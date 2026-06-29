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
