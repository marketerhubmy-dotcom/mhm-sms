import { Hono } from 'hono';
import { AppError, listCountries, listServices } from '../services/catalog';
import { clientIp, enforceRateLimit, type HonoEnv } from '../http';

export const publicRoutes = new Hono<HonoEnv>();

publicRoutes.get('/health', (c) => {
  const app = c.get('app');
  return c.json({
    ok: app.configErrors.length === 0,
    mode: app.config.mode,
    env: app.config.appEnv,
    payment: app.config.paymentProvider === 'mock' ? 'simulated' : app.config.chipTestOnly ? 'chip-test' : 'chip',
    // Nama masalah konfigurasi (tiada nilai rahsia) dipaparkan di luar production untuk memudahkan persediaan.
    ...(app.config.appEnv !== 'production' && app.configErrors.length ? { configErrors: app.configErrors } : {}),
  });
});

/**
 * Diagnostik sambungan Worker -> CHIP (BUKAN production). Melaporkan kod HTTP & masa sahaja.
 * 200 = boleh dicapai & kunci sah; 401/403 = boleh dicapai tetapi kunci/akses tidak sah; TIMEOUT/NETWORK_ERROR = tidak dapat dicapai.
 */
publicRoutes.get('/health/chip', async (c) => {
  const app = c.get('app');
  if (app.config.appEnv === 'production' || app.config.paymentProvider !== 'chip') throw new AppError('NOT_FOUND', 404, 'Tidak dijumpai.');
  await enforceRateLimit(c, `chip-probe:${clientIp(c)}`, 10, 10 * 60_000);
  const base = (app.env.CHIP_BASE_URL || 'https://gate.chip-in.asia/api/v1').replace(/\/+$/, '');
  const probe = async (withKey: boolean) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const started = Date.now();
    try {
      const res = await fetch(`${base}/public_key/`, {
        headers: { Accept: 'application/json', ...(withKey ? { Authorization: `Bearer ${app.env.CHIP_SECRET_KEY ?? ''}` } : {}) },
        signal: ctrl.signal,
      });
      await res.arrayBuffer();
      return { http: res.status, ms: Date.now() - started };
    } catch (e) {
      return { error: (e as Error)?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', ms: Date.now() - started };
    } finally {
      clearTimeout(t);
    }
  };
  return c.json({ withoutKey: await probe(false), withKey: await probe(true) });
});

publicRoutes.get('/config', (c) => {
  const app = c.get('app');
  return c.json({
    mode: app.config.mode,
    paymentMode: app.config.paymentProvider === 'mock' ? 'simulated' : app.config.chipTestOnly ? 'test' : 'live',
    salesOpen: app.config.purchasesEnabled && app.config.paymentsEnabled,
    passwordResetAvailable: !!app.email,
    supportEmail: app.env.SUPPORT_EMAIL ?? null,
    supportWhatsapp: app.env.SUPPORT_WHATSAPP ?? null,
  });
});

publicRoutes.get('/catalog/countries', async (c) => {
  const { countries, stale } = await listCountries(c.get('app'));
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ countries: countries.map((x) => ({ code: x.code, name: x.name })), stale });
});

publicRoutes.get('/catalog/countries/:code/services', async (c) => {
  const app = c.get('app');
  const code = Number(c.req.param('code'));
  if (!Number.isInteger(code) || code <= 0) throw new AppError('BAD_REQUEST', 400, 'Negara tidak sah.');
  const { countries } = await listCountries(app);
  if (!countries.some((x) => x.code === code)) throw new AppError('COUNTRY_UNAVAILABLE', 404, 'Negara ini tidak tersedia.');
  const { services, stale, fetchedAt } = await listServices(app, code);
  c.header('Cache-Control', 'public, max-age=30');
  // Kos pembekal TIDAK didedahkan kepada pelanggan.
  return c.json({
    services: services.map((s) => ({ slug: s.slug, name: s.name, stock: s.stock, priceSen: s.priceSen })),
    stale,
    fetchedAt,
  });
});
