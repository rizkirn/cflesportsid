import { generateSharedBracket } from './bracket-engine.mjs';
import type { CollectionEntry } from 'astro:content';

type TournamentData = CollectionEntry<'tournaments'>['data'];

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
  teamNames?: Record<string, string>;
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
    throw new Error(
      'Choose at least 5 teams. An 8-slot bracket needs 5 teams to avoid BYE vs BYE.'
    );
  }

  return 2 ** Math.ceil(Math.log2(teamCount));
}

export function generateBracket(
  options: BracketOptions,
  random = Math.random
) {
  const {
    teamCount,
    selectedTeamIds,
    availableTeamIds,
    tournamentId,
    name,
    startDate,
    endDate,
    mapCount,
    thirdPlace
  } = options;

  const size = bracketSizeFor(teamCount);

    if (
    selectedTeamIds.length !== teamCount ||
    new Set(selectedTeamIds).size !== teamCount
  ) {
    throw new Error(
      `Select exactly ${teamCount} different teams.`
    );
  }

  const available = new Set(availableTeamIds);

  if (
    selectedTeamIds.some(id => !available.has(id))
  ) {
    throw new Error(
      'Select teams from the Teams collection.'
    );
  }

  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tournamentId)
  ) {
    throw new Error(
      'Use lowercase letters, numbers and single hyphens for the tournament ID.'
    );
  }

  if (
    options.existingTournamentIds?.includes(tournamentId)
  ) {
    throw new Error(
      'That tournament ID already exists. Choose a new ID.'
    );
  }

  if (!name.trim()) {
    throw new Error('Enter a tournament name.');
  }

  const validDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;

  if (
    !validDate(startDate) ||
    !validDate(endDate) ||
    endDate < startDate
  ) {
    throw new Error(
      'Enter valid dates with the end on or after the start.'
    );
  }

  if (
    !Number.isSafeInteger(mapCount) ||
    mapCount < 1 ||
    mapCount % 2 !== 1
  ) {
    throw new Error(
      'Choose a positive odd number of maps.'
    );
  }

    const rounds:
    TournamentData['stages'][number]['rounds'] = [];

  for (
    let slots = size, order = 1;
    slots >= 2;
    slots /= 2, order++
  ) {
    rounds.push({
      id:
        slots === 2
          ? 'final'
          : slots === 4
            ? 'semi-final'
            : slots === 8
              ? 'quarter-final'
              : `top-${slots}`,

      name:
        slots === 2
          ? 'Final'
          : slots === 4
            ? 'Semifinal'
            : slots === 8
              ? 'Quarterfinal'
              : `Round of ${slots}`,

      order,

      ...(slots === 2
        ? { placement: 1 as const }
        : {})
    });
  }

  if (thirdPlace) {
    rounds.push({
      id: 'bronze',
      name: 'Third place',
      order: rounds.length + 1,
      placement: 3
    });
  }

    const stage:
    TournamentData['stages'][number] = {
      id: 'playoffs',
      name: 'Playoffs',
      format: 'single-elimination',
      bracketSize: size,

      series: {
        type: 'fixed-maps',
        mapCount
      },

      rounds,
      byes: []
    };

  return generateSharedBracket({ tournamentId, name, startDate, endDate, stage,
    teams: selectedTeamIds.map(id => ({id, name: options.teamNames?.[id] ?? id})), existingMatchIds: options.existingMatchIds }, random);
}

export type GeneratedBracket =
  ReturnType<typeof generateBracket>;

export function bracketExport(
  bracket: GeneratedBracket,
  customTeams: {id: string; name: string}[] = []
) {
  return {
    version: 1,
    ...(customTeams.length ? { customTeams, importNote: 'Temporary custom team IDs require team records with tag and region before importing these files.' } : {}),

    files: Object.fromEntries([
      [
        `src/data/tournaments/${bracket.tournament.id}.json`,
        bracket.tournament.data
      ],

      ...bracket.matches.map(
        match => [
          `src/data/matches/${match.id}.json`,
          match.data
        ]
      )
    ]),

    draw: bracket.draw
  };
}