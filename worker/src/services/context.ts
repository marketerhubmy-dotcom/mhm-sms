import { loadConfig, type AppConfig, type Env } from '../env';
import { ResendEmailProvider, type EmailProvider } from '../providers/email';
import { MockPaymentProvider } from '../providers/payment/mock';
import { ToyyibPayProvider } from '../providers/payment/toyyibpay';
import type { PaymentProvider } from '../providers/payment/types';
import { MockSmsProvider } from '../providers/sms/mock';
import { OnlineSimProvider } from '../providers/sms/onlinesim';
import type { SmsProvider } from '../providers/sms/types';

export interface AppCtx {
  env: Env;
  config: AppConfig;
  configErrors: string[];
  db: D1Database;
  sms: SmsProvider;
  payment: PaymentProvider;
  email: EmailProvider | null;
  now: () => number;
}

export interface Deps {
  now?: () => number;
  sms?: (env: Env, config: AppConfig, now: () => number) => SmsProvider;
  payment?: (env: Env, config: AppConfig, now: () => number) => PaymentProvider;
}

export function buildCtx(env: Env, deps: Deps = {}): AppCtx {
  const { ok, errors, config } = loadConfig(env);
  const now = deps.now ?? Date.now;
  const sms =
    deps.sms?.(env, config, now) ??
    (config.smsProvider === 'onlinesim'
      ? new OnlineSimProvider(env.ONLINESIM_API_KEY ?? '', env.ONLINESIM_BASE_URL || 'https://onlinesim.io')
      : new MockSmsProvider(env.DB, now));
  const payment =
    deps.payment?.(env, config, now) ??
    (config.paymentProvider === 'toyyibpay'
      ? new ToyyibPayProvider(env.TOYYIBPAY_SECRET_KEY ?? '', env.TOYYIBPAY_CATEGORY_CODE ?? '', env.TOYYIBPAY_BASE_URL || 'https://toyyibpay.com')
      : new MockPaymentProvider(env.DB, config.baseUrl, now));
  const email = config.emailEnabled ? new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM!) : null;
  return { env, config, configErrors: ok ? [] : errors, db: env.DB, sms, payment, email, now };
}
