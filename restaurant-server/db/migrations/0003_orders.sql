-- ============================================================================
-- Migration 0003_orders — orders, line items, modifiers, payments
-- (depends on 0002_menu)
-- ============================================================================
BEGIN;

CREATE TYPE order_status AS ENUM ('OPEN', 'IN_KITCHEN', 'READY', 'COMPLETED', 'VOIDED');
CREATE TYPE kitchen_status AS ENUM ('QUEUED', 'READY');
CREATE TYPE payment_method AS ENUM ('CARD', 'CASH');

-- Per-restaurant incrementing order number, human-friendly on tickets.
CREATE TABLE order_counters (
    restaurant_id  UUID PRIMARY KEY REFERENCES restaurants(id),
    next_number    INT NOT NULL DEFAULT 1
);

CREATE TABLE orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
    order_number    INT  NOT NULL,
    status          order_status NOT NULL DEFAULT 'OPEN',
    customer_label  TEXT,                         -- name called out, e.g. "Mike"
    subtotal_cents  BIGINT NOT NULL DEFAULT 0,
    tax_cents       BIGINT NOT NULL DEFAULT 0,
    tip_cents       BIGINT NOT NULL DEFAULT 0,
    card_fee_cents  BIGINT NOT NULL DEFAULT 0,
    total_cents     BIGINT NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES staff(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,                  -- when fired to the kitchen
    closed_at       TIMESTAMPTZ,                  -- when paid/completed
    UNIQUE (restaurant_id, order_number)
);
CREATE INDEX idx_orders_restaurant_status ON orders(restaurant_id, status);
CREATE INDEX idx_orders_restaurant_time ON orders(restaurant_id, created_at);

CREATE TABLE order_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id     UUID REFERENCES menu_items(id),
    name_snapshot    TEXT NOT NULL,               -- name at time of order
    unit_price_cents BIGINT NOT NULL,             -- base price snapshot
    quantity         INT NOT NULL CHECK (quantity > 0),
    line_total_cents BIGINT NOT NULL,             -- (base + mods) * qty
    kitchen_status   kitchen_status NOT NULL DEFAULT 'QUEUED',
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_item_modifiers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id      UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    modifier_id        UUID REFERENCES modifiers(id),
    name_snapshot      TEXT NOT NULL,
    price_delta_cents  BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX idx_oimods_item ON order_item_modifiers(order_item_id);

-- Payments are append-only money records (see 0004 immutability triggers).
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
    order_id        UUID NOT NULL REFERENCES orders(id),
    method          payment_method NOT NULL,
    amount_cents    BIGINT NOT NULL,             -- subtotal + tax + tip
    tip_cents       BIGINT NOT NULL DEFAULT 0,
    card_fee_cents  BIGINT NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES staff(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_restaurant_time ON payments(restaurant_id, created_at);
CREATE INDEX idx_payments_order ON payments(order_id);

COMMIT;
