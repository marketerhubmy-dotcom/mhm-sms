import type { PricingSettings } from '../lib/money';
import { audit } from './audit';

export const SETTING_KEYS = [
  'provider_currency',
  'fx_rate_micros',
  'markup_bps',
  'fixed_fee_sen',
  'min_price_sen',
  'rounding_sen',
  'payment_window_minutes',
  'catalog_ttl_seconds',
  'sms_retention_days',
  'low_balance_threshold_micros',
  'blocked_service_keywords',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

const INT_KEYS: SettingKey[] = [
  'fx_rate_micros',
  'markup_bps',
  'fixed_fee_sen',
  'min_price_sen',
  'rounding_sen',
  'payment_window_minutes',
  'catalog_ttl_seconds',
  'sms_retention_days',
  'low_balance_threshold_micros',
];

const LIMITS: Partial<Record<SettingKey, [number, number]>> = {
  fx_rate_micros: [1, 1_000_000_000],
  markup_bps: [0, 100_000],
  fixed_fee_sen: [0, 100_000],
  min_price_sen: [100, 1_000_000],
  rounding_sen: [1, 100],
  payment_window_minutes: [5, 1440],
  catalog_ttl_seconds: [60, 86_400],
  sms_retention_days: [1, 30],
  low_balance_threshold_micros: [0, 1_000_000_000],
};

export type Settings = Record<SettingKey, string>;

export async function getSettings(db: D1Database): Promise<Settings> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out = {} as Settings;
  for (const r of rows.results) out[r.key as SettingKey] = r.value;
  return out;
}

export function intSetting(s: Settings, k: SettingKey): number {
  const n = Number(s[k]);
  if (!Number.isInteger(n)) throw new Error(`Tetapan ${k} tidak sah`);
  return n;
}

export function pricingFrom(s: Settings): PricingSettings {
  return {
    fxRateMicros: intSetting(s, 'fx_rate_micros'),
    markupBps: intSetting(s, 'markup_bps'),
    fixedFeeSen: intSetting(s, 'fixed_fee_sen'),
    minPriceSen: intSetting(s, 'min_price_sen'),
    roundingSen: intSetting(s, 'rounding_sen'),
  };
}

export function validateSetting(key: string, value: unknown): string {
  if (!SETTING_KEYS.includes(key as SettingKey)) throw new Error(`Tetapan tidak dikenali: ${key}`);
  const k = key as SettingKey;
  if (INT_KEYS.includes(k)) {
    const n = typeof value === 'number' ? value : Number(String(value));
    if (!Number.isInteger(n)) throw new Error(`${key} mesti integer`);
    const [min, max] = LIMITS[k] ?? [0, Number.MAX_SAFE_INTEGER];
    if (n < min || n > max) throw new Error(`${key} mesti antara ${min} dan ${max}`);
    return String(n);
  }
  if (k === 'provider_currency') {
    const v = String(value).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(v)) throw new Error('Kod mata wang tidak sah');
    return v;
  }
  const v = String(value)
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .join(',');
  if (v.length > 1000) throw new Error('Senarai terlalu panjang');
  return v;
}

export async function updateSettings(db: D1Database, actorId: string, changes: Record<string, unknown>, now: number) {
  const before = await getSettings(db);
  const validated: [string, string][] = Object.entries(changes).map(([k, v]) => [k, validateSetting(k, v)]);
  const stmts = validated.map(([k, v]) =>
    db
      .prepare('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by')
      .bind(k, v, now, actorId),
  );
  if (stmts.length) await db.batch(stmts);
  const diff = Object.fromEntries(validated.filter(([k, v]) => before[k as SettingKey] !== v).map(([k, v]) => [k, { from: before[k as SettingKey] ?? null, to: v }]));
  if (Object.keys(diff).length) await audit(db, { actor: actorId, action: 'settings.update', targetType: 'settings', details: diff, now });
}

export async function getMeta(db: D1Database, key: string): Promise<{ value: string; updated_at: number } | null> {
  return db.prepare('SELECT value, updated_at FROM meta WHERE key = ?').bind(key).first();
}

export async function setMeta(db: D1Database, key: string, value: string, now: number) {
  await db
    .prepare('INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, now)
    .run();
}
