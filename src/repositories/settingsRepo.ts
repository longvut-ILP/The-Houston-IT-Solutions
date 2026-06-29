import { Db } from "../db/pool";
import { SalonConfig } from "../lib/commissionEngine";

interface SettingsRow {
  cc_fee_pct_bps: number;
  cc_fee_fixed_cents: string; // pg returns BIGINT as string
  product_cost_pct_bps: number;
  min_wage_cents_per_hour: string;
  tip_pooling_enabled: boolean;
  timezone: string;
}

/** Current salon settings, mapped into the engine's SalonConfig shape. */
export async function getCurrentConfig(
  db: Db,
  salonId: string
): Promise<Required<SalonConfig>> {
  const { rows } = await db.query<SettingsRow>(
    `SELECT cc_fee_pct_bps, cc_fee_fixed_cents, product_cost_pct_bps,
            min_wage_cents_per_hour, tip_pooling_enabled, timezone
       FROM salon_settings
      WHERE salon_id = $1 AND is_current
      LIMIT 1`,
    [salonId]
  );
  if (rows.length === 0) {
    throw new Error(`No current settings for salon ${salonId}`);
  }
  const r = rows[0];
  return {
    ccFeePctBps: r.cc_fee_pct_bps,
    ccFeeFixedCents: Number(r.cc_fee_fixed_cents),
    productCostPctBps: r.product_cost_pct_bps,
    minWageCentsPerHour: Number(r.min_wage_cents_per_hour),
    tipPoolingEnabled: r.tip_pooling_enabled,
    timezone: r.timezone,
  };
}

/**
 * Replace the current settings with a NEW version: flip the existing current
 * row to is_current=false, then insert the new values as current. History is
 * preserved (the partial unique index guarantees only one current row). Must be
 * called inside a transaction.
 */
export async function replaceCurrentConfig(
  db: Db,
  salonId: string,
  c: SalonConfig
): Promise<void> {
  await db.query(
    `UPDATE salon_settings SET is_current = false
      WHERE salon_id = $1 AND is_current`,
    [salonId]
  );
  await db.query(
    `INSERT INTO salon_settings
       (salon_id, cc_fee_pct_bps, cc_fee_fixed_cents, product_cost_pct_bps,
        min_wage_cents_per_hour, tip_pooling_enabled, timezone, is_current)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
    [
      salonId,
      c.ccFeePctBps,
      c.ccFeeFixedCents,
      c.productCostPctBps,
      c.minWageCentsPerHour,
      c.tipPoolingEnabled,
      c.timezone ?? "America/New_York",
    ]
  );
}
