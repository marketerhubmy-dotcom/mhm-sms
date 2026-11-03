export interface ProviderCountry {
  code: number;
  name: string;
  enabled: boolean;
}

export interface ProviderService {
  slug: string;
  name: string;
  stock: number;
  costMicros: number;
}

export type BuyResult =
  | { kind: 'ok'; tzid: string; number: string | null; timeLeftS: number | null; guardS: number | null }
  /** Pembekal menolak dengan jelas: nombor TIDAK dikeluarkan. */
  | { kind: 'rejected'; code: string }
  /** Timeout / ralat rangkaian / kod tidak dikenali: status sebenar TIDAK diketahui. */
  | { kind: 'unknown'; code: string };

export type OperationStatus = 'TZ_INPOOL' | 'TZ_NUM_WAIT' | 'TZ_NUM_ANSWER' | 'TZ_OVER_OK' | 'ERROR_NO_ITEMS' | string;

export type OperationResult =
  | { kind: 'found'; status: OperationStatus; number: string | null; timeLeftS: number | null; messages: string[] }
  | { kind: 'not_found' }
  | { kind: 'error'; code: string };

export type CloseResult = { kind: 'ok' } | { kind: 'too_early' } | { kind: 'error'; code: string };

export interface BalanceResult {
  balanceMicros: number;
  frozenMicros: number;
}

export interface ProviderOperationSummary {
  tzid: string;
  number: string | null;
  service: string;
  country: number;
  status: string;
  timeLeftS: number | null;
}

export interface SmsProvider {
  readonly name: 'mock' | 'onlinesim';
  getCountries(): Promise<ProviderCountry[]>;
  getServices(countryCode: number): Promise<ProviderService[]>;
  getBalance(): Promise<BalanceResult>;
  buyNumber(input: { countryCode: number; serviceSlug: string }): Promise<BuyResult>;
  getOperation(tzid: string): Promise<OperationResult>;
  listOperations(): Promise<ProviderOperationSummary[] | null>;
  completeOperation(tzid: string): Promise<CloseResult>;
}

export class ProviderError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

/**
 * Kod ralat getNum yang bermakna nombor PASTI tidak dikeluarkan (dokumentasi OnlineSIM, seksyen Exception Handling).
 * TRY_AGAIN_LATER ("unexpected error"), INTERVAL_CONCURRENT_REQUESTS_ERROR dan kod tidak dikenali dianggap TIDAK PASTI.
 */
export const DEFINITIVE_REJECTION_CODES = new Set([
  'NO_NUMBER',
  'WARNING_LOW_BALANCE',
  'ERROR_NO_SERVICE',
  'UNDEFINED_COUNTRY',
  'ACCOUNT_BLOCKED',
  'API_ACCESS_DISABLED',
  'API_ACCESS_IP',
  'ERROR_WRONG_KEY',
  'ERROR_NO_KEY',
  'REQUEST_NOT_FOUND',
]);
