export type OrderStatus =
  | 'pending_payment'
  | 'payment_failed'
  | 'expired_unpaid'
  | 'cancelled_unpaid'
  | 'paid'
  | 'purchasing'
  | 'needs_reconciliation'
  | 'purchase_failed'
  | 'active'
  | 'completed'
  | 'expired'
  | 'cancelled';

/**
 * State machine pesanan. Hanya peralihan dalam jadual ini dibenarkan.
 *
 * pending_payment ─► paid ─► purchasing ─► active ─► completed | expired | cancelled
 *        │                       ├─► purchase_failed (pembekal menolak secara jelas)
 *        │                       └─► needs_reconciliation (timeout / status tidak diketahui)
 *        │                                ├─► active (admin sahkan nombor dikeluarkan)
 *        │                                └─► purchase_failed (admin sahkan tiada nombor)
 *        ├─► payment_failed ──► paid (bayaran berjaya kemudian)
 *        ├─► expired_unpaid ──► paid (bayaran lewat)
 *        └─► cancelled_unpaid ─► paid (bayaran diterima selepas dibatalkan)
 */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'payment_failed', 'expired_unpaid', 'cancelled_unpaid'],
  payment_failed: ['paid'],
  expired_unpaid: ['paid'],
  cancelled_unpaid: ['paid'],
  paid: ['purchasing'],
  purchasing: ['active', 'purchase_failed', 'needs_reconciliation'],
  needs_reconciliation: ['active', 'purchase_failed'],
  purchase_failed: [],
  active: ['completed', 'expired', 'cancelled'],
  completed: [],
  expired: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const PAYABLE_STATES: OrderStatus[] = ['pending_payment', 'payment_failed', 'expired_unpaid', 'cancelled_unpaid'];

/** Refund hanya boleh dimohon apabila pasti tiada nombor/SMS diterima dan status pembekal diketahui. */
export function refundEligible(status: OrderStatus, smsCount: number): boolean {
  if (smsCount > 0) return false;
  return status === 'purchase_failed' || status === 'expired' || status === 'cancelled';
}

export const STATUS_LABEL_MS: Record<OrderStatus, string> = {
  pending_payment: 'Menunggu bayaran',
  payment_failed: 'Bayaran gagal',
  expired_unpaid: 'Bayaran tidak diterima',
  cancelled_unpaid: 'Dibatalkan',
  paid: 'Bayaran diterima',
  purchasing: 'Menyediakan nombor',
  needs_reconciliation: 'Dalam semakan',
  purchase_failed: 'Nombor tidak dapat disediakan',
  active: 'Aktif',
  completed: 'Selesai',
  expired: 'Tamat tempoh',
  cancelled: 'Dibatalkan',
};
