export async function audit(
  db: D1Database,
  e: { actor: string | null; action: string; targetType?: string; targetId?: string; details?: unknown; now: number },
) {
  await db
    .prepare('INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.actor, e.action, e.targetType ?? null, e.targetId ?? null, e.details === undefined ? null : JSON.stringify(e.details), e.now)
    .run();
}
