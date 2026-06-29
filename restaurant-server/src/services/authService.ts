import { pool, withTx } from "../db/pool";
import {
  getCredentialByEmail,
  getStaffIdentity,
  upsertCredential,
} from "../repositories/authRepo";
import { insertStaff } from "../repositories/staffRepo";
import { replaceCurrentConfig } from "../repositories/settingsRepo";
import { insertAudit } from "../repositories/auditRepo";
import { hashPassword, verifyPassword } from "../auth/password";
import { signToken } from "../auth/jwt";
import { HttpError } from "../auth/middleware";

export interface AuthResult {
  token: string;
  staff: { id: string; name: string; role: string; restaurantId: string };
}

function issue(staff: {
  staffId: string;
  fullName: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  restaurantId: string;
}): AuthResult {
  const token = signToken({
    staffId: staff.staffId,
    restaurantId: staff.restaurantId,
    role: staff.role,
  });
  return {
    token,
    staff: { id: staff.staffId, name: staff.fullName, role: staff.role, restaurantId: staff.restaurantId },
  };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const cred = await getCredentialByEmail(pool, email.trim().toLowerCase());
  if (!cred) throw new HttpError(401, "Invalid email or password");
  const ok = await verifyPassword(password, cred.passwordHash);
  if (!ok) throw new HttpError(401, "Invalid email or password");
  return issue(cred);
}

export interface RegisterInput {
  restaurantName: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  timezone?: string;
}

/** Self-serve tenant onboarding: new restaurant + default settings + owner login. */
export async function registerRestaurant(input: RegisterInput): Promise<AuthResult> {
  const email = input.ownerEmail.trim().toLowerCase();
  const existing = await getCredentialByEmail(pool, email);
  if (existing) throw new HttpError(409, "An account with that email already exists");
  const tz = input.timezone?.trim() || "America/Chicago";
  const ownerName = input.ownerName.trim();

  const owner = await withTx(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO restaurants (name, timezone) VALUES ($1,$2) RETURNING id`,
      [input.restaurantName.trim(), tz]
    );
    const restaurantId = rows[0].id;
    await db.query(`INSERT INTO order_counters (restaurant_id, next_number) VALUES ($1, 1)`, [
      restaurantId,
    ]);
    await replaceCurrentConfig(db, restaurantId, {
      taxPctBps: 825,
      ccFeePctBps: 290,
      ccFeeFixedCents: 30,
    });
    const staffId = await insertStaff(db, {
      restaurantId,
      fullName: ownerName,
      email,
      role: "OWNER",
    });
    await upsertCredential(db, staffId, await hashPassword(input.password));
    return { staffId, restaurantId, fullName: ownerName, role: "OWNER" as const };
  });
  return issue(owner);
}

export async function me(staffId: string) {
  const id = await getStaffIdentity(pool, staffId);
  if (!id) throw new HttpError(404, "Not found");
  return { id: id.staffId, name: id.fullName, role: id.role, restaurantId: id.restaurantId };
}

export async function createStaff(
  restaurantId: string,
  input: { fullName: string; email?: string | null; role?: "OWNER" | "ADMIN" | "STAFF"; password?: string },
  actorStaffId: string
): Promise<{ staffId: string }> {
  const staffId = await withTx(async (db) => {
    const id = await insertStaff(db, {
      restaurantId,
      fullName: input.fullName.trim(),
      email: input.email ? input.email.trim().toLowerCase() : null,
      role: input.role ?? "STAFF",
    });
    if (input.password) await upsertCredential(db, id, await hashPassword(input.password));
    await insertAudit(db, {
      restaurantId,
      actorStaffId,
      entityType: "staff",
      entityId: id,
      action: "CREATE",
      after: { fullName: input.fullName, role: input.role ?? "STAFF" },
    });
    return id;
  });
  return { staffId };
}

export async function setStaffPassword(
  restaurantId: string,
  staffId: string,
  password: string,
  actorStaffId: string
): Promise<void> {
  const hash = await hashPassword(password);
  await withTx(async (db) => {
    await upsertCredential(db, staffId, hash);
    await insertAudit(db, {
      restaurantId,
      actorStaffId,
      entityType: "staff",
      entityId: staffId,
      action: "SET_PASSWORD",
      after: { passwordSet: true },
    });
  });
}
