import { Hono } from 'hono';
import { STATUS_LABEL_MS, refundEligible, type OrderStatus } from '../lib/orderState';
import { MockPaymentProvider } from '../providers/payment/mock';
import { MockSmsProvider } from '../providers/sms/mock';
import { AppError } from '../services/catalog';
import type { AppCtx } from '../services/context';
import {
  cancelOrder,
  completeOrder,
  createOrder,
  createRefundRequest,
  getOwnedOrder,
  processPaymentSignal,
  refreshOrder,
  type OrderRow,
  type PaymentRow,
} from '../services/orders';
import { enforceRateLimit, jsonBody, keepAlive, requireUser, type HonoEnv } from '../http';

const ACTIVE_STATES: OrderStatus[] = ['pending_payment', 'paid', 'purchasing', 'active', 'needs_reconciliation'];

export function customerOrderView(o: OrderRow, extra: { payment?: PaymentRow | null; refund?: { status: string; created_at: number } | null } = {}) {
  return {
    id: o.id,
    ref: o.ref,
    mode: o.mode,
    status: o.status,
    statusLabel: o.status === 'active' && o.sms_count > 0 ? 'SMS diterima' : STATUS_LABEL_MS[o.status],
    countryCode: o.country_code,
    countryName: o.country_name,
    serviceSlug: o.service_slug,
    serviceName: o.service_name,
    priceSen: o.price_sen,
    phoneNumber: o.phone_number,
    numberExpiresAt: o.number_expires_at,
    guardUntil: o.guard_until,
    smsCount: o.sms_count,
    paymentDueAt: o.payment_due_at,
    paidAt: o.paid_at,
    createdAt: o.created_at,
    closedAt: o.closed_at,
    lateNotice: o.late_payment === 1,
    paymentIssue: o.last_error_code === 'PAYMENT_MISMATCH',
    payment: extra.payment ? { status: extra.payment.status, provider: extra.payment.provider } : null,
    refund: extra.refund ? { status: extra.refund.status, createdAt: extra.refund.created_at } : null,
    canRequestRefund: refundEligible(o.status, o.sms_count) && !extra.refund,
  };
}

async function loadOwned(c: { get: (k: 'app' | 'user') => unknown }, id: string): Promise<OrderRow> {
  const app = c.get('app') as AppCtx;
  const user = c.get('user') as { id: string };
  const o = await getOwnedOrder(app.db, id, user.id);
  // 404 untuk pesanan orang lain juga — tidak dedahkan kewujudannya.
  if (!o) throw new AppError('NOT_FOUND', 404, 'Pesanan tidak dijumpai.');
  return o;
}

export const orderRoutes = new Hono<HonoEnv>();
orderRoutes.use('*', requireUser);

orderRoutes.post('/', async (c) => {
  const app = c.get('app');
  const user = c.get('user')!;
  await enforceRateLimit(c, `order:${user.id}`, 10, 10 * 60_000);
  const b = await jsonBody<{ countryCode?: unknown; serviceSlug?: unknown; expectedPriceSen?: unknown }>(c);
  const countryCode = Number(b.countryCode);
  const serviceSlug = typeof b.serviceSlug === 'string' ? b.serviceSlug : '';
  if (!Number.isInteger(countryCode) || countryCode <= 0 || !/^[a-z0-9_.-]{1,64}$/i.test(serviceSlug)) {
    throw new AppError('BAD_REQUEST', 400, 'Pilihan negara/servis tidak sah.');
  }
  // expectedPriceSen hanya untuk mengesan perubahan harga; harga sebenar SENTIASA dikira di server.
  const expected = b.expectedPriceSen == null ? undefined : Number(b.expectedPriceSen);
  const { order, paymentUrl } = await createOrder(app, user, {
    countryCode,
    serviceSlug,
    expectedPriceSen: Number.isInteger(expected) ? expected : undefined,
  });
  return c.json({ order: customerOrderView(order), paymentUrl }, 201);
});

orderRoutes.get('/', async (c) => {
  const app = c.get('app');
  const user = c.get('user')!;
  const scope = c.req.query('scope') === 'active' ? 'active' : 'history';
  const placeholders = ACTIVE_STATES.map(() => '?').join(',');
  const sql =
    scope === 'active'
      ? `SELECT * FROM orders WHERE user_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC LIMIT 50`
      : `SELECT * FROM orders WHERE user_id = ? AND status NOT IN (${placeholders}) ORDER BY created_at DESC LIMIT 100`;
  const rows = await app.db.prepare(sql).bind(user.id, ...ACTIVE_STATES).all<OrderRow>();
  // Segarkan pesanan aktif yang tiba masa polling (dihadkan).
  if (scope === 'active') {
    for (const o of rows.results.filter((o) => o.status === 'active').slice(0, 3)) await keepAlive(c, refreshOrder(app, o.id));
  }
  const fresh = scope === 'active' ? (await app.db.prepare(sql).bind(user.id, ...ACTIVE_STATES).all<OrderRow>()).results : rows.results;
  return c.json({ orders: fresh.map((o) => customerOrderView(o)), serverNow: app.now() });
});

