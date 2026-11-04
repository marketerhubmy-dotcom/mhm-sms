import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChipProvider } from '../worker/src/providers/payment/chip';
import { BRAND_ID, makeChipFixture } from './chipFixture';
import { MockPaymentProvider } from '../worker/src/providers/payment/mock';
import { MockSmsProvider, mockServicesFor } from '../worker/src/providers/sms/mock';
import { ProviderError, type BuyResult, type SmsProvider } from '../worker/src/providers/sms/types';
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
  issueButUnknown = false;
  async buyNumber(input: { countryCode: number; serviceSlug: string }): Promise<BuyResult> {
    this.buyCalls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.forced) return this.forced;
    if (this.issueButUnknown) {
      // Pembekal mengeluarkan nombor, tetapi jawapan tidak sampai kepada kita (cth. timeout / sambungan terputus).
      await super.buyNumber(input);
      return { kind: 'unknown', code: 'TIMEOUT' };
    }
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

  it('getNum terputus tetapi nombor dikeluarkan -> cron memadankan secara automatik (tepat satu calon)', async () => {
    const { app, env, sms, ctx, clock } = setup();
    const c = new Client(app, env);
    await c.register();
    // Kosongkan operasi mock lama supaya ujian ini terasing
    await proxy.env.DB.prepare('UPDATE mock_operations SET closed = 1').run();
    const { orderId, bill } = await newPaidOrder(c, 'instagram');
    sms.issueButUnknown = true;
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    expect((await c.req('GET', `/api/orders/${orderId}`)).json.order.status).toBe('needs_reconciliation');
    clock.advance(60_000);
    await runScheduled(ctx());
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('active');
    expect(o.json.order.phoneNumber).toMatch(/^\+60/);
    expect(sms.buyCalls).toBe(1);
    const ev = await proxy.env.DB.prepare("SELECT actor FROM order_events WHERE order_id = ? AND to_status = 'active'").bind(orderId).first<{ actor: string }>();
    expect(ev?.actor).toBe('system:auto-reconcile');
  });

  it('rekonsiliasi automatik TIDAK memadankan jika ada lebih daripada satu calon', async () => {
    const { app, env, sms, ctx, clock } = setup();
    const c = new Client(app, env);
    await c.register();
    await proxy.env.DB.prepare('UPDATE mock_operations SET closed = 1').run();
    // Operasi tambahan yang sama servis/negara (cth. pembelian manual di papan pemuka pembekal)
    await new MockSmsProvider(proxy.env.DB, clock.now).buyNumber({ countryCode: 60, serviceSlug: 'instagram' });
    const { orderId, bill } = await newPaidOrder(c, 'instagram');
    sms.issueButUnknown = true;
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    clock.advance(60_000);
    await runScheduled(ctx());
    expect((await c.req('GET', `/api/orders/${orderId}`)).json.order.status).toBe('needs_reconciliation');
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

describe('CHIP melalui endpoint callback', () => {
  async function chipSetup() {
    const clock = new Clock();
    const sms = new CountingSms(proxy.env.DB, clock.now);
    const fx = await makeChipFixture();
    const pay = new ChipProvider('SECRET', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem });
    const { app, env } = makeApp(proxy, {}, { now: clock.now, sms: () => sms, payment: () => pay });
    const c = new Client(app, env);
    await c.register();
    const price = await getPrice(c);
    const r = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price });
    expect(r.status).toBe(201);
    expect(r.json.paymentUrl).toMatch(/^https:\/\/gate\.chip-in\.asia\/p\//);
    const orderId = r.json.order.id as string;
    const ref = r.json.order.ref as string;
    const billCode = (await proxy.env.DB.prepare('SELECT bill_code FROM payments WHERE order_id = ?').bind(orderId).first<{ bill_code: string }>())!.bill_code;
    const purchase = fx.purchases.get(billCode)!;
    const send = async (body: string, sig?: string) =>
      app.fetch(
        new Request('http://localhost:5173/api/payments/chip/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(sig ? { 'X-Signature': sig } : {}) },
          body,
        }),
        env,
      );
    return { c, sms, fx, orderId, ref, billCode, purchase, price, send, app, env };
  }

  it('pesanan mencipta purchase CHIP dengan amaun, rujukan & callback yang betul', async () => {
    const { purchase, price, ref, fx } = await chipSetup();
    expect(purchase.purchase.total).toBe(price);
    expect(purchase.purchase.currency).toBe('MYR');
    expect(purchase.reference).toBe(ref);
    expect(purchase.success_callback).toBe('http://localhost:5173/api/payments/chip/callback');
    expect(purchase.brand_id).toBe(BRAND_ID);
    expect(fx.calls.find((x) => x.path === '/purchases/')!.body.client.email).toMatch(/@contoh\.my$/);
  });

  it('tandatangan palsu ditolak; payload "paid" tidak dipercayai jika API masih belum dibayar', async () => {
    const { c, sms, orderId, billCode, send, fx } = await chipSetup();
    const fakePaid = JSON.stringify({ id: billCode, status: 'paid', event_type: 'purchase.paid' });
    expect((await send(fakePaid)).status).toBe(400);
    expect((await send(fakePaid, btoa('palsu'))).status).toBe(400);
    // Tandatangan sah, tetapi GET /purchases/{id}/ masih "created" -> belum dibayar
    expect((await send(fakePaid, await fx.sign(fakePaid))).status).toBe(200);
    expect((await c.req('GET', `/api/orders/${orderId}`)).json.order.status).toBe('pending_payment');
    expect(sms.buyCalls).toBe(0);
  });

  it('amaun berbeza -> mismatch, tiada pembelian', async () => {
    const { c, sms, orderId, billCode, purchase, price, send, fx } = await chipSetup();
    purchase.status = 'paid';
    purchase.purchase.total = price - 10;
    const body = JSON.stringify({ id: billCode, status: 'paid' });
    await send(body, await fx.sign(body));
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('pending_payment');
    expect(o.json.order.paymentIssue).toBe(true);
    expect(sms.buyCalls).toBe(0);
  });

  it('rujukan atau mata wang berbeza ditolak', async () => {
    const a = await chipSetup();
    a.purchase.status = 'paid';
    a.purchase.reference = 'MHMLAIN';
    const b1 = JSON.stringify({ id: a.billCode });
    await a.send(b1, await a.fx.sign(b1));
    expect((await a.c.req('GET', `/api/orders/${a.orderId}`)).json.order.status).toBe('pending_payment');
    const b = await chipSetup();
    b.purchase.status = 'paid';
    b.purchase.purchase.currency = 'SGD';
    const b2 = JSON.stringify({ id: b.billCode });
    await b.send(b2, await b.fx.sign(b2));
    expect((await b.c.req('GET', `/api/orders/${b.orderId}`)).json.order.status).toBe('pending_payment');
    expect(a.sms.buyCalls + b.sms.buyCalls).toBe(0);
  });

  it('dibayar & disahkan -> nombor dibeli SEKALI walaupun callback berulang/serentak', async () => {
    const { c, sms, orderId, billCode, purchase, send, fx } = await chipSetup();
    purchase.status = 'paid';
    const body = JSON.stringify({ id: billCode, status: 'paid', event_type: 'purchase.paid' });
    const sig = await fx.sign(body);
    sms.delayMs = 30;
    const res = await Promise.all(Array.from({ length: 5 }, () => send(body, sig)));
    expect(res.every((r) => r.status === 200)).toBe(true);
    await send(body, sig);
    expect(sms.buyCalls).toBe(1);
    const o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('active');
    expect(o.json.order.payment.provider).toBe('chip');
  });

  it('percubaan bayaran gagal (status CHIP error) -> mesej cuba lagi; berjaya kemudian -> mesej hilang & dibayar', async () => {
    const a = await chipSetup();
    a.purchase.status = 'error';
    let o = await a.c.req('GET', `/api/orders/${a.orderId}?check=1`);
    expect(o.json.order.status).toBe('pending_payment');
    expect(o.json.order.paymentAttemptFailed).toBe(true);
    expect(o.json.paymentUrl).toMatch(/gate\.chip-in\.asia/);
    a.purchase.status = 'paid';
    o = await a.c.req('GET', `/api/orders/${a.orderId}?check=1`);
    expect(o.json.order.status).toBe('active');
    expect(o.json.order.paymentAttemptFailed).toBe(false);
    const row = await proxy.env.DB.prepare('SELECT last_error_code FROM orders WHERE id = ?').bind(a.orderId).first<{ last_error_code: string | null }>();
    expect(row?.last_error_code).toBeNull();
  });

  it('pelanggan kembali (redirect) -> sahkan melalui API; batal sebelum bayar memanggil cancel', async () => {
    const a = await chipSetup();
    expect((await a.c.req('GET', `/api/orders/${a.orderId}?check=1`)).json.order.status).toBe('pending_payment');
    a.purchase.status = 'paid';
    expect((await a.c.req('GET', `/api/orders/${a.orderId}?check=1`)).json.order.status).toBe('active');
    const b = await chipSetup();
    expect((await b.c.req('POST', `/api/orders/${b.orderId}/cancel`)).status).toBe(200);
    expect(b.purchase.status).toBe('cancelled');
  });
});

