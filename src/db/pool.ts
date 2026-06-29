import { Pool, PoolClient } from "pg";
import "dotenv/config";

// Managed Postgres (Vercel Postgres / Neon / Render / Supabase) requires TLS.
// Enable it when PGSSL=true or when the connection string asks for sslmode=require.
const url = process.env.DATABASE_URL || "";
const useSSL = process.env.PGSSL === "true" || /sslmode=require/i.test(url);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  // Bounded pool + idle timeout keeps us under managed-DB connection limits
  // (e.g. Neon/Vercel Postgres) and lets the DB autosuspend when idle.
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30000,
});

/** Anything we can run a query on: the pool itself or a client inside a tx. */
export type Db = Pick<Pool, "query">;

/**
 * Run `fn` inside a single transaction. Commits on success, rolls back on any
 * throw. The checkout path uses this so a ticket and its commission/payout
 * rows are written atomically — never a ticket without its money records.
 */
export async function withTx<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
