import { orderRef, uuid } from '../lib/crypto';
import { senToRm } from '../lib/money';
import { canTransition, PAYABLE_STATES, refundEligible, type OrderStatus } from '../lib/orderState';
import type { AppCtx } from './context';
import { audit } from './audit';
import { AppError, isCountryAvailable, listServices } from './catalog';
import { getMeta, getSettings, intSetting, pricingFrom, setMeta } from './settings';

export interface OrderRow {
  id: string;
  ref: string;
  user_id: string;
  kind: string;
  mode: 'demo' | 'live';
  status: OrderStatus;
  country_code: number;
  country_name: string;
  service_slug: string;
  service_name: string;
  cost_micros: number;
  cost_currency: string;
  fx_rate_micros: number;
  markup_bps: number;
  fixed_fee_sen: number;
  min_price_sen: number;
  rounding_sen: number;
  override_applied: number;
  cost_sen: number;
  price_sen: number;
  provider_tzid: string | null;
  phone_number: string | null;
  provider_status: string | null;
  number_expires_at: number | null;
  guard_until: number | null;
  sms_count: number;
  late_payment: number;
  payment_due_at: number;
  paid_at: number | null;
  purchase_started_at: number | null;
  activated_at: number | null;
  closed_at: number | null;
  next_poll_at: number | null;
  poll_interval_s: number;
  last_polled_at: number | null;
  last_error_code: string | null;
  created_at: number;
  updated_at: number;
}

export interface PaymentRow {
  id: string;
  order_id: string;
  provider: 'mock' | 'chip';
  bill_code: string | null;
  payment_url: string | null;
  amount_sen: number;
  currency: string;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'amount_mismatch';
  provider_ref: string | null;
  verified_amount_sen: number | null;
  verified_at: number | null;
}

export async function getOrder(db: D1Database, id: string): Promise<OrderRow | null> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<OrderRow>();
}

/** Ambil pesanan HANYA jika dimiliki pengguna. Pulang null jika tidak wujud ATAU milik orang lain (tiada kebocoran kewujudan). */
export async function getOwnedOrder(db: D1Database, id: string, userId: string): Promise<OrderRow | null> {
  return db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').bind(id, userId).first<OrderRow>();
}

/**
 * Peralihan status bersyarat (compare-and-set). Hanya berjaya jika status semasa = `from`.
 * Ini menghalang dua request serentak daripada melakukan peralihan yang sama.
 */
