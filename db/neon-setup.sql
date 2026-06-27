-- ============================================================
-- neon-setup.sql — paste this whole file into Neon's SQL Editor
-- Creates the full schema + seed data, then sets the owner login.
-- ============================================================

-- ----- migrations/0001_init.sql -----
-- ============================================================================
-- Nail Salon POS — initial schema (PostgreSQL 14+)
-- Migration 0001_init
-- ----------------------------------------------------------------------------
-- DESIGN RULES (must match src/lib/commissionEngine.ts):
--   * All money is BIGINT CENTS. Never NUMERIC/FLOAT for money. CHECK (>= 0).
--   * All rates are INT BASIS POINTS (bps). 10000 = 100%. CHECK (0..10000).
--   * Financial records (commissions, payouts, payroll, tip shares, ledger)
--     are APPEND-ONLY. Corrections are reversing inserts, never UPDATE/DELETE.
--     Enforced by trg_block_mutation triggers at the bottom of this file.
--   * Every row carries salon_id so a second location can be added later
--     without a migration. Single-salon installs just use one salons row.
--   * Tickets snapshot the config + rates in effect at sale time so a payout
--     can always be recomputed exactly, even after the owner changes settings.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE employment_type   AS ENUM ('W2', 'CONTRACTOR_1099');
CREATE TYPE staff_role        AS ENUM ('OWNER', 'ADMIN', 'TECH');
CREATE TYPE appointment_status AS ENUM ('BOOKED', 'IN_CHAIR', 'DONE', 'CANCELLED', 'NO_SHOW');
CREATE TYPE ticket_status     AS ENUM ('OPEN', 'COMPLETED', 'VOIDED');
CREATE TYPE line_item_kind    AS ENUM ('SERVICE', 'RETAIL');
CREATE TYPE tip_method        AS ENUM ('CARD', 'CASH');
CREATE TYPE rent_cadence      AS ENUM ('WEEKLY', 'MONTHLY');
CREATE TYPE payout_status     AS ENUM ('PENDING', 'PAID', 'FAILED', 'REVERSED');
CREATE TYPE pay_period_status AS ENUM ('OPEN', 'LOCKED', 'EXPORTED');
CREATE TYPE ledger_kind       AS ENUM ('CARD_CHARGE', 'INSTANT_PAYOUT', 'RENT_CHARGE', 'REFUND', 'ADJUSTMENT');

-- ===========================================================================
-- CORE + CONFIG
-- ===========================================================================

