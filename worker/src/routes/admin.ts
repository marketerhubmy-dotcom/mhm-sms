import { Hono } from 'hono';
import { microsToDecimal } from '../lib/money';
import { OnlineSimProvider } from '../providers/sms/onlinesim';
import { STATUS_LABEL_MS } from '../lib/orderState';
import { audit } from '../services/audit';
import { AppError, listCountries, listServices } from '../services/catalog';
import { getOrder, getProviderBalance, refreshOrder, resolveReconciliation, type OrderRow, type PaymentRow } from '../services/orders';
import { getMeta, getSettings, intSetting, updateSettings } from '../services/settings';
import { enforceRateLimit, jsonBody, requireAdmin, type HonoEnv } from '../http';

export const adminRoutes = new Hono<HonoEnv>();
adminRoutes.use('*', requireAdmin);

const PAGE = 50;
function page(c: { req: { query: (k: string) => string | undefined } }) {
  const p = Math.max(1, Math.min(1000, Number(c.req.query('page') ?? '1') || 1));
  return { limit: PAGE, offset: (p - 1) * PAGE, page: p };
}

adminRoutes.get('/overview', async (c) => {
  const app = c.get('app');
  const settings = await getSettings(app.db);
  const balanceMeta = await getMeta(app.db, 'provider_balance');
  const balance = balanceMeta ? (JSON.parse(balanceMeta.value) as { balanceMicros: number; frozenMicros: number }) : null;
  const counts = await app.db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all<{ status: string; n: number }>();
  const refunds = await app.db.prepare("SELECT COUNT(*) AS n FROM refunds WHERE status IN ('requested','approved')").first<{ n: number }>();
  const users = await app.db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const threshold = intSetting(settings, 'low_balance_threshold_micros');
  return c.json({
    mode: app.config.mode,
    appEnv: app.config.appEnv,
    smsProvider: app.config.smsProvider,
    paymentProvider: app.config.paymentProvider,
    purchasesEnabled: app.config.purchasesEnabled,
    paymentsEnabled: app.config.paymentsEnabled,
    providerCurrency: settings.provider_currency,
    balance: balance
      ? { balance: microsToDecimal(balance.balanceMicros), frozen: microsToDecimal(balance.frozenMicros), checkedAt: balanceMeta!.updated_at, low: balance.balanceMicros < threshold }
      : null,
    orderCounts: Object.fromEntries(counts.results.map((r) => [r.status, r.n])),
    openRefunds: refunds?.n ?? 0,
    users: users?.n ?? 0,
  });
});

adminRoutes.post('/provider/balance/refresh', async (c) => {
  const app = c.get('app');
  const b = await getProviderBalance(app, 0);
  if (!b) throw new AppError('PROVIDER_UNAVAILABLE', 502, 'Baki pembekal tidak dapat disemak sekarang.');
  return c.json({ ok: true, checkedAt: b.checkedAt });
});

adminRoutes.get('/provider/operations', async (c) => {
  const app = c.get('app');
  const ops = await app.sms.listOperations();
  if (ops == null) throw new AppError('PROVIDER_UNAVAILABLE', 502, 'Senarai operasi pembekal tidak dapat dimuatkan.');
  const known = await app.db.prepare('SELECT provider_tzid, ref FROM orders WHERE provider_tzid IS NOT NULL').all<{ provider_tzid: string; ref: string }>();
  const map = new Map(known.results.map((k) => [k.provider_tzid, k.ref]));
  return c.json({ operations: ops.map((o) => ({ ...o, matchedOrderRef: map.get(o.tzid) ?? null })) });
});

