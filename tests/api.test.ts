import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { md5Hex } from '../worker/src/lib/crypto';
import { MockPaymentProvider } from '../worker/src/providers/payment/mock';
import type { PaymentProvider, PaymentStatusResult } from '../worker/src/providers/payment/types';
import { MockSmsProvider } from '../worker/src/providers/sms/mock';
import type { BuyResult, SmsProvider } from '../worker/src/providers/sms/types';
import { buildCtx } from '../worker/src/services/context';
import { runScheduled } from '../worker/src/services/cron';
import { attemptPurchase, processPaymentSignal } from '../worker/src/services/orders';
import { Client, Clock, createAdmin, makeApp, setupDb, type Proxy } from './helpers';

let proxy: Proxy;
beforeAll(async () => {
  proxy = await setupDb();
});
afterAll(async () => {
  await proxy?.dispose();
});

/** Pembekal SMS mock yang mengira panggilan getNum dan boleh dilambatkan / dipaksa gagal. */
class CountingSms extends MockSmsProvider {
  buyCalls = 0;
  delayMs = 0;
  forced: BuyResult | null = null;
  async buyNumber(input: { countryCode: number; serviceSlug: string }): Promise<BuyResult> {
    this.buyCalls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.forced) return this.forced;
    return super.buyNumber(input);
  }
}

function setup(clock = new Clock()) {
  const sms = new CountingSms(proxy.env.DB, clock.now);
  const { app, env } = makeApp(proxy, {}, { now: clock.now, sms: () => sms });
  return { app, env, sms, clock, ctx: () => buildCtx(env, { now: clock.now, sms: () => sms }) };
}

async function getPrice(c: Client, country = 60, slug = 'telegram') {
  const r = await c.req('GET', `/api/catalog/countries/${country}/services`);
  expect(r.status).toBe(200);
  const s = r.json.services.find((x: any) => x.slug === slug);
  expect(s).toBeTruthy();
  return s.priceSen as number;
}

async function newPaidOrder(c: Client, slug = 'telegram') {
  const price = await getPrice(c, 60, slug);
  const r = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: slug, expectedPriceSen: price });
  expect(r.status).toBe(201);
  const bill = String(r.json.paymentUrl).split('/demo-bayar/')[1];
  return { orderId: r.json.order.id as string, bill, price };
}

