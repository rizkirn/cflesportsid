import type { CollectionEntry } from 'astro:content';

type Match = CollectionEntry<'matches'>;
type Tournament = CollectionEntry<'tournaments'>;
type TournamentMap = Map<string, Tournament>;

export function getMatchRound(match: Match, tournament?: Tournament) {
  return tournament?.data.stages.find(stage => stage.id === match.data.stageId)
    ?.rounds.find(round => round.id === match.data.roundId);
}

export function getRoundName(match: Match, tournaments: TournamentMap) {
  return getMatchRound(match, tournaments.get(match.data.tournamentId))?.name ?? match.data.roundId;
}

export function getRoundOrder(match: Match, tournaments: TournamentMap) {
  return getMatchRound(match, tournaments.get(match.data.tournamentId))?.order ?? 0;
}

export function getParticipantLabel(match: Match, side: 1 | 2) {
  const source = side === 1 ? match.data.team1Source : match.data.team2Source;
  if (!source || source.type === 'bye') return 'TBD';
  return `${source.type === 'winner' ? 'Winner' : 'Loser'} of ${source.matchId}`;
}

export function getSourceNode(match: Match, side: 1 | 2) {
  const source = side === 1 ? match.data.team1Source : match.data.team2Source;
  if (!source) return undefined;
  return source.type === 'bye' ? `${match.data.stageId}:${source.byeId}` : source.matchId;
}

export function resolveSourceTeam(match: Match, side: 1 | 2, tournament: Tournament, matches: Match[]) {
  const source = side === 1 ? match.data.team1Source : match.data.team2Source;
  if (!source) return side === 1 ? match.data.team1Id : match.data.team2Id;
  if (source.type === 'bye') {
    return tournament.data.stages.find(stage => stage.id === match.data.stageId)
      ?.byes.find(bye => bye.id === source.byeId)?.teamId;
  }
  const previous = matches.find(m => m.id === source.matchId);
  if (previous?.data.status !== 'completed' || !previous.data.winnerId) return undefined;
  if (source.type === 'winner') return previous.data.winnerId;
  return previous.data.winnerId === previous.data.team1Id ? previous.data.team2Id : previous.data.team1Id;
}