CREATE TABLE salons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    timezone    TEXT NOT NULL DEFAULT 'America/New_York',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner-configurable overhead + compliance settings.
-- One CURRENT row per salon (is_current = true). Changes insert a new row and
-- flip the old one to is_current = false, preserving history for audits.
CREATE TABLE salon_settings (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id                 UUID NOT NULL REFERENCES salons(id),
    cc_fee_pct_bps           INT  NOT NULL DEFAULT 290  CHECK (cc_fee_pct_bps BETWEEN 0 AND 10000),
    cc_fee_fixed_cents       BIGINT NOT NULL DEFAULT 30 CHECK (cc_fee_fixed_cents >= 0),
    product_cost_pct_bps     INT  NOT NULL DEFAULT 1000 CHECK (product_cost_pct_bps BETWEEN 0 AND 10000),
    min_wage_cents_per_hour  BIGINT NOT NULL DEFAULT 1600 CHECK (min_wage_cents_per_hour >= 0),
    tip_pooling_enabled      BOOLEAN NOT NULL DEFAULT false,
    is_current               BOOLEAN NOT NULL DEFAULT true,
    effective_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one current settings row per salon.
CREATE UNIQUE INDEX uq_salon_settings_current
    ON salon_settings(salon_id) WHERE is_current;

-- Staff = owners, admins, and techs (W-2 or 1099).
CREATE TABLE staff (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id         UUID NOT NULL REFERENCES salons(id),
    full_name        TEXT NOT NULL,
    email            TEXT,
    role             staff_role NOT NULL DEFAULT 'TECH',
    employment_type  employment_type NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (salon_id, email)
);
CREATE INDEX idx_staff_salon ON staff(salon_id);

-- Current compensation profile per tech. W-2 fields apply to commission
-- employees; rent fields apply to 1099 booth renters. The CHECK enforces that
-- the right fields are populated for the employment type and that the wrong
-- ones stay null/zero — the two paths never share columns by accident.
CREATE TABLE staff_pay_profiles (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id                 UUID NOT NULL REFERENCES staff(id),
    employment_type          employment_type NOT NULL,
    -- W-2 commission rates
    service_commission_bps   INT CHECK (service_commission_bps BETWEEN 0 AND 10000),
    retail_commission_bps    INT CHECK (retail_commission_bps BETWEEN 0 AND 10000),
    -- 1099 rent
    rent_amount_cents        BIGINT CHECK (rent_amount_cents >= 0),
    rent_cadence             rent_cadence,
    is_current               BOOLEAN NOT NULL DEFAULT true,
    effective_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pay_profile_shape CHECK (
        (employment_type = 'W2'
            AND service_commission_bps IS NOT NULL
            AND retail_commission_bps IS NOT NULL
            AND rent_amount_cents IS NULL)
        OR
        (employment_type = 'CONTRACTOR_1099'
            AND rent_amount_cents IS NOT NULL
            AND rent_cadence IS NOT NULL
            AND service_commission_bps IS NULL
            AND retail_commission_bps IS NULL)
    )
);
CREATE UNIQUE INDEX uq_pay_profile_current
    ON staff_pay_profiles(staff_id) WHERE is_current;

COMMIT;

-- ----- migrations/0002_sales.sql -----
-- ============================================================================
-- Migration 0002_sales — scheduling + sales (depends on 0001_init)
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Clients + appointments (the "turns" / calendar)
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id    UUID NOT NULL REFERENCES salons(id),
    full_name   TEXT NOT NULL,
    phone       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_salon ON clients(salon_id);

CREATE TABLE appointments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id        UUID NOT NULL REFERENCES salons(id),
    tech_id         UUID NOT NULL REFERENCES staff(id),
    client_id       UUID REFERENCES clients(id),          -- null for anon walk-in
    client_label    TEXT,                                  -- e.g. 'Walk-in'
    service_desc    TEXT,
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ,
    status          appointment_status NOT NULL DEFAULT 'BOOKED',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX idx_appt_tech_time ON appointments(tech_id, starts_at);
CREATE INDEX idx_appt_salon_day ON appointments(salon_id, starts_at);

-- ---------------------------------------------------------------------------
-- Tickets (a checkout / sale)
-- ---------------------------------------------------------------------------
-- A ticket SNAPSHOTS the config + tech rates in force at checkout. This makes
-- every downstream commission/payout reproducible months later, regardless of
-- how settings change afterward. The engine reads these snapshot_* values, not
-- the live salon_settings row, when (re)computing this ticket.
CREATE TABLE tickets (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id                 UUID NOT NULL REFERENCES salons(id),
    tech_id                  UUID NOT NULL REFERENCES staff(id),
    appointment_id           UUID REFERENCES appointments(id),
    status                   ticket_status NOT NULL DEFAULT 'OPEN',
    -- snapshots (immutable once COMPLETED)
    employment_type_snapshot employment_type NOT NULL,
    snap_cc_fee_pct_bps      INT NOT NULL,
    snap_cc_fee_fixed_cents  BIGINT NOT NULL,
    snap_product_cost_pct_bps INT NOT NULL,
    snap_service_commission_bps INT,   -- null for 1099
    snap_retail_commission_bps  INT,   -- null for 1099
    voided_by_ticket_id      UUID REFERENCES tickets(id),  -- reversing ticket
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at             TIMESTAMPTZ
);
CREATE INDEX idx_tickets_tech ON tickets(tech_id, created_at);
CREATE INDEX idx_tickets_salon ON tickets(salon_id, created_at);

-- Line items separate the revenue streams (PRD §2): SERVICE vs RETAIL.
CREATE TABLE ticket_line_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    kind          line_item_kind NOT NULL,
    description   TEXT,
    quantity      INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    amount_cents  BIGINT NOT NULL CHECK (amount_cents >= 0),  -- extended (qty*unit)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lineitems_ticket ON ticket_line_items(ticket_id);

-- Tips kept distinct from revenue and split by method (PRD §2).
CREATE TABLE ticket_tips (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id     UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    method        tip_method NOT NULL,
    amount_cents  BIGINT NOT NULL CHECK (amount_cents >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tips_ticket ON ticket_tips(ticket_id);

COMMIT;

-- ----- migrations/0003_payouts.sql -----
-- ============================================================================
-- Migration 0003_payouts — commission, payouts, compliance, rent, ledger
-- (depends on 0002_sales). These tables are APPEND-ONLY (see 0004 triggers).
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- PATH A — W-2 commission records (one per completed W-2 ticket)
-- Mirrors W2TicketBreakdown in commissionEngine.ts.
-- ---------------------------------------------------------------------------
CREATE TABLE commission_records (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id                UUID NOT NULL UNIQUE REFERENCES tickets(id),
    tech_id                  UUID NOT NULL REFERENCES staff(id),
    gross_service_cents      BIGINT NOT NULL CHECK (gross_service_cents >= 0),
    cc_fee_on_service_cents  BIGINT NOT NULL CHECK (cc_fee_on_service_cents >= 0),
    product_cost_cents       BIGINT NOT NULL CHECK (product_cost_cents >= 0),
    net_service_cents        BIGINT NOT NULL CHECK (net_service_cents >= 0),
    service_commission_cents BIGINT NOT NULL CHECK (service_commission_cents >= 0),
    retail_revenue_cents     BIGINT NOT NULL CHECK (retail_revenue_cents >= 0),
    retail_commission_cents  BIGINT NOT NULL CHECK (retail_commission_cents >= 0),
    commission_wages_cents   BIGINT NOT NULL CHECK (commission_wages_cents >= 0),
    card_tip_cents           BIGINT NOT NULL DEFAULT 0 CHECK (card_tip_cents >= 0),
    cash_tip_cents           BIGINT NOT NULL DEFAULT 0 CHECK (cash_tip_cents >= 0),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commission_tech ON commission_records(tech_id, created_at);

-- ---------------------------------------------------------------------------
-- PATH B — 1099 instant payout records (one per completed renter ticket)
-- Mirrors Renter1099Payout. Retail stays with the salon; no commission split.
-- ---------------------------------------------------------------------------
CREATE TABLE payout_records (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id              UUID NOT NULL UNIQUE REFERENCES tickets(id),
    tech_id                UUID NOT NULL REFERENCES staff(id),
    gross_service_cents    BIGINT NOT NULL CHECK (gross_service_cents >= 0),
    card_tip_cents         BIGINT NOT NULL DEFAULT 0 CHECK (card_tip_cents >= 0),
    card_fee_cents         BIGINT NOT NULL CHECK (card_fee_cents >= 0),
    instant_payout_cents   BIGINT NOT NULL CHECK (instant_payout_cents >= 0),
    cash_tip_cents         BIGINT NOT NULL DEFAULT 0 CHECK (cash_tip_cents >= 0),
    salon_retail_cents     BIGINT NOT NULL DEFAULT 0 CHECK (salon_retail_cents >= 0),
    provider               TEXT,           -- 'stripe' | 'square' | ... (decided later)
    provider_transfer_id   TEXT,
    status                 payout_status NOT NULL DEFAULT 'PENDING',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payout_tech ON payout_records(tech_id, created_at);

-- ---------------------------------------------------------------------------
-- Time tracking — W-2 ONLY. PRD §1: do NOT track 1099 hours for wage purposes.
-- A CHECK can't see the staff row, so enforce W-2-only via the FK + an app
-- guard and the trg_time_entry_w2_only trigger in 0004.
-- ---------------------------------------------------------------------------
CREATE TABLE time_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id          UUID NOT NULL REFERENCES salons(id),
    tech_id           UUID NOT NULL REFERENCES staff(id),
    clock_in          TIMESTAMPTZ NOT NULL,
    clock_out         TIMESTAMPTZ,
    -- workweek anchor (Mon 00:00 local) used to group FLSA weeks
    workweek_start    DATE NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (clock_out IS NULL OR clock_out >= clock_in)
);
CREATE INDEX idx_time_tech_week ON time_entries(tech_id, workweek_start);

-- ---------------------------------------------------------------------------
-- Payroll (W-2) — period + computed lines (FLSA floor + overtime).
-- Mirrors FlsaResult. payroll_lines is the export the owner sends to payroll.
-- ---------------------------------------------------------------------------
CREATE TABLE pay_periods (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id    UUID NOT NULL REFERENCES salons(id),
    starts_on   DATE NOT NULL,
    ends_on     DATE NOT NULL,
    status      pay_period_status NOT NULL DEFAULT 'OPEN',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on),
    UNIQUE (salon_id, starts_on, ends_on)
);

CREATE TABLE payroll_lines (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pay_period_id             UUID NOT NULL REFERENCES pay_periods(id),
    tech_id                   UUID NOT NULL REFERENCES staff(id),
    hours_worked              NUMERIC(7,2) NOT NULL CHECK (hours_worked >= 0),
    commission_wages_cents    BIGINT NOT NULL CHECK (commission_wages_cents >= 0),
    min_wage_floor_cents      BIGINT NOT NULL CHECK (min_wage_floor_cents >= 0),
    min_wage_topup_cents      BIGINT NOT NULL DEFAULT 0 CHECK (min_wage_topup_cents >= 0),
    overtime_hours            NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
    regular_rate_cents        BIGINT NOT NULL DEFAULT 0 CHECK (regular_rate_cents >= 0),
    overtime_premium_cents    BIGINT NOT NULL DEFAULT 0 CHECK (overtime_premium_cents >= 0),
    gross_pay_cents           BIGINT NOT NULL CHECK (gross_pay_cents >= 0),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pay_period_id, tech_id)
);
CREATE INDEX idx_payroll_tech ON payroll_lines(tech_id);

-- ---------------------------------------------------------------------------
-- Tip pooling (W-2 only). Daily pool + per-tech shares (largest-remainder so
-- shares sum exactly to the pool). 1099 contractors & owners excluded by law.
-- ---------------------------------------------------------------------------
CREATE TABLE tip_pools (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id              UUID NOT NULL REFERENCES salons(id),
    business_date         DATE NOT NULL,
    total_card_tips_cents BIGINT NOT NULL CHECK (total_card_tips_cents >= 0),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (salon_id, business_date)
);

CREATE TABLE tip_pool_shares (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tip_pool_id   UUID NOT NULL REFERENCES tip_pools(id),
    tech_id       UUID NOT NULL REFERENCES staff(id),
    hours         NUMERIC(7,2) NOT NULL CHECK (hours >= 0),
    share_cents   BIGINT NOT NULL CHECK (share_cents >= 0),
    UNIQUE (tip_pool_id, tech_id)
);

-- ---------------------------------------------------------------------------
-- Rent (1099) — agreement + recurring charges via the payment provider.
-- ---------------------------------------------------------------------------
CREATE TABLE rent_agreements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id       UUID NOT NULL REFERENCES salons(id),
    tech_id        UUID NOT NULL REFERENCES staff(id),
    amount_cents   BIGINT NOT NULL CHECK (amount_cents >= 0),
    cadence        rent_cadence NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    starts_on      DATE NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rent_tech ON rent_agreements(tech_id) WHERE is_active;

CREATE TABLE rent_charges (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rent_agreement_id    UUID NOT NULL REFERENCES rent_agreements(id),
    period_start         DATE NOT NULL,
    period_end           DATE NOT NULL,
    amount_cents         BIGINT NOT NULL CHECK (amount_cents >= 0),
    status               payout_status NOT NULL DEFAULT 'PENDING',
    provider_invoice_id  TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (rent_agreement_id, period_start)
);

-- ---------------------------------------------------------------------------
-- Payment ledger — provider-agnostic record of every money movement, so the
-- payment provider (Stripe Connect / Square / ...) can be swapped behind it.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_accounts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id             UUID NOT NULL REFERENCES staff(id),
    provider             TEXT NOT NULL,
    external_account_id  TEXT NOT NULL,   -- e.g. Stripe connected acct id
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, external_account_id)
);

