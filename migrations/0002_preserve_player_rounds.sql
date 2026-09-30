CREATE TABLE player_match_entries (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  entry_index INTEGER NOT NULL,
  player_id TEXT REFERENCES players(id),
  team_id TEXT REFERENCES teams(id),
  uid_snapshot TEXT,
  ign_snapshot TEXT,
  PRIMARY KEY (match_id, entry_index)
);

INSERT INTO player_match_entries
SELECT match_id,
       ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY player_id, team_id, uid_snapshot, ign_snapshot) - 1,
       player_id, team_id, uid_snapshot, ign_snapshot
FROM (SELECT DISTINCT match_id, player_id, team_id, uid_snapshot, ign_snapshot FROM player_map_stats);

CREATE TABLE player_round_stats (
  match_id TEXT NOT NULL,
  entry_index INTEGER NOT NULL,
  round_index INTEGER NOT NULL,
  map_number INTEGER,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, entry_index, round_index),
  FOREIGN KEY (match_id, entry_index) REFERENCES player_match_entries(match_id, entry_index) ON DELETE CASCADE,
  FOREIGN KEY (match_id, map_number) REFERENCES match_maps(match_id, map_number) ON DELETE CASCADE
);

INSERT INTO player_round_stats
SELECT s.match_id, e.entry_index,
       ROW_NUMBER() OVER (PARTITION BY s.match_id, e.entry_index ORDER BY s.map_number) - 1,
       s.map_number, s.kills, s.deaths, s.assists
FROM player_map_stats s
JOIN player_match_entries e ON e.match_id = s.match_id
 AND e.player_id IS s.player_id AND e.team_id IS s.team_id
 AND e.uid_snapshot IS s.uid_snapshot AND e.ign_snapshot IS s.ign_snapshot;

DROP TABLE player_map_stats;
CREATE VIEW player_map_stats AS
SELECT r.match_id, r.map_number, e.player_id, e.team_id, e.uid_snapshot, e.ign_snapshot,
       r.kills, r.deaths, r.assists, r.entry_index, r.round_index
FROM player_round_stats r
JOIN player_match_entries e ON e.match_id = r.match_id AND e.entry_index = r.entry_index;

CREATE INDEX idx_player_match_entries_player ON player_match_entries(player_id);
CREATE INDEX idx_player_match_entries_team ON player_match_entries(team_id);
CREATE INDEX idx_player_round_stats_map ON player_round_stats(match_id, map_number);

UPDATE match_maps SET score_team1 = NULL, score_team2 = NULL;
