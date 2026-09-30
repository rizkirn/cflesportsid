-- Import integrity
SELECT
  (SELECT COUNT(*) FROM tournaments) AS tournaments,
  (SELECT COUNT(*) FROM teams) AS teams,
  (SELECT COUNT(*) FROM players) AS players,
  (SELECT COUNT(*) FROM maps) AS maps,
  (SELECT COUNT(*) FROM matches) AS matches,
  (SELECT COUNT(*) FROM match_maps) AS match_maps,
  (SELECT COUNT(*) FROM player_map_stats) AS player_map_stats;

-- Tournament totals.
SELECT
  m.tournament_id,
  COUNT(DISTINCT m.id) AS completed_matches,
  COUNT(DISTINCT mm.match_id || ':' || mm.map_number) AS maps,
  COALESCE(SUM(s.kills), 0) AS kills,
  COALESCE(SUM(s.deaths), 0) AS deaths,
  COALESCE(SUM(s.assists), 0) AS assists
FROM matches m
LEFT JOIN match_maps mm ON mm.match_id = m.id
LEFT JOIN player_map_stats s
  ON s.match_id = mm.match_id
 AND s.map_number = mm.map_number
WHERE m.status = 'completed'
GROUP BY m.tournament_id
ORDER BY m.tournament_id;

-- Top career players. Mirrors statistics.ts for K/D/A, maps played and MVP.
SELECT
  p.id AS player_id,
  p.current_ign,
  COALESCE(SUM(s.kills), 0) AS kills,
  COALESCE(SUM(s.deaths), 0) AS deaths,
  COALESCE(SUM(s.assists), 0) AS assists,
  COUNT(s.map_number) AS maps_played,
  (
    SELECT COUNT(*)
    FROM match_maps mm2
    JOIN matches m2 ON m2.id = mm2.match_id
    WHERE m2.status = 'completed'
      AND mm2.mvp_player_id = p.id
  ) AS mvp_count
FROM players p
LEFT JOIN player_map_stats s ON s.player_id = p.id
LEFT JOIN matches m ON m.id = s.match_id AND m.status = 'completed'
GROUP BY p.id, p.current_ign
ORDER BY kills DESC, deaths ASC
LIMIT 20;
