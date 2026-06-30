-- ============================================================================
-- Migration 0005_edits — order discounts/corrections
-- (depends on 0003_orders). Run this on databases created before this change.
-- ============================================================================
BEGIN;

ALTER TABLE orders   ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS discount_cents BIGINT NOT NULL DEFAULT 0;

COMMIT;
