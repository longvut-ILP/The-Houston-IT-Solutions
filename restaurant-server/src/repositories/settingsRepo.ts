import { Db } from "../db/pool";
import { RestaurantConfig } from "../lib/orderEngine";

/** Current settings mapped into the engine's RestaurantConfig shape. */
export async function getCurrentConfig(db: Db, restaurantId: string): Promise<RestaurantConfig> {
  const { rows } = await db.query<{
    tax_pct_bps: number;
    cc_fee_pct_bps: number;
    cc_fee_fixed_cents: string;
  }>(
    `SELECT tax_pct_bps, cc_fee_pct_bps, cc_fee_fixed_cents
       FROM restaurant_settings
      WHERE restaurant_id = $1 AND is_current
      LIMIT 1`,
    [restaurantId]
  );
  if (rows.length === 0) throw new Error(`No current settings for restaurant ${restaurantId}`);
  const r = rows[0];
  return {
    taxPctBps: r.tax_pct_bps,
    ccFeePctBps: r.cc_fee_pct_bps,
    ccFeeFixedCents: Number(r.cc_fee_fixed_cents),
  };
}

/** Write a new current settings row (history preserved). Run inside a tx. */
export async function replaceCurrentConfig(
  db: Db,
  restaurantId: string,
  c: RestaurantConfig
): Promise<void> {
  await db.query(
    `UPDATE restaurant_settings SET is_current = false WHERE restaurant_id = $1 AND is_current`,
    [restaurantId]
  );
  await db.query(
    `INSERT INTO restaurant_settings
       (restaurant_id, tax_pct_bps, cc_fee_pct_bps, cc_fee_fixed_cents, is_current)
     VALUES ($1, $2, $3, $4, true)`,
    [restaurantId, c.taxPctBps, c.ccFeePctBps, c.ccFeeFixedCents]
  );
}
