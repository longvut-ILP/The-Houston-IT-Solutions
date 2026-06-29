import { Db } from "../db/pool";
import { Role } from "../auth/jwt";

export interface CredentialRow {
  staffId: string;
  restaurantId: string;
  role: Role;
  fullName: string;
  passwordHash: string;
}

export async function getCredentialByEmail(
  db: Db,
  email: string
): Promise<CredentialRow | null> {
  const { rows } = await db.query<{
    staff_id: string;
    restaurant_id: string;
    role: Role;
    full_name: string;
    password_hash: string;
  }>(
    `SELECT s.id AS staff_id, s.restaurant_id, s.role, s.full_name, c.password_hash
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
    restaurantId: r.restaurant_id,
    role: r.role,
    fullName: r.full_name,
    passwordHash: r.password_hash,
  };
}

export interface StaffIdentity {
  staffId: string;
  restaurantId: string;
  role: Role;
  fullName: string;
}

export async function getStaffIdentity(
  db: Db,
  staffId: string
): Promise<StaffIdentity | null> {
  const { rows } = await db.query<{
    id: string;
    restaurant_id: string;
    role: Role;
    full_name: string;
  }>(
    `SELECT id, restaurant_id, role, full_name FROM staff WHERE id = $1 AND is_active`,
    [staffId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return { staffId: r.id, restaurantId: r.restaurant_id, role: r.role, fullName: r.full_name };
}

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

export async function getStaffRestaurant(db: Db, staffId: string): Promise<string | null> {
  const { rows } = await db.query<{ restaurant_id: string }>(
    `SELECT restaurant_id FROM staff WHERE id = $1`,
    [staffId]
  );
  return rows[0]?.restaurant_id ?? null;
}

export async function getOrderRestaurant(db: Db, orderId: string): Promise<string | null> {
  const { rows } = await db.query<{ restaurant_id: string }>(
    `SELECT restaurant_id FROM orders WHERE id = $1`,
    [orderId]
  );
  return rows[0]?.restaurant_id ?? null;
}
