import { computePrice } from '../lib/money';
import { ProviderError } from '../providers/sms/types';
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

export async function refreshCountries(ctx: AppCtx, force = false): Promise<void> {
  const meta = await getMeta(ctx.db, 'catalog_countries_at');
  if (!force && meta && ctx.now() - meta.updated_at < COUNTRY_TTL_MS) return;
  const countries = await ctx.sms.getCountries();
  const now = ctx.now();
  const stmts = countries.map((c) =>
    ctx.db
      .prepare('INSERT INTO catalog_countries (code, name, provider_enabled, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, provider_enabled = excluded.provider_enabled, fetched_at = excluded.fetched_at')
      .bind(c.code, c.name, c.enabled ? 1 : 0, now),
  );
  if (stmts.length) await ctx.db.batch(stmts);
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

export async function listServices(
  ctx: AppCtx,
  countryCode: number,
  opts: { includeHidden?: boolean; force?: boolean; settings?: Settings } = {},
): Promise<{ services: ServiceRow[]; stale: boolean; fetchedAt: number | null }> {
  const settings = opts.settings ?? (await getSettings(ctx.db));
  const ttlMs = intSetting(settings, 'catalog_ttl_seconds') * 1000;
  let stale = false;
  try {
    await refreshServices(ctx, countryCode, ttlMs, !!opts.force);
  } catch (e) {
    if (opts.force) {
      throw new AppError('PROVIDER_UNAVAILABLE', 503, 'Stok dan harga tidak dapat disahkan buat masa ini. Sila cuba sebentar lagi.', {
        providerCode: e instanceof ProviderError ? e.code : 'UNKNOWN',
      });
    }
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
