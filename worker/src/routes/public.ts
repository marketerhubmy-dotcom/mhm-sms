import { Hono } from 'hono';
import { AppError, listCountries, listServices } from '../services/catalog';
import type { HonoEnv } from '../http';

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
