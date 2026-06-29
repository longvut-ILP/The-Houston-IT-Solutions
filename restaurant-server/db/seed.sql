-- ============================================================================
-- seed.sql — a demo restaurant with an owner login and a small menu.
-- The owner password is a placeholder; set a real one after loading (see
-- neon-setup.sql / the create-restaurant signup flow).
-- ============================================================================
BEGIN;

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

-- placeholder password — replace before real use
INSERT INTO staff_credentials (staff_id, password_hash)
VALUES ('00000000-0000-0000-0000-0000000000b0',
        crypt('CHANGE_ME_password', gen_salt('bf', 10)));

-- categories
INSERT INTO menu_categories (id, restaurant_id, name, sort_order) VALUES
 ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-0000000000a0', 'Coffee', 1),
 ('00000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-0000000000a0', 'Food',   2);

-- items (prices in cents)
INSERT INTO menu_items (restaurant_id, category_id, name, price_cents, sort_order) VALUES
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0001', 'Drip Coffee',   295, 1),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0001', 'Latte',         475, 2),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0001', 'Cold Brew',     445, 3),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0002', 'Croissant',     395, 1),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0002', 'Breakfast Taco',350, 2),
 ('00000000-0000-0000-0000-0000000000a0', '00000000-0000-0000-0000-0000000c0002', 'Avocado Toast', 850, 3);

COMMIT;
