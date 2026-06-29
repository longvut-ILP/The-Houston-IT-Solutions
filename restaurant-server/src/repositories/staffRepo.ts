import { Db } from "../db/pool";
import { Role } from "../auth/jwt";

export async function insertStaff(
  db: Db,
  p: { restaurantId: string; fullName: string; email?: string | null; role?: Role }
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO staff (restaurant_id, full_name, email, role)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [p.restaurantId, p.fullName, p.email ?? null, p.role ?? "STAFF"]
  );
  return rows[0].id;
}

export interface StaffListItem {
  id: string;
  name: string;
  role: string;
  email: string | null;
  hasLogin: boolean;
}

export async function listStaff(db: Db, restaurantId: string): Promise<StaffListItem[]> {
  const { rows } = await db.query<{
    id: string;
    full_name: string;
    role: string;
    email: string | null;
    has_login: boolean;
  }>(
    `SELECT s.id, s.full_name, s.role, s.email,
            (c.staff_id IS NOT NULL) AS has_login
       FROM staff s
       LEFT JOIN staff_credentials c ON c.staff_id = s.id
      WHERE s.restaurant_id = $1 AND s.is_active
      ORDER BY s.full_name`,
    [restaurantId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.full_name,
    role: r.role,
    email: r.email,
    hasLogin: r.has_login,
  }));
}
