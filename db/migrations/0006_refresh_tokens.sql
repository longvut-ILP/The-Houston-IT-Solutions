-- ============================================================================
-- Migration 0006_refresh_tokens — long-lived refresh tokens (depends on 0001)
-- ----------------------------------------------------------------------------
-- We store only a SHA-256 hash of each refresh token (high-entropy random
-- string, so a fast hash is fine — unlike passwords). Rotation revokes the old
-- row and inserts a new one on every /auth/refresh.
-- ============================================================================
BEGIN;

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id    UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_staff ON refresh_tokens(staff_id) WHERE NOT revoked;

COMMIT;
