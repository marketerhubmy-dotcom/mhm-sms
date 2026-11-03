#!/usr/bin/env node
/**
 * Bootstrap admin dengan selamat — TIADA kata laluan lalai.
 * 1. Daftar akaun biasa melalui laman web (/daftar) menggunakan emel admin.
 * 2. Jalankan:  npm run bootstrap-admin -- --email anda@domain.com --target local|staging|production
 *    Skrip ini menaikkan peranan akaun itu kepada 'admin' melalui `wrangler d1 execute`
 *    (memerlukan akses akaun Cloudflare anda) dan merekod audit log.
 */
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const email = String(args.email ?? '').trim().toLowerCase();
const target = String(args.target ?? 'local');
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error('Emel tidak sah. Guna: --email nama@domain.com');
  process.exit(1);
}
if (!['local', 'staging', 'production'].includes(target)) {
  console.error('--target mesti local, staging atau production');
  process.exit(1);
}
// Emel telah disahkan dengan regex ketat (tiada petikan/koma bertitik), jadi selamat dimasukkan ke SQL.
const now = Date.now();
const sql = [
  `UPDATE users SET role = 'admin', updated_at = ${now} WHERE email = '${email}';`,
  `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at) SELECT NULL, 'user.role', 'user', id, '{"to":"admin","via":"bootstrap-admin"}', ${now} FROM users WHERE email = '${email}';`,
  `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '${email}');`,
  `SELECT email, role FROM users WHERE email = '${email}';`,
].join(' ');
const base = ['wrangler', 'd1', 'execute', 'DB', '-c', 'worker/wrangler.toml', '--command', sql];
const extra = target === 'local' ? ['--local'] : ['--remote', '--env', target];
const out = execFileSync('npx', [...base, ...extra], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
if (!/"role":\s*"admin"/.test(out)) {
  console.error('Akaun tidak dijumpai. Daftar akaun dengan emel ini dahulu, kemudian jalankan semula.');
  process.exit(1);
}
console.log(`Selesai: ${email} kini admin (${target}). Log masuk semula untuk menggunakan panel admin.`);
