import { test, after } from "node:test";
import assert from "node:assert/strict";
import { checkout } from "../src/services/checkoutService";
import { pool } from "../src/db/pool";

/**
 * Integration test for the real checkout write path. It runs ONLY when
 * RUN_DB_TESTS=1 and DATABASE_URL points at a disposable database that has had
 * the migrations + seed applied:
 *
 *   createdb nail_salon_test
 *   DATABASE_URL=postgres://localhost/nail_salon_test npm run migrate -- --seed
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://localhost/nail_salon_test npm test
 *
 * Note: financial tables are append-only, so these inserts are not cleaned up —
 * use a throwaway DB.
 */
const skip = process.env.RUN_DB_TESTS
  ? false
  : "set RUN_DB_TESTS=1 and DATABASE_URL to a seeded test DB";

// Seed ids from db/seed.sql
const TECH_W2 = "00000000-0000-0000-0000-0000000000a1"; // Mai, 50%/10%
const TECH_1099 = "00000000-0000-0000-0000-0000000000a3"; // Kevin, booth renter

after(async () => {
  await pool.end();
});

test("W-2 checkout persists a commission record matching the engine", { skip }, async () => {
  const result = await checkout({
    techId: TECH_W2,
    lineItems: [
      { kind: "SERVICE", description: "Gel Manicure", amountCents: 10000 },
      { kind: "RETAIL", description: "Cuticle oil", amountCents: 2000 },
    ],
    tips: [{ method: "CARD", amountCents: 2000 }],
  });

  assert.equal(result.path, "W2");
  assert.equal(result.breakdown.commissionWagesCents, 4540);
  assert.equal(result.breakdown.techTakeHomeCents, 6540);

  const { rows } = await pool.query(
    `SELECT commission_wages_cents FROM commission_records WHERE ticket_id = $1`,
    [result.ticketId]
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].commission_wages_cents), 4540);
});

test("1099 checkout persists a payout record and marks it paid", { skip }, async () => {
  const result = await checkout({
    techId: TECH_1099,
    lineItems: [{ kind: "SERVICE", description: "Full Set", amountCents: 9500 }],
    tips: [{ method: "CARD", amountCents: 2000 }],
  });

  assert.equal(result.path, "1099");
  assert.equal(result.breakdown.instantPayoutCents, 11136); // 11500 - (334 + 30)
  assert.equal(result.payoutStatus, "PAID");

  const { rows } = await pool.query(
    `SELECT status, instant_payout_cents FROM payout_records WHERE ticket_id = $1`,
    [result.ticketId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "PAID");
  assert.equal(Number(rows[0].instant_payout_cents), 11136);
});