// Called while generating tournament routes: invalid bracket data stops the build.
export function validateTournament(tournament: Tournament, allMatches: Match[], teamIds: Set<string>, options: { allowPendingDetails?: boolean } = {}) {
  const fail = (message: string): never => { throw new Error(`${tournament.id}: ${message}`); };
  const matches = allMatches.filter(match => match.data.tournamentId === tournament.id);
  const matchMap = new Map(allMatches.map(match => [match.id, match]));
  const registered = new Set(tournament.data.teams);
  if (registered.size !== tournament.data.teams.length) fail('Duplicate registered team');
  for (const id of registered) if (!teamIds.has(id)) fail(`Unknown team ${id}`);
  const stages = new Set<string>();
  const consumed = new Set<string>();
  for (const stage of tournament.data.stages) {
    if (stages.has(stage.id)) fail(`Duplicate stage ${stage.id}`);
    stages.add(stage.id);
    if (registered.size > stage.bracketSize) fail(`Too many entrants for ${stage.id}`);
    const roundIds = new Set<string>();
    const orders = new Set<number>();
    for (const round of stage.rounds) {
      if (roundIds.has(round.id) || orders.has(round.order)) fail(`Duplicate round ID/order in ${stage.id}`);
      roundIds.add(round.id); orders.add(round.order);
    }
    const mainRounds = stage.rounds.filter(r => r.placement !== 3).sort((a, b) => a.order - b.order);
    if (mainRounds.length !== Math.log2(stage.bracketSize) || mainRounds.at(-1)?.placement !== 1 ||
        stage.rounds.filter(r => r.placement === 1).length !== 1 || stage.rounds.filter(r => r.placement === 3).length > 1) {
      fail(`Invalid elimination rounds in ${stage.id}`);
    }
    const slots = new Set<string>();
    const claimSlot = (roundId: string, slot: number) => {
      const round = stage.rounds.find(r => r.id === roundId);
      if (!round) fail(`Unknown round ${roundId}`);
      const index = mainRounds.findIndex(r => r.id === roundId);
      const capacity = round?.placement === 3 ? 1 : stage.bracketSize / (2 ** (index + 1));
      const key = `${roundId}:${slot}`;
      if (slot > capacity || slots.has(key)) fail(`Invalid or duplicate slot ${stage.id}/${key}`);
      slots.add(key);
    };
    const byeIds = new Set<string>();
    const entrants = new Set<string>();
    for (const bye of stage.byes) {
      if (byeIds.has(bye.id)) fail(`Duplicate bye ${bye.id}`);
      byeIds.add(bye.id);
      if (bye.roundId !== mainRounds[0].id || !registered.has(bye.teamId) || entrants.has(bye.teamId)) fail(`Invalid bye ${bye.id}`);
      entrants.add(bye.teamId);
      claimSlot(bye.roundId, bye.slot);
    }
    for (const match of matches.filter(m => m.data.stageId === stage.id)) {
      const m = match.data;
      claimSlot(m.roundId, m.bracketSlot);
      if (m.team1Id && m.team1Id === m.team2Id) fail(`${match.id}: team plays itself`);
      for (const side of [1, 2] as const) {
        const id = side === 1 ? m.team1Id : m.team2Id;
        const source = side === 1 ? m.team1Source : m.team2Source;
        if (id && !registered.has(id)) fail(`${match.id}: unregistered team ${id}`);
        if (!source && m.roundId === mainRounds[0].id && id) {
          if (entrants.has(id)) fail(`${match.id}: duplicate entrant ${id}`);
          entrants.add(id);
        }
        if (!source && m.roundId !== mainRounds[0].id) fail(`${match.id}: missing advancement source`);
        if (source) {
          const key = source.type === 'bye' ? `${stage.id}:bye:${source.byeId}` : `${source.type}:${source.matchId}`;
          if (consumed.has(key)) fail(`${match.id}: source used more than once (${key})`);
          consumed.add(key);
          let previousRound;
          if (source.type === 'bye') {
            const bye = stage.byes.find(b => b.id === source.byeId);
            if (!bye) fail(`${match.id}: unknown bye ${source.byeId}`);
            previousRound = stage.rounds.find(r => r.id === bye?.roundId);
          } else {
            const previous = matchMap.get(source.matchId);
            if (!previous || previous.data.tournamentId !== tournament.id || previous.data.stageId !== stage.id) fail(`${match.id}: invalid source match ${source.matchId}`);
            previousRound = getMatchRound(previous!, tournament);
          }
          const currentRound = getMatchRound(match, tournament);
          if (!previousRound || !currentRound || previousRound.order >= currentRound.order) return fail(`${match.id}: source must be in an earlier round (no cycles)`);
          const previousIndex = mainRounds.findIndex(r => r.id === previousRound.id);
          const currentIndex = mainRounds.findIndex(r => r.id === currentRound.id);
          if (currentRound.placement === 3) {
            if (source.type !== 'loser' || previousIndex !== mainRounds.length - 2) fail(`${match.id}: bronze needs semifinal losers`);
          } else if (source.type === 'loser' || currentIndex !== previousIndex + 1) {
            fail(`${match.id}: advancement must follow consecutive elimination rounds`);
          }
          const expected = resolveSourceTeam(match, side, tournament, matches);
          if (id && id !== expected) fail(`${match.id}: team${side}Id disagrees with its source`);
        }
      }
      if (m.status === 'completed') {
        if (!m.team1Id || !m.team2Id || !m.winnerId) fail(`${match.id}: completed match needs teams and winner`);
        if(m.resultType==='walkover') {
          if(![m.team1Id,m.team2Id].includes(m.winnerId)||m.score1!==0||m.score2!==0||m.roundDetails.length||m.playerStats.length)fail(`${match.id}: invalid full-match W/O`);
          continue;
        }
        if (m.score1 + m.score2 !== stage.series.mapCount || m.score1 === m.score2) fail(`${match.id}: completed scores must total ${stage.series.mapCount} maps`);
        if (m.winnerId !== (m.score1 > m.score2 ? m.team1Id : m.team2Id)) fail(`${match.id}: winner disagrees with score`);
        const numbers = new Set(m.roundDetails.map(r => r.round_number));
        if (!options.allowPendingDetails && (m.roundDetails.length !== stage.series.mapCount || numbers.size !== stage.series.mapCount ||
            [...numbers].some(n => !Number.isInteger(n) || n < 1 || n > stage.series.mapCount))) fail(`${match.id}: record all ${stage.series.mapCount} maps`);
      } else if (m.winnerId || m.score1 + m.score2 > stage.series.mapCount) {
        fail(`${match.id}: invalid unfinished result`);
      }
    }
    if (tournament.data.status === 'completed') {
      for (const round of stage.rounds) {
        const index = mainRounds.findIndex(r => r.id === round.id);
        const capacity = round.placement === 3 ? 1 : stage.bracketSize / (2 ** (index + 1));
        for (let slot = 1; slot <= capacity; slot++) {
          if (!slots.has(`${round.id}:${slot}`)) fail(`Completed tournament has an empty slot ${stage.id}/${round.id}:${slot}`);
        }
      }
      if (matches.some(m => m.data.stageId === stage.id && m.data.status !== 'completed')) fail('Completed tournament contains unfinished matches');
    }
  }
  for (const match of matches) if (!stages.has(match.data.stageId)) fail(`${match.id}: unknown stage`);
}