describe('akaun & keselamatan', () => {
  it('daftar mengabaikan medan role', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    const r = await c.req('POST', '/api/auth/register', { name: 'Ali', email: 'ali.role@contoh.my', password: 'kataLaluan123!', acceptTerms: true, role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.json.user.role).toBe('customer');
    const row = await proxy.env.DB.prepare('SELECT role FROM users WHERE email = ?').bind('ali.role@contoh.my').first<{ role: string }>();
    expect(row?.role).toBe('customer');
  });

  it('cookie sesi HttpOnly; kata laluan disimpan sebagai hash', async () => {
    const { app, env } = setup();
    const res = await app.fetch(
      new Request('http://localhost:5173/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mhm-sms', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ name: 'Siti', email: 'siti@contoh.my', password: 'kataLaluan123!', acceptTerms: true }),
      }),
      env,
    );
    expect(res.headers.get('Set-Cookie')).toMatch(/HttpOnly/);
    expect(res.headers.get('Set-Cookie')).toMatch(/SameSite=Lax/);
    const row = await proxy.env.DB.prepare('SELECT password_hash FROM users WHERE email = ?').bind('siti@contoh.my').first<{ password_hash: string }>();
    expect(row?.password_hash).not.toContain('kataLaluan123!');
  });

  it('login salah ditolak; login betul berjaya; logout memadam sesi', async () => {
    const { app, env } = setup();
    const c = new Client(app, env, '5.5.5.5');
    await c.register('login.test@contoh.my');
    await c.req('POST', '/api/auth/logout');
    expect((await c.req('GET', '/api/auth/me')).json.user).toBeNull();
    expect((await c.req('POST', '/api/auth/login', { email: 'login.test@contoh.my', password: 'salah-salah-salah' })).status).toBe(401);
    const ok = await c.req('POST', '/api/auth/login', { email: 'login.test@contoh.my', password: 'kataLaluan123!' });
    expect(ok.status).toBe(200);
    expect((await c.req('GET', '/api/auth/me')).json.user.email).toBe('login.test@contoh.my');
  });

  it('CSRF: tanpa token/header ditolak; origin asing ditolak', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    await c.register();
    const saved = c.csrf;
    c.csrf = 'salah';
    expect((await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram' })).status).toBe(403);
    c.csrf = saved;
    expect((await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram' }, { Origin: 'https://jahat.example' })).status).toBe(403);
    expect((await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram' }, { 'X-Requested-With': '' })).status).toBe(403);
  });

  it('had kadar login', async () => {
    const { app, env } = setup();
    const c = new Client(app, env, '7.7.7.7');
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await c.req('POST', '/api/auth/login', { email: 'tiada@contoh.my', password: 'x' })).status;
    expect(last).toBe(429);
  });

  it('reset kata laluan tanpa penyedia emel: 503 jelas, bukan kejayaan palsu', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    const r = await c.req('POST', '/api/auth/password/forgot', { email: 'a@b.my' });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('RESET_UNAVAILABLE');
  });
});

describe('aliran demo penuh', () => {
  it('katalog -> pesanan -> bayaran mock -> nombor -> SMS -> selesai -> sejarah', async () => {
    const { app, env, sms } = setup();
    const c = new Client(app, env);
    await c.register();
    const countries = await c.req('GET', '/api/catalog/countries');
    expect(countries.json.countries.length).toBeGreaterThan(3);
    const svc = await c.req('GET', '/api/catalog/countries/60/services');
    expect(svc.json.services[0]).not.toHaveProperty('costMicros');
    expect(svc.json.services.some((s: any) => s.slug === 'demobank')).toBe(false); // servis kewangan disekat

    const { orderId, bill, price } = await newPaidOrder(c);
    let o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('pending_payment');
    expect(o.json.order.priceSen).toBe(price);

    // Redirect "kembali" sahaja tidak menandakan bayar.
    o = await c.req('GET', `/api/orders/${orderId}?check=1`);
    expect(o.json.order.status).toBe('pending_payment');

    const pay = await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    expect(pay.json.result).toBe('paid');
    o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('active');
    expect(o.json.order.phoneNumber).toMatch(/^\+60\d+/);
    expect(sms.buyCalls).toBe(1);

    expect((await c.req('POST', `/api/orders/${orderId}/demo-sms`)).status).toBe(200);
    o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.smsCount).toBe(1);
    expect(o.json.sms[0].body).toMatch(/Kod pengesahan/);

    expect((await c.req('POST', `/api/orders/${orderId}/complete`)).status).toBe(200);
    const hist = await c.req('GET', '/api/orders?scope=history');
    expect(hist.json.orders.find((x: any) => x.id === orderId).status).toBe('completed');
  });

  it('harga berubah dikesan; harga daripada frontend tidak digunakan', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    await c.register();
    const price = await getPrice(c);
    const r = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: 1 });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('PRICE_CHANGED');
    expect(r.json.error.priceSen).toBe(price);
    const ok = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price, priceSen: 1 });
    expect(ok.json.order.priceSen).toBe(price);
    const row = await proxy.env.DB.prepare('SELECT cost_micros, fx_rate_micros, markup_bps, price_sen, cost_currency FROM orders WHERE id = ?').bind(ok.json.order.id).first<any>();
    expect(row.price_sen).toBe(price);
    expect(row.cost_currency).toBe('USD');
    expect(row.fx_rate_micros).toBe(4_700_000);
  });

  it('stok habis ditunjukkan dengan jelas', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    await c.register();
    let target: { code: number; slug: string } | null = null;
    for (const code of [60, 62, 66, 63, 84, 44, 1]) {
      const s = await c.req('GET', `/api/catalog/countries/${code}/services`);
      const z = s.json.services.find((x: any) => x.stock === 0);
      if (z) {
        target = { code, slug: z.slug };
        break;
      }
    }
    expect(target).toBeTruthy();
    const r = await c.req('POST', '/api/orders', { countryCode: target!.code, serviceSlug: target!.slug });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('OUT_OF_STOCK');
  });
});

