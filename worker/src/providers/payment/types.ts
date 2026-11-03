export interface CreateBillInput {
  orderRef: string;
  amountSen: number;
  title: string;
  description: string;
  returnUrl: string;
  callbackUrl: string;
}

export interface CreateBillResult {
  billCode: string;
  paymentUrl: string;
}

export type PaymentStatusResult =
  | { status: 'paid'; amountSen: number; orderRef: string | null; providerRef: string | null }
  | { status: 'pending' | 'failed' | 'none' }
  | { status: 'unknown'; code: string };

export interface CallbackCheck {
  /** Tandatangan sah. Walaupun sah, status MESTI disahkan semula melalui fetchStatus(). */
  valid: boolean;
  billCode: string | null;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'toyyibpay';
  createBill(input: CreateBillInput): Promise<CreateBillResult>;
  verifyCallback(form: Record<string, string>): CallbackCheck;
  fetchStatus(billCode: string): Promise<PaymentStatusResult>;
  deactivateBill(billCode: string): Promise<void>;
}

export class PaymentProviderError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
