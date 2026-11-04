export interface CreateBillInput {
  orderRef: string;
  amountSen: number;
  title: string;
  description: string;
  customerEmail: string;
  customerName: string;
  /** Masa (ms) selepas ini bil tidak boleh dibayar lagi. */
  dueAt: number;
  returnUrl: string;
  callbackUrl: string;
}

export interface CreateBillResult {
  billCode: string;
  paymentUrl: string;
}

export type PaymentStatusResult =
  | { status: 'paid'; amountSen: number; currency: string; orderRef: string | null; providerRef: string | null }
  | { status: 'pending'; attemptFailed?: boolean }
  | { status: 'failed' | 'none' }
  | { status: 'unknown'; code: string };

export interface CallbackCheck {
  /** Tandatangan sah. Walaupun sah, status MESTI disahkan semula melalui fetchStatus(). */
  valid: boolean;
  billCode: string | null;
}

export interface CallbackRequest {
  rawBody: string;
  headers: Headers;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'chip';
  createBill(input: CreateBillInput): Promise<CreateBillResult>;
  verifyCallback(req: CallbackRequest): Promise<CallbackCheck>;
  fetchStatus(billCode: string): Promise<PaymentStatusResult>;
  deactivateBill(billCode: string): Promise<void>;
}

export class PaymentProviderError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
