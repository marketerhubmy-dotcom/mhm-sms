import { PaymentProviderError, type CallbackCheck, type CallbackRequest, type CreateBillInput, type CreateBillResult, type PaymentProvider, type PaymentStatusResult } from './types';

/**
 * Adapter CHIP Collect (https://docs.chip-in.asia/openapi/chip-collect.yaml).
 *  - Base URL:          https://gate.chip-in.asia/api/v1  (kunci ujian & live menggunakan base yang sama; objek ujian ada is_test=true)
 *  - Auth:              Authorization: Bearer <secret key>
 *  - Cipta bayaran:     POST /purchases/            (purchase.products[].price dalam SEN; respons: id, checkout_url)
 *  - Semak status:      GET  /purchases/{id}/       (status, purchase.total, purchase.currency, reference, is_test)
 *  - Batal:             POST /purchases/{id}/cancel/
 *  - Kunci awam:        GET  /public_key/           (rentetan PEM dikodkan JSON)
 *  - Callback:          X-Signature = base64 RSA PKCS#1 v1.5 atas digest SHA-256 badan request.
 */

/** Status yang bermaksud wang telah diterima. */
const PAID = new Set(['paid', 'cleared', 'settled']);
/** Status muktamad tanpa bayaran. */
const FAILED = new Set(['cancelled', 'expired']);
/** Bayaran pernah diterima tetapi kemudian dipulangkan/dipertikaikan: perlu semakan manual. */
const REVERSED = new Set(['refunded', 'pending_refund', 'chargeback', 'released', 'pending_release']);

