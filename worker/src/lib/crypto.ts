import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/**
 * Password hashing menggunakan PBKDF2-HMAC-SHA256 melalui Web Crypto API platform
 * (algoritma standard NIST SP 800-132; tiada algoritma ciptaan sendiri).
 * Format: pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>
 */
const enc = new TextEncoder();

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const expected = unb64(parts[3]);
  const actual = await derive(password, unb64(parts[2]), iterations);
  return timingSafeEqual(actual, expected);
}

/** Hash palsu untuk menyamakan masa respons apabila emel tidak wujud. */
export async function dummyVerify(iterations: number): Promise<void> {
  await derive('dummy-password', new Uint8Array(16), iterations);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return nodeTimingSafeEqual(a, b);
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  return timingSafeEqual(enc.encode(a), enc.encode(b));
}

export function randomToken(bytes = 32): string {
  const u = crypto.getRandomValues(new Uint8Array(bytes));
  return b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Rujukan pesanan mesra pengguna: MHM-XXXXXXXX (tanpa huruf mengelirukan). */
export function orderRef(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const u = crypto.getRandomValues(new Uint8Array(8));
  return 'MHM' + Array.from(u, (b) => alphabet[b % alphabet.length]).join('');
}
