-- ============================================================================
-- Migration 0005_auth — credentials for login (depends on 0001_init)
-- ----------------------------------------------------------------------------
-- One credential per staff member. The role + salon used for authorization
-- live on the staff row already (staff.role, staff.salon_id); this table only
-- holds the password hash. Set/rotate via scripts/create-user.js.
-- ============================================================================
BEGIN;

CREATE TABLE staff_credentials (
    staff_id       UUID PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
