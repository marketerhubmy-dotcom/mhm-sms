import { Hono } from 'hono';
import { timingSafeEqualStr } from '../lib/crypto';
import { processPaymentSignal, refreshOrder } from '../services/orders';
import type { HonoEnv } from '../http';

export const callbackRoutes = new Hono<HonoEnv>();

/**
 * Callback pembayaran (server-to-server).
 * CHIP: success_callback POST JSON (objek Purchase) dengan header X-Signature
 *       (RSA PKCS#1 v1.5 + SHA-256 atas badan mentah, kunci daripada GET /public_key/).
 * 1. Sahkan tandatangan pada badan MENTAH.
 * 2. Walaupun sah, JANGAN percaya status dalam payload: sahkan semula melalui GET /purchases/{id}/
 *    (status, rujukan pesanan, amaun, mata wang) dalam processPaymentSignal.
 * 3. Idempotent: callback berulang tidak menyebabkan pembelian berganda.
 */
callbackRoutes.post('/payments/:provider/callback', async (c) => {
  const app = c.get('app');
  const provider = c.req.param('provider');
  if (provider !== app.payment.name) return c.text('Not found', 404);
  if (provider === 'mock' && app.config.mode !== 'demo') return c.text('Not found', 404);
  const rawBody = await c.req.text();
  if (rawBody.length > 200_000) return c.text('Payload too large', 413);
  const check = await app.payment.verifyCallback({ rawBody, headers: c.req.raw.headers });
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
