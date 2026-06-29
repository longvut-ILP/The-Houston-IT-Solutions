import { Db } from "../db/pool";

export async function getEmploymentType(db: Db, techId: string): Promise<string | null> {
  const { rows } = await db.query<{ employment_type: string }>(
    `SELECT employment_type FROM staff WHERE id = $1`,
    [techId]
  );
  return rows[0]?.employment_type ?? null;
}

export interface OpenEntry {
  id: string;
  clockIn: string;
}

/** The tech's currently-open entry (clocked in, not yet out), if any. */
export async function getOpenEntry(db: Db, techId: string): Promise<OpenEntry | null> {
  const { rows } = await db.query<{ id: string; clock_in: string }>(
    `SELECT id, clock_in FROM time_entries
      WHERE tech_id = $1 AND clock_out IS NULL
      ORDER BY clock_in DESC LIMIT 1`,
    [techId]
  );
  return rows[0] ? { id: rows[0].id, clockIn: rows[0].clock_in } : null;
}

export async function insertClockIn(
  db: Db,
  salonId: string,
  techId: string,
  workweekStart: string
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO time_entries (salon_id, tech_id, clock_in, workweek_start)
     VALUES ($1, $2, now(), $3)
     RETURNING id`,
    [salonId, techId, workweekStart]
  );
  return rows[0].id;
}

export async function closeEntry(db: Db, entryId: string): Promise<void> {
  await db.query(
    `UPDATE time_entries SET clock_out = now() WHERE id = $1 AND clock_out IS NULL`,
    [entryId]
  );
}

/** Completed hours for a tech on a calendar date. */
export async function hoursForDay(db: Db, techId: string, date: string): Promise<number> {
  const { rows } = await db.query<{ hours: string }>(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600.0),0) AS hours
       FROM time_entries
      WHERE tech_id = $1
        AND clock_out IS NOT NULL
        AND (clock_in AT TIME ZONE 'UTC')::date = $2::date`,
    [techId, date]
  );
  return Number(rows[0]?.hours ?? 0);
}