CREATE TABLE payment_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id        UUID NOT NULL REFERENCES salons(id),
    kind            ledger_kind NOT NULL,
    ticket_id       UUID REFERENCES tickets(id),
    payout_id       UUID REFERENCES payout_records(id),
    rent_charge_id  UUID REFERENCES rent_charges(id),
    amount_cents    BIGINT NOT NULL,     -- signed: +in to salon, -out
    provider        TEXT,
    external_id     TEXT,
    status          payout_status NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_paytx_salon ON payment_transactions(salon_id, created_at);

COMMIT;

-- ----- migrations/0004_audit_immutability.sql -----
-- ============================================================================
-- Migration 0004_audit_immutability — audit log + append-only enforcement
-- (depends on 0003_payouts)
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only audit log. Every financially meaningful change writes a row.
-- before/after hold JSON snapshots; actor_staff_id is who did it.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    salon_id        UUID,
    actor_staff_id  UUID,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    action          TEXT NOT NULL,          -- INSERT | VOID | EXPORT | LOGIN ...
    before_json     JSONB,
    after_json      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_salon_time ON audit_log(salon_id, created_at);

-- ---------------------------------------------------------------------------
-- Immutability: financial records may be INSERTed but never UPDATEd/DELETEd.
-- Corrections happen by inserting a reversing record (e.g. a VOIDED ticket
-- plus negative commission/payout). This protects payroll & 1099 integrity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'Table % is append-only; insert a reversing record instead of % ',
        TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_mutation_commission
    BEFORE UPDATE OR DELETE ON commission_records
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE TRIGGER trg_block_mutation_payout
    BEFORE DELETE ON payout_records
    FOR EACH ROW EXECUTE FUNCTION block_mutation();
