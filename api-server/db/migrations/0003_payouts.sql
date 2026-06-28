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