// ---------------- Pesanan ----------------
adminRoutes.get('/orders', async (c) => {
  const app = c.get('app');
  const { limit, offset, page: p } = page(c);
  const q = (c.req.query('q') ?? '').trim();
  const status = c.req.query('status') ?? '';
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q) {
    where.push('(o.ref LIKE ? OR u.email LIKE ? OR o.phone_number LIKE ? OR o.service_name LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  if (status && status in STATUS_LABEL_MS) {
    where.push('o.status = ?');
    args.push(status);
  }
  const sql = `SELECT o.id, o.ref, o.mode, o.status, o.country_name, o.service_name, o.price_sen, o.cost_sen, o.phone_number, o.sms_count, o.last_error_code, o.created_at, u.email
    FROM orders o JOIN users u ON u.id = o.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
  const rows = await app.db.prepare(sql).bind(...args, limit + 1, offset).all();
  return c.json({ orders: rows.results.slice(0, limit), page: p, hasMore: rows.results.length > limit });
});

adminRoutes.get('/orders/:id', async (c) => {
  const app = c.get('app');
  const o = await getOrder(app.db, c.req.param('id'));
  if (!o) throw new AppError('NOT_FOUND', 404, 'Pesanan tidak dijumpai.');
  const user = await app.db.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(o.user_id).first();
  const payment = await app.db.prepare('SELECT * FROM payments WHERE order_id = ?').bind(o.id).first<PaymentRow>();
  const events = await app.db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id ASC').bind(o.id).all();
  const refund = await app.db.prepare('SELECT * FROM refunds WHERE order_id = ?').bind(o.id).first();
  // Kandungan SMS/OTP TIDAK dipaparkan kepada admin secara lalai; hanya bilangan.
  const { ...order } = o as OrderRow;
  return c.json({ order, user, payment, events: events.results, refund });
});

/**
 * Diagnostik: bandingkan keadaan pesanan dalam sistem dengan getState pembekal.
 * Kandungan SMS TIDAK dipulangkan — hanya bilangan, status dan baki masa.
 */
adminRoutes.post('/orders/:id/provider-check', async (c) => {
  const app = c.get('app');
  const admin = c.get('user')!;
  await enforceRateLimit(c, `provider-check:${admin.id}`, 20, 60_000);
  const o = await getOrder(app.db, c.req.param('id'));
  if (!o) throw new AppError('NOT_FOUND', 404, 'Pesanan tidak dijumpai.');
  if (!o.provider_tzid) throw new AppError('NO_OPERATION', 409, 'Pesanan ini tiada operasi pembekal (nombor belum dikeluarkan).');
  const started = app.now();
  const op = await app.sms.getOperation(o.provider_tzid);
  const stored = await app.db.prepare('SELECT COUNT(*) AS n FROM sms_messages WHERE order_id = ?').bind(o.id).first<{ n: number }>();
  const provider =
    op.kind === 'found'
      ? { result: 'found', status: op.status, messageCount: op.messages.length, timeLeftS: op.timeLeftS, numberMatches: op.number == null || op.number === o.phone_number }
      : op.kind === 'not_found'
        ? { result: 'not_found' }
        : { result: 'error', code: op.code };
  const local = { status: o.status, smsCount: o.sms_count, storedMessages: stored?.n ?? 0, lastPolledAt: o.last_polled_at, lastErrorCode: o.last_error_code };
  const consistent =
    op.kind === 'found'
      ? o.status === 'active' && op.messages.length === o.sms_count && (op.number == null || op.number === o.phone_number)
      : op.kind === 'not_found'
        ? o.status !== 'active'
        : null;
  await audit(app.db, {
    actor: admin.id,
    action: 'order.provider_check',
    targetType: 'order',
    targetId: o.id,
    details: { result: provider.result, consistent },
    now: app.now(),
  });
  return c.json({ tzid: o.provider_tzid, provider, local, consistent, checkedAt: app.now(), ms: app.now() - started });
});

/** Diagnostik getState OnlineSIM (variasi parameter). Tiada kandungan SMS. */
adminRoutes.post('/orders/:id/provider-diagnose', async (c) => {
  const app = c.get('app');
  const admin = c.get('user')!;
  await enforceRateLimit(c, `provider-diagnose:${admin.id}`, 5, 60_000);
  const o = await getOrder(app.db, c.req.param('id'));
  if (!o?.provider_tzid) throw new AppError('NO_OPERATION', 409, 'Pesanan ini tiada operasi pembekal.');
  if (!(app.sms instanceof OnlineSimProvider)) throw new AppError('NOT_SUPPORTED', 409, 'Diagnostik hanya untuk OnlineSIM.');
  const results = await app.sms.diagnoseState(o.provider_tzid);
  await audit(app.db, { actor: admin.id, action: 'order.provider_diagnose', targetType: 'order', targetId: o.id, details: results.map((r) => ({ l: r.label.slice(0, 12), r: r.result, ms: r.ms })), now: app.now() });
  return c.json({ tzid: o.provider_tzid, results });
});

/** Paksa satu polling melalui laluan biasa (refreshOrder) untuk menyegerakkan SMS/status daripada pembekal. */
adminRoutes.post('/orders/:id/provider-sync', async (c) => {
  const app = c.get('app');
  const admin = c.get('user')!;
  await enforceRateLimit(c, `provider-sync:${admin.id}`, 20, 60_000);
  const o = await getOrder(app.db, c.req.param('id'));
  if (!o) throw new AppError('NOT_FOUND', 404, 'Pesanan tidak dijumpai.');
  if (o.status !== 'active') throw new AppError('INVALID_STATE', 409, 'Hanya pesanan aktif boleh disegerakkan.');
  await refreshOrder(app, o.id, { force: true });
  await audit(app.db, { actor: admin.id, action: 'order.provider_sync', targetType: 'order', targetId: o.id, now: app.now() });
  return c.json({ ok: true });
});

adminRoutes.post('/orders/:id/reconcile', async (c) => {
  const app = c.get('app');
  const admin = c.get('user')!;
  const b = await jsonBody<{ outcome?: string; tzid?: string; note?: string }>(c);
  if (b.outcome === 'issued') {
    if (!b.tzid || !/^\d+$/.test(b.tzid)) throw new AppError('BAD_REQUEST', 400, 'ID operasi pembekal diperlukan.');
    await resolveReconciliation(app, admin.id, c.req.param('id'), { outcome: 'issued', tzid: b.tzid, note: String(b.note ?? '') });
  } else if (b.outcome === 'not_issued') {
    await resolveReconciliation(app, admin.id, c.req.param('id'), { outcome: 'not_issued', note: String(b.note ?? '') });
  } else throw new AppError('BAD_REQUEST', 400, 'Keputusan tidak sah.');
  return c.json({ ok: true });
});

// ---------------- Pelanggan ----------------
adminRoutes.get('/customers', async (c) => {
  const app = c.get('app');
  const { limit, offset, page: p } = page(c);
  const q = (c.req.query('q') ?? '').trim();
  const rows = await app.db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
        (SELECT COALESCE(SUM(o.price_sen),0) FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.user_id = u.id AND p.status = 'paid') AS paid_sen
       FROM users u ${q ? 'WHERE u.email LIKE ? OR u.name LIKE ?' : ''} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...(q ? [`%${q}%`, `%${q}%`] : []), limit + 1, offset)
    .all();
  return c.json({ customers: rows.results.slice(0, limit), page: p, hasMore: rows.results.length > limit });
});

adminRoutes.post('/customers/:id', async (c) => {
  const app = c.get('app');
  const admin = c.get('user')!;
  const id = c.req.param('id');
  const b = await jsonBody<{ status?: string; role?: string }>(c);
  const target = await app.db.prepare('SELECT id, role, status FROM users WHERE id = ?').bind(id).first<{ id: string; role: string; status: string }>();
  if (!target) throw new AppError('NOT_FOUND', 404, 'Pengguna tidak dijumpai.');
  if (id === admin.id) throw new AppError('SELF_CHANGE', 400, 'Anda tidak boleh mengubah peranan/status akaun sendiri.');
  const now = app.now();
  if (b.status === 'active' || b.status === 'disabled') {
    await app.db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').bind(b.status, now, id).run();
    if (b.status === 'disabled') await app.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    await audit(app.db, { actor: admin.id, action: 'user.status', targetType: 'user', targetId: id, details: { from: target.status, to: b.status }, now });
  }
  if (b.role === 'customer' || b.role === 'admin') {
    await app.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').bind(b.role, now, id).run();
    await app.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
    await audit(app.db, { actor: admin.id, action: 'user.role', targetType: 'user', targetId: id, details: { from: target.role, to: b.role }, now });
  }
  return c.json({ ok: true });
});

// ---------------- Tetapan harga ----------------
adminRoutes.get('/settings', async (c) => c.json({ settings: await getSettings(c.get('app').db) }));

adminRoutes.put('/settings', async (c) => {
  const app = c.get('app');
  const b = await jsonBody<Record<string, unknown>>(c);
  try {
    await updateSettings(app.db, c.get('user')!.id, b, app.now());
  } catch (e) {
    throw new AppError('INVALID_SETTING', 400, (e as Error).message);
  }
  return c.json({ settings: await getSettings(app.db) });
});

adminRoutes.get('/countries', async (c) => {
  const { countries, stale } = await listCountries(c.get('app'), { includeDisabled: true });
  return c.json({ countries, stale });
});

adminRoutes.put('/countries/:code', async (c) => {
  const app = c.get('app');
  const code = Number(c.req.param('code'));
  const b = await jsonBody<{ enabled?: boolean }>(c);
  if (!Number.isInteger(code) || typeof b.enabled !== 'boolean') throw new AppError('BAD_REQUEST', 400, 'Data tidak sah.');
  const now = app.now();
  await app.db
    .prepare('INSERT INTO country_settings (country_code, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(country_code) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at')
    .bind(code, b.enabled ? 1 : 0, now)
    .run();
  await audit(app.db, { actor: c.get('user')!.id, action: 'catalog.country_toggle', targetType: 'country', targetId: String(code), details: { enabled: b.enabled }, now });
  return c.json({ ok: true });
});

adminRoutes.put('/services/:slug', async (c) => {
  const app = c.get('app');
  const slug = c.req.param('slug');
  const b = await jsonBody<{ enabled?: boolean }>(c);
  if (typeof b.enabled !== 'boolean') throw new AppError('BAD_REQUEST', 400, 'Data tidak sah.');
  const now = app.now();
  await app.db
    .prepare('INSERT INTO service_settings (slug, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at')
    .bind(slug, b.enabled ? 1 : 0, now)
    .run();
  await audit(app.db, { actor: c.get('user')!.id, action: 'catalog.service_toggle', targetType: 'service', targetId: slug, details: { enabled: b.enabled }, now });
  return c.json({ ok: true });
});

adminRoutes.get('/catalog/:code', async (c) => {
  const app = c.get('app');
  const code = Number(c.req.param('code'));
  const { services, stale, fetchedAt } = await listServices(app, code, { includeHidden: true, force: c.req.query('refresh') === '1' });
  return c.json({ services: services.map((s) => ({ ...s, cost: microsToDecimal(s.costMicros) })), stale, fetchedAt });
});

adminRoutes.put('/overrides', async (c) => {
  const app = c.get('app');
  const b = await jsonBody<{ countryCode?: number; serviceSlug?: string; priceSen?: number | null }>(c);
  const code = Number(b.countryCode);
  const slug = String(b.serviceSlug ?? '');
  if (!Number.isInteger(code) || !slug) throw new AppError('BAD_REQUEST', 400, 'Data tidak sah.');
  const now = app.now();
  const before = await app.db.prepare('SELECT price_sen FROM price_overrides WHERE country_code = ? AND service_slug = ?').bind(code, slug).first<{ price_sen: number }>();
  if (b.priceSen == null) {
    await app.db.prepare('DELETE FROM price_overrides WHERE country_code = ? AND service_slug = ?').bind(code, slug).run();
  } else {
    if (!Number.isInteger(b.priceSen) || b.priceSen < 100 || b.priceSen > 1_000_000) throw new AppError('BAD_REQUEST', 400, 'Harga override mesti antara RM1.00 dan RM10,000.');
    await app.db
      .prepare('INSERT INTO price_overrides (country_code, service_slug, price_sen, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(country_code, service_slug) DO UPDATE SET price_sen = excluded.price_sen, updated_at = excluded.updated_at')
      .bind(code, slug, b.priceSen, now)
      .run();
  }
  await audit(app.db, {
    actor: c.get('user')!.id,
    action: 'pricing.override',
    targetType: 'price',
    targetId: `${code}:${slug}`,
    details: { from: before?.price_sen ?? null, to: b.priceSen ?? null },
    now,
  });
  return c.json({ ok: true });
});

// ---------------- Laporan ----------------
adminRoutes.get('/reports', async (c) => {
  const app = c.get('app');
  const now = app.now();
  const from = Number(c.req.query('from') ?? now - 30 * 86_400_000);
  const to = Number(c.req.query('to') ?? now);
  const mode = c.req.query('mode') === 'demo' ? 'demo' : 'live';
  // Hasil: bayaran yang disahkan. Kos: snapshot kos bagi pesanan yang nombornya dikeluarkan (pembekal boleh caj walaupun tiada SMS).
  const sum = await app.db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN p.status = 'paid' THEN o.price_sen END), 0) AS revenue_sen,
         COALESCE(SUM(CASE WHEN o.provider_tzid IS NOT NULL THEN o.cost_sen END), 0) AS cost_sen,
         COUNT(CASE WHEN p.status = 'paid' THEN 1 END) AS paid_orders,
         COUNT(CASE WHEN o.provider_tzid IS NOT NULL THEN 1 END) AS issued_orders
       FROM orders o JOIN payments p ON p.order_id = o.id
       WHERE o.mode = ? AND COALESCE(o.paid_at, o.created_at) BETWEEN ? AND ?`,
    )
    .bind(mode, from, to)
    .first<{ revenue_sen: number; cost_sen: number; paid_orders: number; issued_orders: number }>();
  const refunds = await app.db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN r.status = 'processed' THEN r.amount_sen END), 0) AS processed_sen,
        COALESCE(SUM(CASE WHEN r.status IN ('requested','approved') THEN r.amount_sen END), 0) AS pending_sen
       FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.mode = ? AND r.created_at BETWEEN ? AND ?`,
    )
    .bind(mode, from, to)
    .first<{ processed_sen: number; pending_sen: number }>();
  const daily = await app.db
    .prepare(
      `SELECT date(COALESCE(o.paid_at, o.created_at) / 1000, 'unixepoch', '+8 hours') AS day,
         COALESCE(SUM(CASE WHEN p.status = 'paid' THEN o.price_sen END), 0) AS revenue_sen,
         COALESCE(SUM(CASE WHEN o.provider_tzid IS NOT NULL THEN o.cost_sen END), 0) AS cost_sen
       FROM orders o JOIN payments p ON p.order_id = o.id
       WHERE o.mode = ? AND COALESCE(o.paid_at, o.created_at) BETWEEN ? AND ?
       GROUP BY day ORDER BY day DESC LIMIT 60`,
    )
    .bind(mode, from, to)
    .all();
  const revenue = sum?.revenue_sen ?? 0;
  const cost = sum?.cost_sen ?? 0;
  const refunded = refunds?.processed_sen ?? 0;
  return c.json({
    mode,
    from,
    to,
    revenueSen: revenue,
    refundedSen: refunded,
    pendingRefundSen: refunds?.pending_sen ?? 0,
    netRevenueSen: revenue - refunded,
    estimatedCostSen: cost,
    grossMarginSen: revenue - refunded - cost,
    paidOrders: sum?.paid_orders ?? 0,
    issuedOrders: sum?.issued_orders ?? 0,
    daily: daily.results,
  });
});

// ---------------- Refund ----------------
adminRoutes.get('/refunds', async (c) => {
  const app = c.get('app');
  const status = c.req.query('status');
  const rows = await app.db
    .prepare(
      `SELECT r.*, o.ref, o.service_name, o.country_name, o.status AS order_status, u.email FROM refunds r
       JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id
       ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 200`,
    )
    .bind(...(status ? [status] : []))
    .all();
  return c.json({ refunds: rows.results });
});

const REFUND_TRANSITIONS: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['processed', 'rejected'],
  processed: [],
  rejected: [],
};

adminRoutes.post('/refunds/:id', async (c) => {
  const app = c.get('app');
  const admin = c.get('user')!;
  const b = await jsonBody<{ status?: string; note?: string; externalRef?: string }>(c);
  const r = await app.db.prepare('SELECT * FROM refunds WHERE id = ?').bind(c.req.param('id')).first<{ id: string; status: string; order_id: string; amount_sen: number }>();
  if (!r) throw new AppError('NOT_FOUND', 404, 'Refund tidak dijumpai.');
  const to = String(b.status ?? '');
  if (!REFUND_TRANSITIONS[r.status]?.includes(to)) throw new AppError('INVALID_STATE', 409, `Tidak boleh tukar ${r.status} -> ${to}.`);
  const note = String(b.note ?? '').trim().slice(0, 500);
  if (note.length < 3) throw new AppError('NOTE_REQUIRED', 400, 'Nota diperlukan.');
  const externalRef = String(b.externalRef ?? '').trim().slice(0, 100);
  // "processed" hanya selepas wang benar-benar dipulangkan; rujukan transaksi wajib.
  if (to === 'processed' && !externalRef) throw new AppError('REF_REQUIRED', 400, 'Rujukan transaksi pemulangan wajib untuk status "processed".');
  const order = await getOrder(app.db, r.order_id);
  if (order?.status === 'needs_reconciliation' || order?.status === 'purchasing') {
    throw new AppError('PROVIDER_UNKNOWN', 409, 'Status pembekal belum disahkan. Selesaikan rekonsiliasi dahulu.');
  }
  const now = app.now();
  const res = await app.db
    .prepare('UPDATE refunds SET status = ?, admin_note = ?, external_ref = COALESCE(NULLIF(?, \'\'), external_ref), resolved_by = ?, updated_at = ? WHERE id = ? AND status = ?')
    .bind(to, note, externalRef, admin.id, now, r.id, r.status)
    .run();
  if ((res.meta.changes ?? 0) !== 1) throw new AppError('INVALID_STATE', 409, 'Status refund telah berubah. Sila muat semula.');
  await audit(app.db, { actor: admin.id, action: `refund.${to}`, targetType: 'refund', targetId: r.id, details: { orderId: r.order_id, amountSen: r.amount_sen, externalRef: externalRef || undefined }, now });
  return c.json({ ok: true });
});

// ---------------- Audit ----------------
adminRoutes.get('/audit', async (c) => {
  const app = c.get('app');
  const { limit, offset, page: p } = page(c);
  const rows = await app.db
    .prepare('SELECT a.*, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT ? OFFSET ?')
    .bind(limit + 1, offset)
    .all();
  return c.json({ logs: rows.results.slice(0, limit), page: p, hasMore: rows.results.length > limit });
});
