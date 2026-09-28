import type { CollectionEntry } from 'astro:content';

type TournamentData = CollectionEntry<'tournaments'>['data'];
type MatchData = CollectionEntry<'matches'>['data'];
type Source = NonNullable<MatchData['team1Source']>;
export type DrawEntry = {
  number: number;
  roundId: string;
  slot: number;
  team1?: string;
  team2?: string;
  source1?: number;
  source2?: number;
  kind: 'match' | 'bye';
};
export type BracketOptions = {
  teamCount: number;
  selectedTeamIds: string[];
  availableTeamIds: string[];
  tournamentId: string;
  name: string;
  startDate: string;
  endDate: string;
  mapCount: number;
  thirdPlace: boolean;
  existingTournamentIds?: string[];
  existingMatchIds?: string[];
};

export function bracketSizeFor(teamCount: number) {
  if (!Number.isSafeInteger(teamCount) || teamCount < 5) {
    throw new Error('Choose at least 5 teams. An 8-slot bracket needs 5 teams to avoid BYE vs BYE.');
  }
  return 2 ** Math.ceil(Math.log2(teamCount));
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Invalid random source.');
    const j = Math.floor(value * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateBracket(options: BracketOptions, random = Math.random) {
  const { teamCount, selectedTeamIds, availableTeamIds, tournamentId, name, startDate, endDate, mapCount, thirdPlace } = options;
  const size = bracketSizeFor(teamCount);
  if (selectedTeamIds.length !== teamCount || new Set(selectedTeamIds).size !== teamCount) {
    throw new Error(`Select exactly ${teamCount} different teams.`);
  }
  const available = new Set(availableTeamIds);
  if (selectedTeamIds.some(id => !available.has(id))) throw new Error('Select teams from the Teams collection.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentId)) throw new Error('Use lowercase letters, numbers and single hyphens for the tournament ID.');
  if (options.existingTournamentIds?.includes(tournamentId)) throw new Error('That tournament ID already exists. Choose a new ID.');
  if (!name.trim()) throw new Error('Enter a tournament name.');
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) throw new Error('Enter valid dates with the end on or after the start.');
  if (!Number.isSafeInteger(mapCount) || mapCount < 1 || mapCount % 2 !== 1) throw new Error('Choose a positive odd number of maps.');

  const rounds: TournamentData['stages'][number]['rounds'] = [];
  for (let slots = size, order = 1; slots >= 2; slots /= 2, order++) {
    rounds.push({
      id: slots === 2 ? 'final' : slots === 4 ? 'semi-final' : slots === 8 ? 'quarter-final' : `top-${slots}`,
      name: slots === 2 ? 'Final' : slots === 4 ? 'Semifinal' : slots === 8 ? 'Quarterfinal' : `Round of ${slots}`,
      order,
      ...(slots === 2 ? { placement: 1 as const } : {}),
    });
  }
  if (thirdPlace) rounds.push({ id: 'bronze', name: 'Third place', order: rounds.length + 1, placement: 3 });
  const stage: TournamentData['stages'][number] = {
    id: 'playoffs', name: 'Playoffs', format: 'single-elimination', bracketSize: size,
    series: { type: 'fixed-maps', mapCount }, rounds, byes: [],
  };
  const tournament = { id: tournamentId, data: {
    name: name.trim(), game: 'crossfire-legends', region: 'ID', startDate, endDate,
    status: 'upcoming' as const, format: 'single-elimination' as const,
    teams: [...selectedTeamIds], stages: [stage],
  } satisfies TournamentData };
  const matches: { id: string; data: MatchData }[] = [];
  const draw: DrawEntry[] = [];
  const teams = shuffle(selectedTeamIds, random);
  const feederPairs = shuffle(Array.from({ length: size / 4 }, (_, i) => i), random)
    .map(pair => shuffle([pair * 2 + 1, pair * 2 + 2], random));
  const byeOrder = [...feederPairs.map(pair => pair[0]), ...feederPairs.map(pair => pair[1])];
  const byeSlots = new Set(byeOrder.slice(0, size - teamCount));
  const existingIds = new Set(options.existingMatchIds);
  const matchId = (number: number) => `${tournamentId}-m${String(number).padStart(2, '0')}`;
  let number = 0;
  let cursor = 0;
  let previous: { source: Source; number: number; teamId?: string }[] = [];
  let semifinal: typeof previous = [];
  for (const round of rounds) {
    const isBronze = round.placement === 3;
    const opening = round.id === rounds[0].id;
    const capacity = isBronze ? 1 : size / 2 ** round.order;
    const current: typeof previous = [];
    for (let slot = 1; slot <= capacity; slot++) {
      number++;
      if (opening && byeSlots.has(slot)) {
        const teamId = teams[cursor++];
        const byeId = `bye-m${String(number).padStart(2, '0')}`;
        stage.byes.push({ id: byeId, roundId: round.id, slot, teamId });
        draw.push({ number, roundId: round.id, slot, kind: 'bye', team1: teamId });
        current.push({ source: { type: 'bye', byeId }, number, teamId });
        continue;
      }
      const id = matchId(number);
      if (existingIds.has(id)) throw new Error(`Match ID ${id} already exists. Choose a different tournament ID.`);
      const data: MatchData = {
        tournamentId, stageId: stage.id, roundId: round.id, bracketSlot: slot,
        date: startDate, status: 'upcoming', score1: 0, score2: 0,
        roundDetails: [], playerStats: [],
        stats1: { kills: 0, deaths: 0, assists: 0 }, stats2: { kills: 0, deaths: 0, assists: 0 },
      };
      const entry: DrawEntry = { number, roundId: round.id, slot, kind: 'match' };
      if (opening) {
        data.team1Id = entry.team1 = teams[cursor++];
        data.team2Id = entry.team2 = teams[cursor++];
      } else {
        const parents = isBronze ? semifinal : previous;
        for (const side of [1, 2] as const) {
          const parent = parents[(slot - 1) * 2 + side - 1];
          data[`team${side}Source`] = isBronze
            ? { type: 'loser', matchId: matchId(parent.number) }
            : parent.source;
          entry[`source${side}`] = parent.number;
          if (!isBronze && parent.teamId) data[`team${side}Id`] = entry[`team${side}`] = parent.teamId;
        }
      }
      matches.push({ id, data });
      draw.push(entry);
      current.push({ source: { type: 'winner', matchId: id }, number });
    }
    if (round.id === 'semi-final') semifinal = current;
    previous = current;
  }
  return { tournament, matches, draw };
}

export type GeneratedBracket = ReturnType<typeof generateBracket>;

export function bracketExport(bracket: GeneratedBracket) {
  return {
    version: 1,
    files: Object.fromEntries([
      [`src/data/tournaments/${bracket.tournament.id}.json`, bracket.tournament.data],
      ...bracket.matches.map(match => [`src/data/matches/${match.id}.json`, match.data]),
    ]),
    draw: bracket.draw,
  };
}