describe('staging: SMS simulasi + CHIP mod ujian', () => {
  it('aliran penuh: pesanan -> CHIP ujian dibayar -> callback bertandatangan -> nombor simulasi -> SMS simulasi', async () => {
    const clock = new Clock();
    const fx = await makeChipFixture();
    const sms = new CountingSms(proxy.env.DB, clock.now);
    const { app, env } = makeApp(
      proxy,
      { APP_ENV: 'staging', SMS_PROVIDER: 'mock', PAYMENT_PROVIDER: 'chip', CHIP_SECRET_KEY: 'test_key', CHIP_BRAND_ID: BRAND_ID, LIVE_PAYMENTS_ENABLED: 'true' },
      { now: clock.now, sms: () => sms, payment: () => new ChipProvider('test_key', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem, requireTestPurchases: true }) },
    );
    const c = new Client(app, env);
    const health = await c.req('GET', '/api/health');
    expect(health.json).toMatchObject({ ok: true, env: 'staging', payment: 'chip-test' });
    expect((await c.req('GET', '/api/config')).json.paymentMode).toBe('test');
    await c.register();
    const price = await getPrice(c);
    const r = await c.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price });
    expect(r.status).toBe(201);
    const orderId = r.json.order.id;
    const billCode = (await proxy.env.DB.prepare('SELECT bill_code FROM payments WHERE order_id = ?').bind(orderId).first<{ bill_code: string }>())!.bill_code;
    // Laluan bayaran demo (mock) tidak wujud dalam staging
    expect((await c.req('POST', `/api/demo/payments/${billCode}`, { outcome: 'paid' })).status).toBe(404);
    fx.purchases.get(billCode)!.status = 'paid';
    const body = JSON.stringify({ id: billCode, status: 'paid' });
    const res = await app.fetch(new Request('http://localhost:5173/api/payments/chip/callback', { method: 'POST', headers: { 'X-Signature': await fx.sign(body) }, body }), env);
    expect(res.status).toBe(200);
    let o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.status).toBe('active');
    expect(o.json.order.mode).toBe('demo');
    expect((await c.req('POST', `/api/orders/${orderId}/demo-sms`)).status).toBe(200);
    o = await c.req('GET', `/api/orders/${orderId}`);
    expect(o.json.order.smsCount).toBe(1);
    expect(sms.buyCalls).toBe(1);
  });

  it('staging nombor SEBENAR: pelanggan biasa ditolak, admin dibenarkan, had harian dikuatkuasakan', async () => {
    const clock = new Clock(Date.UTC(2027, 0, 1));
    const fx = await makeChipFixture();
    const sms = new CountingSms(proxy.env.DB, clock.now);
    const { app, env } = makeApp(
      proxy,
      { APP_ENV: 'staging', SMS_PROVIDER: 'onlinesim', ONLINESIM_API_KEY: 'k', PAYMENT_PROVIDER: 'chip', CHIP_SECRET_KEY: 'k', CHIP_BRAND_ID: BRAND_ID, LIVE_PAYMENTS_ENABLED: 'true', LIVE_PURCHASES_ENABLED: 'true' },
      { now: clock.now, sms: () => sms, payment: () => new ChipProvider('k', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem, requireTestPurchases: true }) },
    );
    const cust = new Client(app, env);
    await cust.register();
    expect((await cust.req('GET', '/api/config')).json.stage).toBe('staging-real');
    const price = await getPrice(cust);
    const denied = await cust.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price });
    expect(denied.status).toBe(403);
    expect(denied.json.error.code).toBe('STAGING_ADMIN_ONLY');
    // Pesanan simulasi sedia ada (mode demo) tidak dikira dalam had
    await proxy.env.DB.prepare(
      "INSERT INTO orders (id, ref, user_id, mode, status, country_code, country_name, service_slug, service_name, cost_micros, cost_currency, fx_rate_micros, markup_bps, fixed_fee_sen, min_price_sen, rounding_sen, cost_sen, price_sen, payment_due_at, purchase_started_at, created_at, updated_at) SELECT 'sim-' || hex(randomblob(6)), 'SIM' || hex(randomblob(4)), id, 'demo', 'completed', 60, 'Malaysia', 'telegram', 'Telegram', 1, 'USD', 1, 0, 0, 0, 1, 1, 200, ?, ?, ?, ? FROM users LIMIT 6",
    ).bind(clock.t, clock.t, clock.t, clock.t).run();
    const { client: admin } = await createAdmin(proxy, app, env);
    const codes: number[] = [];
    // Pesanan yang dibatalkan sebelum bayar tidak dikira
    for (let i = 0; i < 3; i++) {
      const r = await admin.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price });
      expect(r.status).toBe(201);
      await admin.req('POST', `/api/orders/${r.json.order.id}/cancel`);
    }
    // Pesanan yang dibayar (pembelian bermula) dikira
    for (let i = 0; i < 6; i++) {
      const r = await admin.req('POST', '/api/orders', { countryCode: 60, serviceSlug: 'telegram', expectedPriceSen: price });
      codes.push(r.status);
      if (r.status !== 201) continue;
      const bill = (await proxy.env.DB.prepare('SELECT bill_code FROM payments WHERE order_id = ?').bind(r.json.order.id).first<{ bill_code: string }>())!.bill_code;
      fx.purchases.get(bill)!.status = 'paid';
      const body = JSON.stringify({ id: bill });
      await app.fetch(new Request('http://localhost:5173/api/payments/chip/callback', { method: 'POST', headers: { 'X-Signature': await fx.sign(body) }, body }), env);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
    expect(sms.buyCalls).toBe(5);
  });

  it('staging tanpa secrets CHIP: /api/health menunjukkan nama ralat, API lain 503', async () => {
    const { app, env } = makeApp(proxy, { APP_ENV: 'staging', SMS_PROVIDER: 'mock', PAYMENT_PROVIDER: 'chip', LIVE_PAYMENTS_ENABLED: 'true' });
    const c = new Client(app, env);
    const h = await c.req('GET', '/api/health');
    expect(h.json.ok).toBe(false);
    expect(h.json.configErrors.join()).toMatch(/CHIP_SECRET_KEY/);
    expect((await c.req('GET', '/api/catalog/countries')).status).toBe(503);
  });
});

