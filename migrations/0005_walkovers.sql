ALTER TABLE matches ADD COLUMN result_type TEXT NOT NULL DEFAULT 'played'
  CHECK (result_type IN ('played','walkover'));

-- Unplayed slots are separate from combat maps; a map name can be unknown.
CREATE TABLE match_map_walkovers (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  map_number INTEGER NOT NULL CHECK (map_number BETWEEN 1 AND 3),
  map_id TEXT REFERENCES maps(id),
  winner_team_id TEXT NOT NULL REFERENCES teams(id),
  PRIMARY KEY (match_id, map_number)
);

CREATE TRIGGER walkover_slot_guard BEFORE INSERT ON match_map_walkovers BEGIN
  SELECT RAISE(ABORT, 'Invalid walkover slot') WHERE
    EXISTS (SELECT 1 FROM match_maps WHERE match_id=NEW.match_id AND map_number=NEW.map_number)
    OR EXISTS (SELECT 1 FROM player_round_stats WHERE match_id=NEW.match_id AND map_number=NEW.map_number)
    OR NOT EXISTS (SELECT 1 FROM matches WHERE id=NEW.match_id AND result_type='played'
      AND NEW.winner_team_id IN (team1_id,team2_id));
END;
CREATE TRIGGER walkover_combat_guard BEFORE INSERT ON player_round_stats BEGIN
  SELECT RAISE(ABORT, 'W/O cannot contain combat stats') WHERE
    EXISTS (SELECT 1 FROM match_map_walkovers WHERE match_id=NEW.match_id AND map_number=NEW.map_number)
    OR EXISTS (SELECT 1 FROM matches WHERE id=NEW.match_id AND result_type='walkover');
END;
CREATE TRIGGER walkover_participation_guard BEFORE INSERT ON player_match_entries BEGIN
  SELECT RAISE(ABORT, 'Full-match W/O cannot contain participation') WHERE
    EXISTS (SELECT 1 FROM matches WHERE id=NEW.match_id AND result_type='walkover');
END;
CREATE TRIGGER played_slot_guard BEFORE INSERT ON match_maps BEGIN
  SELECT RAISE(ABORT, 'Invalid played slot') WHERE
    EXISTS (SELECT 1 FROM match_map_walkovers WHERE match_id=NEW.match_id AND map_number=NEW.map_number)
    OR EXISTS (SELECT 1 FROM matches WHERE id=NEW.match_id AND result_type='walkover');
END;
