-- ============================================================================
-- Migration 0002_menu — categories, items, and optional modifier groups
-- (depends on 0001_init)
-- ============================================================================
BEGIN;

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

-- Optional modifier groups (e.g. "Size", "Add-ons") attached to an item.
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

COMMIT;
