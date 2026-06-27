# Nail Salon POS — API

Node + TypeScript + Express + PostgreSQL (raw `pg`, no ORM). Reuses the pure
commission math in `src/lib/commissionEngine.ts`; the database schema lives in
`db/`. Payments go through a provider-agnostic interface (mock until Stripe/Square
is chosen).

## Run

```bash
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install
npm run migrate -- --seed     # apply db/migrations/*.sql then db/seed.sql
npm run create-user owner@polished.test "your-password"   # set a login
npm run dev                    # http://localhost:4000
```

Then log in to get a token:

```bash
curl -X POST http://localhost:4000/auth/login -H 'content-type: application/json' \
  -d '{"email":"owner@polished.test","password":"your-password"}'
# -> { "token": "...", "staff": { "id", "name", "role", "salonId" } }
```

Send `Authorization: Bearer <token>` on every other request.

## Layout

```
src/
  lib/commissionEngine.ts      pure math (cents + bps) — shared with the UI
  db/pool.ts                   pg Pool + withTx() transaction helper
  payments/                    PaymentProvider interface + MockPaymentProvider
  repositories/                SQL: settings, staff+profile, ticket writes
  services/
    checkoutService.ts         engine + repos in one transaction (core path)
    payrollService.ts          FLSA workweek (floor + overtime)
    tipPoolService.ts          daily W-2 tip pool by hours
  http/app.ts                  Express routes + zod validation + errors
  server.ts                    entry point
```

## Endpoints

All endpoints except `/health` and `/auth/login` require `Authorization: Bearer <token>`.
The token carries `salonId` + `role`; the server scopes every query to that salon and
ignores any `salonId` in request bodies. Owner/admin-only routes are marked below.

Role-based read scoping: a `TECH` token only sees **their own** tickets/earnings,
their own full pay profile, and a roster where other staff's commission/rent figures
are zeroed out. `OWNER`/`ADMIN` see the whole salon.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET   | `/health` | liveness (public) |
| POST  | `/webhooks/stripe` | Stripe event receiver (public, signature-verified) |
| POST  | `/auth/login` | email + password → access JWT + refresh token (public) |
| POST  | `/auth/refresh` `{ refreshToken }` | rotate → new access + refresh (public) |
| POST  | `/auth/logout` `{ refreshToken }` | revoke a refresh token |
| GET   | `/auth/me` | current user from token |
| GET   | `/salons/:salonId/calendar` | salon-local today + workweek start (timezone-aware) |
| GET   | `/salons/:salonId/settings` | current overhead/compliance config |
| PUT   | `/salons/:salonId/settings` | save a new settings version (audited) — **owner/admin** |
| GET   | `/staff/:staffId` | staff + current pay profile |
| GET   | `/salons/:salonId/staff` | all active staff + profiles (UI list) |
| GET   | `/salons/:salonId/tickets?date=YYYY-MM-DD` | day's completed tickets (dashboard data) |
| POST  | `/staff` | create staff + initial pay profile — **owner/admin** |
| PATCH | `/staff/:staffId/comp` | W-2/1099 toggle + rates (new profile version) — **owner/admin** |
| GET   | `/salons/:salonId/appointments?date=YYYY-MM-DD` | day's turns |
| POST  | `/appointments` | book a turn / walk-in |
| PATCH | `/appointments/:id/status` | update turn status |
| POST  | `/time-clock/in` `{ techId? }` | clock in (W-2; self, or manager for anyone) |
| POST  | `/time-clock/out` `{ techId? }` | clock out |
| GET   | `/time-clock/status?techId=&date=` | current clock state + hours today |
| POST  | `/checkout` | run engine, persist ticket + commission/payout atomically |
| GET   | `/payroll/workweek?salonId=&start=YYYY-MM-DD[&techId=]` | FLSA pay for the week (compute) — **owner/admin** |
| POST  | `/payroll/commit` `{ start }` | persist + lock the week's payroll lines — **owner/admin** |
| GET   | `/tip-pool?salonId=&date=YYYY-MM-DD` | daily W-2 tip pool split (compute) — **owner/admin** |
| POST  | `/tip-pool/commit` `{ date }` | persist the day's tip pool + shares — **owner/admin** |

