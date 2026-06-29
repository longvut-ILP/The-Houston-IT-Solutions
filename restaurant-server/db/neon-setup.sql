-- =============================================================
-- neon-setup.sql — run ONCE in the Neon SQL editor to create the
-- Restaurant POS schema + a demo restaurant. Afterwards either use
-- "Create restaurant" in the app, or set the demo owner password at
-- the bottom of this file.
-- =============================================================

-- ===== 0001_init: tenants, settings, staff, credentials =====
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE staff_role AS ENUM ('OWNER', 'ADMIN', 'STAFF');

CREATE TABLE restaurants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    timezone    TEXT NOT NULL DEFAULT 'America/Chicago',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE restaurant_settings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID NOT NULL REFERENCES restaurants(id),
    tax_pct_bps         INT  NOT NULL DEFAULT 825  CHECK (tax_pct_bps BETWEEN 0 AND 10000),
    cc_fee_pct_bps      INT  NOT NULL DEFAULT 290  CHECK (cc_fee_pct_bps BETWEEN 0 AND 10000),
    cc_fee_fixed_cents  BIGINT NOT NULL DEFAULT 30 CHECK (cc_fee_fixed_cents >= 0),
    is_current          BOOLEAN NOT NULL DEFAULT true,
    effective_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
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

CREATE TABLE staff_credentials (
    staff_id       UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== 0002_menu: categories, items, modifier groups =====
CREATE TABLE menu_categories (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurants(id),
    name           TEXT NOT NULL,
    sort_order     INT  NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_categories_restaurant ON menu_categories(restaurant_id);

CREATE TABLE menu_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurants(id),
    category_id    UUID REFERENCES menu_categories(id),
    name           TEXT NOT NULL,
    price_cents    BIGINT NOT NULL CHECK (price_cents >= 0),
    sort_order     INT  NOT NULL DEFAULT 0,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_items_restaurant ON menu_items(restaurant_id);
CREATE INDEX idx_items_category ON menu_items(category_id);

CREATE TABLE modifier_groups (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id  UUID NOT NULL REFERENCES restaurants(id),
    item_id        UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    min_select     INT NOT NULL DEFAULT 0,
    max_select     INT NOT NULL DEFAULT 1,
    sort_order     INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_modgroups_item ON modifier_groups(item_id);

CREATE TABLE modifiers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id           UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    price_delta_cents  BIGINT NOT NULL DEFAULT 0,
    sort_order         INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_modifiers_group ON modifiers(group_id);

-- ===== 0003_orders: orders, items, modifiers, payments =====
CREATE TYPE order_status AS ENUM ('OPEN', 'IN_KITCHEN', 'READY', 'COMPLETED', 'VOIDED');
CREATE TYPE kitchen_status AS ENUM ('QUEUED', 'READY');
CREATE TYPE payment_method AS ENUM ('CARD', 'CASH');

CREATE TABLE order_counters (
    restaurant_id  UUID PRIMARY KEY REFERENCES restaurants(id),
    next_number    INT NOT NULL DEFAULT 1
);

CREATE TABLE orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
    order_number    INT  NOT NULL,
    status          order_status NOT NULL DEFAULT 'OPEN',
    customer_label  TEXT,
    subtotal_cents  BIGINT NOT NULL DEFAULT 0,
    tax_cents       BIGINT NOT NULL DEFAULT 0,
    tip_cents       BIGINT NOT NULL DEFAULT 0,
    card_fee_cents  BIGINT NOT NULL DEFAULT 0,
    total_cents     BIGINT NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES staff(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    UNIQUE (restaurant_id, order_number)
);
CREATE INDEX idx_orders_restaurant_status ON orders(restaurant_id, status);
CREATE INDEX idx_orders_restaurant_time ON orders(restaurant_id, created_at);

CREATE TABLE order_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id         UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id     UUID REFERENCES menu_items(id),
    name_snapshot    TEXT NOT NULL,
    unit_price_cents BIGINT NOT NULL,
    quantity         INT NOT NULL CHECK (quantity > 0),
    line_total_cents BIGINT NOT NULL,
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

CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
    order_id        UUID NOT NULL REFERENCES orders(id),
    method          payment_method NOT NULL,
    amount_cents    BIGINT NOT NULL,
    tip_cents       BIGINT NOT NULL DEFAULT 0,
    card_fee_cents  BIGINT NOT NULL DEFAULT 0,
    created_by      UUID REFERENCES staff(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_restaurant_time ON payments(restaurant_id, created_at);
CREATE INDEX idx_payments_order ON payments(order_id);

-- ===== 0004_audit: audit log + append-only payments =====
CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    restaurant_id   UUID,
    actor_staff_id  UUID,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    action          TEXT NOT NULL,
    before_json     JSONB,
    after_json      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_restaurant_time ON audit_log(restaurant_id, created_at);

CREATE OR REPLACE FUNCTION block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Table % is append-only; insert a reversing record instead of %',
        TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_mutation_payments
    BEFORE UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- ===== seed: demo restaurant + owner + small menu =====
INSERT INTO restaurants (id, name, timezone)
VALUES ('00000000-0000-0000-0000-0000000000a0', 'Bayou Brew (Demo)', 'America/Chicago');

INSERT INTO order_counters (restaurant_id, next_number)
VALUES ('00000000-0000-0000-0000-0000000000a0', 101);

INSERT INTO restaurant_settings (restaurant_id, tax_pct_bps, cc_fee_pct_bps, cc_fee_fixed_cents)
VALUES ('00000000-0000-0000-0000-0000000000a0', 825, 290, 30);

INSERT INTO staff (id, restaurant_id, full_name, email, role)
VALUES ('00000000-0000-0000-0000-0000000000b0',
        '00000000-0000-0000-0000-0000000000a0',
        'Demo Owner', 'owner@bayoubrew.test', 'OWNER');

INSERT INTO staff_credentials (staff_id, password_hash)
VALUES ('00000000-0000-0000-0000-0000000000b0',
        crypt('CHANGE_ME_password', gen_salt('bf', 10)));

INSERT INTO menu_categories (id, restaurant_id, name, sort_order) VALUES
 ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000000a0', 'Coffee', 1),
 ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000000a0', 'Food',   2);

INSERT INTO menu_items (restaurant_id, category_id, name, price_cents, sort_order) VALUES
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0001', 'Drip Coffee',    295, 1),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0001', 'Latte',          475, 2),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0001', 'Cold Brew',      445, 3),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0002', 'Croissant',      395, 1),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0002', 'Breakfast Taco', 350, 2),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0002', 'Avocado Toast',  850, 3);

-- ----- OPTIONAL: set the demo owner password (login: owner@bayoubrew.test) -----
-- UPDATE staff_credentials SET password_hash = crypt('your_password', gen_salt('bf',10))
--   WHERE staff_id = '00000000-0000-0000-0000-0000000000b0';
