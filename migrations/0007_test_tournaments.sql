ALTER TABLE tournaments ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0,1));

CREATE TRIGGER tournament_test_immutable BEFORE UPDATE OF is_test ON tournaments
WHEN NEW.is_test <> OLD.is_test BEGIN
  SELECT RAISE(ABORT,'Tournament test flag is immutable');
END;
CREATE TRIGGER official_tournament_no_delete BEFORE DELETE ON tournaments
WHEN OLD.is_test = 0 BEGIN
  SELECT RAISE(ABORT,'Official tournaments cannot be deleted');
END;

-- History remains append-only except as part of permanent test-data cleanup.
DROP TRIGGER correction_audit_no_delete;
CREATE TRIGGER correction_audit_no_delete BEFORE DELETE ON match_correction_audit
WHEN NOT EXISTS (SELECT 1 FROM tournaments WHERE id=OLD.tournament_id AND is_test=1) BEGIN
  SELECT RAISE(ABORT,'Correction history is append-only');
END;