`POST /staff` and `PATCH /staff/:id/comp` validate the comp shape: a W-2 body
must carry `serviceCommissionBps` + `retailCommissionBps`; a 1099 body must carry
`rentAmountCents` + `rentCadence`. Mismatches return 400 before hitting the DB.

### Example checkout

```bash
curl -X POST http://localhost:4000/checkout -H 'content-type: application/json' -d '{
  "techId": "00000000-0000-0000-0000-0000000000a1",
  "lineItems": [
    { "kind": "SERVICE", "description": "Gel Manicure", "amountCents": 8000 },
    { "kind": "RETAIL",  "description": "Cuticle oil",  "amountCents": 2000 }
  ],
  "tips": [{ "method": "CARD", "amountCents": 1500 }]
}'
```

The response includes the engine breakdown and, for a 1099 renter, the payout id
and provider status.

## How checkout stays correct

- Loads the tech's **current** pay profile + salon config, then **snapshots**
  those rates onto the ticket so the record is reproducible later.
- Writes ticket, line items, tips, and the W-2 `commission_record` **or** the
  1099 `payout_record` inside a single `withTx` transaction — all-or-nothing.
- For 1099, the external payout is initiated **after** commit (no network call
  inside the DB transaction); the `payout_records.status` is then updated, which
  the append-only triggers permit (they block DELETE, allow status UPDATE).

## Payments

All money movement goes through the `PaymentProvider` interface
(`src/payments/`). `MockPaymentProvider` is the default and returns synthetic
PAID results so checkout runs without a vendor.

To use Stripe Connect, set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, and
`STRIPE_WEBHOOK_SECRET`. Then:

- 1099 service payouts → Stripe **Transfer** to the contractor's connected
  account (id stored in `payment_accounts.external_account_id`).
- Chair rent → a **PaymentIntent** charged to the renter's saved payment method.
- Async results land on `POST /webhooks/stripe`, which verifies the signature
  (raw body) and updates `payout_records` / `rent_charges` by the `metadata`
  (`payoutId` / `rentChargeId`) set when the object was created. Test locally
  with `stripe listen --forward-to localhost:4000/webhooks/stripe`.

Still TODO for production Stripe: Connect onboarding to populate
`payment_accounts`, and creating `rent_charges` rows on a schedule before
charging them.

## Tests

Built on Node's built-in runner via `tsx` (no extra deps).

```bash
npm run test:unit   # engine math + HTTP validation (no database needed)
npm test            # also runs the checkout integration test (needs a test DB)
```

- `test/engine.test.ts` — pure math: bps rounding, W-2 ticket, renter payout,
  FLSA floor/overtime, tip-pool exact-sum. Always runs.
- `test/http.test.ts` — boots the Express app on an ephemeral port and checks
  `/health` plus validation 400s. No database touched.
- `test/checkout.int.test.ts` — real write path; runs only when
  `RUN_DB_TESTS=1` and `DATABASE_URL` points at a **disposable** seeded DB
  (financial tables are append-only, so rows aren't cleaned up):

  ```bash
  createdb nail_salon_test
  DATABASE_URL=postgres://localhost/nail_salon_test npm run migrate -- --seed
  RUN_DB_TESTS=1 DATABASE_URL=postgres://localhost/nail_salon_test npm test
  ```

## Auth tokens

Login returns a short-lived access JWT plus a long-lived opaque refresh token
(SHA-256 hashed at rest in `refresh_tokens`). `POST /auth/refresh` rotates:
it revokes the presented token and issues a fresh pair. The UI auto-refreshes
once on a 401 and retries the request. `POST /auth/logout` revokes.

## Timezone

`salon_settings.timezone` (IANA, owner-editable) anchors the workweek (Mon
00:00) and "today". The server is authoritative — `GET /salons/:id/calendar`
returns `{ today, weekStart, timezone }` and the UI uses those instead of the
browser clock, so payroll weeks and tip-pool days are consistent.

## Not done yet (next steps)

- Stripe Connect onboarding flow to populate `payment_accounts`; scheduled rent_charge creation.
- Server-side CSV export endpoint for a *committed* pay period (UI currently exports the computed view client-side).

> Note: this was authored without a live build in the sandbox. Run
> `npm run typecheck` and the migrations on your machine to confirm before relying on it.
```