describe('pemilikan data', () => {
  it('pengguna B tidak boleh membaca atau mengubah pesanan/SMS pengguna A', async () => {
    const { app, env } = setup();
    const a = new Client(app, env, '1.1.1.1');
    const b = new Client(app, env, '2.2.2.2');
    await a.register();
    await b.register();
    const { orderId, bill } = await newPaidOrder(a);
    await a.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    await a.req('POST', `/api/orders/${orderId}/demo-sms`);

    expect((await b.req('GET', `/api/orders/${orderId}`)).status).toBe(404);
    expect((await b.req('POST', `/api/orders/${orderId}/complete`)).status).toBe(404);
    expect((await b.req('POST', `/api/orders/${orderId}/cancel`)).status).toBe(404);
    expect((await b.req('POST', `/api/orders/${orderId}/demo-sms`)).status).toBe(404);
    expect((await b.req('POST', `/api/orders/${orderId}/refund-request`)).status).toBe(404);
    expect((await b.req('GET', `/api/demo/payments/${bill}`)).status).toBe(404);
    const list = await b.req('GET', '/api/orders?scope=active');
    expect(list.json.orders.find((x: any) => x.id === orderId)).toBeUndefined();
    const hist = await b.req('GET', '/api/orders?scope=history');
    expect(hist.json.orders.find((x: any) => x.id === orderId)).toBeUndefined();
    // Tanpa log masuk
    const anon = new Client(app, env, '3.3.3.3');
    expect((await anon.req('GET', `/api/orders/${orderId}`)).status).toBe(401);
  });
});

