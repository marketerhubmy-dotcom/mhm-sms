import type {
  BalanceResult,
  BuyResult,
  CloseResult,
  OperationResult,
  ProviderCountry,
  ProviderOperationSummary,
  ProviderService,
  SmsProvider,
} from './types';

/**
 * Adapter SIMULASI untuk mod demo/development. Tiada panggilan ke pembekal sebenar.
 * Keadaan disimpan dalam jadual mock_operations / mock_sms (D1) kerana Worker tidak berkeadaan.
 */
export const MOCK_COUNTRIES: ProviderCountry[] = [
  { code: 60, name: 'Malaysia', enabled: true },
  { code: 62, name: 'Indonesia', enabled: true },
  { code: 66, name: 'Thailand', enabled: true },
  { code: 63, name: 'Filipina', enabled: true },
  { code: 84, name: 'Vietnam', enabled: true },
  { code: 44, name: 'United Kingdom', enabled: true },
  { code: 1, name: 'Amerika Syarikat', enabled: true },
];

const BASE_SERVICES: { slug: string; name: string; cost: number }[] = [
  { slug: 'whatsapp', name: 'WhatsApp', cost: 820_000 },
  { slug: 'telegram', name: 'Telegram', cost: 640_000 },
  { slug: 'google', name: 'Google / Gmail', cost: 310_000 },
  { slug: 'facebook', name: 'Facebook', cost: 150_000 },
  { slug: 'instagram', name: 'Instagram', cost: 180_000 },
  { slug: 'tiktok', name: 'TikTok', cost: 120_000 },
  { slug: 'shopee', name: 'Shopee', cost: 260_000 },
  { slug: 'discord', name: 'Discord', cost: 95_000 },
  { slug: 'microsoft', name: 'Microsoft', cost: 110_000 },
  { slug: 'twitter', name: 'X (Twitter)', cost: 140_000 },
  { slug: 'demobank', name: 'Demo Bank (contoh perkhidmatan disekat)', cost: 100_000 },
];

function seeded(n: number): number {
  const x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}

export function mockServicesFor(countryCode: number): ProviderService[] {
  return BASE_SERVICES.map((s, i) => {
    const r = seeded(countryCode * 31 + i);
    const stock = r < 0.12 ? 0 : Math.floor(r * 900) + 3;
    const factor = 0.7 + seeded(countryCode * 7 + i * 3) * 0.8;
    return { slug: s.slug, name: s.name, stock, costMicros: Math.round((s.cost * factor) / 1000) * 1000 };
  });
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock' as const;
  constructor(private db: D1Database, private now: () => number = Date.now) {}

  async getCountries() {
    return MOCK_COUNTRIES;
  }

  async getServices(countryCode: number) {
    if (!MOCK_COUNTRIES.some((c) => c.code === countryCode)) return [];
    return mockServicesFor(countryCode);
  }

  async getBalance(): Promise<BalanceResult> {
    return { balanceMicros: 25_000_000, frozenMicros: 0 };
  }

  async buyNumber(input: { countryCode: number; serviceSlug: string }): Promise<BuyResult> {
    const svc = (await this.getServices(input.countryCode)).find((s) => s.slug === input.serviceSlug);
    if (!svc) return { kind: 'rejected', code: 'ERROR_NO_SERVICE' };
    if (svc.stock <= 0) return { kind: 'rejected', code: 'NO_NUMBER' };
    const now = this.now();
    const local = String(100000000 + Math.floor(Math.random() * 899999999)).slice(0, 9);
    const number = `+${input.countryCode}${local}`;
    const row = await this.db
      .prepare('INSERT INTO mock_operations (country_code, service_slug, number, created_at, expires_at) VALUES (?, ?, ?, ?, ?) RETURNING tzid')
      .bind(input.countryCode, input.serviceSlug, number, now, now + 15 * 60_000)
      .first<{ tzid: number }>();
    return { kind: 'ok', tzid: String(row!.tzid), number, timeLeftS: 900, guardS: input.serviceSlug === 'whatsapp' ? 300 : 120 };
  }

  async getOperation(tzid: string): Promise<OperationResult> {
    const op = await this.db.prepare('SELECT * FROM mock_operations WHERE tzid = ?').bind(Number(tzid)).first<{
      number: string;
      expires_at: number;
      closed: number;
    }>();
    if (!op) return { kind: 'not_found' };
    const now = this.now();
    if (op.closed || op.expires_at <= now) return { kind: 'not_found' };
    const sms = await this.db.prepare('SELECT body FROM mock_sms WHERE tzid = ? ORDER BY id ASC').bind(Number(tzid)).all<{ body: string }>();
    const messages = sms.results.map((r) => r.body);
    return {
      kind: 'found',
      status: messages.length ? 'TZ_NUM_ANSWER' : 'TZ_NUM_WAIT',
      number: op.number,
      timeLeftS: Math.max(0, Math.floor((op.expires_at - now) / 1000)),
      messages,
    };
  }

  async listOperations(): Promise<ProviderOperationSummary[]> {
    const now = this.now();
    const rows = await this.db
      .prepare('SELECT * FROM mock_operations WHERE closed = 0 AND expires_at > ? ORDER BY tzid DESC LIMIT 100')
      .bind(now)
      .all<{ tzid: number; number: string; service_slug: string; country_code: number; expires_at: number }>();
    return rows.results.map((r) => ({
      tzid: String(r.tzid),
      number: r.number,
      service: r.service_slug,
      country: r.country_code,
      status: 'TZ_NUM_WAIT',
      timeLeftS: Math.floor((r.expires_at - now) / 1000),
    }));
  }

  async completeOperation(tzid: string): Promise<CloseResult> {
    const op = await this.db.prepare('SELECT * FROM mock_operations WHERE tzid = ?').bind(Number(tzid)).first<{
      created_at: number;
      service_slug: string;
      closed: number;
    }>();
    if (!op) return { kind: 'error', code: 'ERROR_WRONG_TZID' };
    const sms = await this.db.prepare('SELECT COUNT(*) AS n FROM mock_sms WHERE tzid = ?').bind(Number(tzid)).first<{ n: number }>();
    const guardMs = (op.service_slug === 'whatsapp' ? 300 : 120) * 1000;
    if (!sms?.n && this.now() - op.created_at < guardMs) return { kind: 'too_early' };
    await this.db.prepare('UPDATE mock_operations SET closed = 1 WHERE tzid = ?').bind(Number(tzid)).run();
    return { kind: 'ok' };
  }

  /** Hanya untuk demo: masukkan SMS simulasi. */
  async simulateIncomingSms(tzid: string, serviceName: string): Promise<void> {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.db
      .prepare('INSERT INTO mock_sms (tzid, body, created_at) VALUES (?, ?, ?)')
      .bind(Number(tzid), `[DEMO] Kod pengesahan ${serviceName} anda ialah ${code}. Jangan kongsi kod ini.`, this.now())
      .run();
  }
}
