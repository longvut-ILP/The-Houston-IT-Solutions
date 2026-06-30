-- ============================================================================
-- Migration 0008_ticket_discount — discounts/corrections at checkout
-- (depends on 0002_sales). Run on databases created before this change.
-- ============================================================================
BEGIN;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS discount_cents      BIGINT NOT NULL DEFAULT 0;
-- 'TICKET' (service+retail) or 'SERVICE' only
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS discount_applies_to TEXT;
-- 'TECH' (commission on discounted revenue) or 'HOUSE' (salon absorbs it)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS discount_absorb     TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS discount_reason     TEXT;

COMMIT;