describe('idempotensi pembayaran & pembelian', () => {
  it('callback berulang (berturut & serentak) hanya membeli SATU nombor', async () => {
    const { app, env, sms, ctx } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    sms.delayMs = 30;
    await (ctx().payment as MockPaymentProvider).setOutcome(bill, 'paid');
    const results = await Promise.all(Array.from({ length: 6 }, () => processPaymentSignal(ctx(), bill, 'callback')));
    for (let i = 0; i < 3; i++) results.push(await processPaymentSignal(ctx(), bill, 'callback'));
    // Callback HTTP sebenar melalui endpoint juga idempotent
    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(new Request('http://localhost:5173/api/payments/mock/callback', { method: 'POST', body: new URLSearchParams({ billcode: bill }) }), env);
      expect(res.status).toBe(200);
    }
    expect(results.filter((r) => r === 'paid').length).toBe(1);
    expect(sms.buyCalls).toBe(1);
    const ops = await proxy.env.DB.prepare('SELECT COUNT(*) AS n FROM order_events WHERE order_id = ? AND to_status = ?').bind(orderId, 'purchasing').first<{ n: number }>();
    expect(ops?.n).toBe(1);
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('active');
  });

  it('permintaan serentak attemptPurchase tidak membeli dua nombor', async () => {
    const { app, env, sms, ctx } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId } = await newPaidOrder(c);
    // Tandakan dibayar terus (simulasi selepas pengesahan)
    await proxy.env.DB.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").bind(orderId).run();
    sms.delayMs = 50;
    const r = await Promise.all(Array.from({ length: 8 }, () => attemptPurchase(ctx(), orderId)));
    expect(sms.buyCalls).toBe(1);
    expect(r.filter((x) => x === 'active').length).toBe(1);
  });

  it('timeout pembekal -> needs_reconciliation; tiada retry; tiada refund', async () => {
    const { app, env, sms, ctx, clock } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    sms.forced = { kind: 'unknown', code: 'TIMEOUT' };
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    let o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('needs_reconciliation');
    expect(o.json.order.canRequestRefund).toBe(false);
    expect((await c.req('POST', `/api/orders/${orderId}/refund-request`)).status).toBe(409);

    // Callback berulang & cron tidak mencetuskan pembelian semula
    await processPaymentSignal(ctx(), bill, 'callback');
    clock.advance(5 * 60_000);
    await runScheduled(ctx());
    expect(sms.buyCalls).toBe(1);
    o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('needs_reconciliation');
    const refunds = await proxy.env.DB.prepare('SELECT COUNT(*) AS n FROM refunds WHERE order_id = ?').bind(orderId).first<{ n: number }>();
    expect(refunds?.n).toBe(0);

    // Admin: tidak boleh sahkan "not_issued" tanpa nota; dengan nota -> purchase_failed + SATU permohonan refund
    const { client: admin } = await createAdmin(proxy, app, env);
    expect((await admin.req('POST', `/api/admin/orders/${orderId}/reconcile`, { outcome: 'not_issued', note: '' })).status).toBe(400);
    expect((await admin.req('POST', `/api/admin/orders/${orderId}/reconcile`, { outcome: 'not_issued', note: 'Disemak di papan pemuka pembekal: tiada operasi' })).status).toBe(200);
    expect((await admin.req('POST', `/api/admin/orders/${orderId}/reconcile`, { outcome: 'not_issued', note: 'Ulang' })).status).toBe(409);
    const rf = await proxy.env.DB.prepare("SELECT COUNT(*) AS n FROM refunds WHERE order_id = ? AND status = 'requested'").bind(orderId).first<{ n: number }>();
    expect(rf?.n).toBe(1);
    expect(sms.buyCalls).toBe(1);
  });

  it('pembekal menolak (NO_NUMBER) -> purchase_failed + satu permohonan refund (pending)', async () => {
    const { app, env, sms, ctx } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    sms.forced = { kind: 'rejected', code: 'NO_NUMBER' };
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    await processPaymentSignal(ctx(), bill, 'callback');
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('purchase_failed');
    expect(o.json.order.refund.status).toBe('requested');
    const n = await proxy.env.DB.prepare('SELECT COUNT(*) AS n FROM refunds WHERE order_id = ?').bind(orderId).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('bayaran gagal tidak membeli nombor', async () => {
    const { app, env, sms } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'failed' });
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('payment_failed');
    expect(sms.buyCalls).toBe(0);
  });

  it('bayaran lewat (selepas tamat tempoh) diproses sekali', async () => {
    const { app, env, sms, ctx, clock } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    clock.advance(31 * 60_000);
    await runScheduled(ctx());
    expect((await c.req('GET', `/api/orders/${orderId}`)).json.order.status).toBe('expired_unpaid');
    await (ctx().payment as MockPaymentProvider).setOutcome(bill, 'paid');
    await processPaymentSignal(ctx(), bill, 'callback');
    await processPaymentSignal(ctx(), bill, 'callback');
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('active');
    expect(o.json.order.lateNotice).toBe(true);
    expect(sms.buyCalls).toBe(1);
  });

  it('pembatalan: ditolak sebelum guard interval, dibenarkan selepasnya', async () => {
    const { app, env, clock } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    const early = await c.req('POST', `/api/orders/${orderId}/cancel`);
    expect(early.status).toBe(409);
    expect(early.json.error.code).toBe('TOO_EARLY');
    clock.advance(121_000);
    expect((await c.req('POST', `/api/orders/${orderId}/cancel`)).status).toBe(200);
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('cancelled');
    expect(o.json.order.canRequestRefund).toBe(true);
    expect((await c.req('POST', `/api/orders/${orderId}/refund-request`)).json.result).toBe('created');
    expect((await c.req('POST', `/api/orders/${orderId}/refund-request`)).json.result).toBe('exists');
    const n = await proxy.env.DB.prepare('SELECT COUNT(*) AS n FROM refunds WHERE order_id = ?').bind(orderId).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('nombor tamat tempoh tanpa SMS -> expired; polling berhenti', async () => {
    const { app, env, clock, ctx } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    clock.advance(16 * 60_000);
    await runScheduled(ctx());
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('expired');
    const row = await proxy.env.DB.prepare('SELECT next_poll_at FROM orders WHERE id = ?').bind(orderId).first<{ next_poll_at: number | null }>();
    expect(row?.next_poll_at).toBeNull();
  });
});