-- payout_records.status legitimately transitions (PENDING->PAID/FAILED/REVERSED),
-- so UPDATE is allowed there but DELETE is not.

CREATE TRIGGER trg_block_mutation_payroll
    BEFORE UPDATE OR DELETE ON payroll_lines
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE TRIGGER trg_block_mutation_tip_share
    BEFORE UPDATE OR DELETE ON tip_pool_shares
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE TRIGGER trg_block_mutation_audit
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- ---------------------------------------------------------------------------
-- Guard: time_entries are for W-2 staff only (PRD §1 — no 1099 wage hours).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_time_entry_w2_only() RETURNS trigger AS $$
DECLARE et employment_type;
BEGIN
    SELECT employment_type INTO et FROM staff WHERE id = NEW.tech_id;
    IF et <> 'W2' THEN
        RAISE EXCEPTION 'time_entries are W-2 only; tech % is %', NEW.tech_id, et;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entry_w2_only
    BEFORE INSERT OR UPDATE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION enforce_time_entry_w2_only();

COMMIT;

-- ----- migrations/0005_auth.sql -----
-- ============================================================================
-- Migration 0005_auth — credentials for login (depends on 0001_init)
-- ----------------------------------------------------------------------------
-- One credential per staff member. The role + salon used for authorization
-- live on the staff row already (staff.role, staff.salon_id); this table only
-- holds the password hash. Set/rotate via scripts/create-user.js.
-- ============================================================================
BEGIN;

