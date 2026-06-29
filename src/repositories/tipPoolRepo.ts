import { Db } from "../db/pool";

export interface PersistedShare {
  techId: string;
  techName: string;
  hours: number;
  shareCents: number;
}

/** Existing pool id for the date, or null. */
export async function findPool(
  db: Db,
  salonId: string,
  businessDate: string
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM tip_pools WHERE salon_id = $1 AND business_date = $2`,
    [salonId, businessDate]
  );
  return rows[0]?.id ?? null;
}

export async function insertPool(
  db: Db,
  salonId: string,
  businessDate: string,
  totalCardTipsCents: number
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tip_pools (salon_id, business_date, total_card_tips_cents)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [salonId, businessDate, totalCardTipsCents]
  );
  return rows[0].id;
}

export async function insertShare(
  db: Db,
  tipPoolId: string,
  techId: string,
  hours: number,
  shareCents: number
): Promise<void> {
  // Shares are append-only; DO NOTHING keeps re-runs from tripping the trigger.
  await db.query(
    `INSERT INTO tip_pool_shares (tip_pool_id, tech_id, hours, share_cents)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tip_pool_id, tech_id) DO NOTHING`,
    [tipPoolId, techId, hours, shareCents]
  );
}

export async function listShares(
  db: Db,
  tipPoolId: string
): Promise<PersistedShare[]> {
  const { rows } = await db.query<{
    tech_id: string;
    full_name: string;
    hours: string;
    share_cents: string;
  }>(
    `SELECT ts.tech_id, s.full_name, ts.hours, ts.share_cents
       FROM tip_pool_shares ts
       JOIN staff s ON s.id = ts.tech_id
      WHERE ts.tip_pool_id = $1
      ORDER BY s.full_name`,
    [tipPoolId]
  );
  return rows.map((r) => ({
    techId: r.tech_id,
    techName: r.full_name,
    hours: Number(r.hours),
    shareCents: Number(r.share_cents),
  }));
}