describe('cache katalog', () => {
  it('pertukaran pembekal SMS mengosongkan cache negara/servis lama', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    expect((await c.req('GET', '/api/catalog/countries')).json.countries.some((x: any) => x.name === 'Malaysia')).toBe(true);
    await c.req('GET', '/api/catalog/countries/60/services');
    const other = {
      name: 'onlinesim' as const,
      getCountries: async () => [{ code: 7, name: 'Russia', enabled: true }],
      getServices: async () => [{ slug: 'vkcom', name: 'VKontakte', stock: 5, costMicros: 550_000 }],
      getServiceQuote: async () => ({ slug: 'vkcom', name: 'VKontakte', stock: 5, costMicros: 550_000 }),
      getBalance: async () => ({ balanceMicros: 1, frozenMicros: 0 }),
      buyNumber: async () => ({ kind: 'rejected' as const, code: 'NO_NUMBER' }),
      getOperation: async () => ({ kind: 'not_found' as const }),
      listOperations: async () => [],
      completeOperation: async () => ({ kind: 'ok' as const }),
    };
    const { app: app2, env: env2 } = makeApp(proxy, {}, { sms: () => other });
    const c2 = new Client(app2, env2);
    const countries = (await c2.req('GET', '/api/catalog/countries')).json.countries;
    expect(countries).toEqual([{ code: 7, name: 'Russia' }]);
    const left = await proxy.env.DB.prepare('SELECT COUNT(*) AS n FROM catalog_services WHERE country_code = 60').first<{ n: number }>();
    expect(left?.n).toBe(0);
    // Kembali ke mock untuk ujian lain
    await new Client(app, env).req('GET', '/api/catalog/countries');
  });
});

