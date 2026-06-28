-- ============================================================================
-- Migration 0007_salon_timezone — owner-configurable timezone (depends on 0001)
-- The workweek anchor (Mon 00:00) and "today" are computed in this IANA zone,
-- so FLSA weeks and daily tip pools line up with the salon's local calendar.
-- ============================================================================
BEGIN;

ALTER TABLE salon_settings
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York';

COMMIT;