describe('ToyyibPay melalui endpoint callback', () => {
  class FakeToyyib implements PaymentProvider {
    readonly name = 'toyyibpay' as const;
    status: PaymentStatusResult = { status: 'pending' };
    bills = 0;
    async createBill() {
      this.bills++;
      return { billCode: `tp${this.bills}${Date.now()}`, paymentUrl: 'https://dev.toyyibpay.com/x' };
    }
    verifyCallback(form: Record<string, string>) {
      const expected = md5Hex(`SECRET${form.status}${form.order_id}${form.refno}ok`);
      return { valid: form.hash === expected, billCode: form.billcode ?? null };
    }
    async fetchStatus() {
      return this.status;
    }
    async deactivateBill() {}
  }

  it('hash tidak sah ditolak; payload "berjaya" tidak dipercayai tanpa pengesahan API; amaun salah ditolak', async () => {
    const clock = new Clock();
    const sms = new CountingSms(proxy.env.DB, clock.now);
    const pay = new FakeToyyib();
    const { app, env } = makeApp(proxy, {}, { now: clock.now, sms: () => sms, payment: () => pay });
    const c = new Client(app, env);
    await c.register();
    const price = await getPrice(c);
    const r = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price });
    const orderId = r.json.order.id;
    const ref = r.json.order.ref;
    const billcode = (await proxy.env.DB.prepare('SELECT bill_code FROM payments WHERE order_id = ?').bind(orderId).first<{ bill_code: string }>())!.bill_code;
    const send = (form: Record<string, string>) =>
      app.fetch(new Request('http://localhost:5173/api/payments/toyyibpay/callback', { method: 'POST', body: new URLSearchParams(form) }), env);

    const good = { refno: 'TP1', status: '1', reason: 'Approved', billcode, order_id: ref, amount: '1', transaction_time: 'x' };
    expect((await send({ ...good, hash: 'palsu' })).status).toBe(400);

    // Hash sah, tetapi API pembekal masih "pending" -> tidak dibayar
    expect((await send({ ...good, hash: md5Hex(`SECRET1${ref}TP1ok`) })).status).toBe(200);
    expect((await c.req('GET', `/api/orders/${orderId}`)).json.order.status).toBe('pending_payment');

    // API kata dibayar tetapi amaun berbeza -> mismatch, tiada pembelian
    pay.status = { status: 'paid', amountSen: price - 10, orderRef: ref, providerRef: 'TP1' };
    await send({ ...good, hash: md5Hex(`SECRET1${ref}TP1ok`) });
    let o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('pending_payment');
    expect(o.json.order.paymentIssue).toBe(true);
    expect(sms.buyCalls).toBe(0);
  });

  it('rujukan pesanan salah ditolak; betul -> dibayar sekali', async () => {
    const clock = new Clock();
    const sms = new CountingSms(proxy.env.DB, clock.now);
    const pay = new FakeToyyib();
    const { app, env } = makeApp(proxy, {}, { now: clock.now, sms: () => sms, payment: () => pay });
    const c = new Client(app, env);
    await c.register();
    const price = await getPrice(c);
    const r = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price });
    const orderId = r.json.order.id;
    const ref = r.json.order.ref;
    const billcode = (await proxy.env.DB.prepare('SELECT bill_code FROM payments WHERE order_id = ?').bind(orderId).first<{ bill_code: string }>())!.bill_code;
    const form = { refno: 'TP2', status: '1', billcode, order_id: ref, hash: md5Hex(`SECRET1${ref}TP2ok`) };
    const send = () => app.fetch(new Request('http://localhost:5173/api/payments/toyyibpay/callback', { method: 'POST', body: new URLSearchParams(form) }), env);

    pay.status = { status: 'paid', amountSen: price, orderRef: 'MHMLAIN', providerRef: 'TP2' };
    await send();
    expect((await c.req('GET', `/api/orders/${orderId}`)).json.order.status).toBe('pending_payment');
    expect(sms.buyCalls).toBe(0);
  });
});

