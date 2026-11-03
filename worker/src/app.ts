import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './env';
import { csrfGuard, loadSession, type HonoEnv } from './http';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { callbackRoutes } from './routes/callbacks';
import { demoPaymentRoutes, orderRoutes } from './routes/orders';
import { publicRoutes } from './routes/public';
import { AppError } from './services/catalog';
import { buildCtx, type Deps } from './services/context';
import { runScheduled } from './services/cron';

export function createApp(deps: Deps = {}) {
  const app = new Hono<HonoEnv>();

  app.use('*', secureHeaders());
  app.use('/api/*', async (c, next) => {
    const ctx = buildCtx(c.env, deps);
    c.set('app', ctx);
    c.header('Cache-Control', 'no-store');
    if (ctx.configErrors.length && !c.req.path.startsWith('/api/health')) {
      // Log nama ralat konfigurasi sahaja (tiada nilai rahsia).
      console.error('Konfigurasi tidak sah:', ctx.configErrors.join('; '));
      return c.json({ error: { code: 'MISCONFIGURED', message: 'Servis sedang diselenggara. Sila cuba sebentar lagi.' } }, 503);
    }
    await next();
  });
  app.use('/api/*', loadSession);
  app.use('/api/*', csrfGuard);

  app.route('/api', publicRoutes);
  app.route('/api', callbackRoutes);
  app.route('/api/auth', authRoutes);
  app.route('/api/orders', orderRoutes);
  app.route('/api/demo/payments', demoPaymentRoutes);
  app.route('/api/admin', adminRoutes);

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Tidak dijumpai.' } }, 404));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } }, err.status as 400);
    }
    // Jangan log payload/SMS/kata laluan — hanya nama & mesej ralat.
    console.error('Ralat tidak dijangka:', err?.name, err?.message);
    return c.json({ error: { code: 'INTERNAL', message: 'Ralat sistem. Sila cuba lagi.' } }, 500);
  });

  return {
    fetch: app.fetch,
    async scheduled(_event: ScheduledController | unknown, env: Env, ctx?: ExecutionContext) {
      const appCtx = buildCtx(env, deps);
      if (appCtx.configErrors.length) {
        console.error('Cron dilangkau: konfigurasi tidak sah:', appCtx.configErrors.join('; '));
        return;
      }
      const p = runScheduled(appCtx).catch((e) => console.error('Cron gagal:', (e as Error)?.message));
      if (ctx) ctx.waitUntil(p);
      else await p;
    },
  };
}
