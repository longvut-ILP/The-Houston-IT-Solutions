import { pool, withTx } from "../db/pool";
import { getCurrentConfig } from "../repositories/settingsRepo";
import { computeFlsaWorkweek, FlsaResult } from "../lib/commissionEngine";
import {
  findOrCreatePayPeriod,
  insertPayrollLine,
  listPayrollLines,
  lockPayPeriod,
  PersistedPayrollLine,
} from "../repositories/payrollRepo";
import { insertAudit } from "../repositories/ticketRepo";

export interface WorkweekPay {
  techId: string;
  techName: string;
  workweekStart: string; // YYYY-MM-DD
  commissionWagesCents: number;
  hoursWorked: number;
  flsa: FlsaResult;
}

/**
 * FLSA pay for ONE W-2 tech for the 7-day workweek beginning workweekStart.
 * Commission wages come from commission_records on tickets created that week;
 * hours come from time_entries anchored to that workweek. (Default workweek
 * anchor: Monday 00:00 local — confirm before production.)
 */
export async function computeWorkweek(
  salonId: string,
  techId: string,
  workweekStart: string
): Promise<WorkweekPay> {
  const config = await getCurrentConfig(pool, salonId);

  const wagesQ = await pool.query<{ wages: string | null; name: string }>(
    `SELECT COALESCE(SUM(cr.commission_wages_cents),0) AS wages,
            (SELECT full_name FROM staff WHERE id = $1) AS name
       FROM commission_records cr
       JOIN tickets t ON t.id = cr.ticket_id
      WHERE cr.tech_id = $1
        AND t.status = 'COMPLETED'
        AND t.created_at >= $2::date
        AND t.created_at <  ($2::date + INTERVAL '7 days')`,
    [techId, workweekStart]
  );

  const hoursQ = await pool.query<{ hours: string | null }>(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0),0) AS hours
       FROM time_entries
      WHERE tech_id = $1
        AND workweek_start = $2::date
        AND clock_out IS NOT NULL`,
    [techId, workweekStart]
  );

  const commissionWagesCents = Number(wagesQ.rows[0]?.wages ?? 0);
  const hoursWorked = Number(hoursQ.rows[0]?.hours ?? 0);

  const flsa = computeFlsaWorkweek({
    commissionWagesCents,
    hoursWorked,
    minWageCentsPerHour: config.minWageCentsPerHour,
  });

  return {
    techId,
    techName: wagesQ.rows[0]?.name ?? "",
    workweekStart,
    commissionWagesCents,
    hoursWorked,
    flsa,
  };
}

/** Compute the workweek for every active W-2 tech in the salon. */
export async function computeWorkweekForSalon(
  salonId: string,
  workweekStart: string
): Promise<WorkweekPay[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM staff
      WHERE salon_id = $1 AND is_active AND employment_type = 'W2'`,
    [salonId]
  );
  return Promise.all(rows.map((r) => computeWorkweek(salonId, r.id, workweekStart)));
}

/** workweekStart + 6 days, as YYYY-MM-DD. */
function weekEnd(startISO: string): string {
  const d = new Date(`${startISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

export interface CommittedPayroll {
  payPeriodId: string;
  startsOn: string;
  endsOn: string;
  lines: PersistedPayrollLine[];
}

/**
 * Compute the workweek for the salon and PERSIST it: find-or-create the pay
 * period, write a payroll_line per W-2 tech (idempotent), lock the period, and
 * audit. Returns the persisted lines. Safe to re-run — existing lines are kept.
 */
export async function generateAndPersistWorkweek(
  salonId: string,
  workweekStart: string,
  actorStaffId?: string | null
): Promise<CommittedPayroll> {
  const computed = await computeWorkweekForSalon(salonId, workweekStart);
  const endsOn = weekEnd(workweekStart);

  return withTx(async (db) => {
    const payPeriodId = await findOrCreatePayPeriod(db, salonId, workweekStart, endsOn);
    for (const wp of computed) {
      await insertPayrollLine(db, payPeriodId, wp);
    }
    await lockPayPeriod(db, payPeriodId);
    await insertAudit(db, {
      salonId,
      actorStaffId: actorStaffId ?? null,
      entityType: "pay_period",
      entityId: payPeriodId,
      action: "GENERATE_PAYROLL",
      after: { workweekStart, endsOn, techCount: computed.length },
    });
    const lines = await listPayrollLines(db, payPeriodId);
    return { payPeriodId, startsOn: workweekStart, endsOn, lines };
  });
}
