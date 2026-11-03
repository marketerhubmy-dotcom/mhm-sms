import { randomToken } from '../../lib/crypto';
import type { CallbackCheck, CreateBillInput, CreateBillResult, PaymentProvider, PaymentStatusResult } from './types';

/**
 * Pembayaran SIMULASI (DEMO). Tiada wang sebenar. Hanya aktif apabila APP_ENV=development/demo
 * (dikuatkuasakan oleh loadConfig). "Callback" demo melalui laluan yang sama: isyarat -> fetchStatus -> apply.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;
  constructor(private db: D1Database, private baseUrl: string, private now: () => number = Date.now) {}

  async createBill(input: CreateBillInput): Promise<CreateBillResult> {
    const billCode = 'demo' + randomToken(9).replace(/[^A-Za-z0-9]/g, 'x');
    await this.db
      .prepare("INSERT INTO mock_payments (bill_code, order_ref, amount_sen, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
      .bind(billCode, input.orderRef, input.amountSen, this.now())
      .run();
    return { billCode, paymentUrl: `${this.baseUrl}/demo-bayar/${billCode}` };
  }

  verifyCallback(form: Record<string, string>): CallbackCheck {
    return { valid: !!form.billcode, billCode: form.billcode ?? null };
  }

  async fetchStatus(billCode: string): Promise<PaymentStatusResult> {
    const row = await this.db.prepare('SELECT * FROM mock_payments WHERE bill_code = ?').bind(billCode).first<{
      order_ref: string;
      amount_sen: number;
      status: string;
    }>();
    if (!row) return { status: 'none' };
    if (row.status === 'paid') return { status: 'paid', amountSen: row.amount_sen, orderRef: row.order_ref, providerRef: `DEMO-${billCode}` };
    if (row.status === 'failed') return { status: 'failed' };
    return { status: 'pending' };
  }

  async deactivateBill(): Promise<void> {}

  async setOutcome(billCode: string, outcome: 'paid' | 'failed'): Promise<boolean> {
    const r = await this.db
      .prepare("UPDATE mock_payments SET status = ?, paid_at = ? WHERE bill_code = ? AND status = 'pending'")
      .bind(outcome, this.now(), billCode)
      .run();
    return (r.meta.changes ?? 0) > 0;
  }
}
