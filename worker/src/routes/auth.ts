import { Hono } from 'hono';
import { dummyVerify, hashPassword, randomToken, sha256Hex, uuid, verifyPassword } from '../lib/crypto';
import { AppError } from '../services/catalog';
import { audit } from '../services/audit';
import { clientIp, createSession, destroySession, enforceRateLimit, jsonBody, requireUser, type HonoEnv } from '../http';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validatePassword(p: unknown): string {
  if (typeof p !== 'string' || p.length < 10) throw new AppError('WEAK_PASSWORD', 400, 'Kata laluan mesti sekurang-kurangnya 10 aksara.');
  if (p.length > 200) throw new AppError('WEAK_PASSWORD', 400, 'Kata laluan terlalu panjang.');
  return p;
}

function normEmail(e: unknown): string {
  const s = typeof e === 'string' ? e.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(s) || s.length > 200) throw new AppError('INVALID_EMAIL', 400, 'Alamat emel tidak sah.');
  return s;
}

export const authRoutes = new Hono<HonoEnv>();

authRoutes.get('/me', (c) => {
  const u = c.get('user');
  return c.json({ user: u, csrfToken: c.get('csrfToken') });
});

authRoutes.post('/register', async (c) => {
  const app = c.get('app');
  await enforceRateLimit(c, `register:${clientIp(c)}`, 5, 60 * 60_000);
  const b = await jsonBody<{ name?: string; email?: string; password?: string; acceptTerms?: boolean }>(c);
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
  if (name.length < 2) throw new AppError('INVALID_NAME', 400, 'Sila masukkan nama anda.');
  const email = normEmail(b.email);
  const password = validatePassword(b.password);
  if (b.acceptTerms !== true) throw new AppError('TERMS_REQUIRED', 400, 'Sila bersetuju dengan terma penggunaan.');
  // Peranan SENTIASA 'customer'. Sebarang medan "role" daripada klien diabaikan.
  const hash = await hashPassword(password, app.config.pbkdf2Iterations);
  const id = uuid();
  const now = app.now();
  const r = await app.db
    .prepare("INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'customer', ?, ?)")
    .bind(id, email, name, hash, now, now)
    .run();
  if ((r.meta.changes ?? 0) === 0) throw new AppError('EMAIL_TAKEN', 409, 'Emel ini sudah didaftarkan. Sila log masuk.');
  const csrfToken = await createSession(c, id);
  return c.json({ user: { id, email, name, role: 'customer' }, csrfToken }, 201);
});

authRoutes.post('/login', async (c) => {
  const app = c.get('app');
  const b = await jsonBody<{ email?: string; password?: string }>(c);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  await enforceRateLimit(c, `login-ip:${clientIp(c)}`, 30, 15 * 60_000);
  await enforceRateLimit(c, `login-email:${email}`, 8, 15 * 60_000);
  const password = typeof b.password === 'string' ? b.password : '';
  const user = await app.db
    .prepare('SELECT id, email, name, role, status, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; email: string; name: string; role: 'customer' | 'admin'; status: string; password_hash: string }>();
  if (!user) {
    await dummyVerify(app.config.pbkdf2Iterations);
    throw new AppError('INVALID_CREDENTIALS', 401, 'Emel atau kata laluan tidak betul.');
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new AppError('INVALID_CREDENTIALS', 401, 'Emel atau kata laluan tidak betul.');
  if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED', 403, 'Akaun ini telah dinyahaktifkan. Sila hubungi support.');
  // Putar sesi: buang sesi lama dalam pelayar ini (cookie baharu menggantikannya).
  await destroySession(c, false);
  const csrfToken = await createSession(c, user.id);
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, csrfToken });
});

authRoutes.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

authRoutes.post('/password/change', requireUser, async (c) => {
  const app = c.get('app');
  const u = c.get('user')!;
  await enforceRateLimit(c, `pwchange:${u.id}`, 5, 15 * 60_000);
  const b = await jsonBody<{ currentPassword?: string; newPassword?: string }>(c);
  const row = await app.db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(u.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(b.currentPassword ?? ''), row.password_hash))) {
    throw new AppError('INVALID_CREDENTIALS', 401, 'Kata laluan semasa tidak betul.');
  }
  const hash = await hashPassword(validatePassword(b.newPassword), app.config.pbkdf2Iterations);
  await app.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(hash, app.now(), u.id).run();
  await app.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(u.id, c.get('sessionId')).run();
  return c.json({ ok: true });
});

authRoutes.post('/password/forgot', async (c) => {
  const app = c.get('app');
  if (!app.email) {
    throw new AppError('RESET_UNAVAILABLE', 503, 'Reset kata laluan melalui emel belum tersedia. Sila hubungi support untuk bantuan.');
  }
  await enforceRateLimit(c, `forgot:${clientIp(c)}`, 5, 60 * 60_000);
  const b = await jsonBody<{ email?: string }>(c);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const user = await app.db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").bind(email).first<{ id: string }>();
  if (user) {
    const token = randomToken(32);
    const now = app.now();
    await app.db
      .prepare('INSERT INTO password_resets (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), user.id, now, now + 60 * 60_000)
      .run();
    try {
      await app.email.send({
        to: email,
        subject: 'Reset kata laluan MHM SMS',
        text: `Klik pautan ini untuk menetapkan kata laluan baharu (sah selama 1 jam):\n${app.config.baseUrl}/reset-kata-laluan?token=${token}\n\nJika anda tidak meminta reset, abaikan emel ini.`,
      });
    } catch {
      throw new AppError('EMAIL_FAILED', 502, 'Emel tidak dapat dihantar sekarang. Sila cuba lagi kemudian.');
    }
  }
  return c.json({ ok: true, message: 'Jika emel tersebut berdaftar, pautan reset telah dihantar.' });
});

authRoutes.post('/password/reset', async (c) => {
  const app = c.get('app');
  await enforceRateLimit(c, `reset:${clientIp(c)}`, 10, 60 * 60_000);
  const b = await jsonBody<{ token?: string; password?: string }>(c);
  const password = validatePassword(b.password);
  const id = await sha256Hex(String(b.token ?? ''));
  const now = app.now();
  const row = await app.db
    .prepare('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
    .bind(now, id, now)
    .first<{ user_id: string }>();
  if (!row) throw new AppError('INVALID_TOKEN', 400, 'Pautan reset tidak sah atau telah tamat tempoh.');
  const hash = await hashPassword(password, app.config.pbkdf2Iterations);
  await app.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(hash, now, row.user_id).run();
  await app.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id).run();
  await audit(app.db, { actor: row.user_id, action: 'user.password_reset', targetType: 'user', targetId: row.user_id, now });
  return c.json({ ok: true });
});
