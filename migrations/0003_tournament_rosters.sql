CREATE TABLE tournament_rosters (
  tournament_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  ign_snapshot TEXT NOT NULL CHECK (length(trim(ign_snapshot)) BETWEEN 1 AND 120),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 7),
  PRIMARY KEY (tournament_id, player_id),
  UNIQUE (tournament_id, team_id, position),
  FOREIGN KEY (tournament_id, team_id) REFERENCES tournament_teams(tournament_id, team_id) ON DELETE CASCADE
);
