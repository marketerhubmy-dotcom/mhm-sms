import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './env';
import { randomToken, sha256Hex, timingSafeEqualStr } from './lib/crypto';
import { AppError } from './services/catalog';
import type { AppCtx } from './services/context';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    app: AppCtx;
    user: SessionUser | null;
    sessionId: string | null;
    csrfToken: string | null;
  };
};
export type C = Context<HonoEnv>;

const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const SESSION_TOUCH_MS = 10 * 60_000;

export function cookieName(app: AppCtx) {
  return app.config.secureCookies ? '__Host-mhm_sid' : 'mhm_sid';
}

export function clientIp(c: C): string {
  return c.req.header('CF-Connecting-IP') ?? 'local';
}

export async function createSession(c: C, userId: string): Promise<string> {
  const app = c.get('app');
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const csrf = randomToken(24);
  const now = app.now();
  await app.db
    .prepare('INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, userId, csrf, now, now + SESSION_TTL_MS, now)
    .run();
  setCookie(c, cookieName(app), token, {
    httpOnly: true,
    secure: app.config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  c.set('sessionId', id);
  c.set('csrfToken', csrf);
  return csrf;
}

export async function destroySession(c: C, clearCookie = true) {
  const app = c.get('app');
  const id = c.get('sessionId');
  if (id) await app.db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  if (clearCookie) deleteCookie(c, cookieName(app), { path: '/', secure: app.config.secureCookies });
  c.set('sessionId', null);
  c.set('user', null);
  c.set('csrfToken', null);
}

export const loadSession: MiddlewareHandler<HonoEnv> = async (c, next) => {
  c.set('user', null);
  c.set('sessionId', null);
  c.set('csrfToken', null);
  const app = c.get('app');
  const token = getCookie(c, cookieName(app));
  if (token && token.length < 200) {
    const id = await sha256Hex(token);
    const row = await app.db
      .prepare(
        `SELECT s.id, s.csrf_token, s.expires_at, s.last_seen_at, u.id AS uid, u.email, u.name, u.role, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .bind(id)
      .first<{ id: string; csrf_token: string; expires_at: number; last_seen_at: number; uid: string; email: string; name: string; role: 'customer' | 'admin'; status: string }>();
    const now = app.now();
    if (row && row.expires_at > now && row.status === 'active') {
      c.set('user', { id: row.uid, email: row.email, name: row.name, role: row.role });
      c.set('sessionId', row.id);
      c.set('csrfToken', row.csrf_token);
      if (now - row.last_seen_at > SESSION_TOUCH_MS) {
        await app.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').bind(now, now + SESSION_TTL_MS, row.id).run();
      }
    } else if (row) {
      await app.db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    }
  }
  await next();
};

/**
 * Perlindungan CSRF untuk semua request yang mengubah keadaan:
 *  1. Header Origin (jika ada) mesti dalam senarai dibenarkan.
 *  2. Header tersuai X-Requested-With (tidak boleh dihantar rentas-laman tanpa CORS preflight, yang tidak kita benarkan).
 *  3. Jika ada sesi: X-CSRF-Token mesti sepadan dengan token sesi (synchronizer token).
 * Callback pembayaran & webhook dikecualikan (dilindungi tandatangan/token & pengesahan semula pada pembekal).
 */
export const csrfGuard: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/payments/') || path.startsWith('/api/webhooks/')) return next();
  const app = c.get('app');
  const origin = c.req.header('Origin');
  if (origin && !app.config.allowedOrigins.includes(origin)) throw new AppError('BAD_ORIGIN', 403, 'Permintaan ditolak.');
  if (c.req.header('X-Requested-With') !== 'mhm-sms') throw new AppError('CSRF', 403, 'Permintaan ditolak.');
  const sessionCsrf = c.get('csrfToken');
  if (sessionCsrf) {
    const sent = c.req.header('X-CSRF-Token') ?? '';
    if (!timingSafeEqualStr(sent, sessionCsrf)) throw new AppError('CSRF', 403, 'Sesi tidak sah. Sila muat semula halaman.');
  }
  await next();
};

export const requireUser: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (!c.get('user')) throw new AppError('UNAUTHENTICATED', 401, 'Sila log masuk.');
  await next();
};

/** Peranan admin disemak pada backend daripada pangkalan data (melalui sesi), bukan daripada input klien. */
export const requireAdmin: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const u = c.get('user');
  if (!u) throw new AppError('UNAUTHENTICATED', 401, 'Sila log masuk.');
  if (u.role !== 'admin') throw new AppError('FORBIDDEN', 403, 'Akses ditolak.');
  await next();
};

/** Had kadar (fixed window) yang disimpan dalam D1. Pulang true jika dibenarkan. */
export async function rateLimit(app: AppCtx, key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = app.now();
  const k = await sha256Hex(key);
  const row = await app.db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start <= ? THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start <= ? THEN excluded.window_start ELSE rate_limits.window_start END
       RETURNING count`,
    )
    .bind(k, now, now - windowMs, now - windowMs)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

export async function enforceRateLimit(c: C, key: string, limit: number, windowMs: number) {
  if (!(await rateLimit(c.get('app'), key, limit, windowMs))) {
    throw new AppError('RATE_LIMITED', 429, 'Terlalu banyak cubaan. Sila tunggu sebentar dan cuba lagi.');
  }
}

export async function jsonBody<T = Record<string, unknown>>(c: C): Promise<T> {
  try {
    const b = await c.req.json();
    if (!b || typeof b !== 'object') throw new Error();
    return b as T;
  } catch {
    throw new AppError('BAD_REQUEST', 400, 'Data permintaan tidak sah.');
  }
}
