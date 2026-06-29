import { Db } from "../db/pool";
import { Role } from "../auth/jwt";

export interface CredentialRow {
  staffId: string;
  salonId: string;
  role: Role;
  fullName: string;
  passwordHash: string;
}

/** Look up a staff member's login by email (active staff with a credential). */
export async function getCredentialByEmail(
  db: Db,
  email: string
): Promise<CredentialRow | null> {
  const { rows } = await db.query<{
    staff_id: string;
    salon_id: string;
    role: Role;
    full_name: string;
    password_hash: string;
  }>(
    `SELECT s.id AS staff_id, s.salon_id, s.role, s.full_name, c.password_hash
       FROM staff s
       JOIN staff_credentials c ON c.staff_id = s.id
      WHERE s.email = $1 AND s.is_active
      LIMIT 1`,
    [email]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    staffId: r.staff_id,
    salonId: r.salon_id,
    role: r.role,
    fullName: r.full_name,
    passwordHash: r.password_hash,
  };
}

export interface StaffIdentity {
  staffId: string;
  salonId: string;
  role: Role;
  fullName: string;
}

export async function getStaffIdentity(
  db: Db,
  staffId: string
): Promise<StaffIdentity | null> {
  const { rows } = await db.query<{
    id: string;
    salon_id: string;
    role: Role;
    full_name: string;
  }>(
    `SELECT id, salon_id, role, full_name FROM staff WHERE id = $1 AND is_active`,
    [staffId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { staffId: r.id, salonId: r.salon_id, role: r.role, fullName: r.full_name };
}

/** Create or replace a staff member's login password hash. */
export async function upsertCredential(
  db: Db,
  staffId: string,
  passwordHash: string
): Promise<void> {
  await db.query(
    `INSERT INTO staff_credentials (staff_id, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (staff_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [staffId, passwordHash]
  );
}

/** Salon that owns a staff row (for tenancy checks). */
export async function getStaffSalon(db: Db, staffId: string): Promise<string | null> {
  const { rows } = await db.query<{ salon_id: string }>(
    `SELECT salon_id FROM staff WHERE id = $1`,
    [staffId]
  );
  return rows[0]?.salon_id ?? null;
}

/** Salon that owns an appointment (for tenancy checks). */
export async function getAppointmentSalon(
  db: Db,
  appointmentId: string
): Promise<string | null> {
  const { rows } = await db.query<{ salon_id: string }>(
    `SELECT salon_id FROM appointments WHERE id = $1`,
    [appointmentId]
  );
  return rows[0]?.salon_id ?? null;
}
