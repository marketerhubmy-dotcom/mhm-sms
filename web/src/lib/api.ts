export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

let csrfToken: string | null = null;
export function setCsrf(t: string | null) {
  csrfToken = t;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['X-Requested-With'] = 'mhm-sms';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sambungan terputus. Semak internet anda dan cuba lagi.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* bukan JSON */
  }
  if (data && typeof data === 'object' && 'csrfToken' in data) setCsrf(data.csrfToken);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'Ralat tidak dijangka. Sila cuba lagi.', e);
  }
  return data as T;
}

export function rm(sen: number | null | undefined): string {
  if (sen == null) return '-';
  return 'RM' + (sen / 100).toLocaleString('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function dt(ms: number | null | undefined): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export interface OrderView {
  id: string;
  ref: string;
  mode: 'demo' | 'live';
  status: string;
  statusLabel: string;
  countryCode: number;
  countryName: string;
  serviceSlug: string;
  serviceName: string;
  priceSen: number;
  phoneNumber: string | null;
  numberExpiresAt: number | null;
  guardUntil: number | null;
  smsCount: number;
  paymentDueAt: number;
  paidAt: number | null;
  createdAt: number;
  closedAt: number | null;
  lateNotice: boolean;
  paymentIssue: boolean;
  payment: { status: string; provider: string } | null;
  refund: { status: string; createdAt: number } | null;
  canRequestRefund: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}

export interface PublicConfig {
  mode: 'demo' | 'live';
  paymentMode: 'simulated' | 'test' | 'live';
  salesOpen: boolean;
  passwordResetAvailable: boolean;
  supportEmail: string | null;
  supportWhatsapp: string | null;
}
