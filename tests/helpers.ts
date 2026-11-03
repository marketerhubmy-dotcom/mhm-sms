import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { createApp } from '../worker/src/app';
import type { Env } from '../worker/src/env';
import { hashPassword, uuid } from '../worker/src/lib/crypto';
import type { Deps } from '../worker/src/services/context';

export type Proxy = Awaited<ReturnType<typeof getPlatformProxy<Env>>>;

export async function setupDb(): Promise<Proxy> {
  const proxy = await getPlatformProxy<Env>({ configPath: 'worker/wrangler.toml', persist: false });
  const dir = 'worker/migrations';
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8')
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n');
    const stmts = sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
    await proxy.env.DB.batch(stmts.map((s) => proxy.env.DB.prepare(s)));
  }
  return proxy;
}

export class Clock {
  constructor(public t = Date.UTC(2026, 10, 3, 4, 0, 0)) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export function makeApp(proxy: Proxy, envOverrides: Partial<Env> = {}, deps: Deps = {}) {
  const env: Env = {
    ...(proxy.env as Env),
    APP_ENV: 'development',
    APP_BASE_URL: 'http://localhost:5173',
    SMS_PROVIDER: 'mock',
    PAYMENT_PROVIDER: 'mock',
    PASSWORD_PBKDF2_ITERATIONS: '10000',
    ...envOverrides,
  };
  const app = createApp(deps);
  return { app, env };
}

export class Client {
  cookie = '';
  csrf: string | null = null;
  constructor(private app: ReturnType<typeof createApp>, private env: Env, public ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {}

  async req(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const headers: Record<string, string> = {
      'X-Requested-With': 'mhm-sms',
      Origin: 'http://localhost:5173',
      'CF-Connecting-IP': this.ip,
      ...extraHeaders,
    };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.app.fetch(new Request(`http://localhost:5173${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), this.env);
    for (const set of res.headers.getSetCookie()) {
      const m = set.match(/^([^=]+)=([^;]*)/);
      if (m) this.cookie = m[2] ? `${m[1]}=${m[2]}` : '';
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (json && typeof json === 'object' && 'csrfToken' in json) this.csrf = json.csrfToken;
    return { status: res.status, json };
  }

  async register(email = `u${uuid().slice(0, 8)}@contoh.my`, password = 'kataLaluan123!') {
    const r = await this.req('POST', '/api/auth/register', { name: 'Pengguna Ujian', email, password, acceptTerms: true });
    if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.user as { id: string; email: string };
  }
}

export async function createAdmin(proxy: Proxy, app: ReturnType<typeof createApp>, env: Env) {
  const email = `admin${uuid().slice(0, 6)}@contoh.my`;
  const password = 'adminKataLaluan123!';
  const id = uuid();
  await proxy.env.DB.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES (?, ?, 'Admin', ?, 'admin', 0, 0)")
    .bind(id, email, await hashPassword(password, 10000))
    .run();
  const c = new Client(app, env, '9.9.9.9');
  const r = await c.req('POST', '/api/auth/login', { email, password });
  if (r.status !== 200) throw new Error('admin login failed');
  return { client: c, id };
}
