CREATE TABLE match_detail_edits (
  match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft','complete')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  revision INTEGER NOT NULL CHECK (revision > 0)
);