export async function transition(
  ctx: AppCtx,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  actor: string,
  reason: string | null,
  sets: Record<string, string | number | null> = {},
): Promise<boolean> {
  if (!canTransition(from, to)) throw new Error(`Peralihan tidak dibenarkan: ${from} -> ${to}`);
  const now = ctx.now();
  const cols = Object.keys(sets);
  for (const c of cols) if (!/^[a-z_]+$/.test(c)) throw new Error('Nama lajur tidak sah');
  const setSql = ['status = ?', 'updated_at = ?', ...cols.map((c) => `${c} = ?`)].join(', ');
  const res = await ctx.db
    .prepare(`UPDATE orders SET ${setSql} WHERE id = ? AND status = ?`)
    .bind(to, now, ...cols.map((c) => sets[c]), orderId, from)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return false;
  await ctx.db
    .prepare('INSERT INTO order_events (order_id, from_status, to_status, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(orderId, from, to, actor, reason, now)
    .run();
  return true;
}

// ---------------------------------------------------------------------------
// Penciptaan pesanan
// ---------------------------------------------------------------------------

const MAX_OPEN_UNPAID = 3;

export async function getProviderBalance(ctx: AppCtx, maxAgeMs = 5 * 60_000): Promise<{ balanceMicros: number; checkedAt: number } | null> {
  const meta = await getMeta(ctx.db, 'provider_balance');
  if (meta && ctx.now() - meta.updated_at < maxAgeMs) {
    const v = JSON.parse(meta.value) as { balanceMicros: number };
    return { balanceMicros: v.balanceMicros, checkedAt: meta.updated_at };
  }
  try {
    const b = await ctx.sms.getBalance();
    await setMeta(ctx.db, 'provider_balance', JSON.stringify(b), ctx.now());
    return { balanceMicros: b.balanceMicros, checkedAt: ctx.now() };
  } catch {
    return meta ? { balanceMicros: (JSON.parse(meta.value) as { balanceMicros: number }).balanceMicros, checkedAt: meta.updated_at } : null;
  }
}

export const STAGING_REAL_DAILY_LIMIT = 5;

export async function createOrder(
  ctx: AppCtx,
  user: { id: string; email: string; name: string; role?: string },
  input: { countryCode: number; serviceSlug: string; expectedPriceSen?: number },
): Promise<{ order: OrderRow; paymentUrl: string }> {
  if (!ctx.config.purchasesEnabled || !ctx.config.paymentsEnabled) {
    throw new AppError('SALES_DISABLED', 503, 'Pembelian belum dibuka buat masa ini. Sila cuba lagi kemudian.');
  }
  if (ctx.config.stagingRealNumbers) {
    // Staging dengan nombor OnlineSIM SEBENAR: kos sebenar kepada MHM, jadi hanya admin & dihadkan sehari.
    if (user.role !== 'admin') throw new AppError('STAGING_ADMIN_ONLY', 403, 'Staging: pembelian nombor sebenar hanya untuk admin.');
    // Kira hanya pesanan nombor SEBENAR yang boleh menelan kos: pembelian telah bermula dalam 24 jam,
    // atau masih menunggu bayaran (akan membeli jika dibayar). Pesanan simulasi/gagal/batal tidak dikira.
    const today = await ctx.db
      .prepare("SELECT COUNT(*) AS n FROM orders WHERE mode = 'live' AND (purchase_started_at > ? OR status = 'pending_payment')")
      .bind(ctx.now() - 86_400_000)
      .first<{ n: number }>();
    if ((today?.n ?? 0) >= STAGING_REAL_DAILY_LIMIT) {
      throw new AppError('STAGING_DAILY_LIMIT', 429, `Staging: had ${STAGING_REAL_DAILY_LIMIT} pesanan sehari telah dicapai.`);
    }
  }
  const country = await isCountryAvailable(ctx, input.countryCode);
  if (!country) throw new AppError('COUNTRY_UNAVAILABLE', 400, 'Negara ini tidak tersedia.');

  const open = await ctx.db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'pending_payment'")
    .bind(user.id)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_UNPAID) {
    throw new AppError('TOO_MANY_UNPAID', 429, 'Anda mempunyai terlalu banyak pesanan belum dibayar. Selesaikan atau batalkan dahulu.');
  }

  const settings = await getSettings(ctx.db);
  // Semakan segar (bukan cache) stok & harga sebelum pesanan disahkan.
  // Semakan stok & harga terkini: data katalog mesti berusia ≤ 60 s (elak had kekerapan API pembekal).
  const { services } = await listServices(ctx, input.countryCode, { maxAgeMs: 60_000, settings });
  const svc = services.find((s) => s.slug === input.serviceSlug);
  if (!svc) throw new AppError('SERVICE_UNAVAILABLE', 400, 'Servis ini tidak tersedia untuk negara yang dipilih.');
  if (svc.stock <= 0) throw new AppError('OUT_OF_STOCK', 409, 'Stok nombor untuk pilihan ini telah habis. Cuba negara lain atau sebentar lagi.');
  if (input.expectedPriceSen != null && input.expectedPriceSen !== svc.priceSen) {
    throw new AppError('PRICE_CHANGED', 409, `Harga telah berubah kepada RM${senToRm(svc.priceSen)}. Sila sahkan semula.`, { priceSen: svc.priceSen });
  }

  const balance = await getProviderBalance(ctx);
  if (!balance || balance.balanceMicros < svc.costMicros) {
    await audit(ctx.db, { actor: null, action: 'provider.low_balance_block', details: { needMicros: svc.costMicros }, now: ctx.now() });
    throw new AppError('TEMPORARILY_UNAVAILABLE', 503, 'Servis tidak dapat diproses buat sementara waktu. Tiada bayaran dikenakan. Sila cuba lagi kemudian.');
  }

  const pricing = pricingFrom(settings);
  const now = ctx.now();
  const id = uuid();
  const ref = orderRef();
  const paymentId = uuid();
  const dueAt = now + intSetting(settings, 'payment_window_minutes') * 60_000;
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO orders (id, ref, user_id, mode, status, country_code, country_name, service_slug, service_name,
          cost_micros, cost_currency, fx_rate_micros, markup_bps, fixed_fee_sen, min_price_sen, rounding_sen, override_applied,
          cost_sen, price_sen, payment_due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, ref, user.id, ctx.config.mode, input.countryCode, country.name, svc.slug, svc.name,
        svc.costMicros, settings.provider_currency ?? 'USD', pricing.fxRateMicros, pricing.markupBps, pricing.fixedFeeSen,
        pricing.minPriceSen, pricing.roundingSen, svc.overrideApplied ? 1 : 0, svc.costSen, svc.priceSen, dueAt, now, now,
      ),
    ctx.db
      .prepare("INSERT INTO payments (id, order_id, provider, amount_sen, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'MYR', 'created', ?, ?)")
      .bind(paymentId, id, ctx.payment.name, svc.priceSen, now, now),
    ctx.db
      .prepare("INSERT INTO order_events (order_id, from_status, to_status, actor, reason, created_at) VALUES (?, NULL, 'pending_payment', ?, 'Pesanan dicipta', ?)")
      .bind(id, `customer:${user.id}`, now),
  ]);

  let bill;
  try {
    bill = await ctx.payment.createBill({
      orderRef: ref,
      amountSen: svc.priceSen,
      title: `MHM SMS ${ref}`,
      description: `Nombor SMS ${svc.name} (${country.name}) - ${ref}`,
      customerEmail: user.email,
      customerName: user.name,
      dueAt: dueAt,
      returnUrl: `${ctx.config.baseUrl}/bayar/kembali?order=${id}`,
      callbackUrl: `${ctx.config.baseUrl}/api/payments/${ctx.payment.name}/callback`,
    });
  } catch (e) {
    const providerCode = (e as { code?: string })?.code ?? 'UNKNOWN';
    console.error('Bil pembayaran gagal dicipta:', providerCode);
    await audit(ctx.db, { actor: null, action: 'payment.create_failed', targetType: 'order', targetId: id, details: { provider: ctx.payment.name, code: providerCode }, now: ctx.now() });
    await transition(ctx, id, 'pending_payment', 'payment_failed', 'system', `Bil pembayaran gagal dicipta: ${providerCode}`);
    await ctx.db.prepare("UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ?").bind(ctx.now(), paymentId).run();
    throw new AppError(
      'PAYMENT_PROVIDER_ERROR',
      502,
      'Halaman pembayaran tidak dapat disediakan. Tiada bayaran dikenakan. Sila cuba lagi.',
      ctx.config.appEnv !== 'production' ? { providerCode } : undefined,
    );
  }
  await ctx.db
    .prepare("UPDATE payments SET bill_code = ?, payment_url = ?, status = 'pending', updated_at = ? WHERE id = ?")
    .bind(bill.billCode, bill.paymentUrl, ctx.now(), paymentId)
    .run();
  const order = (await getOrder(ctx.db, id))!;
  return { order, paymentUrl: bill.paymentUrl };
}

