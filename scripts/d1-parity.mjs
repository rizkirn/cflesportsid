import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as continuity from '../src/utils/player-continuity.mjs';

export function loadLegacyStatistics() {
  const source = fs.readFileSync(new URL('../src/utils/statistics.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, require: name => {
    if (name === './player-continuity.mjs') return continuity;
    throw new Error(`Unexpected statistics dependency: ${name}`);
  } };
  vm.runInNewContext(code, context);
  return context.exports;
}

const empty = () => ({ kills: 0, deaths: 0, assists: 0, matchesPlayed: 0, mapsPlayed: 0, wins: 0, losses: 0, mvpCount: 0 });
const ensure = (map, id, init = empty) => {
  if (!map.has(id)) map.set(id, init());
  return map.get(id);
};
const add = (target, row) => { for (const key of ['kills', 'deaths', 'assists']) target[key] += row[key]; };
const winLoss = (target, team, match) => {
  if (!team || !match.winner_id) return;
  if (team === match.winner_id) target.wins++;
  else if ([match.team1_id, match.team2_id].includes(team)) target.losses++;
};

export function calculateD1Statistics(db, tournamentId) {
  const result = { players: new Map(), teams: new Map(), maps: new Map(), totals: { ...empty(), unassignedPlayerRounds: 0, unassignedMapKills: 0 } };
  const matches = new Map(db.matches.filter(m => m.status === 'completed' && (!tournamentId || m.tournament_id === tournamentId)).map(m => [m.id, m]));
  const details = new Map();
  const mapMatches = new Map(), teamMapMatches = new Map(), playerMapMatches = new Map(), playerMatches = new Map();
  const countOnce = (sets, key, matchId, stats) => {
    const seen = ensure(sets, key, () => new Set());
    if (seen.has(matchId)) return false;
    seen.add(matchId); stats.matchesPlayed++; return true;
  };
  for (const m of matches.values()) {
    result.totals.matchesPlayed++;
    for (const id of [m.team1_id, m.team2_id].filter(Boolean)) {
      const team = ensure(result.teams, id);
      team.matchesPlayed++; winLoss(team, id, m);
    }
  }
  for (const rd of db.match_maps) {
    const m = matches.get(rd.match_id);
    if (!m) continue;
    details.set(JSON.stringify([rd.match_id, rd.map_number]), rd);
    const map = ensure(result.maps, rd.map_id, () => ({ ...empty(), playerRounds: 0, knownResults: 0, players: new Map(), teams: new Map() }));
    map.mapsPlayed++; result.totals.mapsPlayed++;
    countOnce(mapMatches, rd.map_id, m.id, map);
    if (rd.winner_team_id) map.knownResults++;
    for (const id of [m.team1_id, m.team2_id].filter(Boolean)) {
      ensure(result.teams, id).mapsPlayed++;
      const team = ensure(map.teams, id);
      team.mapsPlayed++;
      if (rd.winner_team_id === id) team.wins++;
      else if (rd.winner_team_id) team.losses++;
      countOnce(teamMapMatches, JSON.stringify([rd.map_id, id]), m.id, team);
    }
    if (rd.mvp_player_id) {
      const identity = continuity.statisticalPlayerKey(rd.mvp_player_id, m.tournament_id);
      ensure(result.players, identity).mvpCount++;
      ensure(map.players, identity).mvpCount++;
      map.mvpCount++; result.totals.mvpCount++;
    }
  }
  const entries = new Map();
  for (const e of db.player_match_entries) {
    if (!matches.has(e.match_id)) continue;
    entries.set(JSON.stringify([e.match_id, e.entry_index]), e);
    if (e.uid_snapshot) ensure(result.players, continuity.statisticalPlayerKey(e.uid_snapshot, matches.get(e.match_id).tournament_id));
    if (e.team_id) ensure(result.teams, e.team_id);
  }
  for (const r of [...db.player_round_stats].sort((a, b) => a.entry_index - b.entry_index || a.round_index - b.round_index)) {
    const m = matches.get(r.match_id);
    if (!m) continue;
    const e = entries.get(JSON.stringify([r.match_id, r.entry_index]));
    if (!e) throw new Error(`Missing player entry for ${r.match_id}/${r.entry_index}`);
    add(result.totals, r);
    if (e.team_id) add(ensure(result.teams, e.team_id), r);
    if (e.uid_snapshot) {
      const identity = continuity.statisticalPlayerKey(e.uid_snapshot, m.tournament_id);
      const player = ensure(result.players, identity);
      add(player, r); player.mapsPlayed++;
      if (countOnce(playerMatches, identity, m.id, player)) winLoss(player, e.team_id, m);
    }
    const rd = r.map_number === null ? undefined : details.get(JSON.stringify([r.match_id, r.map_number]));
    if (!rd) { result.totals.unassignedPlayerRounds++; result.totals.unassignedMapKills += r.kills; continue; }
    const map = result.maps.get(rd.map_id);
    add(map, r); map.playerRounds++;
    if (e.team_id) add(ensure(map.teams, e.team_id), r);
    if (e.uid_snapshot) {
      const identity = continuity.statisticalPlayerKey(e.uid_snapshot, m.tournament_id);
      const player = ensure(map.players, identity);
      add(player, r); player.mapsPlayed++;
      countOnce(playerMapMatches, JSON.stringify([rd.map_id, identity]), m.id, player);
    }
  }
  return result;
}

