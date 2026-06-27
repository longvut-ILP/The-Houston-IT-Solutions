import { Db } from "../db/pool";
import type { WorkweekPay } from "../services/payrollService";

/** Find the pay period for [startsOn, endsOn] or create it (OPEN). Returns id. */
export async function findOrCreatePayPeriod(
  db: Db,
  salonId: string,
  startsOn: string,
  endsOn: string
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO pay_periods (salon_id, starts_on, ends_on)
     VALUES ($1, $2, $3)
     ON CONFLICT (salon_id, starts_on, ends_on)
       DO UPDATE SET starts_on = EXCLUDED.starts_on
     RETURNING id`,
    [salonId, startsOn, endsOn]
  );
  return rows[0].id;
}

/**
 * Insert a payroll line. ON CONFLICT DO NOTHING (not UPDATE) so re-running a
 * generate is safe and never trips the append-only trigger on payroll_lines.
 */
export async function insertPayrollLine(
  db: Db,
  payPeriodId: string,
  wp: WorkweekPay
): Promise<void> {
  await db.query(
    `INSERT INTO payroll_lines
       (pay_period_id, tech_id, hours_worked, commission_wages_cents,
        min_wage_floor_cents, min_wage_topup_cents, overtime_hours,
        regular_rate_cents, overtime_premium_cents, gross_pay_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (pay_period_id, tech_id) DO NOTHING`,
    [
      payPeriodId,
      wp.techId,
      wp.hoursWorked,
      wp.commissionWagesCents,
      wp.flsa.minWageFloorCents,
      wp.flsa.minWageTopUpCents,
      wp.flsa.overtimeHours,
      wp.flsa.regularRateCentsPerHour,
      wp.flsa.overtimePremiumCents,
      wp.flsa.grossPayCents,
    ]
  );
}

export interface PersistedPayrollLine {
  techId: string;
  techName: string;
  hoursWorked: number;
  commissionWagesCents: number;
  minWageFloorCents: number;
  minWageTopUpCents: number;
  overtimeHours: number;
  regularRateCents: number;
  overtimePremiumCents: number;
  grossPayCents: number;
}

export async function listPayrollLines(
  db: Db,
  payPeriodId: string
): Promise<PersistedPayrollLine[]> {
  const { rows } = await db.query<{
    tech_id: string;
    full_name: string;
    hours_worked: string;
    commission_wages_cents: string;
    min_wage_floor_cents: string;
    min_wage_topup_cents: string;
    overtime_hours: string;
    regular_rate_cents: string;
    overtime_premium_cents: string;
    gross_pay_cents: string;
  }>(
    `SELECT pl.tech_id, s.full_name,
            pl.hours_worked, pl.commission_wages_cents, pl.min_wage_floor_cents,
            pl.min_wage_topup_cents, pl.overtime_hours, pl.regular_rate_cents,
            pl.overtime_premium_cents, pl.gross_pay_cents
       FROM payroll_lines pl
       JOIN staff s ON s.id = pl.tech_id
      WHERE pl.pay_period_id = $1
      ORDER BY s.full_name`,
    [payPeriodId]
  );
  return rows.map((r) => ({
    techId: r.tech_id,
    techName: r.full_name,
    hoursWorked: Number(r.hours_worked),
    commissionWagesCents: Number(r.commission_wages_cents),
    minWageFloorCents: Number(r.min_wage_floor_cents),
    minWageTopUpCents: Number(r.min_wage_topup_cents),
    overtimeHours: Number(r.overtime_hours),
    regularRateCents: Number(r.regular_rate_cents),
    overtimePremiumCents: Number(r.overtime_premium_cents),
    grossPayCents: Number(r.gross_pay_cents),
  }));
}

export async function lockPayPeriod(db: Db, payPeriodId: string): Promise<void> {
  await db.query(
    `UPDATE pay_periods SET status = 'LOCKED' WHERE id = $1 AND status = 'OPEN'`,
    [payPeriodId]
  );
}
