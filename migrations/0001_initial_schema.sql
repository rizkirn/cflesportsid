PRAGMA foreign_keys = ON;

CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'crossfire-legends',
  region TEXT NOT NULL DEFAULT 'ID',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('upcoming','ongoing','completed')),
  format TEXT NOT NULL,
  winner_team_id TEXT REFERENCES teams(id)
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,
  color TEXT,
  logo TEXT,
  region TEXT NOT NULL,
  founded TEXT,
  description TEXT
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  uid TEXT UNIQUE,
  name TEXT NOT NULL,
  current_ign TEXT NOT NULL,
  current_team_id TEXT REFERENCES teams(id),
  role TEXT NOT NULL DEFAULT 'Player',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  avatar TEXT,
  country TEXT,
  bio TEXT,
  discord TEXT,
  twitter TEXT,
  youtube TEXT,
  twitch TEXT
);

CREATE TABLE maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'crossfire-legends',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  thumbnail TEXT
);

CREATE TABLE tournament_stages (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  bracket_size INTEGER NOT NULL,
  series_type TEXT NOT NULL,
  map_count INTEGER NOT NULL,
  final_map_rule TEXT,
  action_seconds INTEGER,
  reserve_seconds INTEGER,
  PRIMARY KEY (tournament_id, id)
);

CREATE TABLE tournament_rounds (
  tournament_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  placement INTEGER,
  PRIMARY KEY (tournament_id, stage_id, id),
  FOREIGN KEY (tournament_id, stage_id)
    REFERENCES tournament_stages(tournament_id, id) ON DELETE CASCADE
);

CREATE TABLE tournament_teams (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (tournament_id, team_id)
);

CREATE TABLE tournament_byes (
  tournament_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (tournament_id, stage_id, id),
  FOREIGN KEY (tournament_id, stage_id, round_id)
    REFERENCES tournament_rounds(tournament_id, stage_id, id) ON DELETE CASCADE
);

CREATE TABLE stage_map_pool (
  tournament_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id),
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, stage_id, map_id),
  FOREIGN KEY (tournament_id, stage_id)
    REFERENCES tournament_stages(tournament_id, id) ON DELETE CASCADE
);

CREATE TABLE veto_steps (
  tournament_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  team_side TEXT NOT NULL CHECK (team_side IN ('A','B')),
  action TEXT NOT NULL CHECK (action IN ('ban','pick')),
  PRIMARY KEY (tournament_id, stage_id, step_order),
  FOREIGN KEY (tournament_id, stage_id)
    REFERENCES tournament_stages(tournament_id, id) ON DELETE CASCADE
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  bracket_slot INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('upcoming','live','completed')),
  team1_id TEXT REFERENCES teams(id),
  team2_id TEXT REFERENCES teams(id),
  score1 INTEGER NOT NULL DEFAULT 0,
  score2 INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT REFERENCES teams(id),
  duration TEXT,
  FOREIGN KEY (tournament_id, stage_id, round_id)
    REFERENCES tournament_rounds(tournament_id, stage_id, id)
);

CREATE TABLE match_sources (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side INTEGER NOT NULL CHECK (side IN (1,2)),
  source_type TEXT NOT NULL CHECK (source_type IN ('winner','loser','bye')),
  source_match_id TEXT REFERENCES matches(id),
  source_bye_id TEXT,
  PRIMARY KEY (match_id, side)
);

CREATE TABLE match_maps (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  map_number INTEGER NOT NULL,
  map_id TEXT NOT NULL REFERENCES maps(id),
  winner_team_id TEXT REFERENCES teams(id),
  score_team1 INTEGER,
  score_team2 INTEGER,
  mvp_player_id TEXT REFERENCES players(id),
  result_note TEXT,
  PRIMARY KEY (match_id, map_number)
);

CREATE TABLE player_map_stats (
  match_id TEXT NOT NULL,
  map_number INTEGER NOT NULL,
  player_id TEXT,
  team_id TEXT REFERENCES teams(id),
  uid_snapshot TEXT,
  ign_snapshot TEXT,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, map_number, player_id),
  FOREIGN KEY (match_id, map_number)
    REFERENCES match_maps(match_id, map_number) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE team_penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  points INTEGER NOT NULL,
  reason TEXT NOT NULL
);

CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_player_map_stats_player ON player_map_stats(player_id);
CREATE INDEX idx_player_map_stats_team ON player_map_stats(team_id);
CREATE INDEX idx_match_maps_map ON match_maps(map_id);
