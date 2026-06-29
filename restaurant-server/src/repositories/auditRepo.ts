import { Db } from "../db/pool";

export interface AuditEntry {
  restaurantId: string;
  actorStaffId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
}

export async function insertAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (restaurant_id, actor_staff_id, entity_type, entity_id, action, before_json, after_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      e.restaurantId,
      e.actorStaffId ?? null,
      e.entityType,
      e.entityId ?? null,
      e.action,
      e.before == null ? null : JSON.stringify(e.before),
      e.after == null ? null : JSON.stringify(e.after),
    ]
  );
}
