function shuffle(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error('Invalid random source.');
    }
    const j = Math.floor(value * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function generateSharedBracket(options, random = Math.random) {
  const { tournamentId, name, startDate, endDate } = options;
  const inputTeams = options.teams;
  const stage = structuredClone(options.stage);
  const size = stage.bracketSize;
  if (!Array.isArray(inputTeams) || inputTeams.some(t => !t.id || !t.name?.trim()) || new Set(inputTeams.map(t => t.id)).size !== inputTeams.length)
    throw new Error('Choose different teams with an ID and name.');
  const teamCount = inputTeams.length;
  if (!Number.isSafeInteger(size) || size < 2 || size > 16384 || !Number.isInteger(Math.log2(size)))
    throw new Error('Use a power-of-two bracket size.');
  if (teamCount < 2 || teamCount < size / 2 || teamCount > size)
    throw new Error(`A ${size}-slot bracket needs ${Math.max(2, size / 2)} to ${size} teams to avoid BYE vs BYE. Add participants or use a smaller bracket.`);
  if (stage.format !== 'single-elimination')
    throw new Error('Only single-elimination is supported.');
  const rounds = stage.rounds.sort((a, b) => a.order - b.order);
  const mainRounds = rounds.filter(r => r.placement !== 3);
  if (mainRounds.length !== Math.log2(size) || mainRounds.at(-1)?.placement !== 1 || new Set(rounds.map(r => r.id)).size !== rounds.length || rounds.filter(r => r.placement === 3).length > 1 || rounds.some(r => !r.id || !r.name || !Number.isInteger(r.order)) || rounds.some((r, i) => i && r.order <= rounds[i - 1].order))
    throw new Error('Review the saved bracket rounds.');
  if (rounds.some(r => r.placement === 3) && (size < 4 || size === 4 && teamCount < 4 || rounds.find(r => r.placement === 3).order <= mainRounds.at(-2).order))
    throw new Error('Third place needs two played semifinals. Remove the third-place round or add participants.');
  const selectedTeamIds = inputTeams.map(t => t.id);
  stage.byes = [];
  const tournament = { id: tournamentId, data: { name: name.trim(), game: options.game ?? 'crossfire-legends', region: options.region ?? 'ID', startDate, endDate, status: 'upcoming', format: 'single-elimination', teams: [...selectedTeamIds], stages: [stage] } };
  const matches = [];
  const draw = [];
  const teams = shuffle(selectedTeamIds, random);
  /*
  * BYEs are distributed across feeder pairs instead
  * of simply filling the first empty slots.
  *
  * This avoids BYE vs BYE in the opening round.
  */
  const feederPairs = shuffle(Array.from({ length: size / 4 }, (_, i) => i), random).map(pair => shuffle([
    pair * 2 + 1,
    pair * 2 + 2
  ], random));
  const byeOrder = [
    ...feederPairs.map(pair => pair[0]),
    ...feederPairs.map(pair => pair[1])
  ];
  const byeSlots = new Set(byeOrder.slice(0, size - teamCount));
  const existingIds = new Set(options.existingMatchIds);
  const matchId = (number) => `${tournamentId}-m${String(number).padStart(2, '0')}`;
  let number = 0;
  let cursor = 0;
  let previous = [];
  let semifinal = [];
  for (const round of rounds) {
    const mainIndex = mainRounds.findIndex(r => r.id === round.id);
    const isBronze = round.placement === 3;
    const opening = mainIndex === 0;
    const capacity = isBronze
      ? 1
      : size / 2 ** (mainIndex + 1);
    const current = [];
    for (let slot = 1; slot <= capacity; slot++) {
      number++;
      if (opening &&
        byeSlots.has(slot)) {
        const teamId = teams[cursor++];
        const byeId = `bye-m${String(number).padStart(2, '0')}`;
        stage.byes.push({
          id: byeId,
          roundId: round.id,
          slot,
          teamId
        });
        draw.push({
          number,
          roundId: round.id,
          slot,
          kind: 'bye',
          team1: teamId
        });
        current.push({
          source: {
            type: 'bye',
            byeId
          },
          number,
          teamId
        });
        continue;
      }
      const id = matchId(number);
      if (existingIds.has(id)) {
        throw new Error(`Match ID ${id} already exists. Choose a different tournament ID.`);
      }
      const data = {
        tournamentId,
        stageId: stage.id,
        roundId: round.id,
        bracketSlot: slot,
        date: startDate,
        status: 'upcoming',
        score1: 0,
        score2: 0,
        roundDetails: [],
        playerStats: [],
        stats1: {
          kills: 0,
          deaths: 0,
          assists: 0
        },
        stats2: {
          kills: 0,
          deaths: 0,
          assists: 0
        }
      };
      const entry = {
        number,
        roundId: round.id,
        slot,
        kind: 'match'
      };
      if (opening) {
        data.team1Id =
          entry.team1 =
            teams[cursor++];
        data.team2Id =
          entry.team2 =
            teams[cursor++];
      }
      else {
        const parents = isBronze
          ? semifinal
          : previous;
        for (const side of [1, 2]) {
          const parent = parents[(slot - 1) * 2 +
            side -
            1];
          data[`team${side}Source`] =
            isBronze
              ? {
                type: 'loser',
                matchId: matchId(parent.number)
              }
              : parent.source;
          entry[`source${side}`] =
            parent.number;
          /*
          * A BYE already tells us which team
          * advances, so we can resolve that team
          * immediately.
          */
          if (!isBronze &&
            parent.teamId) {
            data[`team${side}Id`] =
              entry[`team${side}`] =
                parent.teamId;
          }
        }
      }
      matches.push({
        id,
        data
      });
      draw.push(entry);
      current.push({
        source: {
          type: 'winner',
          matchId: id
        },
        number
      });
    }
    if (mainIndex === mainRounds.length - 2) {
      semifinal = current;
    }
    if (!isBronze)
      previous = current;
  }
  return {
    tournament,
    matches,
    draw
  };
}