orderRoutes.get('/:id', async (c) => {
  const app = c.get('app');
  let o = await loadOwned(c, c.req.param('id'));
  if (o.status === 'pending_payment' && c.req.query('check') === '1') {
    // Pelanggan kembali dari halaman bayaran: redirect BUKAN bukti; sahkan dengan pembekal.
    const p = await app.db.prepare('SELECT bill_code FROM payments WHERE order_id = ?').bind(o.id).first<{ bill_code: string | null }>();
    if (p?.bill_code) await keepAlive(c, processPaymentSignal(app, p.bill_code, 'return'));
  }
  if (o.status === 'active' || o.status === 'pending_payment') {
    await keepAlive(c, refreshOrder(app, o.id));
    o = (await getOwnedOrder(app.db, o.id, o.user_id))!;
  }
  const payment = await app.db.prepare('SELECT * FROM payments WHERE order_id = ?').bind(o.id).first<PaymentRow>();
  const refund = await app.db.prepare('SELECT status, created_at FROM refunds WHERE order_id = ?').bind(o.id).first<{ status: string; created_at: number }>();
  const sms = await app.db
    .prepare('SELECT seq, body, received_at FROM sms_messages WHERE order_id = ? ORDER BY seq ASC')
    .bind(o.id)
    .all<{ seq: number; body: string; received_at: number }>();
  return c.json({
    order: customerOrderView(o, { payment, refund }),
    sms: sms.results.map((s) => ({ seq: s.seq, body: s.body, receivedAt: s.received_at })),
    smsPurged: o.sms_count > sms.results.length,
    paymentUrl: o.status === 'pending_payment' ? payment?.payment_url ?? null : null,
    serverNow: app.now(),
  });
});

orderRoutes.post('/:id/complete', async (c) => {
  const app = c.get('app');
  const o = await loadOwned(c, c.req.param('id'));
  await completeOrder(app, o, `customer:${o.user_id}`);
  return c.json({ ok: true });
});

orderRoutes.post('/:id/cancel', async (c) => {
  const app = c.get('app');
  const o = await loadOwned(c, c.req.param('id'));
  await cancelOrder(app, o, `customer:${o.user_id}`);
  return c.json({ ok: true });
});

orderRoutes.post('/:id/refund-request', async (c) => {
  const app = c.get('app');
  const o = await loadOwned(c, c.req.param('id'));
  const r = await createRefundRequest(app, o.id, `customer:${o.user_id}`, 'Dimohon oleh pelanggan: tiada SMS diterima');
  return c.json({ ok: true, result: r });
});

/** DEMO sahaja: simulasi SMS masuk. */
orderRoutes.post('/:id/demo-sms', async (c) => {
  const app = c.get('app');
  if (app.config.mode !== 'demo' || !(app.sms instanceof MockSmsProvider)) throw new AppError('NOT_FOUND', 404, 'Tidak dijumpai.');
  const o = await loadOwned(c, c.req.param('id'));
  if (o.status !== 'active' || !o.provider_tzid) throw new AppError('INVALID_STATE', 409, 'Pesanan tidak aktif.');
  await app.sms.simulateIncomingSms(o.provider_tzid, o.service_name);
  await keepAlive(c, refreshOrder(app, o.id, { force: true }));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DEMO: halaman bayaran simulasi
// ---------------------------------------------------------------------------
export const demoPaymentRoutes = new Hono<HonoEnv>();
demoPaymentRoutes.use('*', requireUser);

async function loadDemoBill(c: { get: (k: 'app' | 'user') => unknown }, billCode: string) {
  const app = c.get('app') as AppCtx;
  const user = c.get('user') as { id: string };
  if (app.config.mode !== 'demo' || !(app.payment instanceof MockPaymentProvider)) throw new AppError('NOT_FOUND', 404, 'Tidak dijumpai.');
  const row = await app.db
    .prepare('SELECT p.amount_sen, p.status AS pay_status, o.id, o.ref, o.service_name, o.country_name FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.bill_code = ? AND o.user_id = ?')
    .bind(billCode, user.id)
    .first<{ amount_sen: number; pay_status: string; id: string; ref: string; service_name: string; country_name: string }>();
  if (!row) throw new AppError('NOT_FOUND', 404, 'Bil tidak dijumpai.');
  return { app, row, payment: app.payment };
}

demoPaymentRoutes.get('/:billCode', async (c) => {
  const { row } = await loadDemoBill(c, c.req.param('billCode'));
  return c.json({ orderId: row.id, ref: row.ref, amountSen: row.amount_sen, status: row.pay_status, serviceName: row.service_name, countryName: row.country_name });
});

demoPaymentRoutes.post('/:billCode', async (c) => {
  const billCode = c.req.param('billCode');
  const { app, row, payment } = await loadDemoBill(c, billCode);
  const b = await jsonBody<{ outcome?: string }>(c);
  const outcome = b.outcome === 'failed' ? 'failed' : 'paid';
  await payment.setOutcome(billCode, outcome);
  // Simulasi callback: melalui laluan pengesahan yang sama seperti pembekal sebenar.
  const result = await keepAlive(c, processPaymentSignal(app, billCode, 'demo-callback'));
  return c.json({ orderId: row.id, result });
});
