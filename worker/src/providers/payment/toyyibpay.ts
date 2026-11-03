import { md5Hex, timingSafeEqualStr } from '../../lib/crypto';
import { rmStringToSen } from '../../lib/money';
import { PaymentProviderError, type CallbackCheck, type CreateBillInput, type CreateBillResult, type PaymentProvider, type PaymentStatusResult } from './types';

/**
 * Adapter ToyyibPay (https://toyyibpay.com/apireference/).
 *  - createBill:            POST {base}/index.php/api/createBill        (billAmount dalam SEN)
 *  - getBillTransactions:   POST {base}/index.php/api/getBillTransactions
 *  - inactiveBill:          POST {base}/index.php/api/inactiveBill       (param: secretKey, billCode)
 *  - Callback hash:         MD5(userSecretKey + status + order_id + refno + "ok")
 *  - URL bayaran:           {base}/{billCode}
 * Sandbox: https://dev.toyyibpay.com. Production: https://toyyibpay.com.
 */
export class ToyyibPayProvider implements PaymentProvider {
  readonly name = 'toyyibpay' as const;
  constructor(
    private secretKey: string,
    private categoryCode: string,
    private baseUrl = 'https://toyyibpay.com',
    private paymentChannel = '0',
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
    private timeoutMs = 15_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async post(path: string, form: Record<string, string>): Promise<string> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new PaymentProviderError(`HTTP_${res.status}`);
      return await res.text();
    } catch (e) {
      if (e instanceof PaymentProviderError) throw e;
      throw new PaymentProviderError((e as Error)?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally {
      clearTimeout(t);
    }
  }

  static sanitize(s: string, max: number): string {
    return s.replace(/[^A-Za-z0-9 _]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  async createBill(input: CreateBillInput): Promise<CreateBillResult> {
    if (!Number.isInteger(input.amountSen) || input.amountSen <= 0) throw new PaymentProviderError('INVALID_AMOUNT');
    const text = await this.post('/index.php/api/createBill', {
      userSecretKey: this.secretKey,
      categoryCode: this.categoryCode,
      billName: ToyyibPayProvider.sanitize(input.title, 30),
      billDescription: ToyyibPayProvider.sanitize(input.description, 100),
      billPriceSetting: '1',
      billPayorInfo: '0',
      billAmount: String(input.amountSen),
      billReturnUrl: input.returnUrl,
      billCallbackUrl: input.callbackUrl,
      billExternalReferenceNo: input.orderRef,
      billPaymentChannel: this.paymentChannel,
      billExpiryDays: '1',
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaymentProviderError(text.trim().slice(0, 60) || 'INVALID_RESPONSE');
    }
    const code = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown>)?.BillCode : undefined;
    if (typeof code !== 'string' || !/^[A-Za-z0-9]+$/.test(code)) throw new PaymentProviderError('CREATE_BILL_FAILED');
    return { billCode: code, paymentUrl: `${this.baseUrl}/${code}` };
  }

  verifyCallback(form: Record<string, string>): CallbackCheck {
    const { status = '', order_id = '', refno = '', hash = '', billcode = '' } = form;
    if (!hash || !billcode) return { valid: false, billCode: billcode || null };
    const expected = md5Hex(`${this.secretKey}${status}${order_id}${refno}ok`);
    return { valid: timingSafeEqualStr(expected, hash.toLowerCase()), billCode: billcode };
  }

  async fetchStatus(billCode: string): Promise<PaymentStatusResult> {
    let text: string;
    try {
      text = await this.post('/index.php/api/getBillTransactions', { billCode, userSecretKey: this.secretKey });
    } catch (e) {
      return { status: 'unknown', code: e instanceof PaymentProviderError ? e.code : 'UNKNOWN' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: 'unknown', code: 'INVALID_RESPONSE' };
    }
    if (!Array.isArray(parsed)) return { status: 'unknown', code: 'UNEXPECTED_RESPONSE' };
    if (parsed.length === 0) return { status: 'none' };
    const txs = parsed as Record<string, unknown>[];
    const success = txs.find((t) => String(t.billpaymentStatus) === '1');
    if (success) {
      let amountSen: number;
      try {
        // Contoh dokumentasi: "billpaymentAmount": "10.00" (format RM dua tempat perpuluhan).
        amountSen = rmStringToSen(String(success.billpaymentAmount ?? ''));
      } catch {
        return { status: 'unknown', code: 'AMOUNT_UNPARSEABLE' };
      }
      return {
        status: 'paid',
        amountSen,
        orderRef: success.billExternalReferenceNo != null ? String(success.billExternalReferenceNo) : null,
        providerRef: success.billpaymentInvoiceNo != null ? String(success.billpaymentInvoiceNo) : null,
      };
    }
    if (txs.some((t) => ['2', '4'].includes(String(t.billpaymentStatus)))) return { status: 'pending' };
    if (txs.every((t) => String(t.billpaymentStatus) === '3')) return { status: 'failed' };
    return { status: 'unknown', code: 'UNRECOGNISED_STATUS' };
  }

  async deactivateBill(billCode: string): Promise<void> {
    try {
      await this.post('/index.php/api/inactiveBill', { secretKey: this.secretKey, billCode });
    } catch {
      // Tidak kritikal: jika bil masih dibayar, bayaran lewat dikendalikan sebagai "paid" dan pesanan diteruskan.
    }
  }
}