CREATE TABLE staff_credentials (
    staff_id       UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;

-- ----- migrations/0006_refresh_tokens.sql -----
-- ============================================================================
-- Migration 0006_refresh_tokens — long-lived refresh tokens (depends on 0001)
-- ----------------------------------------------------------------------------
-- We store only a SHA-256 hash of each refresh token (high-entropy random
-- string, so a fast hash is fine — unlike passwords). Rotation revokes the old
-- row and inserts a new one on every /auth/refresh.
-- ============================================================================
BEGIN;

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id    UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_staff ON refresh_tokens(staff_id) WHERE NOT revoked;

COMMIT;

-- ----- migrations/0007_salon_timezone.sql -----
-- ============================================================================
-- Migration 0007_salon_timezone — owner-configurable timezone (depends on 0001)
-- The workweek anchor (Mon 00:00) and "today" are computed in this IANA zone,
-- so FLSA weeks and daily tip pools line up with the salon's local calendar.
-- ============================================================================
BEGIN;

ALTER TABLE salon_settings
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York';

COMMIT;

-- ----- seed.sql -----
-- ============================================================================
-- seed.sql — demo data mirroring SalonPOS.jsx (run after 0001–0004)
-- ============================================================================
BEGIN;

-- Salon
INSERT INTO salons (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Polished Nail Bar');

-- Settings (2.9% + $0.30 card fee, 10% product cost, $16/hr min wage)
INSERT INTO salon_settings
    (salon_id, cc_fee_pct_bps, cc_fee_fixed_cents, product_cost_pct_bps,
     min_wage_cents_per_hour, tip_pooling_enabled)
VALUES
    ('00000000-0000-0000-0000-000000000001', 290, 30, 1000, 1600, false);

-- Staff (one OWNER to log in as, plus the techs). Owners are modeled as W-2
-- with a 0% commission profile so the pay_profile_shape CHECK is satisfied.
INSERT INTO staff (id, salon_id, full_name, email, role, employment_type) VALUES
 ('00000000-0000-0000-0000-0000000000f0','00000000-0000-0000-0000-000000000001','Owner Admin','owner@polished.test','OWNER','W2'),
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Mai Tran','mai@polished.test','TECH','W2'),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','Linda Pham','linda@polished.test','TECH','W2'),
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','Kevin Ng','kevin@polished.test','TECH','CONTRACTOR_1099');

-- Pay profiles: W-2 commission rates; 1099 chair rent
INSERT INTO staff_pay_profiles
    (staff_id, employment_type, service_commission_bps, retail_commission_bps, rent_amount_cents, rent_cadence)
VALUES
 ('00000000-0000-0000-0000-0000000000f0','W2', 0, 0, NULL, NULL),
 ('00000000-0000-0000-0000-0000000000a1','W2', 5000, 1000, NULL, NULL),
 ('00000000-0000-0000-0000-0000000000a2','W2', 4500, 1000, NULL, NULL),
 ('00000000-0000-0000-0000-0000000000a3','CONTRACTOR_1099', NULL, NULL, 25000, 'WEEKLY');

-- Active rent agreement for the 1099 renter ($250/week)
INSERT INTO rent_agreements (salon_id, tech_id, amount_cents, cadence, starts_on)
VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a3',25000,'WEEKLY', CURRENT_DATE);

COMMIT;

-- ----- owner login (CHANGE the password below) -----
INSERT INTO staff_credentials (staff_id, password_hash)
VALUES ('00000000-0000-0000-0000-0000000000f0', crypt('CHANGE_ME_password', gen_salt('bf', 10)))
ON CONFLICT (staff_id) DO UPDATE SET password_hash = EXCLUDED.password_hash;
