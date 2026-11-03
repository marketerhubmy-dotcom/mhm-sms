/**
 * Pelayan CHIP Collect tiruan untuk ujian, mengikut skema OpenAPI rasmi:
 *  POST /purchases/, GET /purchases/{id}/, POST /purchases/{id}/cancel/, GET /public_key/
 * Callback ditandatangani dengan RSA PKCS#1 v1.5 + SHA-256 (seperti X-Signature CHIP).
 */
export const BRAND_ID = '409eb80e-3782-4b1d-afa8-b779759266a5';

function toB64(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

export interface FakePurchase {
  id: string;
  status: string;
  brand_id: string;
  reference: string;
  is_test: boolean;
  checkout_url: string;
  purchase: { currency: string; total: number; products: { name: string; price: number }[] };
  client: { email: string };
  success_callback?: string;
}

export async function makeChipFixture() {
  const keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const spki = (await crypto.subtle.exportKey('spki', keys.publicKey)) as ArrayBuffer;
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${toB64(spki).replace(/(.{64})/g, '$1\n')}\n-----END PUBLIC KEY-----\n`;
  const purchases = new Map<string, FakePurchase>();
  const calls: { method: string; path: string; body: any; auth: string | null }[] = [];

  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/api\/v1/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const auth = (init.headers as Record<string, string>)?.Authorization ?? null;
    calls.push({ method, path, body, auth });
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET' && path === '/public_key/') return json(publicKeyPem);
    if (method === 'POST' && path === '/purchases/') {
      const id = crypto.randomUUID();
      const total = body.purchase.products.reduce((a: number, p: { price: number }) => a + p.price, 0);
      const p: FakePurchase = {
        id,
        status: 'created',
        brand_id: body.brand_id,
        reference: body.reference,
        is_test: true,
        checkout_url: `https://gate.chip-in.asia/p/${id}/`,
        purchase: { currency: body.purchase.currency, total, products: body.purchase.products },
        client: body.client,
        success_callback: body.success_callback,
      };
      purchases.set(id, p);
      return json(p, 201);
    }
    const m = path.match(/^\/purchases\/([0-9a-f-]{36})\/(cancel\/)?$/);
    if (m) {
      const p = purchases.get(m[1]);
      if (!p) return json({ detail: 'Not found' }, 404);
      if (m[2] && method === 'POST') p.status = 'cancelled';
      return json(p);
    }
    return json({ detail: 'Not found' }, 404);
  }) as unknown as typeof fetch;

  async function sign(rawBody: string): Promise<string> {
    return toB64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(rawBody)));
  }

  return { publicKeyPem, purchases, calls, fetchImpl, sign };
}
