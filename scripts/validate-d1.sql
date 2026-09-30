-- Import integrity.
SELECT
  (SELECT COUNT(*) FROM tournaments) AS tournaments,
  (SELECT COUNT(*) FROM teams) AS teams,
  (SELECT COUNT(*) FROM players) AS players,
  (SELECT COUNT(*) FROM maps) AS maps,
  (SELECT COUNT(*) FROM matches) AS matches,
  (SELECT COUNT(*) FROM match_maps) AS match_maps,
  (SELECT COUNT(*) FROM player_map_stats) AS player_map_stats,
  (SELECT COUNT(*) FROM player_map_stats WHERE map_number IS NULL) AS unassigned_player_rounds;

-- Aggregate maps and combat separately so unassigned rounds survive and joins cannot multiply totals.
SELECT m.tournament_id, COUNT(*) AS completed_matches,
  SUM((SELECT COUNT(*) FROM match_maps mm WHERE mm.match_id = m.id)) AS maps,
  SUM(COALESCE((SELECT SUM(s.kills) FROM player_map_stats s WHERE s.match_id = m.id), 0)) AS kills,
  SUM(COALESCE((SELECT SUM(s.deaths) FROM player_map_stats s WHERE s.match_id = m.id), 0)) AS deaths,
  SUM(COALESCE((SELECT SUM(s.assists) FROM player_map_stats s WHERE s.match_id = m.id), 0)) AS assists
FROM matches m
WHERE m.status = 'completed'
GROUP BY m.tournament_id
ORDER BY m.tournament_id;

-- Filter before the outer join; otherwise live/upcoming combat leaks into career totals.
WITH completed_stats AS (
  SELECT s.* FROM player_map_stats s JOIN matches m ON m.id = s.match_id
  WHERE m.status = 'completed'
)
SELECT p.id AS player_id, p.current_ign,
  COALESCE(SUM(s.kills), 0) AS kills,
  COALESCE(SUM(s.deaths), 0) AS deaths,
  COALESCE(SUM(s.assists), 0) AS assists,
  COUNT(s.match_id) AS maps_played,
  COUNT(DISTINCT s.match_id) AS matches_played,
  (SELECT COUNT(*) FROM match_maps mm JOIN matches m ON m.id = mm.match_id
   WHERE m.status = 'completed' AND mm.mvp_player_id = p.id) AS mvp_count
FROM players p
LEFT JOIN completed_stats s ON s.player_id = p.id
GROUP BY p.id, p.current_ign
ORDER BY kills DESC, deaths ASC
LIMIT 20;
