import { describe, expect, it } from 'vitest';
import { loadConfig } from '../worker/src/env';
import { hashPassword, verifyPassword } from '../worker/src/lib/crypto';
import { computePrice, decimalToMicros, microsToDecimal, rmStringToSen, senToRm } from '../worker/src/lib/money';
import { canTransition, refundEligible, TRANSITIONS } from '../worker/src/lib/orderState';
import { isBlockedService } from '../worker/src/services/catalog';
import { ChipProvider } from '../worker/src/providers/payment/chip';
import { BRAND_ID, makeChipFixture } from './chipFixture';
import { OnlineSimProvider } from '../worker/src/providers/sms/onlinesim';

const base = { fxRateMicros: 4_700_000, markupBps: 5000, fixedFeeSen: 50, minPriceSen: 200, roundingSen: 10 };

describe('pengiraan wang', () => {
  it('menukar perpuluhan kepada micros tanpa floating-point', () => {
    expect(decimalToMicros('0.55')).toBe(550_000);
    expect(decimalToMicros('12')).toBe(12_000_000);
    expect(decimalToMicros('0.1')).toBe(100_000);
    expect(decimalToMicros('0.0000001')).toBe(1); // bundar ke atas
    expect(decimalToMicros('1.2345670')).toBe(1_234_567);
    expect(() => decimalToMicros('-1')).toThrow();
    expect(() => decimalToMicros('1e5')).toThrow();
    expect(microsToDecimal(550_000)).toBe('0.55');
  });

  it('menukar RM kepada sen', () => {
    expect(rmStringToSen('10.00')).toBe(1000);
    expect(rmStringToSen('0.1')).toBe(10);
    expect(rmStringToSen('7')).toBe(700);
    expect(rmStringToSen('1.005'.replace('5', '0'))).toBe(100);
    expect(() => rmStringToSen('1.005')).toThrow();
    expect(senToRm(1234)).toBe('12.34');
    expect(senToRm(5)).toBe('0.05');
  });

  it('mengira harga: kos × kadar × markup + caj tetap, bundar ke atas', () => {
    // 0.82 USD × 4.70 = RM3.854 -> kos 386 sen (ceil). × 1.5 = 5.781 -> 579 sen; +50 = 629 -> bundar 10 sen = 630
    const p = computePrice(820_000, base);
    expect(p.costSen).toBe(386);
    expect(p.priceSen).toBe(630);
    expect(p.overrideApplied).toBe(false);
  });

  it('menggunakan harga minimum', () => {
    expect(computePrice(10_000, base).priceSen).toBe(200);
  });

  it('override menggantikan formula', () => {
    const p = computePrice(820_000, base, 999);
    expect(p.priceSen).toBe(999);
    expect(p.overrideApplied).toBe(true);
    expect(p.costSen).toBe(386);
  });

  it('tiada ralat pembundaran pada nilai klasik 0.1 + 0.2', () => {
    const p = computePrice(300_000, { ...base, fxRateMicros: 1_000_000, markupBps: 0, fixedFeeSen: 0, minPriceSen: 0, roundingSen: 1 });
    expect(p.priceSen).toBe(30);
  });

  it('pembundaran sentiasa ke atas (tidak menjual bawah kos)', () => {
    for (let c = 1; c < 5_000_000; c += 77_777) {
      const p = computePrice(c, { ...base, markupBps: 0, fixedFeeSen: 0, minPriceSen: 0, roundingSen: 1 });
      expect(p.priceSen).toBeGreaterThanOrEqual(p.costSen);
      expect(p.priceSen * 1e10).toBeGreaterThanOrEqual(c * base.fxRateMicros);
    }
  });

  it('menolak input tidak sah', () => {
    expect(() => computePrice(-1, base)).toThrow();
    expect(() => computePrice(1.5, base)).toThrow();
    expect(() => computePrice(100, { ...base, fxRateMicros: 0 })).toThrow();
  });
});

