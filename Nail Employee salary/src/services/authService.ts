import { pool } from "../db/pool";
import { getCredentialByEmail, getStaffIdentity } from "../repositories/authRepo";
import { verifyPassword } from "../auth/password";
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

export async function login(email: string, password: string): Promise<AuthTokens> {
  const cred = await getCredentialByEmail(pool, email);
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
