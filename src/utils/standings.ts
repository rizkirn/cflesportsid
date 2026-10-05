import type { CollectionEntry } from 'astro:content';
import { calculateStatistics } from './statistics';
import { getMatchRound } from './tournament';
import { resolveAsset } from './assets.mjs';

export function getOverallStandings(teams: CollectionEntry<'teams'>[], matches: CollectionEntry<'matches'>[], tournaments: CollectionEntry<'tournaments'>[]) {
  const statistics = calculateStatistics(matches);
  return teams.map(team => {
    let placementPoints = 0;
    let isTournamentWinner = false;
    for (const tournament of tournaments) {
      const played = matches.filter(m => m.data.tournamentId === tournament.id && m.data.status === 'completed');
      const final = played.find(m => getMatchRound(m, tournament)?.placement === 1);
      const bronze = played.find(m => getMatchRound(m, tournament)?.placement === 3);
      if (final?.data.winnerId === team.id) { placementPoints += 10; isTournamentWinner = true; }
      else if (final && [final.data.team1Id, final.data.team2Id].includes(team.id)) placementPoints += 6;
      else if (bronze?.data.winnerId === team.id) placementPoints += 4;
      else if (bronze && [bronze.data.team1Id, bronze.data.team2Id].includes(team.id)) placementPoints += 2;
    }
    const killPoints = statistics.teams.get(team.id)?.kills ?? 0;
    const penalties = team.data.penalties ?? [];
    const penaltyPoints = penalties.reduce((sum, penalty) => sum + penalty.points, 0);
    return { id: team.id, name: team.data.name, tag: team.data.tag, logo: resolveAsset('teams', team).src, killPoints, placementPoints, penalties, penaltyPoints, totalScore: killPoints + placementPoints - penaltyPoints, isTournamentWinner };
  }).sort((a, b) => b.totalScore - a.totalScore);
}
