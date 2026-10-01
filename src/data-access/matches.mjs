export const matchReadQueries = [
  'SELECT * FROM matches ORDER BY id',
  'SELECT * FROM match_maps ORDER BY match_id, map_number',
  'SELECT * FROM match_sources ORDER BY match_id, side',
  'SELECT * FROM player_match_entries ORDER BY match_id, entry_index',
  'SELECT * FROM player_round_stats ORDER BY match_id, entry_index, round_index',
];

const optional = (target, key, value) => {
  if (value === null || value === undefined) delete target[key];
  else target[key] = value;
};
const key = (match, index) => JSON.stringify([match, index]);

export function shapeD1Matches(rows, legacyMatches) {
  const [matches, maps, sources, entries, rounds] = rows;
  const legacy = new Map(legacyMatches.map(m => [m.id, m]));
  const ids = new Set(matches.map(m => m.id));
  if (ids.size !== matches.length || [...legacy.keys()].some(id => !ids.has(id))) {
    throw new Error('D1 match coverage differs from the migration JSON snapshot');
  }
  const entryKeys = new Set(entries.map(e => key(e.match_id, e.entry_index)));
  for (const group of [maps, sources, entries, rounds]) {
    if (group.some(r => !ids.has(r.match_id))) throw new Error('D1 contains orphan match rows');
  }
  if (rounds.some(r => !entryKeys.has(key(r.match_id, r.entry_index)))) throw new Error('D1 contains orphan player rounds');
  const combat = r => {
    for (const field of ['kills', 'deaths', 'assists']) {
      if (!Number.isInteger(r[field]) || r[field] < 0) throw new Error(`Invalid D1 ${field}`);
    }
    return { kills: r.kills, deaths: r.deaths, assists: r.assists };
  };
  const byMatch = group => {
    const result = new Map();
    for (const r of group) {
      if (!result.has(r.match_id)) result.set(r.match_id, []);
      result.get(r.match_id).push(r);
    }
    return result;
  };
  const mapRows = byMatch(maps), sourceRows = byMatch(sources), entryRows = byMatch(entries), allRoundRows = byMatch(rounds);
  for (const m of legacyMatches) {
    const expected = [m.data.roundDetails.length, m.data.playerStats.length,
      m.data.playerStats.reduce((n, e) => n + e.rounds.length, 0),
      Number(Boolean(m.data.team1Source)) + Number(Boolean(m.data.team2Source))];
    const actual = [mapRows, entryRows, allRoundRows, sourceRows].map(group => (group.get(m.id) ?? []).length);
    if (expected.some((count, i) => count !== actual[i])) throw new Error(`Incomplete D1 children for ${m.id}`);
  }
  const roundRows = new Map();
  for (const r of rounds) {
    const id = key(r.match_id, r.entry_index);
    if (!roundRows.has(id)) roundRows.set(id, []);
    roundRows.get(id).push(r);
  }
  const shaped = new Map(matches.map(m => {
    if (!['completed', 'live', 'upcoming'].includes(m.status) || !Number.isInteger(m.score1) || !Number.isInteger(m.score2) || m.score1 < 0 || m.score2 < 0) throw new Error('Invalid D1 match');
    const baseline = legacy.get(m.id);
    const data = baseline ? structuredClone(baseline.data) : { roundDetails: [], playerStats: [] };
    Object.assign(data, { tournamentId: m.tournament_id, stageId: m.stage_id, roundId: m.round_id,
      bracketSlot: m.bracket_slot, date: m.date, status: m.status, score1: m.score1, score2: m.score2 });
    for (const [field, column] of [['team1Id', 'team1_id'], ['team2Id', 'team2_id'], ['winnerId', 'winner_id'], ['duration', 'duration']]) optional(data, field, m[column]);
    delete data.team1Source; delete data.team2Source;
    for (const s of sourceRows.get(m.id) ?? []) {
      if (![1, 2].includes(s.side) || !['winner', 'loser', 'bye'].includes(s.source_type)) throw new Error('Invalid D1 participant source');
      data[`team${s.side}Source`] = s.source_type === 'bye'
        ? { type: s.source_type, byeId: s.source_bye_id }
        : { type: s.source_type, matchId: s.source_match_id };
    }
    data.roundDetails = (mapRows.get(m.id) ?? []).map(r => {
      const result = { round_number: r.map_number, mapId: r.map_id };
      optional(result, 'winnerId', r.winner_team_id);
      optional(result, 'resultNote', r.result_note);
      const old = baseline?.data.roundDetails.find(old => old.round_number === r.map_number);
      if (r.mvp_player_id !== null) result.mvp = r.mvp_player_id;
      else if (old?.mvp === null) result.mvp = null;
      return result;
    });
    data.playerStats = (entryRows.get(m.id) ?? []).filter(e => baseline || (roundRows.get(key(m.id, e.entry_index)) ?? []).length > 0).map(e => {
      const result = { teamId: e.team_id, rounds: (roundRows.get(key(m.id, e.entry_index)) ?? []).map(r => {
        const result = combat(r); optional(result, 'round_number', r.map_number); return result;
      }) };
      const old = baseline?.data.playerStats[e.entry_index];
      if (baseline && (!old || old.rounds.length !== result.rounds.length)) throw new Error('Incomplete D1 player entry');
      if (e.uid_snapshot !== null) result.uid = e.uid_snapshot;
      else if (old && 'uid' in old) result.uid = null;
      optional(result, 'ign', e.ign_snapshot);
      return result;
    });
    return [m.id, { ...(baseline ?? { id: m.id, collection: 'matches' }), data }];
  }));
  return [...legacyMatches.map(m => shaped.get(m.id)), ...matches.filter(m => !legacy.has(m.id)).map(m => shaped.get(m.id))];
}

export async function readD1Matches(db, legacyMatches) {
  if (!db || typeof db.batch !== 'function') throw new Error('D1 binding is unavailable');
  const response = await db.batch(matchReadQueries.map(sql => db.prepare(sql)));
  if (!Array.isArray(response) || response.length !== matchReadQueries.length || response.some(r => r.success !== true || !Array.isArray(r.results))) throw new Error('Invalid D1 read response');
  return shapeD1Matches(response.map(r => r.results), legacyMatches);
}

export async function readMatches({ db, loadJSON, onFallback = () => {} }) {
  const legacy = await loadJSON();
  try {
    return { source: 'd1', matches: await readD1Matches(db, legacy) };
  } catch (error) {
    onFallback(error);
    return { source: 'json', matches: legacy };
  }
}
