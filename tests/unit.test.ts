import { describe, expect, it } from 'vitest';
import { loadConfig } from '../worker/src/env';
import { md5Hex, hashPassword, verifyPassword } from '../worker/src/lib/crypto';
import { computePrice, decimalToMicros, microsToDecimal, rmStringToSen, senToRm } from '../worker/src/lib/money';
import { canTransition, refundEligible, TRANSITIONS } from '../worker/src/lib/orderState';
import { isBlockedService } from '../worker/src/services/catalog';
import { ToyyibPayProvider } from '../worker/src/providers/payment/toyyibpay';
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
    const r = loadConfig({ DB, APP_ENV: 'demo', SMS_PROVIDER: 'mock', PAYMENT_PROVIDER: 'toyyibpay', TOYYIBPAY_SECRET_KEY: 'x', TOYYIBPAY_CATEGORY_CODE: 'y' });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/bercampur/);
  });
  it('production sebenar: live OFF secara lalai', () => {
    const r = loadConfig({
      DB, APP_ENV: 'production', APP_BASE_URL: 'https://sms.mhmacademy.site', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'toyyibpay',
      ONLINESIM_API_KEY: 'k', TOYYIBPAY_SECRET_KEY: 's', TOYYIBPAY_CATEGORY_CODE: 'c', TOYYIBPAY_BASE_URL: 'https://toyyibpay.com',
    });
    expect(r.ok).toBe(true);
    expect(r.config.mode).toBe('live');
    expect(r.config.purchasesEnabled).toBe(false);
    expect(r.config.paymentsEnabled).toBe(false);
  });
  it('production menolak sandbox ToyyibPay dan http', () => {
    const r = loadConfig({
      DB, APP_ENV: 'production', APP_BASE_URL: 'http://sms.mhmacademy.site', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'toyyibpay',
      ONLINESIM_API_KEY: 'k', TOYYIBPAY_SECRET_KEY: 's', TOYYIBPAY_CATEGORY_CODE: 'c', TOYYIBPAY_BASE_URL: 'https://dev.toyyibpay.com',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(2);
  });
  it('production tanpa secrets ditolak', () => {
    const r = loadConfig({ DB, APP_ENV: 'production', APP_BASE_URL: 'https://x.y', SMS_PROVIDER: 'onlinesim', PAYMENT_PROVIDER: 'toyyibpay' });
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

describe('adapter ToyyibPay', () => {
  const fetchOf = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  it('mengesahkan hash callback mengikut formula rasmi', () => {
    const p = new ToyyibPayProvider('SECRET', 'cat', 'https://dev.toyyibpay.com');
    const form = { status: '1', order_id: 'MHMABC', refno: 'TP123', billcode: 'abc', hash: md5Hex('SECRET1MHMABCTP123ok') };
    expect(p.verifyCallback(form).valid).toBe(true);
    expect(p.verifyCallback({ ...form, status: '3' }).valid).toBe(false);
    expect(p.verifyCallback({ ...form, hash: '' }).valid).toBe(false);
  });
  it('fetchStatus: berjaya dengan amaun RM', async () => {
    const p = new ToyyibPayProvider('S', 'c', 'https://x', '0',
      fetchOf(JSON.stringify([{ billpaymentStatus: '1', billpaymentAmount: '6.30', billExternalReferenceNo: 'MHM1', billpaymentInvoiceNo: 'TP1' }])));
    expect(await p.fetchStatus('b')).toEqual({ status: 'paid', amountSen: 630, orderRef: 'MHM1', providerRef: 'TP1' });
  });
  it('fetchStatus: pending/gagal/kosong/rosak', async () => {
    expect((await new ToyyibPayProvider('S', 'c', 'https://x', '0', fetchOf('[{"billpaymentStatus":"2"}]')).fetchStatus('b')).status).toBe('pending');
    expect((await new ToyyibPayProvider('S', 'c', 'https://x', '0', fetchOf('[{"billpaymentStatus":"3"}]')).fetchStatus('b')).status).toBe('failed');
    expect((await new ToyyibPayProvider('S', 'c', 'https://x', '0', fetchOf('[]')).fetchStatus('b')).status).toBe('none');
    expect((await new ToyyibPayProvider('S', 'c', 'https://x', '0', fetchOf('<html>')).fetchStatus('b')).status).toBe('unknown');
  });
  it('createBill menghantar amaun dalam sen dan memulangkan URL', async () => {
    let sent = '';
    const f = (async (_u: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response('[{"BillCode":"gcbhict9"}]');
    }) as unknown as typeof fetch;
    const p = new ToyyibPayProvider('S', 'CAT', 'https://dev.toyyibpay.com', '0', f);
    const r = await p.createBill({ orderRef: 'MHMX', amountSen: 630, title: 'MHM SMS MHMX', description: 'Nombor SMS (Telegram) - Malaysia', returnUrl: 'https://a/r', callbackUrl: 'https://a/c' });
    expect(r).toEqual({ billCode: 'gcbhict9', paymentUrl: 'https://dev.toyyibpay.com/gcbhict9' });
    const q = new URLSearchParams(sent);
    expect(q.get('billAmount')).toBe('630');
    expect(q.get('billExternalReferenceNo')).toBe('MHMX');
    expect(q.get('billDescription')).toBe('Nombor SMS Telegram Malaysia');
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
