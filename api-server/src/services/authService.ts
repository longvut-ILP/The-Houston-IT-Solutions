import { pool, withTx } from "../db/pool";
import {
  getCredentialByEmail,
  getStaffIdentity,
  upsertCredential,
} from "../repositories/authRepo";
import { insertStaff } from "../repositories/staffRepo";
import { replaceCurrentConfig } from "../repositories/settingsRepo";
import { hashPassword, verifyPassword } from "../auth/password";
import { signToken } from "../auth/jwt";
import { HttpError } from "../auth/middleware";
import {
  findValidRefreshToken,
  hashToken,
  newRefreshToken,
  revokeByHash,
  revokeRefreshToken,
  storeRefreshToken,
} from "../repositories/refreshTokenRepo";

const REFRESH_TTL_DAYS = 30;

export interface AuthTokens {
  token: string; // short-lived access JWT
  refreshToken: string; // long-lived opaque token
  staff: { id: string; name: string; role: string; salonId: string };
}

function expiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function issueTokens(staff: {
  staffId: string;
  fullName: string;
  role: "OWNER" | "ADMIN" | "TECH";
  salonId: string;
}): Promise<AuthTokens> {
  const token = signToken({ staffId: staff.staffId, salonId: staff.salonId, role: staff.role });
  const { token: refreshToken, hash } = newRefreshToken();
  await storeRefreshToken(pool, staff.staffId, hash, expiry());
  return {
    token,
    refreshToken,
    staff: { id: staff.staffId, name: staff.fullName, role: staff.role, salonId: staff.salonId },
  };
}

export interface RegisterSalonInput {
  salonName: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  timezone?: string;
}

/**
 * Self-serve tenant onboarding: create a new salon + default settings + an OWNER
 * staff member + their login, all atomically, then sign the owner in. Each salon
 * gets its own salon_id, so tenant data stays isolated by the existing scoping.
 */
export async function registerSalon(input: RegisterSalonInput): Promise<AuthTokens> {
  const email = input.ownerEmail.trim().toLowerCase();
  // Global email uniqueness keeps login (which resolves by email) unambiguous.
  const existing = await getCredentialByEmail(pool, email);
  if (existing) throw new HttpError(409, "An account with that email already exists");

  const tz = input.timezone?.trim() || "America/Chicago";
  const ownerName = input.ownerName.trim();
  const owner = await withTx(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO salons (name, timezone) VALUES ($1, $2) RETURNING id`,
      [input.salonName.trim(), tz]
    );
    const salonId = rows[0].id;
    await replaceCurrentConfig(db, salonId, {
      ccFeePctBps: 290,
      ccFeeFixedCents: 30,
      productCostPctBps: 1000,
      minWageCentsPerHour: 1600,
      tipPoolingEnabled: false,
      timezone: tz,
    });
    const staffId = await insertStaff(db, {
      salonId,
      fullName: ownerName,
      email,
      role: "OWNER",
      employmentType: "W2",
    });
    const passwordHash = await hashPassword(input.password);
    await upsertCredential(db, staffId, passwordHash);
    return { staffId, salonId, fullName: ownerName, role: "OWNER" as const };
  });
  return issueTokens(owner);
}

export async function login(email: string, password: string): Promise<AuthTokens> {
  const cred = await getCredentialByEmail(pool, email.trim().toLowerCase());
  if (!cred) throw new HttpError(401, "Invalid email or password");
  const ok = await verifyPassword(password, cred.passwordHash);
  if (!ok) throw new HttpError(401, "Invalid email or password");
  return issueTokens(cred);
}

/** Rotate: validate the presented refresh token, revoke it, issue a fresh pair. */
export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const hash = hashToken(refreshToken);
  const row = await findValidRefreshToken(pool, hash);
  if (!row) throw new HttpError(401, "Invalid or expired refresh token");
  await revokeRefreshToken(pool, row.id);
  const identity = await getStaffIdentity(pool, row.staffId);
  if (!identity) throw new HttpError(401, "Account no longer active");
  return issueTokens(identity);
}

export async function logout(refreshToken: string): Promise<void> {
  if (refreshToken) await revokeByHash(pool, hashToken(refreshToken));
}

export async function me(staffId: string) {
  const id = await getStaffIdentity(pool, staffId);
  if (!id) throw new HttpError(404, "Not found");
  return { id: id.staffId, name: id.fullName, role: id.role, salonId: id.salonId };
}