describe('admin', () => {
  it('pelanggan biasa ditolak daripada semua endpoint admin', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    await c.register();
    for (const p of ['/api/admin/overview', '/api/admin/orders', '/api/admin/customers', '/api/admin/settings', '/api/admin/reports', '/api/admin/refunds', '/api/admin/audit']) {
      expect((await c.req('GET', p)).status).toBe(403);
    }
    expect((await c.req('PUT', '/api/admin/settings', { markup_bps: 0 })).status).toBe(403);
    const anon = new Client(app, env);
    expect((await anon.req('GET', '/api/admin/overview')).status).toBe(401);
  });

  it('admin boleh ubah harga; perubahan diaudit; SMS tidak didedahkan', async () => {
    const { app, env } = setup();
    const { client: admin } = await createAdmin(proxy, app, env);
    expect((await admin.req('GET', '/api/admin/overview')).status).toBe(200);
    expect((await admin.req('PUT', '/api/admin/settings', { markup_bps: 6000 })).status).toBe(200);
    expect((await admin.req('PUT', '/api/admin/settings', { markup_bps: -5 })).status).toBe(400);
    expect((await admin.req('PUT', '/api/admin/overrides', { countryCode: 60, serviceSlug: 'telegram', priceSen: 777 })).status).toBe(200);
    const c = new Client(app, env);
    await c.register();
    expect(await getPrice(c)).toBe(777);
    await admin.req('PUT', '/api/admin/overrides', { countryCode: 60, serviceSlug: 'telegram', priceSen: null });
    await admin.req('PUT', '/api/admin/settings', { markup_bps: 5000 });
    const audit = await admin.req('GET', '/api/admin/audit');
    const actions = audit.json.logs.map((l: any) => l.action);
    expect(actions).toContain('settings.update');
    expect(actions).toContain('pricing.override');

    const { orderId, bill } = await newPaidOrder(c);
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    await c.req('POST', `/api/orders/${orderId}/demo-sms`);
    const detail = await admin.req('GET', `/api/admin/orders/${orderId}`);
    expect(detail.status).toBe(200);
    expect(JSON.stringify(detail.json)).not.toMatch(/Kod pengesahan/);
    expect(detail.json.order.sms_count).toBe(1);
  });

  it('refund: processed memerlukan rujukan; peralihan tidak sah ditolak', async () => {
    const { app, env, clock } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    clock.advance(121_000);
    await c.req('POST', `/api/orders/${orderId}/cancel`);
    await c.req('POST', `/api/orders/${orderId}/refund-request`);
    const { client: admin } = await createAdmin(proxy, app, env);
    const list = await admin.req('GET', '/api/admin/refunds?status=requested');
    const rf = list.json.refunds.find((r: any) => r.order_id === orderId);
    expect(rf).toBeTruthy();
    expect((await admin.req('POST', `/api/admin/refunds/${rf.id}`, { status: 'processed', note: 'cuba' })).status).toBe(409);
    expect((await admin.req('POST', `/api/admin/refunds/${rf.id}`, { status: 'approved', note: 'Layak' })).status).toBe(200);
    expect((await admin.req('POST', `/api/admin/refunds/${rf.id}`, { status: 'processed', note: 'Dipulangkan' })).status).toBe(400);
    expect((await admin.req('POST', `/api/admin/refunds/${rf.id}`, { status: 'processed', note: 'Dipulangkan', externalRef: 'FPX-123' })).status).toBe(200);
    const rep = await admin.req('GET', '/api/admin/reports?mode=demo');
    expect(rep.json.refundedSen).toBeGreaterThan(0);
  });

  it('admin tidak boleh menukar peranan sendiri; perubahan peranan diaudit', async () => {
    const { app, env } = setup();
    const { client: admin, id } = await createAdmin(proxy, app, env);
    expect((await admin.req('POST', `/api/admin/customers/${id}`, { role: 'customer' })).status).toBe(400);
    const c = new Client(app, env);
    const u = await c.register();
    expect((await admin.req('POST', `/api/admin/customers/${u.id}`, { role: 'admin' })).status).toBe(200);
    const logs = await admin.req('GET', '/api/admin/audit');
    expect(logs.json.logs.some((l: any) => l.action === 'user.role' && l.target_id === u.id)).toBe(true);
  });
});

describe('mod production', () => {
  it('konfigurasi mock dalam production menyebabkan API menolak (503)', async () => {
    const { app, env } = makeApp(proxy, { APP_ENV: 'production', APP_BASE_URL: 'https://sms.mhmacademy.site' });
    const res = await app.fetch(new Request('https://sms.mhmacademy.site/api/catalog/countries'), env);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe('MISCONFIGURED');
  });

  it('live sebenar tetapi LIVE_*_ENABLED=false: jualan ditutup', async () => {
    const fakeSms = new MockSmsProvider(proxy.env.DB) as unknown as SmsProvider;
    const { app, env } = makeApp(
      proxy,
      {
        APP_ENV: 'staging', APP_BASE_URL: 'http://localhost:5173', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'toyyibpay',
        ONLINESIM_API_KEY: 'k', TOYYIBPAY_SECRET_KEY: 's', TOYYIBPAY_CATEGORY_CODE: 'c',
      },
      { sms: () => fakeSms },
    );
    const c = new Client(app, env);
    await c.register();
    const cfg = await c.req('GET', '/api/config');
    expect(cfg.json.mode).toBe('live');
    expect(cfg.json.salesOpen).toBe(false);
    const r = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram' });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('SALES_DISABLED');
  });
});
