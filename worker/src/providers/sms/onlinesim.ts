import { decimalToMicros } from '../../lib/money';
import {
  DEFINITIVE_REJECTION_CODES,
  ProviderError,
  type BalanceResult,
  type BuyResult,
  type CloseResult,
  type OperationResult,
  type ProviderCountry,
  type ProviderOperationSummary,
  type ProviderService,
  type SmsProvider,
} from './types';

/**
 * Adapter OnlineSIM API v1.1 (https://onlinesim.io/openapi_docs/Onlinesim-API-UN/info/).
 * Endpoint yang digunakan (semua GET):
 *   /api/getTariffs.php, /api/getNum.php, /api/getState.php, /api/setOperationOk.php, /api/getBalance.php
 * Auth: header "Authorization: Bearer {apikey}" (disokong dokumentasi) supaya kunci tidak muncul dalam URL/log.
 * Ralat dipulangkan dengan HTTP 200 dan { "response": "ERROR_CODE" }.
 */
export class OnlineSimProvider implements SmsProvider {
  readonly name = 'onlinesim' as const;
  constructor(
    private apiKey: string,
    private baseUrl = 'https://onlinesim.io',
    private timeoutMs = 20_000,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call(path: string, params: Record<string, string | number>, timeoutMs?: number): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs ?? this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ProviderError((e as Error)?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new ProviderError(`HTTP_${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('INVALID_RESPONSE');
    }
  }

  private static errorCode(body: unknown): string | null {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const r = (body as Record<string, unknown>).response;
      if (typeof r === 'string' && r !== '1' && /^[A-Z_]+$/.test(r)) return r;
    }
    return null;
  }

  async getCountries(): Promise<ProviderCountry[]> {
    const body = (await this.call('/api/getTariffs.php', { lang: 'en' })) as Record<string, unknown>;
    const err = OnlineSimProvider.errorCode(body);
    if (err) throw new ProviderError(err);
    const countries = (body.countries ?? {}) as Record<string, { name?: string; code?: number; enable?: boolean }>;
    return Object.values(countries)
      .filter((c) => typeof c.code === 'number')
      .map((c) => ({ code: c.code as number, name: String(c.name ?? c.code), enabled: c.enable !== false }));
  }

  async getServices(countryCode: number): Promise<ProviderService[]> {
    const out = new Map<string, ProviderService>();
    for (let page = 1; page <= 10; page++) {
      const body = (await this.call('/api/getTariffs.php', {
        country: countryCode,
        filter_country: countryCode,
        page,
        lang: 'en',
      })) as Record<string, unknown>;
      const err = OnlineSimProvider.errorCode(body);
      if (err) throw new ProviderError(err);
      const services = (body.services ?? {}) as Record<string, { count?: number; price?: string | number; service?: string; slug?: string }>;
      for (const s of Object.values(services)) {
        if (!s.slug || s.price == null) continue;
        let costMicros: number;
        try {
          costMicros = decimalToMicros(String(s.price));
        } catch {
          continue;
        }
        out.set(s.slug, { slug: s.slug, name: String(s.service ?? s.slug), stock: Number(s.count ?? 0) || 0, costMicros });
      }
      if (body.end !== false) break;
    }
    return [...out.values()];
  }

  async getServiceQuote(countryCode: number, slug: string): Promise<ProviderService | null | undefined> {
    // getTariffs dengan filter_service: "discards service objects not related to the target one".
    const body = (await this.call('/api/getTariffs.php', {
      country: countryCode,
      filter_country: countryCode,
      filter_service: slug,
      lang: 'en',
    })) as Record<string, unknown>;
    const err = OnlineSimProvider.errorCode(body);
    if (err) throw new ProviderError(err);
    const services = Object.values((body.services ?? {}) as Record<string, { count?: number; price?: string | number; service?: string; slug?: string }>);
    const s = services.find((x) => x.slug === slug);
    if (!s) {
      // Tiada padanan: jika penapis tidak berkesan (banyak servis lain dipulangkan) atau kosong, biar pemanggil guna katalog penuh.
      return undefined;
    }
    if (s.price == null) return null;
    let costMicros: number;
    try {
      costMicros = decimalToMicros(String(s.price));
    } catch {
      return undefined;
    }
    return { slug, name: String(s.service ?? slug), stock: Number(s.count ?? 0) || 0, costMicros };
  }

  async getBalance(): Promise<BalanceResult> {
    const body = (await this.call('/api/getBalance.php', {})) as Record<string, unknown>;
    const err = OnlineSimProvider.errorCode(body);
    if (err) throw new ProviderError(err);
    return {
      balanceMicros: decimalToMicros(String(body.balance ?? '0')),
      frozenMicros: decimalToMicros(String(body.zbalance ?? '0')),
    };
  }

  async buyNumber(input: { countryCode: number; serviceSlug: string }): Promise<BuyResult> {
    let body: unknown;
    try {
      body = await this.call('/api/getNum.php', {
        service: input.serviceSlug,
        country: input.countryCode,
        number: 'true',
        lang: 'en',
      });
    } catch (e) {
      // Timeout, ralat rangkaian atau respons rosak: TIDAK TAHU sama ada nombor dikeluarkan.
      return { kind: 'unknown', code: e instanceof ProviderError ? e.code : 'UNKNOWN' };
    }
    const b = (body ?? {}) as Record<string, unknown>;
    if ((b.response === 1 || b.response === '1') && b.tzid != null) {
      return {
        kind: 'ok',
        tzid: String(b.tzid),
        number: typeof b.number === 'string' ? b.number : null,
        timeLeftS: typeof b.time === 'number' ? b.time : null,
        guardS: typeof b.guard_interval_remaining_seconds === 'number' ? b.guard_interval_remaining_seconds : null,
      };
    }
    const code = OnlineSimProvider.errorCode(b) ?? 'UNEXPECTED_RESPONSE';
    if (DEFINITIVE_REJECTION_CODES.has(code)) return { kind: 'rejected', code };
    return { kind: 'unknown', code };
  }

  private static parseOps(body: unknown): Record<string, unknown>[] | { error: string } {
    if (Array.isArray(body)) return body as Record<string, unknown>[];
    const b = (body ?? {}) as Record<string, unknown>;
    if ((b.response === '1' || b.response === 1) && Array.isArray(b.list)) return b.list as Record<string, unknown>[];
    return { error: OnlineSimProvider.errorCode(b) ?? 'UNEXPECTED_RESPONSE' };
  }

  private static messagesOf(op: Record<string, unknown>): string[] {
    const m = op.msg;
    if (typeof m === 'string') return m ? [m] : [];
    if (Array.isArray(m)) {
      return m
        .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as Record<string, unknown>).msg === 'string' ? ((x as Record<string, unknown>).msg as string) : null))
        .filter((x): x is string => !!x);
    }
    return [];
  }

  async getOperation(tzid: string): Promise<OperationResult> {
    let body: unknown;
    try {
      // Polling SMS: had masa pendek; jika tergantung, polling seterusnya akan mencuba semula tidak lama lagi.
      body = await this.call('/api/getState.php', { tzid, message_to_code: 0, msg_list: 1, orderby: 'asc', lang: 'en' }, 8_000);
    } catch (e) {
      return { kind: 'error', code: e instanceof ProviderError ? e.code : 'UNKNOWN' };
    }
    const ops = OnlineSimProvider.parseOps(body);
    if (!Array.isArray(ops)) {
      if (ops.error === 'ERROR_NO_OPERATIONS') return { kind: 'not_found' };
      return { kind: 'error', code: ops.error };
    }
    const op = ops.find((o) => String(o.tzid) === String(tzid));
    if (!op) return { kind: 'not_found' };
    return {
      kind: 'found',
      status: String(op.response ?? ''),
      number: typeof op.number === 'string' ? op.number : null,
      timeLeftS: typeof op.time === 'number' ? op.time : null,
      messages: OnlineSimProvider.messagesOf(op),
    };
  }

  /**
   * Diagnostik: cuba beberapa variasi parameter getState yang didokumenkan dan laporkan masa/hasil.
   * Tiada kandungan SMS dipulangkan.
   */
  async diagnoseState(tzid: string, timeoutMs = 12_000) {
    const variants: [string, Record<string, string | number>][] = [
      ['semasa (tzid+message_to_code=0+msg_list=1+orderby+lang)', { tzid, message_to_code: 0, msg_list: 1, orderby: 'asc', lang: 'en' }],
      ['tzid sahaja', { tzid }],
      ['tzid+message_to_code=1', { tzid, message_to_code: 1 }],
      ['tanpa tzid (semua operasi)', { message_to_code: 1 }],
    ];
    const out = [];
    for (const [label, params] of variants) {
      const started = Date.now();
      const saved = this.timeoutMs;
      this.timeoutMs = timeoutMs;
      try {
        const body = await this.call('/api/getState.php', params);
        const ops = OnlineSimProvider.parseOps(body);
        if (!Array.isArray(ops)) out.push({ label, result: 'error_code', code: ops.error, ms: Date.now() - started });
        else {
          const op = ops.find((o) => String(o.tzid) === String(tzid));
          out.push({ label, result: 'ok', operations: ops.length, found: !!op, status: op ? String(op.response ?? '') : null, messages: op ? OnlineSimProvider.messagesOf(op).length : null, ms: Date.now() - started });
        }
      } catch (e) {
        out.push({ label, result: 'exception', code: e instanceof ProviderError ? e.code : 'UNKNOWN', ms: Date.now() - started });
      } finally {
        this.timeoutMs = saved;
      }
    }
    return out;
  }

  async listOperations(): Promise<ProviderOperationSummary[] | null> {
    let body: unknown;
    try {
      body = await this.call('/api/getState.php', { message_to_code: 1, lang: 'en' });
    } catch {
      return null;
    }
    const ops = OnlineSimProvider.parseOps(body);
    if (!Array.isArray(ops)) return ops.error === 'ERROR_NO_OPERATIONS' ? [] : null;
    return ops.map((o) => ({
      tzid: String(o.tzid),
      number: typeof o.number === 'string' ? o.number : null,
      service: String(o.service ?? ''),
      country: Number(o.country ?? 0),
      status: String(o.response ?? ''),
      timeLeftS: typeof o.time === 'number' ? o.time : null,
    }));
  }

  async completeOperation(tzid: string): Promise<CloseResult> {
    let body: unknown;
    try {
      body = await this.call('/api/setOperationOk.php', { tzid, lang: 'en' });
    } catch (e) {
      return { kind: 'error', code: e instanceof ProviderError ? e.code : 'UNKNOWN' };
    }
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.response === 1 || b.response === '1') return { kind: 'ok' };
    const code = OnlineSimProvider.errorCode(b) ?? 'UNEXPECTED_RESPONSE';
    if (code === 'NO_COMPLETE_TZID') return { kind: 'too_early' };
    return { kind: 'error', code };
  }
}
