#!/usr/bin/env node
/**
 * Bootstrap admin dengan selamat — TIADA kata laluan lalai.
 * 1. Daftar akaun biasa melalui laman web (/daftar) menggunakan emel admin.
 * 2. Jalankan:  npm run bootstrap-admin -- --email anda@domain.com --target local|demo|staging|production
 *    Skrip ini menaikkan peranan akaun itu kepada 'admin' melalui `wrangler d1 execute`
 *    (memerlukan akses akaun Cloudflare anda) dan merekod audit log.
 * Menurunkan peranan: tambah `--role customer` (cth. akaun yang tersilap dijadikan admin).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Jalankan Wrangler terus melalui Node (tiada shell) supaya berfungsi di Windows, macOS dan Linux.
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
if (!existsSync(wranglerBin)) {
  console.error('Wrangler tidak dijumpai. Jalankan `npm install` dalam folder repo dahulu.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const email = String(args.email ?? '').trim().toLowerCase();
const target = String(args.target ?? 'local');
const role = String(args.role ?? 'admin');
if (!['admin', 'customer'].includes(role)) {
  console.error('--role mesti admin atau customer');
  process.exit(1);
}
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error('Emel tidak sah. Guna: --email nama@domain.com');
  process.exit(1);
}
if (!['local', 'demo', 'staging', 'production'].includes(target)) {
  console.error('--target mesti local, demo, staging atau production');
  process.exit(1);
}
// Emel telah disahkan dengan regex ketat (tiada petikan/koma bertitik), jadi selamat dimasukkan ke SQL.
const now = Date.now();
const sql = [
  `UPDATE users SET role = '${role}', updated_at = ${now} WHERE email = '${email}';`,
  `INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at) SELECT NULL, 'user.role', 'user', id, '{"to":"${role}","via":"bootstrap-admin"}', ${now} FROM users WHERE email = '${email}';`,
  `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = '${email}');`,
  `SELECT email, role FROM users WHERE email = '${email}';`,
].join(' ');
const base = [wranglerBin, 'd1', 'execute', 'DB', '-c', 'worker/wrangler.toml', '--json', '--command', sql];
const extra = target === 'local' ? ['--local'] : ['--remote', '--env', target];
const out = execFileSync(process.execPath, [...base, ...extra], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
if (!new RegExp(`"role":\\s*"${role}"`).test(out)) {
  console.error('Akaun tidak dijumpai. Daftar akaun dengan emel ini dahulu, kemudian jalankan semula.');
  process.exit(1);
}
console.log(
  role === 'admin'
    ? `Selesai: ${email} kini admin (${target}). Log masuk semula untuk menggunakan panel admin.`
    : `Selesai: ${email} kini pelanggan biasa (${target}). Sesi akaun itu telah dilog keluar.`,
);
