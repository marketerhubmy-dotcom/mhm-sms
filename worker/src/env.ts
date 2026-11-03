export interface Env {
  DB: D1Database;
  APP_ENV?: string; // development | demo | staging | production
  APP_BASE_URL?: string;
  SMS_PROVIDER?: string; // mock | onlinesim
  PAYMENT_PROVIDER?: string; // mock | toyyibpay
  LIVE_PURCHASES_ENABLED?: string;
  LIVE_PAYMENTS_ENABLED?: string;
  ONLINESIM_API_KEY?: string;
  ONLINESIM_BASE_URL?: string;
  ONLINESIM_WEBHOOK_TOKEN?: string;
  TOYYIBPAY_SECRET_KEY?: string;
  TOYYIBPAY_CATEGORY_CODE?: string;
  TOYYIBPAY_BASE_URL?: string;
  EMAIL_PROVIDER?: string; // none | resend
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  PASSWORD_PBKDF2_ITERATIONS?: string;
  SUPPORT_EMAIL?: string;
  SUPPORT_WHATSAPP?: string;
  EXTRA_ALLOWED_ORIGINS?: string;
}

export type AppEnvName = 'development' | 'demo' | 'staging' | 'production';

export interface AppConfig {
  appEnv: AppEnvName;
  mode: 'demo' | 'live';
  smsProvider: 'mock' | 'onlinesim';
  paymentProvider: 'mock' | 'toyyibpay';
  purchasesEnabled: boolean;
  paymentsEnabled: boolean;
  baseUrl: string;
  secureCookies: boolean;
  allowedOrigins: string[];
  pbkdf2Iterations: number;
  emailEnabled: boolean;
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
  const paymentProvider = pay === 'toyyibpay' ? 'toyyibpay' : 'mock';
  if (sms !== 'mock' && sms !== 'onlinesim') errors.push('SMS_PROVIDER tidak sah');
  if (pay !== 'mock' && pay !== 'toyyibpay') errors.push('PAYMENT_PROVIDER tidak sah');

  const anyMock = smsProvider === 'mock' || paymentProvider === 'mock';
  if (anyMock && !MOCK_ALLOWED.includes(appEnv)) {
    errors.push(`Adapter mock tidak dibenarkan dalam APP_ENV=${appEnv}`);
  }
  if ((smsProvider === 'mock') !== (paymentProvider === 'mock')) {
    errors.push('Mod mock dan sebenar tidak boleh bercampur (SMS_PROVIDER dan PAYMENT_PROVIDER)');
  }
  if (smsProvider === 'onlinesim' && !env.ONLINESIM_API_KEY) errors.push('ONLINESIM_API_KEY belum ditetapkan');
  if (paymentProvider === 'toyyibpay') {
    if (!env.TOYYIBPAY_SECRET_KEY) errors.push('TOYYIBPAY_SECRET_KEY belum ditetapkan');
    if (!env.TOYYIBPAY_CATEGORY_CODE) errors.push('TOYYIBPAY_CATEGORY_CODE belum ditetapkan');
  }

  const baseUrl = (env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  if (appEnv === 'production' && !baseUrl.startsWith('https://')) errors.push('APP_BASE_URL mesti https dalam production');
  if (appEnv === 'production' && /dev\.toyyibpay\.com/.test(env.TOYYIBPAY_BASE_URL ?? '')) {
    errors.push('TOYYIBPAY_BASE_URL sandbox tidak dibenarkan dalam production');
  }

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
      paymentsEnabled: anyMock ? true : flag(env.LIVE_PAYMENTS_ENABLED),
      baseUrl,
      secureCookies: baseUrl.startsWith('https://'),
      allowedOrigins,
      pbkdf2Iterations,
      emailEnabled: (env.EMAIL_PROVIDER ?? 'none') === 'resend' && !!env.RESEND_API_KEY && !!env.EMAIL_FROM,
    },
  };
}
