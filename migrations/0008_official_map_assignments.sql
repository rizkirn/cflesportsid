CREATE TABLE official_map_assignments (
 id TEXT PRIMARY KEY,
 tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
 stage_id TEXT NOT NULL,
 round_id TEXT NOT NULL,
 match_id TEXT REFERENCES matches(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(source IN('randomizer','veto')),
 scope TEXT NOT NULL CHECK(scope IN('round','match')),
 team1_id TEXT REFERENCES teams(id),
 team2_id TEXT REFERENCES teams(id),
 maps TEXT NOT NULL CHECK(json_valid(maps) AND json_array_length(maps)=3),
 actions TEXT NOT NULL CHECK(json_valid(actions)),
 confirmed_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(tournament_id,stage_id,round_id) REFERENCES tournament_rounds(tournament_id,stage_id,id) ON DELETE CASCADE,
 CHECK((scope='round' AND source='randomizer' AND match_id IS NULL AND team1_id IS NULL AND team2_id IS NULL)
 OR(scope='match' AND source='veto' AND match_id IS NOT NULL AND team1_id IS NOT NULL AND team2_id IS NOT NULL))
);
CREATE UNIQUE INDEX official_round_maps ON official_map_assignments(tournament_id,stage_id,round_id) WHERE scope='round';
CREATE UNIQUE INDEX official_match_maps ON official_map_assignments(match_id) WHERE scope='match';
