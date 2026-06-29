-- ============================================================================
-- Migration 0004_audit_immutability — audit log + append-only enforcement
-- (depends on 0003_payouts)
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Append-only audit log. Every financially meaningful change writes a row.
-- before/after hold JSON snapshots; actor_staff_id is who did it.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    salon_id        UUID,
    actor_staff_id  UUID,
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    action          TEXT NOT NULL,          -- INSERT | VOID | EXPORT | LOGIN ...
    before_json     JSONB,
    after_json      JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_salon_time ON audit_log(salon_id, created_at);

-- ---------------------------------------------------------------------------
-- Immutability: financial records may be INSERTed but never UPDATEd/DELETEd.
-- Corrections happen by inserting a reversing record (e.g. a VOIDED ticket
-- plus negative commission/payout). This protects payroll & 1099 integrity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
        'Table % is append-only; insert a reversing record instead of % ',
        TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_mutation_commission
    BEFORE UPDATE OR DELETE ON commission_records
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE TRIGGER trg_block_mutation_payout
    BEFORE DELETE ON payout_records
    FOR EACH ROW EXECUTE FUNCTION block_mutation();
-- payout_records.status legitimately transitions (PENDING->PAID/FAILED/REVERSED),
-- so UPDATE is allowed there but DELETE is not.

CREATE TRIGGER trg_block_mutation_payroll
    BEFORE UPDATE OR DELETE ON payroll_lines
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE TRIGGER trg_block_mutation_tip_share
    BEFORE UPDATE OR DELETE ON tip_pool_shares
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

CREATE TRIGGER trg_block_mutation_audit
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION block_mutation();

-- ---------------------------------------------------------------------------
-- Guard: time_entries are for W-2 staff only (PRD §1 — no 1099 wage hours).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_time_entry_w2_only() RETURNS trigger AS $$
DECLARE et employment_type;
BEGIN
    SELECT employment_type INTO et FROM staff WHERE id = NEW.tech_id;
    IF et <> 'W2' THEN
        RAISE EXCEPTION 'time_entries are W-2 only; tech % is %', NEW.tech_id, et;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_time_entry_w2_only
    BEFORE INSERT OR UPDATE ON time_entries
    FOR EACH ROW EXECUTE FUNCTION enforce_time_entry_w2_only();

COMMIT;
