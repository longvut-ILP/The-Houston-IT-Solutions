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