export function plain(value) {
  if (value && typeof value.entries === 'function' && typeof value.get === 'function') return Object.fromEntries([...value].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, plain(v)]));
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, plain(v)]));
  return value;
}

export function diff(expected, actual, path = '', mismatches = []) {
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) diff(expected[key], actual[key], path ? `${path}.${key}` : key, mismatches);
  } else if (expected !== actual) mismatches.push({ path, expected: expected === undefined ? '(missing)' : expected, actual: actual === undefined ? '(missing)' : actual });
  return mismatches;
}

const sorted = rows => rows.map(plain).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function compareImport(data, db, legacy) {
  const problems = [];
  for (const name of ['players', 'teams', 'maps', 'tournaments', 'matches']) {
    diff([...data[name].keys()].sort(), db[name].map(x => x.id).sort(), `import.${name}.ids`, problems);
  }
  const expectedMatches = [...data.matches.values()].map(({ id, data: m }) => ({ id, tournament_id: m.tournamentId, status: m.status, team1_id: m.team1Id ?? null, team2_id: m.team2Id ?? null, winner_id: m.winnerId ?? null, score1: m.score1, score2: m.score2 }));
  const matchFields = Object.keys(expectedMatches[0] ?? {});
  diff(sorted(expectedMatches), sorted(db.matches.map(m => Object.fromEntries(matchFields.map(k => [k, m[k]])))), 'import.matches', problems);
  const expectedMaps = [...data.matches.values()].flatMap(m => m.data.roundDetails.map(r => ({ match_id: m.id, map_number: r.round_number, map_id: r.mapId, winner_team_id: legacy.getMapWinner(m, r) ?? null, mvp_player_id: r.mvp || null, result_note: r.resultNote ?? null, score_team1: null, score_team2: null })));
  diff(sorted(expectedMaps), sorted(db.match_maps), 'import.match_maps', problems);
  const expectedEntries = [...data.matches.values()].flatMap(m => m.data.playerStats.map(p => ({ match_id: m.id, player_id: p.uid || null, team_id: p.teamId, uid_snapshot: p.uid ?? null, ign_snapshot: p.ign ?? null, rounds: sorted(p.rounds.map(r => ({ map_number: r.round_number ?? null, kills: r.kills, deaths: r.deaths, assists: r.assists }))) })));
  const actualEntries = db.player_match_entries.map(e => ({ match_id: e.match_id, player_id: e.player_id, team_id: e.team_id, uid_snapshot: e.uid_snapshot, ign_snapshot: e.ign_snapshot, rounds: sorted(db.player_round_stats.filter(r => r.match_id === e.match_id && r.entry_index === e.entry_index).map(r => ({ map_number: r.map_number, kills: r.kills, deaths: r.deaths, assists: r.assists }))) }));
  diff(sorted(expectedEntries), sorted(actualEntries), 'import.player_entries', problems);
  return problems;
}

export function compareStatistics(data, db) {
  const legacy = loadLegacyStatistics();
  const mismatches = compareImport(data, db, legacy);
  const scopes = [];
  const ids = [...new Set([...data.tournaments.keys(), ...db.tournaments.map(t => t.id)])].sort();
  for (const tournamentId of [...ids, null]) {
    const name = tournamentId ?? 'overall';
    const matches = [...data.matches.values()].filter(m => !tournamentId || m.data.tournamentId === tournamentId);
    const expected = legacy.calculateStatistics(matches);
    const actual = calculateD1Statistics(db, tournamentId);
    for (const id of data.players.keys()) {
      ensure(expected.players, id, legacy.emptyStats);
      ensure(actual.players, id);
    }
    const start = mismatches.length;
    diff(plain(expected), plain(actual), name, mismatches);
    scopes.push({ name, players: expected.players.size, teams: expected.teams.size, maps: expected.maps.size, totals: plain(expected.totals), mismatches: mismatches.length - start });
  }
  return { mismatches, scopes };
}