describe('konfigurasi mod', () => {
  const DB = {} as D1Database;
  it('production menolak mock', () => {
    const r = loadConfig({ DB, APP_ENV: 'production', APP_BASE_URL: 'https://sms.mhmacademy.site', SMS_PROVIDER: 'mock', PAYMENT_PROVIDER: 'mock' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/mock tidak dibenarkan/);
  });
  it('production menolak campuran mock + sebenar', () => {
    const r = loadConfig({
      DB, APP_ENV: 'production', APP_BASE_URL: 'https://sms.mhmacademy.site', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'mock', ONLINESIM_API_KEY: 'x',
    });
    expect(r.ok).toBe(false);
  });
  it('demo menolak campuran (bayaran sebenar + nombor palsu)', () => {
    const r = loadConfig({ DB, APP_ENV: 'demo', SMS_PROVIDER: 'mock', PAYMENT_PROVIDER: 'chip', CHIP_SECRET_KEY: 'x', CHIP_BRAND_ID: BRAND_ID });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/bercampur/);
  });
  it('production sebenar: live OFF secara lalai', () => {
    const r = loadConfig({
      DB, APP_ENV: 'production', APP_BASE_URL: 'https://sms.mhmacademy.site', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'chip',
      ONLINESIM_API_KEY: 'k', CHIP_SECRET_KEY: 's', CHIP_BRAND_ID: BRAND_ID,
    });
    expect(r.ok).toBe(true);
    expect(r.config.mode).toBe('live');
    expect(r.config.purchasesEnabled).toBe(false);
    expect(r.config.paymentsEnabled).toBe(false);
  });
  it('production menolak http dan CHIP_BRAND_ID bukan UUID', () => {
    const r = loadConfig({
      DB, APP_ENV: 'production', APP_BASE_URL: 'http://sms.mhmacademy.site', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'chip',
      ONLINESIM_API_KEY: 'k', CHIP_SECRET_KEY: 's', CHIP_BRAND_ID: 'bukan-uuid',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(2);
  });
  it('production tanpa secrets ditolak', () => {
    const r = loadConfig({ DB, APP_ENV: 'production', APP_BASE_URL: 'https://x.y', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'chip' });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(3);
  });
});

describe('state machine pesanan', () => {
  it('peralihan sah dan tidak sah', () => {
    expect(canTransition('pending_payment', 'paid')).toBe(true);
    expect(canTransition('paid', 'purchasing')).toBe(true);
    expect(canTransition('purchasing', 'needs_reconciliation')).toBe(true);
    expect(canTransition('paid', 'active')).toBe(false); // mesti melalui purchasing
    expect(canTransition('completed', 'active')).toBe(false);
    expect(canTransition('needs_reconciliation', 'paid')).toBe(false); // tiada retry automatik
    expect(canTransition('active', 'purchase_failed')).toBe(false);
  });
  it('status terminal tiada peralihan keluar', () => {
    for (const s of ['purchase_failed', 'completed', 'expired', 'cancelled'] as const) expect(TRANSITIONS[s]).toEqual([]);
  });
  it('refund tidak dibenarkan bila status pembekal tidak diketahui', () => {
    expect(refundEligible('needs_reconciliation', 0)).toBe(false);
    expect(refundEligible('purchasing', 0)).toBe(false);
    expect(refundEligible('purchase_failed', 0)).toBe(true);
    expect(refundEligible('expired', 0)).toBe(true);
    expect(refundEligible('expired', 1)).toBe(false);
  });
});

describe('kata laluan', () => {
  it('hash & sahkan (PBKDF2 Web Crypto)', async () => {
    const h = await hashPassword('rahsia-sangat-123', 10000);
    expect(h.startsWith('pbkdf2-sha256$10000$')).toBe(true);
    expect(await verifyPassword('rahsia-sangat-123', h)).toBe(true);
    expect(await verifyPassword('salah', h)).toBe(false);
    expect(await hashPassword('rahsia-sangat-123', 10000)).not.toBe(h); // salt rawak
  });
});

describe('servis disekat', () => {
  it('mengesan kata kunci kewangan', () => {
    const kw = 'bank,pay,wallet,loan';
    expect(isBlockedService('demobank', 'Demo Bank', kw)).toBe(true);
    expect(isBlockedService('paypal', 'PayPal', kw)).toBe(true);
    expect(isBlockedService('telegram', 'Telegram', kw)).toBe(false);
    expect(isBlockedService('shopee', 'Shopee', kw)).toBe(false);
  });
});

describe('adapter CHIP', () => {
  it('createBill: amaun dalam sen, rujukan, redirect & callback, kunci dalam header', async () => {
    const fx = await makeChipFixture();
    const p = new ChipProvider('SECRET', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem });
    const r = await p.createBill({
      orderRef: 'MHMX', amountSen: 630, title: 'MHM SMS MHMX', description: 'Nombor SMS Telegram (Malaysia) - MHMX',
      customerEmail: 'a@b.my', customerName: 'Ali', dueAt: 1_800_000_000_000, returnUrl: 'https://a/r', callbackUrl: 'https://a/c',
    });
    expect(r.paymentUrl).toMatch(/^https:\/\/gate\.chip-in\.asia\/p\//);
    const call = fx.calls.find((c) => c.path === '/purchases/')!;
    expect(call.auth).toBe('Bearer SECRET');
    expect(call.body.purchase.products[0].price).toBe(630);
    expect(call.body.purchase.currency).toBe('MYR');
    expect(call.body.reference).toBe('MHMX');
    expect(call.body.brand_id).toBe(BRAND_ID);
    expect(call.body.success_callback).toBe('https://a/c');
    expect(call.body.due).toBe(1_800_000_000);
    expect(fx.calls.every((c) => !c.path.includes('SECRET'))).toBe(true);
  });

  it('fetchStatus: paid/cleared/settled = dibayar; cancelled/expired = gagal; error = belum muktamad; refunded = semakan', async () => {
    const fx = await makeChipFixture();
    const p = new ChipProvider('S', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem });
    const { billCode } = await p.createBill({ orderRef: 'MHM1', amountSen: 420, title: 't', description: 'd', customerEmail: 'a@b.my', customerName: 'A', dueAt: Date.now(), returnUrl: 'https://r', callbackUrl: 'https://c' });
    const set = (st: string) => (fx.purchases.get(billCode)!.status = st);
    expect((await p.fetchStatus(billCode)).status).toBe('pending');
    for (const st of ['paid', 'cleared', 'settled']) {
      set(st);
      expect(await p.fetchStatus(billCode)).toEqual({ status: 'paid', amountSen: 420, currency: 'MYR', orderRef: 'MHM1', providerRef: billCode });
    }
    for (const st of ['cancelled', 'expired']) {
      set(st);
      expect((await p.fetchStatus(billCode)).status).toBe('failed');
    }
    set('error');
    expect((await p.fetchStatus(billCode)).status).toBe('pending');
    set('refunded');
    expect(await p.fetchStatus(billCode)).toEqual({ status: 'unknown', code: 'REVERSED_REFUNDED' });
    expect((await p.fetchStatus('00000000-0000-0000-0000-000000000000')).status).toBe('none');
    expect((await p.fetchStatus('bukan-id')).status).toBe('unknown');
  });

  it('production menolak pembelian ujian (is_test) dan brand berbeza', async () => {
    const fx = await makeChipFixture();
    const p = new ChipProvider('S', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem, rejectTestPurchases: true });
    const { billCode } = await p.createBill({ orderRef: 'MHM2', amountSen: 200, title: 't', description: 'd', customerEmail: 'a@b.my', customerName: 'A', dueAt: Date.now(), returnUrl: 'https://r', callbackUrl: 'https://c' });
    fx.purchases.get(billCode)!.status = 'paid';
    expect(await p.fetchStatus(billCode)).toEqual({ status: 'unknown', code: 'TEST_PURCHASE' });
    fx.purchases.get(billCode)!.is_test = false;
    fx.purchases.get(billCode)!.brand_id = '11111111-1111-1111-1111-111111111111';
    expect(await p.fetchStatus(billCode)).toEqual({ status: 'unknown', code: 'BRAND_MISMATCH' });
  });

  it('verifyCallback: tandatangan RSA sah diterima; badan diubah atau tandatangan palsu ditolak', async () => {
    const fx = await makeChipFixture();
    const p = new ChipProvider('S', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem });
    const body = JSON.stringify({ id: '7ed93a3a-73f1-4979-92de-32928aced353', status: 'paid', event_type: 'purchase.paid' });
    const sig = await fx.sign(body);
    expect(await p.verifyCallback({ rawBody: body, headers: new Headers({ 'X-Signature': sig }) })).toEqual({ valid: true, billCode: '7ed93a3a-73f1-4979-92de-32928aced353' });
    const tampered = body.replace('"paid"', '"paid" ');
    expect((await p.verifyCallback({ rawBody: tampered, headers: new Headers({ 'X-Signature': sig }) })).valid).toBe(false);
    expect((await p.verifyCallback({ rawBody: body, headers: new Headers({ 'X-Signature': btoa('palsu') }) })).valid).toBe(false);
    expect((await p.verifyCallback({ rawBody: body, headers: new Headers() })).valid).toBe(false);
    expect((await p.verifyCallback({ rawBody: 'bukan json', headers: new Headers({ 'X-Signature': sig }) })).valid).toBe(false);
  });

  it('verifyCallback mengambil kunci awam daripada GET /public_key/ (rentetan PEM JSON)', async () => {
    const fx = await makeChipFixture();
    const p = new ChipProvider('S', BRAND_ID, { fetchImpl: fx.fetchImpl });
    const body = JSON.stringify({ id: '7ed93a3a-73f1-4979-92de-32928aced353' });
    expect((await p.verifyCallback({ rawBody: body, headers: new Headers({ 'X-Signature': await fx.sign(body) }) })).valid).toBe(true);
    expect(fx.calls.some((c) => c.path === '/public_key/')).toBe(true);
  });

  it('kunci awam diputar oleh CHIP: kunci cache lama -> ambil semula sekali, kemudian sah', async () => {
    const oldFx = await makeChipFixture();
    const body = JSON.stringify({ id: '7ed93a3a-73f1-4979-92de-32928aced353' });
    const p1 = new ChipProvider('S', BRAND_ID, { fetchImpl: oldFx.fetchImpl, baseUrl: 'https://rotate.test/api/v1' });
    expect((await p1.verifyCallback({ rawBody: body, headers: new Headers({ 'X-Signature': await oldFx.sign(body) }) })).valid).toBe(true);
    const newFx = await makeChipFixture();
    const p2 = new ChipProvider('S', BRAND_ID, { fetchImpl: newFx.fetchImpl, baseUrl: 'https://rotate.test/api/v1' });
    expect((await p2.verifyCallback({ rawBody: body, headers: new Headers({ 'X-Signature': await newFx.sign(body) }) })).valid).toBe(true);
    expect(newFx.calls.filter((c) => c.path === '/public_key/').length).toBe(1);
    // Tandatangan daripada kunci yang tidak sah lagi tetap ditolak
    expect((await p2.verifyCallback({ rawBody: body, headers: new Headers({ 'X-Signature': await oldFx.sign(body) }) })).valid).toBe(false);
  });

  it('deactivateBill memanggil /purchases/{id}/cancel/', async () => {
    const fx = await makeChipFixture();
    const p = new ChipProvider('S', BRAND_ID, { fetchImpl: fx.fetchImpl, publicKeyPem: fx.publicKeyPem });
    const { billCode } = await p.createBill({ orderRef: 'MHM3', amountSen: 200, title: 't', description: 'd', customerEmail: 'a@b.my', customerName: 'A', dueAt: Date.now(), returnUrl: 'https://r', callbackUrl: 'https://c' });
    await p.deactivateBill(billCode);
    expect(fx.purchases.get(billCode)!.status).toBe('cancelled');
  });
});

