import { getCollection, type CollectionEntry } from 'astro:content';
import { getFrontendTeams, getFrontendTournaments } from '../data-access/frontend-bracket';

export async function getTeamMap() {
  const teams = await getFrontendTeams();

  return new Map(
    teams.map((team) => [team.id, team])
  );
}

export async function getPlayerMap() {
  const players = await getCollection('players');

  return new Map(
    players.map((player) => [player.id, player])
  );
}

export async function getTournamentMap() {
  const tournaments = await getFrontendTournaments();

  return new Map(
    tournaments.map((tournament) => [tournament.id, tournament])
  );
}

export async function getMapMap() {
  const maps = await getCollection('maps');

  return new Map(
    maps.map((map) => [map.id, map])
  );
}

export function getMatchTournamentId(match: CollectionEntry<'matches'>) {
  return match.data.tournamentId ?? null;
}

export function getMatchTeam1Id(match: CollectionEntry<'matches'>) {
  return match.data.team1Id ?? null;
}

export function getMatchTeam2Id(match: CollectionEntry<'matches'>) {
  return match.data.team2Id ?? null;
}

export function getMatchWinnerId(match: CollectionEntry<'matches'>) {
  return match.data.winnerId ?? null;
}

export function getRoundMapId(round: CollectionEntry<'matches'>['data']['roundDetails'][number]) {
  return round.mapId;
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Match-time team attribution must never fall back to a player's current roster.
export function getTeamMatchStats(matches: CollectionEntry<'matches'>[], teamId: string) {
  const totals = { kills: 0, deaths: 0, assists: 0 };
  for (const match of matches) {
    for (const playerStats of match.data.playerStats) {
      if (playerStats.teamId !== teamId) continue;
      for (const round of playerStats.rounds) {
        totals.kills += round.kills;
        totals.deaths += round.deaths;
        totals.assists += round.assists;
      }
    }
  }
  return totals;
}
