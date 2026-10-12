CREATE TABLE player_identity_segments (
  id TEXT PRIMARY KEY NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  uid_snapshot TEXT NOT NULL CHECK(length(trim(uid_snapshot)) > 0),
  boundary_tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  ign_snapshot TEXT NOT NULL CHECK(length(trim(ign_snapshot)) BETWEEN 1 AND 120),
  team_id TEXT NOT NULL REFERENCES teams(id),
  UNIQUE(id, player_id)
);

CREATE TABLE player_identity_tournaments (
  player_id TEXT NOT NULL REFERENCES players(id),
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  segment_id TEXT NOT NULL,
  PRIMARY KEY(player_id, tournament_id),
  FOREIGN KEY(segment_id, player_id) REFERENCES player_identity_segments(id, player_id)
);

CREATE INDEX player_identity_segments_player ON player_identity_segments(player_id);

CREATE TABLE tournament_rosters_public (
  tournament_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  ign_snapshot TEXT NOT NULL CHECK(length(trim(ign_snapshot)) BETWEEN 1 AND 120),
  position INTEGER CHECK(position IS NULL OR position BETWEEN 1 AND 7),
  PRIMARY KEY(tournament_id, player_id),
  UNIQUE(tournament_id, team_id, position),
  FOREIGN KEY(tournament_id, team_id) REFERENCES tournament_teams(tournament_id, team_id) ON DELETE CASCADE
);

INSERT INTO tournament_rosters_public(tournament_id,team_id,player_id,ign_snapshot,position)
SELECT tournament_id,team_id,player_id,ign_snapshot,position FROM tournament_rosters;
DROP TABLE tournament_rosters;
ALTER TABLE tournament_rosters_public RENAME TO tournament_rosters;
