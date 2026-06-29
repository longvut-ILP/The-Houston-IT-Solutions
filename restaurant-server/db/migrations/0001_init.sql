-- ============================================================================
-- Migration 0001_init — tenants (restaurants), settings, staff, credentials
-- Quick-service Restaurant POS. Money is integer cents; rates are basis points.
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid() + crypt()

CREATE TYPE staff_role AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- One row per restaurant (tenant). Everything else is scoped by restaurant_id.
CREATE TABLE restaurants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    timezone    TEXT NOT NULL DEFAULT 'America/Chicago',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Versioned settings: tax + card-processing cost. Only one row is_current.
CREATE TABLE restaurant_settings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID NOT NULL REFERENCES restaurants(id),
    tax_pct_bps         INT  NOT NULL DEFAULT 825  CHECK (tax_pct_bps BETWEEN 0 AND 10000),
    cc_fee_pct_bps      INT  NOT NULL DEFAULT 290  CHECK (cc_fee_pct_bps BETWEEN 0 AND 10000),
    cc_fee_fixed_cents  BIGINT NOT NULL DEFAULT 30 CHECK (cc_fee_fixed_cents >= 0),
    is_current          BOOLEAN NOT NULL DEFAULT true,
    effective_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Guarantee a single current settings row per restaurant.
CREATE UNIQUE INDEX uq_settings_current
    ON restaurant_settings(restaurant_id) WHERE is_current;

CREATE TABLE staff (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurants(id),
    full_name      TEXT NOT NULL,
    email          TEXT,
    role           staff_role NOT NULL DEFAULT 'STAFF',
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (restaurant_id, email)
);

-- One login per staff member (password hash only; role/tenant live on staff).
CREATE TABLE staff_credentials (
    staff_id       UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
