CREATE TABLE match_correction_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id),
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  correction_type TEXT NOT NULL CHECK (correction_type IN ('details','series-result','winner')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  old_state TEXT NOT NULL CHECK (json_valid(old_state)),
  new_state TEXT NOT NULL CHECK (json_valid(new_state))
);
CREATE INDEX idx_match_correction_audit_match ON match_correction_audit(match_id,id);
CREATE TRIGGER correction_audit_no_update BEFORE UPDATE ON match_correction_audit BEGIN
  SELECT RAISE(ABORT,'Correction history is append-only');
END;
CREATE TRIGGER correction_audit_no_delete BEFORE DELETE ON match_correction_audit BEGIN
  SELECT RAISE(ABORT,'Correction history is append-only');
END;
