-- ============================================================================
-- Migration 0004_audit — audit log + append-only payments
-- (depends on 0003_orders)
-- ============================================================================
BEGIN;

CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    restaurant_id   UUID,
    actor_staff_id  UUID,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    action          TEXT NOT NULL,          -- CREATE | PAY | VOID | SET_PASSWORD ...
    before_json     JSONB,
    after_json      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_restaurant_time ON audit_log(restaurant_id, created_at);

-- Payments are financial records: insert only, never update/delete. Refunds are
-- modeled as new (negative) payment rows so history stays intact.
CREATE OR REPLACE FUNCTION block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'Table % is append-only; insert a reversing record instead of %',
        TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_mutation_payments
    BEFORE UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

COMMIT;
