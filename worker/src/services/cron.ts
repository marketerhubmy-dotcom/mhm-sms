import type { AppCtx } from './context';
import { audit } from './audit';
import { attemptPurchase, getProviderBalance, processPaymentSignal, refreshOrder, transition } from './orders';
import { getSettings, intSetting } from './settings';

/**
 * Dijalankan oleh Cron Trigger (setiap minit). Had pelan percuma: 50 subrequest/permintaan,
 * jadi setiap kumpulan dihadkan.
 */
export async function runScheduled(ctx: AppCtx): Promise<Record<string, number>> {
  const now = ctx.now();
  const stats: Record<string, number> = {};
  const settings = await getSettings(ctx.db);

  // 1. Pesanan belum bayar yang lepas tempoh: semak sekali dengan pembekal bayaran (tangkap callback yang hilang), kemudian tamatkan.
  const overdue = await ctx.db
    .prepare("SELECT o.id, p.bill_code FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.status = 'pending_payment' AND o.payment_due_at <= ? LIMIT 10")
    .bind(now)
    .all<{ id: string; bill_code: string | null }>();
  for (const o of overdue.results) {
    const outcome = o.bill_code ? await processPaymentSignal(ctx, o.bill_code, 'cron') : 'pending';
    if (outcome === 'pending' || outcome === 'not_found') {
      await transition(ctx, o.id, 'pending_payment', 'expired_unpaid', 'system', 'Tempoh bayaran tamat');
      if (o.bill_code) await ctx.payment.deactivateBill(o.bill_code);
    }
  }
  stats.overdue = overdue.results.length;

  // 2. Pesanan belum bayar yang masih dalam tempoh: semak status bayaran secara berkala (sandaran jika callback tidak sampai).
  const pending = await ctx.db
    .prepare("SELECT p.bill_code FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.status = 'pending_payment' AND p.bill_code IS NOT NULL AND o.created_at <= ? ORDER BY o.updated_at ASC LIMIT 5")
    .bind(now - 60_000)
    .all<{ bill_code: string }>();
  for (const p of pending.results) await processPaymentSignal(ctx, p.bill_code, 'cron');
  stats.pendingChecked = pending.results.length;

  // 3. Bayaran disahkan tetapi pembelian belum bermula (cth. proses terhenti) -> cuba sekali (tuntutan atomik).
  const paid = await ctx.db.prepare("SELECT id FROM orders WHERE status = 'paid' LIMIT 5").all<{ id: string }>();
  for (const o of paid.results) await attemptPurchase(ctx, o.id);
  stats.paidRetried = paid.results.length;

  // 4. 'purchasing' terlalu lama = keputusan tidak diketahui -> rekonsiliasi (TIDAK retry).
  const stuck = await ctx.db
    .prepare("SELECT id FROM orders WHERE status = 'purchasing' AND purchase_started_at <= ? LIMIT 20")
    .bind(now - 2 * 60_000)
    .all<{ id: string }>();
  for (const o of stuck.results) {
    if (await transition(ctx, o.id, 'purchasing', 'needs_reconciliation', 'system', 'Pembelian tidak selesai dalam masa', { last_error_code: 'PURCHASE_STALLED' })) {
      await audit(ctx.db, { actor: null, action: 'order.reconciliation_required', targetType: 'order', targetId: o.id, details: { code: 'PURCHASE_STALLED' }, now });
    }
  }
  stats.stalled = stuck.results.length;

  // 5. Polling pesanan aktif yang tiba masanya.
  const active = await ctx.db
    .prepare("SELECT id FROM orders WHERE status = 'active' AND (next_poll_at IS NULL OR next_poll_at <= ?) ORDER BY next_poll_at ASC LIMIT 20")
    .bind(now)
    .all<{ id: string }>();
  for (const o of active.results) await refreshOrder(ctx, o.id);
  stats.polled = active.results.length;

  // 6. Baki pembekal (setiap ~15 minit).
  await getProviderBalance(ctx, 15 * 60_000);

  // 7. Retention & pembersihan.
  const retentionDays = intSetting(settings, 'sms_retention_days');
  const purged = await purgeOldSms(ctx.db, now - retentionDays * 86_400_000);
  stats.smsPurged = purged;
  await ctx.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
  await ctx.db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').bind(now).run();
  await ctx.db.prepare('DELETE FROM rate_limits WHERE window_start <= ?').bind(now - 86_400_000).run();
  return stats;
}

/** Padam kandungan SMS yang melebihi tempoh simpanan. Bilangan SMS (sms_count) pada pesanan dikekalkan untuk rekod. */
export async function purgeOldSms(db: D1Database, before: number): Promise<number> {
  const r = await db.prepare('DELETE FROM sms_messages WHERE received_at < ?').bind(before).run();
  await db.prepare('DELETE FROM mock_sms WHERE created_at < ?').bind(before).run();
  return r.meta.changes ?? 0;
}
