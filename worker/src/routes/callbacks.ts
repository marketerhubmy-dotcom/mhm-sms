import { Hono } from 'hono';
import { timingSafeEqualStr } from '../lib/crypto';
import { processPaymentSignal, refreshOrder } from '../services/orders';
import type { HonoEnv } from '../http';

export const callbackRoutes = new Hono<HonoEnv>();

/**
 * Callback ToyyibPay (server-to-server, form POST).
 * 1. Sahkan hash MD5(userSecretKey + status + order_id + refno + "ok").
 * 2. Walaupun sah, JANGAN percaya status dalam payload: sahkan semula melalui getBillTransactions
 *    (status, rujukan pesanan, amaun) dalam processPaymentSignal.
 * 3. Idempotent: callback berulang tidak menyebabkan pembelian berganda.
 */
callbackRoutes.post('/payments/:provider/callback', async (c) => {
  const app = c.get('app');
  const provider = c.req.param('provider');
  if (provider !== app.payment.name) return c.text('Not found', 404);
  if (provider === 'mock' && app.config.mode !== 'demo') return c.text('Not found', 404);
  let form: Record<string, string> = {};
  try {
    const fd = await c.req.parseBody();
    form = Object.fromEntries(Object.entries(fd).map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch {
    return c.text('Bad request', 400);
  }
  const check = app.payment.verifyCallback(form);
  const now = app.now();
  if (!check.valid || !check.billCode) {
    await app.db
      .prepare('INSERT INTO payment_callbacks (provider, bill_code, signature_valid, result, received_at) VALUES (?, ?, 0, ?, ?)')
      .bind(provider, (check.billCode ?? '').slice(0, 64), 'rejected', now)
      .run();
    return c.text('Invalid signature', 400);
  }
  const result = await processPaymentSignal(app, check.billCode, 'callback');
  await app.db
    .prepare('INSERT INTO payment_callbacks (provider, bill_code, signature_valid, result, received_at) VALUES (?, ?, 1, ?, ?)')
    .bind(provider, check.billCode.slice(0, 64), result, now)
    .run();
  return c.text('OK');
});

/**
 * Webhook OnlineSIM (newSms). Dokumentasi tidak menyediakan tandatangan, jadi payload TIDAK dipercayai:
 * ia hanya isyarat untuk fetch semula status operasi melalui API (getState).
 * Dilindungi token rahsia dalam URL (ONLINESIM_WEBHOOK_TOKEN). Kandungan SMS tidak dilog.
 */
callbackRoutes.post('/webhooks/onlinesim/:token', async (c) => {
  const app = c.get('app');
  const expected = app.env.ONLINESIM_WEBHOOK_TOKEN ?? '';
  if (!expected || !timingSafeEqualStr(c.req.param('token'), expected)) return c.text('Not found', 404);
  let opId = '';
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    opId = String(body.operation_id ?? '').slice(0, 32);
  } catch {
    return c.text('OK');
  }
  if (!/^\d+$/.test(opId)) return c.text('OK');
  const order = await app.db
    .prepare("SELECT id, last_polled_at FROM orders WHERE provider_tzid = ? AND status = 'active'")
    .bind(opId)
    .first<{ id: string; last_polled_at: number | null }>();
  if (order && (!order.last_polled_at || app.now() - order.last_polled_at > 3000)) {
    await refreshOrder(app, order.id, { force: true });
  }
  return c.text('OK');
});
