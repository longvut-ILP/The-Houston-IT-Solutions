import { createHash, randomBytes } from "crypto";
import { Db } from "../db/pool";

/** Opaque refresh token (returned to the client) + its stored hash. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function storeRefreshToken(
  db: Db,
  staffId: string,
  hash: string,
  expiresAt: Date
): Promise<void> {
  await db.query(
    `INSERT INTO refresh_tokens (staff_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [staffId, hash, expiresAt.toISOString()]
  );
}

export interface RefreshRow {
  id: string;
  staffId: string;
}

/** A non-revoked, non-expired token row for this hash, or null. */
export async function findValidRefreshToken(
  db: Db,
  hash: string
): Promise<RefreshRow | null> {
  const { rows } = await db.query<{ id: string; staff_id: string }>(
    `SELECT id, staff_id FROM refresh_tokens
      WHERE token_hash = $1 AND NOT revoked AND expires_at > now()
      LIMIT 1`,
    [hash]
  );
  return rows[0] ? { id: rows[0].id, staffId: rows[0].staff_id } : null;
}

export async function revokeRefreshToken(db: Db, id: string): Promise<void> {
  await db.query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [id]);
}

export async function revokeByHash(db: Db, hash: string): Promise<void> {
  await db.query(`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`, [hash]);
}