describe('adapter OnlineSIM', () => {
  const fetchOf = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
  it('getNum berjaya', async () => {
    const p = new OnlineSimProvider('k', 'https://onlinesim.io', 1000,
      fetchOf({ response: 1, tzid: 10000, number: '+37360000000', country: 373, time: 900, service: 'telegram', title: 'Telegram', response_text: 'waiting for SMS', guard_interval_remaining_seconds: 120 }));
    expect(await p.buyNumber({ countryCode: 373, serviceSlug: 'telegram' })).toEqual({ kind: 'ok', tzid: '10000', number: '+37360000000', timeLeftS: 900, guardS: 120 });
  });
  it('getNum NO_NUMBER = ditolak secara pasti', async () => {
    const p = new OnlineSimProvider('k', 'https://onlinesim.io', 1000, fetchOf({ response: 'NO_NUMBER' }));
    expect(await p.buyNumber({ countryCode: 7, serviceSlug: 'x' })).toEqual({ kind: 'rejected', code: 'NO_NUMBER' });
  });
  it('getNum TRY_AGAIN_LATER / kod baru = tidak pasti', async () => {
    expect((await new OnlineSimProvider('k', 'https://o', 1000, fetchOf({ response: 'TRY_AGAIN_LATER' })).buyNumber({ countryCode: 7, serviceSlug: 'x' })).kind).toBe('unknown');
    expect((await new OnlineSimProvider('k', 'https://o', 1000, fetchOf({ response: 'SOMETHING_NEW' })).buyNumber({ countryCode: 7, serviceSlug: 'x' })).kind).toBe('unknown');
  });
  it('getNum timeout = tidak pasti', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const r = await new OnlineSimProvider('k', 'https://o', 50, hang).buyNumber({ countryCode: 7, serviceSlug: 'x' });
    expect(r).toEqual({ kind: 'unknown', code: 'TIMEOUT' });
  });
  it('API key dihantar dalam header, bukan URL', async () => {
    let url = '';
    let auth = '';
    const f = (async (u: string, init: RequestInit) => {
      url = u;
      auth = (init.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ response: '1', balance: '106.32', zbalance: 0 }));
    }) as unknown as typeof fetch;
    const b = await new OnlineSimProvider('SECRETKEY', 'https://onlinesim.io', 1000, f).getBalance();
    expect(b.balanceMicros).toBe(106_320_000);
    expect(url).not.toContain('SECRETKEY');
    expect(auth).toBe('Bearer SECRETKEY');
  });
  it('getState: format array dan format {response,list}, serta ERROR_NO_OPERATIONS', async () => {
    const op = { tzid: 10000, response: 'TZ_NUM_ANSWER', number: '+373', country: 373, service: 'telegram', sum: 14, time: 500, msg: ['Your code is 123456'], form: 'index' };
    const a = await new OnlineSimProvider('k', 'https://o', 1000, fetchOf([op])).getOperation('10000');
    expect(a).toMatchObject({ kind: 'found', status: 'TZ_NUM_ANSWER', messages: ['Your code is 123456'], timeLeftS: 500 });
    const b = await new OnlineSimProvider('k', 'https://o', 1000, fetchOf({ response: '1', list: [op] })).getOperation('10000');
    expect(b.kind).toBe('found');
    const c = await new OnlineSimProvider('k', 'https://o', 1000, fetchOf({ response: 'ERROR_NO_OPERATIONS' })).getOperation('10000');
    expect(c.kind).toBe('not_found');
  });
  it('getTariffs: memproses peta countries/services', async () => {
    const body = { response: '1', countries: { _7: { name: 'Russia', original: 'russia', code: 7, pos: 0, other: false, new: false, enable: true } }, services: { _vkcom: { id: 1, count: 3721, price: '0.55', service: 'VKontakte', slug: 'vkcom' } }, end: true };
    const p = new OnlineSimProvider('k', 'https://o', 1000, fetchOf(body));
    expect(await p.getCountries()).toEqual([{ code: 7, name: 'Russia', enabled: true }]);
    expect(await p.getServices(7)).toEqual([{ slug: 'vkcom', name: 'VKontakte', stock: 3721, costMicros: 550_000 }]);
  });
  it('setOperationOk: NO_COMPLETE_TZID = terlalu awal', async () => {
    expect(await new OnlineSimProvider('k', 'https://o', 1000, fetchOf({ response: 'NO_COMPLETE_TZID' })).completeOperation('1')).toEqual({ kind: 'too_early' });
    expect(await new OnlineSimProvider('k', 'https://o', 1000, fetchOf({ response: 1, tzid: 1 })).completeOperation('1')).toEqual({ kind: 'ok' });
  });
});
