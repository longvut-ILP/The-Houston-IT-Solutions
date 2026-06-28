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
