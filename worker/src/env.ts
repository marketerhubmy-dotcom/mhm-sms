export interface Env {
  DB: D1Database;
  APP_ENV?: string; // development | demo | staging | production
  APP_BASE_URL?: string;
  SMS_PROVIDER?: string; // mock | onlinesim
  PAYMENT_PROVIDER?: string; // mock | chip
  LIVE_PURCHASES_ENABLED?: string;
  LIVE_PAYMENTS_ENABLED?: string;
  ONLINESIM_API_KEY?: string;
  ONLINESIM_BASE_URL?: string;
  ONLINESIM_WEBHOOK_TOKEN?: string;
  CHIP_SECRET_KEY?: string;
  CHIP_BRAND_ID?: string;
  CHIP_BASE_URL?: string;
  EMAIL_PROVIDER?: string; // none | resend
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PASSWORD_PBKDF2_ITERATIONS?: string;
  SUPPORT_EMAIL?: string;
  SUPPORT_WHATSAPP?: string;
  SUPPORT_PHONE?: string;
  BUSINESS_NAME?: string;
  BUSINESS_REG_NO?: string;
  BUSINESS_ADDRESS?: string;
  EXTRA_ALLOWED_ORIGINS?: string;
}

export type AppEnvName = 'development' | 'demo' | 'staging' | 'production';

export interface AppConfig {
  appEnv: AppEnvName;
  mode: 'demo' | 'live';
  smsProvider: 'mock' | 'onlinesim';
  paymentProvider: 'mock' | 'chip';
  purchasesEnabled: boolean;
  paymentsEnabled: boolean;
  baseUrl: string;
  secureCookies: boolean;
  allowedOrigins: string[];
  pbkdf2Iterations: number;
  emailEnabled: boolean;
  /** Staging + CHIP: HANYA pembelian CHIP UJIAN (is_test) dibenarkan, sama ada nombor simulasi atau sebenar. */
  chipTestOnly: boolean;
  /** Staging + OnlineSIM sebenar: nombor sebenar (kos sebenar) — hanya admin, dengan had harian. */
  stagingRealNumbers: boolean;
}

export interface ConfigResult {
  ok: boolean;
  errors: string[];
  config: AppConfig;
}

const ENVS: AppEnvName[] = ['development', 'demo', 'staging', 'production'];
const MOCK_ALLOWED: AppEnvName[] = ['development', 'demo'];

function flag(v: string | undefined): boolean {
  return (v ?? '').trim().toLowerCase() === 'true';
}

/**
 * Sahkan konfigurasi. Peraturan utama:
 * - Production MESTI menggunakan pembekal sebenar (tiada mock).
 * - Mock hanya dibenarkan dalam development/demo.
 * - Mock dan sebenar tidak boleh bercampur (bayaran sebenar + nombor palsu, atau sebaliknya).
 * - Pembelian/bayaran sebenar OFF secara lalai; perlu LIVE_*_ENABLED=true.
 */
export function loadConfig(env: Env): ConfigResult {
  const errors: string[] = [];
  const appEnvRaw = (env.APP_ENV ?? 'development').trim() as AppEnvName;
  const appEnv: AppEnvName = ENVS.includes(appEnvRaw) ? appEnvRaw : 'development';
  if (!ENVS.includes(appEnvRaw)) errors.push('APP_ENV tidak sah');

  const sms = (env.SMS_PROVIDER ?? 'mock').trim();
  const pay = (env.PAYMENT_PROVIDER ?? 'mock').trim();
  const smsProvider = sms === 'onlinesim' ? 'onlinesim' : 'mock';
  const paymentProvider = pay === 'chip' ? 'chip' : 'mock';
  if (sms !== 'mock' && sms !== 'onlinesim') errors.push('SMS_PROVIDER tidak sah');
  if (pay !== 'mock' && pay !== 'chip') errors.push('PAYMENT_PROVIDER tidak sah');

  const anyMock = smsProvider === 'mock' || paymentProvider === 'mock';
  // Pengecualian tunggal: staging boleh guna SMS simulasi + CHIP, tetapi HANYA mod ujian CHIP
  // (dikuatkuasakan oleh adapter: bil bukan ujian dibatalkan & tidak diterima).
  const chipTestOnly = appEnv === 'staging' && paymentProvider === 'chip';
  // Satu-satunya campuran dibenarkan: staging dengan SMS simulasi + CHIP ujian.
  const stagingMockSms = chipTestOnly && smsProvider === 'mock';
  if (anyMock && !MOCK_ALLOWED.includes(appEnv) && !stagingMockSms) {
    errors.push(`Adapter mock tidak dibenarkan dalam APP_ENV=${appEnv}`);
  }
  if ((smsProvider === 'mock') !== (paymentProvider === 'mock') && !stagingMockSms) {
    errors.push('Mod mock dan sebenar tidak boleh bercampur (SMS_PROVIDER dan PAYMENT_PROVIDER)');
  }
  if (smsProvider === 'onlinesim' && !env.ONLINESIM_API_KEY) errors.push('ONLINESIM_API_KEY belum ditetapkan');
  if (paymentProvider === 'chip') {
    if (!env.CHIP_SECRET_KEY) errors.push('CHIP_SECRET_KEY belum ditetapkan');
    if (!env.CHIP_BRAND_ID) errors.push('CHIP_BRAND_ID belum ditetapkan');
    else if (!/^[0-9a-f-]{36}$/i.test(env.CHIP_BRAND_ID)) errors.push('CHIP_BRAND_ID mesti UUID');
  }

  const baseUrl = (env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  if (appEnv === 'production' && !baseUrl.startsWith('https://')) errors.push('APP_BASE_URL mesti https dalam production');
  if (env.CHIP_BASE_URL && !env.CHIP_BASE_URL.startsWith('https://')) errors.push('CHIP_BASE_URL mesti https');

  const iterations = Number(env.PASSWORD_PBKDF2_ITERATIONS ?? '100000');
  const pbkdf2Iterations = Number.isInteger(iterations) && iterations >= 10000 && iterations <= 100000 ? iterations : 100000;

  const allowedOrigins = [new URL(baseUrl).origin];
  for (const o of (env.EXTRA_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    allowedOrigins.push(o.replace(/\/+$/, ''));
  }

  const live = !anyMock;
  return {
    ok: errors.length === 0,
    errors,
    config: {
      appEnv,
      mode: live ? 'live' : 'demo',
      smsProvider,
      paymentProvider,
      purchasesEnabled: anyMock ? true : flag(env.LIVE_PURCHASES_ENABLED),
      paymentsEnabled: paymentProvider === 'mock' ? true : flag(env.LIVE_PAYMENTS_ENABLED),
      baseUrl,
      secureCookies: baseUrl.startsWith('https://'),
      allowedOrigins,
      pbkdf2Iterations,
      emailEnabled: (env.EMAIL_PROVIDER ?? 'none') === 'resend' && !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
      chipTestOnly,
      stagingRealNumbers: appEnv === 'staging' && smsProvider === 'onlinesim',
    },
  };
}
