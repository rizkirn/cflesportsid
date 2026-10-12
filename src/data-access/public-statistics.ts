import {calculateStatistics, emptyStats, emptyMapStats} from '../utils/statistics';
import {restorePublicStatisticsKeys, type PublicSnapshot} from './public-d1.mjs';

export function calculatePublicStatistics(snapshot: PublicSnapshot, tournamentId?: string) {
  const result = restorePublicStatisticsKeys(calculateStatistics(snapshot.statisticsMatches(tournamentId)));
  for (const player of snapshot.players) if (!result.players.has(player.id)) result.players.set(player.id, emptyStats());
  for (const team of snapshot.teams) if (!result.teams.has(team.id)) result.teams.set(team.id, emptyStats());
  for (const map of snapshot.maps) if (!result.maps.has(map.id)) result.maps.set(map.id, emptyMapStats());
  return result;
}
