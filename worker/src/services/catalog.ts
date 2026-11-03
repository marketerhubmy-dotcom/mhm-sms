import { computePrice } from '../lib/money';
import { ProviderError } from '../providers/sms/types';
import { audit } from './audit';
import type { AppCtx } from './context';
import { getMeta, getSettings, intSetting, pricingFrom, setMeta, type Settings } from './settings';

export class AppError extends Error {
  constructor(public code: string, public status: number, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const COUNTRY_TTL_MS = 60 * 60_000;

export interface CountryRow {
  code: number;
  name: string;
  enabled: boolean; // admin
  providerEnabled: boolean;
}

export interface ServiceRow {
  slug: string;
  name: string;
  stock: number;
  costMicros: number;
  costSen: number;
  priceSen: number;
  overrideApplied: boolean;
  enabled: boolean;
  blocked: boolean;
  fetchedAt: number;
}

export function isBlockedService(slug: string, name: string, keywords: string): boolean {
  const hay = `${slug} ${name}`.toLowerCase();
  return keywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
    .some((k) => new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay));
}

/** Kosongkan cache katalog jika pembekal SMS bertukar (cth. mock -> onlinesim). */
export async function ensureCatalogProvider(ctx: AppCtx): Promise<void> {
  const meta = await getMeta(ctx.db, 'catalog_provider');
  if (meta?.value === ctx.sms.name) return;
  await ctx.db.batch([
    ctx.db.prepare('DELETE FROM catalog_services'),
    ctx.db.prepare('DELETE FROM catalog_countries'),
    ctx.db.prepare("DELETE FROM meta WHERE key = 'catalog_countries_at' OR substr(key, 1, 20) = 'catalog_services_at:'"),
  ]);
  await setMeta(ctx.db, 'catalog_provider', ctx.sms.name, ctx.now());
}

export async function refreshCountries(ctx: AppCtx, force = false): Promise<void> {
  await ensureCatalogProvider(ctx);
  const meta = await getMeta(ctx.db, 'catalog_countries_at');
  if (!force && meta && ctx.now() - meta.updated_at < COUNTRY_TTL_MS) return;
  const countries = await ctx.sms.getCountries();
  const now = ctx.now();
  const keep = countries.map((c) => c.code);
  const stmts = [
    // Buang negara yang tiada lagi di pembekal.
    ctx.db.prepare(`DELETE FROM catalog_countries WHERE code NOT IN (${keep.map(() => '?').join(',') || 'NULL'})`).bind(...keep),
    ...countries.map((c) =>
    ctx.db
      .prepare('INSERT INTO catalog_countries (code, name, provider_enabled, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, provider_enabled = excluded.provider_enabled, fetched_at = excluded.fetched_at')
      .bind(c.code, c.name, c.enabled ? 1 : 0, now),
    ),
  ];
  await ctx.db.batch(stmts);
  await setMeta(ctx.db, 'catalog_countries_at', String(now), now);
}

export async function listCountries(ctx: AppCtx, opts: { includeDisabled?: boolean } = {}): Promise<{ countries: CountryRow[]; stale: boolean }> {
  let stale = false;
  try {
    await refreshCountries(ctx);
  } catch {
    stale = true;
  }
  const rows = await ctx.db
    .prepare('SELECT c.code, c.name, c.provider_enabled, COALESCE(s.enabled, 1) AS enabled FROM catalog_countries c LEFT JOIN country_settings s ON s.country_code = c.code ORDER BY c.name')
    .all<{ code: number; name: string; provider_enabled: number; enabled: number }>();
  const countries = rows.results
    .map((r) => ({ code: r.code, name: r.name, enabled: !!r.enabled, providerEnabled: !!r.provider_enabled }))
    .filter((c) => opts.includeDisabled || (c.enabled && c.providerEnabled));
  if (!countries.length && stale) throw new AppError('PROVIDER_UNAVAILABLE', 503, 'Katalog tidak dapat dimuatkan buat masa ini. Sila cuba sebentar lagi.');
  return { countries, stale };
}

async function refreshServices(ctx: AppCtx, countryCode: number, ttlMs: number, force: boolean): Promise<void> {
  const key = `catalog_services_at:${countryCode}`;
  const meta = await getMeta(ctx.db, key);
  if (!force && meta && ctx.now() - meta.updated_at < ttlMs) return;
  const services = await ctx.sms.getServices(countryCode);
  const now = ctx.now();
  const stmts = [
    ctx.db.prepare('DELETE FROM catalog_services WHERE country_code = ?').bind(countryCode),
    ...services.map((s) =>
      ctx.db
        .prepare('INSERT INTO catalog_services (country_code, slug, name, stock, cost_micros, fetched_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(countryCode, s.slug, s.name, s.stock, s.costMicros, now),
    ),
  ];
  await ctx.db.batch(stmts);
  await setMeta(ctx.db, key, String(now), now);
}

async function catalogError(ctx: AppCtx, countryCode: number, e: unknown): Promise<AppError> {
  const providerCode = e instanceof ProviderError ? e.code : 'UNKNOWN';
  console.error('Katalog pembekal gagal dimuat:', providerCode);
  await audit(ctx.db, { actor: null, action: 'provider.catalog_error', targetType: 'country', targetId: String(countryCode), details: { code: providerCode }, now: ctx.now() });
  return new AppError(
    'PROVIDER_UNAVAILABLE',
    503,
    'Stok dan harga tidak dapat disahkan buat masa ini. Sila cuba sebentar lagi.' + (ctx.config.appEnv !== 'production' ? ` (${providerCode})` : ''),
    { providerCode },
  );
}

/**
 * Semakan ketat SATU servis sebelum pesanan. Guna cache jika berusia ≤ maxAgeMs; jika tidak,
 * ambil servis itu sahaja (filter_service) dan kemas kini baris cache. Jika pembekal tidak dapat
 * menapis, kembali kepada katalog penuh negara itu.
 */
export async function verifyServiceQuote(ctx: AppCtx, countryCode: number, slug: string, maxAgeMs: number, settings: Settings): Promise<void> {
  await ensureCatalogProvider(ctx);
  const row = await ctx.db
    .prepare('SELECT fetched_at FROM catalog_services WHERE country_code = ? AND slug = ?')
    .bind(countryCode, slug)
    .first<{ fetched_at: number }>();
  if (row && ctx.now() - row.fetched_at <= maxAgeMs) return;
  let quote;
  try {
    quote = await ctx.sms.getServiceQuote(countryCode, slug);
  } catch (e) {
    throw await catalogError(ctx, countryCode, e);
  }
  if (quote === undefined) {
    await listServices(ctx, countryCode, { maxAgeMs, settings });
    return;
  }
  const now = ctx.now();
  if (quote === null) {
    await ctx.db.prepare('DELETE FROM catalog_services WHERE country_code = ? AND slug = ?').bind(countryCode, slug).run();
    return;
  }
  await ctx.db
    .prepare(
      `INSERT INTO catalog_services (country_code, slug, name, stock, cost_micros, fetched_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(country_code, slug) DO UPDATE SET name = excluded.name, stock = excluded.stock, cost_micros = excluded.cost_micros, fetched_at = excluded.fetched_at`,
    )
    .bind(countryCode, slug, quote.name, quote.stock, quote.costMicros, now)
    .run();
}

export async function listServices(
  ctx: AppCtx,
  countryCode: number,
  opts: {
    includeHidden?: boolean;
    /** Sentiasa ambil semula daripada pembekal (admin). */
    force?: boolean;
    /** Semakan ketat sebelum pesanan: data mesti tidak lebih tua daripada ini; jika gagal diambil, ralat. */
    maxAgeMs?: number;
    /** Jangan cuba menyegarkan daripada pembekal (guna cache sahaja). */
    noRefresh?: boolean;
    settings?: Settings;
  } = {},
): Promise<{ services: ServiceRow[]; stale: boolean; fetchedAt: number | null }> {
  await ensureCatalogProvider(ctx);
  const settings = opts.settings ?? (await getSettings(ctx.db));
  const ttlMs = opts.maxAgeMs ?? intSetting(settings, 'catalog_ttl_seconds') * 1000;
  const strict = !!opts.force || opts.maxAgeMs != null;
  let stale = false;
  try {
    if (!opts.noRefresh) await refreshServices(ctx, countryCode, ttlMs, !!opts.force);
  } catch (e) {
    if (strict) throw await catalogError(ctx, countryCode, e);
    stale = true;
  }
  const pricing = pricingFrom(settings);
  const keywords = settings.blocked_service_keywords ?? '';
  const rows = await ctx.db
    .prepare(
      `SELECT cs.slug, cs.name, cs.stock, cs.cost_micros, cs.fetched_at, COALESCE(ss.enabled, 1) AS enabled, po.price_sen AS override_sen
       FROM catalog_services cs
       LEFT JOIN service_settings ss ON ss.slug = cs.slug
       LEFT JOIN price_overrides po ON po.country_code = cs.country_code AND po.service_slug = cs.slug
       WHERE cs.country_code = ? ORDER BY cs.name`,
    )
    .bind(countryCode)
    .all<{ slug: string; name: string; stock: number; cost_micros: number; fetched_at: number; enabled: number; override_sen: number | null }>();
  let fetchedAt: number | null = null;
  const services = rows.results
    .map((r) => {
      fetchedAt = fetchedAt == null ? r.fetched_at : Math.min(fetchedAt, r.fetched_at);
      const p = computePrice(r.cost_micros, pricing, r.override_sen);
      return {
        slug: r.slug,
        name: r.name,
        stock: r.stock,
        costMicros: r.cost_micros,
        costSen: p.costSen,
        priceSen: p.priceSen,
        overrideApplied: p.overrideApplied,
        enabled: !!r.enabled,
        blocked: isBlockedService(r.slug, r.name, keywords),
        fetchedAt: r.fetched_at,
      };
    })
    .filter((s) => opts.includeHidden || (s.enabled && !s.blocked));
  return { services, stale, fetchedAt };
}

export async function isCountryAvailable(ctx: AppCtx, countryCode: number): Promise<{ name: string } | null> {
  const row = await ctx.db
    .prepare('SELECT c.name, c.provider_enabled, COALESCE(s.enabled, 1) AS enabled FROM catalog_countries c LEFT JOIN country_settings s ON s.country_code = c.code WHERE c.code = ?')
    .bind(countryCode)
    .first<{ name: string; provider_enabled: number; enabled: number }>();
  if (!row || !row.enabled || !row.provider_enabled) return null;
  return { name: row.name };
}
