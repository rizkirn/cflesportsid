import type { CollectionEntry } from 'astro:content';
import { statisticalPlayerKey } from './player-continuity.mjs';

type Match = CollectionEntry<'matches'>;
type Combat = { kills: number; deaths: number; assists: number };
export const emptyStats = () => ({ kills: 0, deaths: 0, assists: 0, matchesPlayed: 0, mapsPlayed: 0, wins: 0, losses: 0, mvpCount: 0 });
type Stats = ReturnType<typeof emptyStats>;
export const emptyMapStats = () => ({ ...emptyStats(), playerRounds: 0, knownResults: 0, players: new Map<string, Stats>(), teams: new Map<string, Stats>() });
export const kdRatio = (stats: Combat) => stats.kills / Math.max(stats.deaths, 1);
export const kdaRatio = (stats: Combat) => (stats.kills + stats.assists) / Math.max(stats.deaths, 1);

function ensure<T>(map: Map<string, T>, id: string, create: () => T): T {
  if (!map.has(id)) map.set(id, create());
  return map.get(id)!;
}
function add(target: Combat, values: Combat) {
  target.kills += values.kills; target.deaths += values.deaths; target.assists += values.assists;
}
function outcome(stats: Stats, teamId: string | null | undefined, match: Match) {
  if (!teamId || !match.data.winnerId) return;
  if (teamId === match.data.winnerId) stats.wins++;
  else if (teamId === match.data.team1Id || teamId === match.data.team2Id) stats.losses++;
}

// A sweep establishes every map winner; split scores cannot identify individual winners.
export function getMapWinner(match: Match, round: Match['data']['roundDetails'][number]) {
  if (match.data.status !== 'completed') return undefined;
  if (round.winnerId) return round.winnerId;
  if (match.data.score1 > 0 && match.data.score2 === 0) return match.data.team1Id;
  if (match.data.score2 > 0 && match.data.score1 === 0) return match.data.team2Id;
  return undefined;
}

// Career totals include completed matches only. Team attribution comes from each match row.
export function calculateStatistics(matches: Match[]) {
  const players = new Map<string, Stats>();
  const teams = new Map<string, Stats>();
  const maps = new Map<string, ReturnType<typeof emptyMapStats>>();
  const totals = { ...emptyStats(), unassignedPlayerRounds: 0, unassignedMapKills: 0 };
  for (const match of matches) {
    if (match.data.status !== 'completed') continue;
    const m = match.data;
    totals.matchesPlayed++;
    const matchPlayers = new Set<string>();
    const matchMaps = new Set<string>();
    const playerMapMatches = new Set<string>();
    const teamMapMatches = new Set<string>();
    for (const id of [m.team1Id, m.team2Id]) {
      if (!id) continue;
      const team = ensure(teams, id, emptyStats);
      team.matchesPlayed++; team.mapsPlayed += m.roundDetails.filter(rd=>rd.mode!=='walkover').length; outcome(team, id, match);
    }
    for (const rd of m.roundDetails) {
      if(rd.mode==='walkover'||!rd.mapId)continue;
      const map = ensure(maps, rd.mapId, emptyMapStats);
      map.mapsPlayed++; totals.mapsPlayed++; matchMaps.add(rd.mapId);
      const mapWinner = getMapWinner(match, rd);
      if (mapWinner) map.knownResults++;
      for (const id of [m.team1Id, m.team2Id]) {
        if (!id) continue;
        const team = ensure(map.teams, id, emptyStats); team.mapsPlayed++;
        if (mapWinner === id) team.wins++;
        else if (mapWinner) team.losses++;
        const key = `${rd.mapId}:${id}`;
        if (!teamMapMatches.has(key)) { team.matchesPlayed++; teamMapMatches.add(key); }
      }
      if (rd.mvp) {
        const identity = statisticalPlayerKey(rd.mvp, m.tournamentId);
        ensure(players, identity, emptyStats).mvpCount++;
        ensure(map.players, identity, emptyStats).mvpCount++;
        map.mvpCount++; totals.mvpCount++;
      }
    }
    for (const id of matchMaps) maps.get(id)!.matchesPlayed++;
    for (const ps of m.resultType==='walkover'?[]:m.playerStats) {
      const rounds=ps.rounds.filter(r=>!m.roundDetails.some(rd=>rd.round_number===r.round_number&&rd.mode==='walkover'));
      const identity = ps.uid ? statisticalPlayerKey(ps.uid, m.tournamentId) : undefined;
      const player = identity ? ensure(players, identity, emptyStats) : undefined;
      if (player && rounds.length && !matchPlayers.has(ps.uid!)) {
        player.matchesPlayed++; outcome(player, ps.teamId, match); matchPlayers.add(ps.uid!);
      }
      const team = ps.teamId ? ensure(teams, ps.teamId, emptyStats) : undefined;
      for (const r of rounds) {
        add(totals, r);
        if (player) { add(player, r); player.mapsPlayed++; }
        if (team) add(team, r);
        // An absent map number is unknown, never implicitly map 1 for a substitute.
        const rd = r.round_number === undefined ? undefined : m.roundDetails.find(rd => rd.round_number === r.round_number);
        if (!rd||!rd.mapId) { totals.unassignedPlayerRounds++; totals.unassignedMapKills += r.kills; continue; }
        const map = maps.get(rd.mapId)!;
        add(map, r); map.playerRounds++;
        if (ps.teamId) add(ensure(map.teams, ps.teamId, emptyStats), r);
        if (ps.uid) {
          const mapPlayer = ensure(map.players, identity!, emptyStats);
          add(mapPlayer, r); mapPlayer.mapsPlayed++;
          const key = `${rd.mapId}:${ps.uid}`;
          if (!playerMapMatches.has(key)) { mapPlayer.matchesPlayed++; playerMapMatches.add(key); }
        }
      }
    }
  }
  return { players, teams, maps, totals };
}