/** Cache kunci awam per base URL (TTL 1 jam). */
const keyCache = new Map<string, { pem: string; key: CryptoKey; at: number }>();
const KEY_TTL_MS = 60 * 60_000;

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class ChipProvider implements PaymentProvider {
  readonly name = 'chip' as const;

  constructor(
    private secretKey: string,
    private brandId: string,
    private opts: {
      baseUrl?: string;
      /** Tolak objek ujian (is_test=true) — wajib dalam production. */
      rejectTestPurchases?: boolean;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
      /** Untuk ujian: PEM kunci awam tetap (tanpa memanggil /public_key/). */
      publicKeyPem?: string;
    } = {},
  ) {}

  private get base() {
    return (this.opts.baseUrl || 'https://gate.chip-in.asia/api/v1').replace(/\/+$/, '');
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15_000);
    const f = this.opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    try {
      const res = await f(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (e) {
      throw new PaymentProviderError((e as Error)?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally {
      clearTimeout(t);
    }
  }

  async createBill(input: CreateBillInput): Promise<CreateBillResult> {
    if (!Number.isInteger(input.amountSen) || input.amountSen <= 0) throw new PaymentProviderError('INVALID_AMOUNT');
    const { status, json } = await this.call('POST', '/purchases/', {
      brand_id: this.brandId,
      client: { email: input.customerEmail, full_name: input.customerName.slice(0, 128) },
      purchase: {
        currency: 'MYR',
        products: [{ name: input.description.slice(0, 256), price: input.amountSen }],
        due_strict: true,
        language: 'ms',
      },
      reference: input.orderRef,
      due: Math.floor(input.dueAt / 1000),
      success_redirect: input.returnUrl,
      failure_redirect: input.returnUrl,
      cancel_redirect: input.returnUrl,
      success_callback: input.callbackUrl,
      send_receipt: false,
      platform: 'api',
      creator_agent: 'MHM SMS',
    });
    const p = (json ?? {}) as Record<string, unknown>;
    if (status !== 201 && status !== 200) throw new PaymentProviderError(`HTTP_${status}`);
    if (typeof p.id !== 'string' || typeof p.checkout_url !== 'string') throw new PaymentProviderError('CREATE_PURCHASE_FAILED');
    return { billCode: p.id, paymentUrl: p.checkout_url };
  }

  private static importKey(pem: string): Promise<CryptoKey> {
    return crypto.subtle.importKey('spki', pemToDer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  }

  /** Pulang [kunci, dariCache]. Kunci diambil daripada GET /public_key/ (rentetan PEM dikodkan JSON). */
  private async publicKey(forceRefresh = false): Promise<[CryptoKey, boolean]> {
    if (this.opts.publicKeyPem) return [await ChipProvider.importKey(this.opts.publicKeyPem), false];
    const hit = keyCache.get(this.base);
    if (!forceRefresh && hit && Date.now() - hit.at < KEY_TTL_MS) return [hit.key, true];
    const { status, json } = await this.call('GET', '/public_key/');
    if (status !== 200 || typeof json !== 'string' || !json.includes('BEGIN PUBLIC KEY')) throw new PaymentProviderError('PUBLIC_KEY_UNAVAILABLE');
    const key = await ChipProvider.importKey(json);
    keyCache.set(this.base, { pem: json, key, at: Date.now() });
    return [key, false];
  }

  async verifyCallback(req: CallbackRequest): Promise<CallbackCheck> {
    let billCode: string | null = null;
    try {
      const body = JSON.parse(req.rawBody) as Record<string, unknown>;
      billCode = typeof body.id === 'string' ? body.id : null;
    } catch {
      return { valid: false, billCode: null };
    }
    const sig = req.headers.get('X-Signature');
    if (!sig || !billCode) return { valid: false, billCode };
    try {
      const signature = b64ToBytes(sig);
      const data = new TextEncoder().encode(req.rawBody);
      const [key, fromCache] = await this.publicKey();
      let ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
      if (!ok && fromCache) {
        // Mungkin kunci telah diputar oleh CHIP: ambil semula sekali dan cuba lagi.
        const [fresh] = await this.publicKey(true);
        ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', fresh, signature, data);
      }
      return { valid: ok, billCode };
    } catch {
      return { valid: false, billCode };
    }
  }

  async fetchStatus(billCode: string): Promise<PaymentStatusResult> {
    if (!/^[0-9a-f-]{36}$/i.test(billCode)) return { status: 'unknown', code: 'INVALID_ID' };
    let r: { status: number; json: unknown };
    try {
      r = await this.call('GET', `/purchases/${billCode}/`);
    } catch (e) {
      return { status: 'unknown', code: e instanceof PaymentProviderError ? e.code : 'UNKNOWN' };
    }
    if (r.status === 404) return { status: 'none' };
    if (r.status !== 200 || !r.json || typeof r.json !== 'object') return { status: 'unknown', code: `HTTP_${r.status}` };
    const p = r.json as Record<string, unknown>;
    if (p.id !== billCode) return { status: 'unknown', code: 'ID_MISMATCH' };
    if (p.brand_id != null && p.brand_id !== this.brandId) return { status: 'unknown', code: 'BRAND_MISMATCH' };
    if (this.opts.rejectTestPurchases && p.is_test === true) return { status: 'unknown', code: 'TEST_PURCHASE' };
    const st = String(p.status ?? '');
    if (PAID.has(st)) {
      const purchase = (p.purchase ?? {}) as Record<string, unknown>;
      const total = purchase.total;
      if (typeof total !== 'number' || !Number.isInteger(total)) return { status: 'unknown', code: 'AMOUNT_UNPARSEABLE' };
      return {
        status: 'paid',
        amountSen: total,
        currency: String(purchase.currency ?? ''),
        orderRef: typeof p.reference === 'string' ? p.reference : null,
        providerRef: billCode,
      };
    }
    if (FAILED.has(st)) return { status: 'failed' };
    if (REVERSED.has(st)) return { status: 'unknown', code: `REVERSED_${st.toUpperCase()}` };
    // created, sent, viewed, overdue, error (pelanggan boleh cuba lagi), pending_* , hold, dll.
    return { status: 'pending' };
  }

  async deactivateBill(billCode: string): Promise<void> {
    try {
      await this.call('POST', `/purchases/${billCode}/cancel/`);
    } catch {
      // Tidak kritikal: bayaran lewat tetap dikendalikan sebagai "paid".
    }
  }
}