describe('semakan stok sebelum pesanan', () => {
  it('guna katalog ≤60s tanpa panggilan semula; selepas 60s ambil semula; ralat pembekal -> 503 dengan kod & audit', async () => {
    const clock = new Clock(Date.UTC(2027, 1, 1));
    class FlakySms extends CountingSms {
      serviceCalls = 0;
      failWith: string | null = null;
      async getServices(code: number) {
        this.serviceCalls++;
        if (this.failWith) throw new ProviderError(this.failWith);
        return super.getServices(code);
      }
      quoteCalls = 0;
      async getServiceQuote(code: number, slug: string) {
        this.quoteCalls++;
        if (this.failWith) throw new ProviderError(this.failWith);
        return mockServicesFor(code).find((x) => x.slug === slug) ?? null;
      }
    }
    const sms = new FlakySms(proxy.env.DB, clock.now);
    const { app, env } = makeApp(proxy, {}, { now: clock.now, sms: () => sms });
    const c = new Client(app, env);
    await c.register();
    await c.req('GET', '/api/catalog/countries'); // pastikan cache untuk pembekal ini
    const price = await getPrice(c, 62, 'telegram');
    const before = sms.serviceCalls;
    clock.advance(20_000);
    const r1 = await c.req('POST', '/api/orders', { countryCode: 62, serviceSlug: 'telegram', expectedPriceSen: price });
    expect(r1.status).toBe(201);
    expect(sms.serviceCalls).toBe(before); // data 20s: tiada panggilan baharu
    await c.req('POST', `/api/orders/${r1.json.order.id}/cancel`);
    clock.advance(61_000);
    sms.failWith = 'INTERVAL_CONCURRENT_REQUESTS_ERROR';
    const r2 = await c.req('POST', '/api/orders', { countryCode: 62, serviceSlug: 'telegram', expectedPriceSen: price });
    expect(r2.status).toBe(503);
    expect(r2.json.error.providerCode).toBe('INTERVAL_CONCURRENT_REQUESTS_ERROR');
    expect(r2.json.error.message).toMatch(/INTERVAL_CONCURRENT_REQUESTS_ERROR/);
    const logged = await proxy.env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'provider.catalog_error'").first<{ n: number }>();
    expect(logged!.n).toBeGreaterThan(0);
    sms.failWith = null;
    const r3 = await c.req('POST', '/api/orders', { countryCode: 62, serviceSlug: 'telegram', expectedPriceSen: price });
    expect(r3.status).toBe(201);
    // Semakan sebelum pesanan hanya mengambil SATU servis, bukan katalog penuh
    expect(sms.serviceCalls).toBe(before);
    expect(sms.quoteCalls).toBe(2);
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

  it('semak status pembekal: membandingkan bilangan SMS tanpa mendedahkan kandungan; pelanggan ditolak', async () => {
    const { app, env } = setup();
    const c = new Client(app, env);
    await c.register();
    const { orderId, bill } = await newPaidOrder(c);
    await c.req('POST', `/api/demo/payments/${bill}`, { outcome: 'paid' });
    expect((await c.req('POST', `/api/admin/orders/${orderId}/provider-check`)).status).toBe(403);
    const { client: admin } = await createAdmin(proxy, app, env);
    let r = await admin.req('POST', `/api/admin/orders/${orderId}/provider-check`);
    expect(r.status).toBe(200);
    expect(r.json.provider).toMatchObject({ result: 'found', status: 'TZ_NUM_WAIT', messageCount: 0 });
    expect(r.json.consistent).toBe(true);
    // SMS masuk di pembekal tetapi sistem belum menyemak -> tidak sepadan; segerak -> sepadan
    const tzid = (await proxy.env.DB.prepare('SELECT provider_tzid FROM orders WHERE id = ?').bind(orderId).first<{ provider_tzid: string }>())!.provider_tzid;
    await proxy.env.DB.prepare("INSERT INTO mock_sms (tzid, body, created_at) VALUES (?, 'Kod rahsia 112233', ?)").bind(Number(tzid), Date.now()).run();
    r = await admin.req('POST', `/api/admin/orders/${orderId}/provider-check`);
    expect(r.json.consistent).toBe(false);
    expect(r.json.provider.messageCount).toBe(1);
    expect(JSON.stringify(r.json)).not.toContain('112233');
    expect((await admin.req('POST', `/api/admin/orders/${orderId}/provider-sync`)).status).toBe(200);
    r = await admin.req('POST', `/api/admin/orders/${orderId}/provider-check`);
    expect(r.json.consistent).toBe(true);
    expect(r.json.local.smsCount).toBe(1);
    const logs = await admin.req('GET', '/api/admin/audit');
    expect(logs.json.logs.some((l: any) => l.action === 'order.provider_check')).toBe(true);
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
        APP_ENV: 'staging', APP_BASE_URL: 'http://localhost:5173', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'chip',
        ONLINESIM_API_KEY: 'k', CHIP_SECRET_KEY: 's', CHIP_BRAND_ID: BRAND_ID,
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
