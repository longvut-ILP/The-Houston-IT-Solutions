# Database schema

PostgreSQL schema for the Nail Salon POS. Migrations are the source of truth and
are written to match `src/lib/commissionEngine.ts` field-for-field, so a value
stored here can always be recomputed by the engine.

## Apply order

```
psql "$DATABASE_URL" -f db/migrations/0001_init.sql
psql "$DATABASE_URL" -f db/migrations/0002_sales.sql
psql "$DATABASE_URL" -f db/migrations/0003_payouts.sql
psql "$DATABASE_URL" -f db/migrations/0004_audit_immutability.sql
psql "$DATABASE_URL" -f db/seed.sql      # optional demo data
```

## Design decisions

- **Money is `BIGINT` cents, rates are `INT` basis points.** Every money column
  is `CHECK (>= 0)`; every bps column is `CHECK (0..10000)`. No floats touch money.
- **Two payout paths never share columns.** `staff_pay_profiles.pay_profile_shape`
  enforces that W-2 rows carry commission rates (and no rent) while 1099 rows
  carry rent (and no commission rates). `commission_records` vs `payout_records`
  keep the W-2 and 1099 ledgers physically separate.
- **Tickets snapshot config + rates** (`snap_*` columns). Changing salon settings
  or a tech's rate never alters historical commissions/payouts.
- **Financial tables are append-only.** `0004` installs `block_mutation` triggers
  on `commission_records`, `payroll_lines`, `tip_pool_shares`, `audit_log`, and
  blocks deletes on `payout_records`. Corrections = reversing inserts + a `VOIDED`
  ticket pointing via `voided_by_ticket_id`. `payout_records` may still UPDATE its
  `status` (PENDING → PAID/FAILED/REVERSED).
- **1099 hours are never tracked for wages** (PRD §1). `time_entries` exists for
  W-2 only and `trg_time_entry_w2_only` rejects 1099 inserts.
- **Payments are provider-agnostic.** `payment_accounts` /
  `payment_transactions` form a ledger so Stripe Connect, Square, etc. can sit
  behind one interface (provider undecided per your earlier choice).
- **`salon_id` everywhere** so a second location is a data change, not a migration.

## Open questions for the next pass

1. Workweek anchor: confirm the local day/time your FLSA week starts (seed assumes Mon 00:00).
2. Card-fee allocation when a ticket mixes service + retail + tip — current model
   charges the fee on the service slice (and on service+tip for 1099). Confirm.
3. Tip-credit vs full-min-wage: schema assumes full min wage + tips on top.
4. Multi-location: keep single-salon for now, or model staff working across salons?
