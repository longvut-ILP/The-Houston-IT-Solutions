import { pool, withTx } from "../db/pool";
import { poolTipsByHours } from "../lib/commissionEngine";
import { findPool, insertPool, insertShare, listShares } from "../repositories/tipPoolRepo";
import { insertAudit } from "../repositories/ticketRepo";

export interface TipPoolResult {
  salonId: string;
  businessDate: string; // YYYY-MM-DD
  totalCardTipsCents: number;
  shares: { techId: string; techName: string; hours: number; shareCents: number }[];
}

/**
 * Daily tip pool for W-2 staff, split by hours worked that day using the
 * engine's largest-remainder method (shares sum exactly to the pool).
 * 1099 contractors and owners are excluded by law and by query.
 */
export async function computeDailyPool(
  salonId: string,
  businessDate: string
): Promise<TipPoolResult> {
  // Card tips from W-2 tickets on that calendar date.
  const tipsQ = await pool.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(tt.amount_cents),0) AS total
       FROM ticket_tips tt
       JOIN tickets t ON t.id = tt.ticket_id
       JOIN staff   s ON s.id = t.tech_id
      WHERE tt.method = 'CARD'
        AND s.employment_type = 'W2'
        AND t.salon_id = $1
        AND (t.created_at AT TIME ZONE 'UTC')::date = $2::date`,
    [salonId, businessDate]
  );
  const totalCardTipsCents = Number(tipsQ.rows[0]?.total ?? 0);

  // Hours per W-2 tech that day (only TECH role participates in the pool).
  const hoursQ = await pool.query<{ tech_id: string; name: string; hours: string }>(
    `SELECT s.id AS tech_id, s.full_name AS name,
            COALESCE(SUM(EXTRACT(EPOCH FROM (te.clock_out - te.clock_in)) / 3600.0),0) AS hours
       FROM staff s
       LEFT JOIN time_entries te
         ON te.tech_id = s.id
        AND te.clock_out IS NOT NULL
        AND (te.clock_in AT TIME ZONE 'UTC')::date = $2::date
      WHERE s.salon_id = $1
        AND s.is_active
        AND s.employment_type = 'W2'
        AND s.role = 'TECH'
      GROUP BY s.id, s.full_name
      HAVING COALESCE(SUM(EXTRACT(EPOCH FROM (te.clock_out - te.clock_in)) / 3600.0),0) > 0`,
    [salonId, businessDate]
  );

  const participants = hoursQ.rows.map((r) => ({
    techId: r.tech_id,
    hours: Number(r.hours),
  }));

  const shares = poolTipsByHours(totalCardTipsCents, participants);
  const nameById = new Map(hoursQ.rows.map((r) => [r.tech_id, r.name]));

  return {
    salonId,
    businessDate,
    totalCardTipsCents,
    shares: shares.map((s) => ({
      techId: s.techId,
      techName: nameById.get(s.techId) ?? "",
      hours: s.hours,
      shareCents: s.shareCents,
    })),
  };
}

export interface CommittedTipPool extends TipPoolResult {
  tipPoolId: string;
  alreadyExisted: boolean;
}

/**
 * Compute and PERSIST the daily pool. Idempotent: if a pool already exists for
 * the date, the existing (immutable) shares are returned unchanged. Otherwise
 * the pool + shares are written and audited.
 */
export async function persistDailyPool(
  salonId: string,
  businessDate: string,
  actorStaffId?: string | null
): Promise<CommittedTipPool> {
  const computed = await computeDailyPool(salonId, businessDate);

  return withTx(async (db) => {
    const existing = await findPool(db, salonId, businessDate);
    if (existing) {
      const shares = await listShares(db, existing);
      return {
        ...computed,
        shares,
        tipPoolId: existing,
        alreadyExisted: true,
      };
    }
    const tipPoolId = await insertPool(db, salonId, businessDate, computed.totalCardTipsCents);
    for (const s of computed.shares) {
      await insertShare(db, tipPoolId, s.techId, s.hours, s.shareCents);
    }
    await insertAudit(db, {
      salonId,
      actorStaffId: actorStaffId ?? null,
      entityType: "tip_pool",
      entityId: tipPoolId,
      action: "FINALIZE_TIP_POOL",
      after: { businessDate, total: computed.totalCardTipsCents, shares: computed.shares.length },
    });
    return { ...computed, tipPoolId, alreadyExisted: false };
  });
}