// ---------------------------------------------------------------------------
// Pembayaran: isyarat (callback/redirect/cron) -> sahkan dengan pembekal -> apply (idempotent)
// ---------------------------------------------------------------------------

export type PaymentOutcome = 'paid' | 'already_paid' | 'pending' | 'failed' | 'mismatch' | 'unknown' | 'not_found';

export async function processPaymentSignal(ctx: AppCtx, billCode: string, source: string): Promise<PaymentOutcome> {
  const payment = await ctx.db.prepare('SELECT * FROM payments WHERE bill_code = ?').bind(billCode).first<PaymentRow>();
  if (!payment) return 'not_found';
  if (payment.status === 'paid') {
    // Callback berulang: tiada kesan sampingan. Pastikan langkah pembelian tidak tertinggal (idempotent).
    await attemptPurchase(ctx, payment.order_id);
    return 'already_paid';
  }
  if (payment.provider !== ctx.payment.name) return 'unknown';

  const order = await getOrder(ctx.db, payment.order_id);
  if (!order) return 'not_found';

  const st = await ctx.payment.fetchStatus(billCode);
  const now = ctx.now();
  if (st.status === 'paid') {
    const refOk = st.orderRef === order.ref;
    const amountOk = st.amountSen === payment.amount_sen && payment.amount_sen === order.price_sen && payment.currency === 'MYR' && st.currency === 'MYR';
    if (!refOk || !amountOk) {
      const r = await ctx.db
        .prepare("UPDATE payments SET status = 'amount_mismatch', verified_amount_sen = ?, provider_ref = ?, updated_at = ? WHERE id = ? AND status IN ('created','pending','failed')")
        .bind(st.amountSen, st.providerRef, now, payment.id)
        .run();
      if ((r.meta.changes ?? 0) > 0) {
        await ctx.db.prepare('UPDATE orders SET last_error_code = ?, updated_at = ? WHERE id = ?').bind('PAYMENT_MISMATCH', now, order.id).run();
        await audit(ctx.db, {
          actor: null,
          action: 'payment.mismatch',
          targetType: 'order',
          targetId: order.id,
          details: { source, expectedSen: payment.amount_sen, gotSen: st.amountSen, refOk },
          now,
        });
      }
      return 'mismatch';
    }
    // Hanya SATU pemproses boleh menukar payment kepada 'paid'.
    const r = await ctx.db
      .prepare("UPDATE payments SET status = 'paid', verified_amount_sen = ?, provider_ref = ?, verified_at = ?, updated_at = ? WHERE id = ? AND status IN ('created','pending','failed')")
      .bind(st.amountSen, st.providerRef, now, now, payment.id)
      .run();
    if ((r.meta.changes ?? 0) === 1) {
      const fresh = (await getOrder(ctx.db, order.id))!;
      if (PAYABLE_STATES.includes(fresh.status)) {
        const late = fresh.status !== 'pending_payment';
        await transition(ctx, order.id, fresh.status, 'paid', `payment:${source}`, late ? 'Bayaran lewat disahkan' : 'Bayaran disahkan', {
          paid_at: now,
          late_payment: late ? 1 : 0,
        });
      }
      await audit(ctx.db, { actor: null, action: 'payment.verified', targetType: 'order', targetId: order.id, details: { source, amountSen: st.amountSen }, now });
    }
    await attemptPurchase(ctx, order.id);
    return (r.meta.changes ?? 0) === 1 ? 'paid' : 'already_paid';
  }
  if (st.status === 'failed') {
    await ctx.db.prepare("UPDATE payments SET status = 'failed', updated_at = ? WHERE id = ? AND status IN ('created','pending')").bind(now, payment.id).run();
    await transition(ctx, order.id, 'pending_payment', 'payment_failed', `payment:${source}`, 'Bayaran gagal');
    return 'failed';
  }
  if (st.status === 'pending' || st.status === 'none') return 'pending';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Pembelian nombor: tuntutan atomik, tiada retry membuta tuli
// ---------------------------------------------------------------------------

export async function attemptPurchase(ctx: AppCtx, orderId: string): Promise<OrderStatus | null> {
  const order = await getOrder(ctx.db, orderId);
  if (!order || order.status !== 'paid') return order?.status ?? null;
  if (!ctx.config.purchasesEnabled || ctx.config.mode !== order.mode) {
    await ctx.db.prepare('UPDATE orders SET last_error_code = ?, updated_at = ? WHERE id = ?').bind('PURCHASES_DISABLED', ctx.now(), orderId).run();
    return 'paid';
  }
  const now = ctx.now();
  // Tuntutan: hanya satu request boleh menukar paid -> purchasing. Yang lain berhenti di sini.
  const claimed = await transition(ctx, orderId, 'paid', 'purchasing', 'system', 'Menempah nombor', { purchase_started_at: now });
  if (!claimed) return (await getOrder(ctx.db, orderId))?.status ?? null;

  const result = await ctx.sms.buyNumber({ countryCode: order.country_code, serviceSlug: order.service_slug });
  if (result.kind === 'ok') {
    let number = result.number;
    let timeLeft = result.timeLeftS;
    if (!number || timeLeft == null) {
      const op = await ctx.sms.getOperation(result.tzid);
      if (op.kind === 'found') {
        number = number ?? op.number;
        timeLeft = timeLeft ?? op.timeLeftS;
      }
    }
    const t = ctx.now();
    try {
      const ok = await transition(ctx, orderId, 'purchasing', 'active', 'system', 'Nombor dikeluarkan', {
        provider_tzid: result.tzid,
        phone_number: number,
        provider_status: 'TZ_NUM_WAIT',
        activated_at: t,
        number_expires_at: t + (timeLeft ?? 900) * 1000,
        guard_until: t + (result.guardS ?? 120) * 1000,
        next_poll_at: t + 5000,
        poll_interval_s: 5,
        last_error_code: null,
      });
      if (!ok) throw new Error('state');
    } catch {
      await transition(ctx, orderId, 'purchasing', 'needs_reconciliation', 'system', 'Nombor diterima tetapi gagal disimpan', {
        last_error_code: 'STORE_FAILED',
        provider_tzid: null,
      });
      await audit(ctx.db, { actor: null, action: 'order.reconciliation_required', targetType: 'order', targetId: orderId, details: { tzid: result.tzid }, now: ctx.now() });
      return 'needs_reconciliation';
    }
    return 'active';
  }
  if (result.kind === 'rejected') {
    await transition(ctx, orderId, 'purchasing', 'purchase_failed', 'system', `Pembekal menolak: ${result.code}`, { last_error_code: result.code, closed_at: ctx.now() });
    await createRefundRequest(ctx, orderId, 'system', 'Nombor tidak dapat disediakan selepas bayaran');
    if (result.code === 'WARNING_LOW_BALANCE') {
      await audit(ctx.db, { actor: null, action: 'provider.low_balance', targetType: 'order', targetId: orderId, now: ctx.now() });
    }
    return 'purchase_failed';
  }
  // Tidak pasti: JANGAN retry, JANGAN refund. Perlu semakan.
  await transition(ctx, orderId, 'purchasing', 'needs_reconciliation', 'system', `Status pembekal tidak diketahui: ${result.code}`, { last_error_code: result.code });
  await audit(ctx.db, { actor: null, action: 'order.reconciliation_required', targetType: 'order', targetId: orderId, details: { code: result.code }, now: ctx.now() });
  return 'needs_reconciliation';
}

// ---------------------------------------------------------------------------
// Polling SMS (berjarak, dengan backoff, hanya pesanan aktif)
// ---------------------------------------------------------------------------

const MAX_POLL_INTERVAL_S = 30;

export async function refreshOrder(ctx: AppCtx, orderId: string, opts: { force?: boolean } = {}): Promise<void> {
  const order = await getOrder(ctx.db, orderId);
  if (!order || order.status !== 'active' || !order.provider_tzid) return;
  const now = ctx.now();
  if (!opts.force && order.next_poll_at != null && order.next_poll_at > now) return;

  // Tuntut slot polling supaya request serentak tidak memanggil pembekal berulang kali.
  const tentativeNext = now + order.poll_interval_s * 1000;
  const claim = await ctx.db
    .prepare("UPDATE orders SET next_poll_at = ?, last_polled_at = ? WHERE id = ? AND status = 'active' AND (next_poll_at IS NULL OR next_poll_at <= ? OR ? = 1)")
    .bind(tentativeNext, now, orderId, now, opts.force ? 1 : 0)
    .run();
  if ((claim.meta.changes ?? 0) === 0) return;

  const op = await ctx.sms.getOperation(order.provider_tzid);
  const t = ctx.now();
  if (op.kind === 'found') {
    const newMsgs = op.messages.slice(order.sms_count);
    if (newMsgs.length) {
      await ctx.db.batch(
        newMsgs.map((body, i) =>
          ctx.db.prepare('INSERT OR IGNORE INTO sms_messages (id, order_id, seq, body, received_at) VALUES (?, ?, ?, ?, ?)').bind(uuid(), orderId, order.sms_count + i, body, t),
        ),
      );
    }
    const smsCount = Math.max(order.sms_count, op.messages.length);
    const interval = newMsgs.length ? 5 : Math.min(MAX_POLL_INTERVAL_S, Math.ceil(order.poll_interval_s * 1.5));
    await ctx.db
      .prepare('UPDATE orders SET sms_count = ?, provider_status = ?, number_expires_at = COALESCE(?, number_expires_at), poll_interval_s = ?, next_poll_at = ?, last_error_code = NULL, updated_at = ? WHERE id = ?')
      .bind(smsCount, op.status, op.timeLeftS != null ? t + op.timeLeftS * 1000 : null, interval, t + interval * 1000, t, orderId)
      .run();
    if (op.status === 'TZ_OVER_OK' || op.status === 'ERROR_NO_ITEMS') {
      await closeLocally(ctx, orderId, smsCount, `Status pembekal: ${op.status}`);
    } else if (op.timeLeftS === 0) {
      await closeLocally(ctx, orderId, smsCount, 'Masa nombor tamat');
    }
    return;
  }
  if (op.kind === 'not_found') {
    // Operasi tiada lagi dalam senarai aktif pembekal -> sudah ditutup/tamat.
    await closeLocally(ctx, orderId, order.sms_count, 'Operasi tidak lagi aktif di pembekal');
    return;
  }
  const interval = Math.min(MAX_POLL_INTERVAL_S, Math.ceil(order.poll_interval_s * 2));
  await ctx.db
    .prepare('UPDATE orders SET poll_interval_s = ?, next_poll_at = ?, last_error_code = ?, updated_at = ? WHERE id = ?')
    .bind(interval, t + interval * 1000, op.code, t, orderId)
    .run();
  // Jika masa sudah lama tamat, hentikan polling.
  if (order.number_expires_at != null && t > order.number_expires_at + 10 * 60_000) {
    await closeLocally(ctx, orderId, order.sms_count, 'Masa tamat (pembekal tidak dapat dihubungi)');
  }
}

async function closeLocally(ctx: AppCtx, orderId: string, smsCount: number, reason: string) {
  await transition(ctx, orderId, 'active', smsCount > 0 ? 'completed' : 'expired', 'system', reason, { closed_at: ctx.now(), next_poll_at: null });
}

// ---------------------------------------------------------------------------
// Tindakan pelanggan
// ---------------------------------------------------------------------------

export async function completeOrder(ctx: AppCtx, order: OrderRow, actor: string): Promise<void> {
  if (order.status !== 'active') throw new AppError('INVALID_STATE', 409, 'Pesanan ini tidak aktif.');
  if (order.sms_count === 0) throw new AppError('NO_SMS_YET', 409, 'Belum ada SMS diterima. Gunakan "Batal" jika anda tidak memerlukan nombor ini.');
  const r = await ctx.sms.completeOperation(order.provider_tzid!);
  if (r.kind !== 'ok') throw new AppError('PROVIDER_ERROR', 502, 'Pesanan tidak dapat ditutup sekarang. Sila cuba sebentar lagi.');
  await transition(ctx, order.id, 'active', 'completed', actor, 'Ditandakan selesai oleh pelanggan', { closed_at: ctx.now(), next_poll_at: null });
}

export async function cancelOrder(ctx: AppCtx, order: OrderRow, actor: string): Promise<void> {
  if (order.status === 'pending_payment') {
    const ok = await transition(ctx, order.id, 'pending_payment', 'cancelled_unpaid', actor, 'Dibatalkan sebelum bayaran');
    if (!ok) throw new AppError('INVALID_STATE', 409, 'Status pesanan telah berubah. Sila muat semula.');
    const p = await ctx.db.prepare('SELECT bill_code FROM payments WHERE order_id = ?').bind(order.id).first<{ bill_code: string | null }>();
    if (p?.bill_code) await ctx.payment.deactivateBill(p.bill_code);
    return;
  }
  if (order.status !== 'active') throw new AppError('INVALID_STATE', 409, 'Pesanan ini tidak boleh dibatalkan.');
  if (order.sms_count > 0) throw new AppError('SMS_RECEIVED', 409, 'SMS telah diterima. Pesanan ini tidak boleh dibatalkan; tandakan sebagai selesai.');
  const now = ctx.now();
  if (order.guard_until && now < order.guard_until) {
    const s = Math.ceil((order.guard_until - now) / 1000);
    throw new AppError('TOO_EARLY', 409, `Pembatalan dibenarkan selepas ${s} saat lagi.`, { retryAfterS: s });
  }
  const r = await ctx.sms.completeOperation(order.provider_tzid!);
  if (r.kind === 'too_early') throw new AppError('TOO_EARLY', 409, 'Pembatalan belum dibenarkan oleh pembekal. Cuba sebentar lagi.');
  if (r.kind !== 'ok') throw new AppError('PROVIDER_ERROR', 502, 'Pesanan tidak dapat dibatalkan sekarang. Sila cuba sebentar lagi.');
  await transition(ctx, order.id, 'active', 'cancelled', actor, 'Dibatalkan tanpa SMS', { closed_at: now, next_poll_at: null });
}

export async function createRefundRequest(ctx: AppCtx, orderId: string, requestedBy: string, reason: string): Promise<'created' | 'exists'> {
  const order = await getOrder(ctx.db, orderId);
  if (!order) throw new AppError('NOT_FOUND', 404, 'Pesanan tidak dijumpai.');
  if (!refundEligible(order.status, order.sms_count)) {
    throw new AppError('REFUND_NOT_ELIGIBLE', 409, 'Pesanan ini tidak layak untuk permohonan refund.');
  }
  const pay = await ctx.db.prepare("SELECT status FROM payments WHERE order_id = ? AND status = 'paid'").bind(orderId).first();
  if (!pay) throw new AppError('REFUND_NOT_ELIGIBLE', 409, 'Tiada bayaran yang disahkan untuk pesanan ini.');
  const now = ctx.now();
  const r = await ctx.db
    .prepare("INSERT OR IGNORE INTO refunds (id, order_id, user_id, amount_sen, status, reason, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, ?)")
    .bind(uuid(), orderId, order.user_id, order.price_sen, reason, requestedBy, now, now)
    .run();
  if ((r.meta.changes ?? 0) === 0) return 'exists';
  await audit(ctx.db, { actor: requestedBy.startsWith('admin:') ? requestedBy.slice(6) : null, action: 'refund.requested', targetType: 'order', targetId: orderId, details: { amountSen: order.price_sen, by: requestedBy }, now });
  return 'created';
}

// ---------------------------------------------------------------------------
// Penyelesaian rekonsiliasi oleh admin
// ---------------------------------------------------------------------------

export async function resolveReconciliation(
  ctx: AppCtx,
  adminId: string,
  orderId: string,
  input: { outcome: 'issued'; tzid: string; note: string } | { outcome: 'not_issued'; note: string },
): Promise<void> {
  const order = await getOrder(ctx.db, orderId);
  if (!order || order.status !== 'needs_reconciliation') throw new AppError('INVALID_STATE', 409, 'Pesanan tidak memerlukan rekonsiliasi.');
  if (!input.note || input.note.trim().length < 5) throw new AppError('NOTE_REQUIRED', 400, 'Nota semakan diperlukan.');
  const now = ctx.now();
  if (input.outcome === 'issued') {
    const op = await ctx.sms.getOperation(input.tzid);
    if (op.kind !== 'found') throw new AppError('TZID_NOT_FOUND', 400, 'Operasi tidak dijumpai sebagai aktif di pembekal. Semak semula ID operasi.');
    const ok = await transition(ctx, orderId, 'needs_reconciliation', 'active', `admin:${adminId}`, input.note.trim(), {
      provider_tzid: input.tzid,
      phone_number: op.number,
      provider_status: op.status,
      activated_at: now,
      number_expires_at: now + (op.timeLeftS ?? 0) * 1000,
      guard_until: now,
      next_poll_at: now,
      poll_interval_s: 5,
      last_error_code: null,
    });
    if (!ok) throw new AppError('INVALID_STATE', 409, 'Status pesanan telah berubah.');
  } else {
    const ok = await transition(ctx, orderId, 'needs_reconciliation', 'purchase_failed', `admin:${adminId}`, input.note.trim(), { closed_at: now });
    if (!ok) throw new AppError('INVALID_STATE', 409, 'Status pesanan telah berubah.');
    await createRefundRequest(ctx, orderId, `admin:${adminId}`, 'Disahkan tiada nombor dikeluarkan (rekonsiliasi)');
  }
  await audit(ctx.db, { actor: adminId, action: 'order.reconciled', targetType: 'order', targetId: orderId, details: { outcome: input.outcome }, now });
}
