-- Basic import integrity
SELECT 'tournaments' AS metric, COUNT(*) AS value FROM tournaments
UNION ALL SELECT 'teams', COUNT(*) FROM teams
UNION ALL SELECT 'players', COUNT(*) FROM players
UNION ALL SELECT 'maps', COUNT(*) FROM maps
UNION ALL SELECT 'matches', COUNT(*) FROM matches
UNION ALL SELECT 'match_maps', COUNT(*) FROM match_maps
UNION ALL SELECT 'player_map_stats', COUNT(*) FROM player_map_stats;

-- Career player totals. This mirrors src/utils/statistics.ts for K/D/A,
-- maps played and MVP count using completed matches only.
SELECT
  p.id AS player_id,
  p.current_ign,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN s.kills ELSE 0 END), 0) AS kills,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN s.deaths ELSE 0 END), 0) AS deaths,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN s.assists ELSE 0 END), 0) AS assists,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN 1 ELSE 0 END), 0) AS maps_played,
  (
    SELECT COUNT(*)
    FROM match_maps mm
    JOIN matches mx ON mx.id = mm.match_id
    WHERE mx.status = 'completed' AND mm.mvp_player_id = p.id
  ) AS mvp_count
FROM players p
LEFT JOIN player_map_stats s ON s.player_id = p.id
LEFT JOIN matches m ON m.id = s.match_id
GROUP BY p.id
ORDER BY kills DESC, deaths ASC;

-- Tournament totals make S1/S2 comparison easy.
SELECT
  m.tournament_id,
  COUNT(DISTINCT m.id) AS completed_matches,
  COUNT(DISTINCT mm.match_id || ':' || mm.map_number) AS maps,
  COALESCE(SUM(s.kills), 0) AS kills,
  COALESCE(SUM(s.deaths), 0) AS deaths,
  COALESCE(SUM(s.assists), 0) AS assists
FROM matches m
LEFT JOIN match_maps mm ON mm.match_id = m.id
LEFT JOIN player_map_stats s ON s.match_id = mm.match_id AND s.map_number = mm.map_number
WHERE m.status = 'completed'
GROUP BY m.tournament_id
ORDER BY m.tournament_id;
