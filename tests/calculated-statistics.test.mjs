import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/utils/statistics.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} }; vm.runInNewContext(code, context);
const { calculateStatistics, emptyStats, kdRatio, kdaRatio, getMapWinner } = context.exports;
const stats = (kills, deaths, assists, round_number) => ({ kills, deaths, assists, ...(round_number ? { round_number } : {}) });
const fixture = () => ({ id: 'test', data: {
  status: 'completed', team1Id: 'a', team2Id: 'b', winnerId: 'a',
  roundDetails: [{ round_number: 1, mapId: 'desert', mvp: 'p1' }, { round_number: 2, mapId: 'port' }, { round_number: 3, mapId: 'desert' }],
  playerStats: [
    { uid: 'p1', teamId: 'a', rounds: [stats(10, 2, 3, 1), stats(4, 3, 2, 3)] },
    { uid: 'p2', teamId: 'b', rounds: [stats(6, 4, 1, 2)] },
    { uid: 'p3', teamId: 'a', rounds: [stats(9, 5, 4)] },
  ],
} });

test('completed matches are counted once and live/upcoming stats are excluded', () => {
  const m = fixture();
  const result = calculateStatistics([m, { ...m, data: { ...m.data, status: 'live' } }, { ...m, data: { ...m.data, status: 'upcoming' } }]);
  assert.equal(result.totals.matchesPlayed, 1); assert.equal(result.totals.kills, 29);
  assert.equal(result.players.get('p1').matchesPlayed, 1); assert.equal(result.players.get('p1').mvpCount, 1);
  assert.equal(result.teams.get('a').wins, 1); assert.equal(result.teams.get('b').losses, 1);
});

test('explicit map numbers assign substitutes to the correct map', () => {
  const result = calculateStatistics([fixture()]);
  assert.equal(result.maps.get('port').kills, 6);
  assert.equal(result.maps.get('desert').kills, 14);
  assert.equal(result.maps.get('desert').mapsPlayed, 2);
  assert.equal(result.maps.get('desert').matchesPlayed, 1);
  assert.equal(result.maps.get('desert').players.get('p1').matchesPlayed, 1);
});

test('unknown map numbers stay in career/team totals without contaminating map totals', () => {
  const result = calculateStatistics([fixture()]);
  assert.equal(result.players.get('p3').kills, 9); assert.equal(result.teams.get('a').kills, 23);
  assert.equal(result.totals.unassignedPlayerRounds, 1); assert.equal(result.totals.unassignedMapKills, 9);
  assert.equal([...result.maps.values()].reduce((sum, map) => sum + map.kills, 0) + result.totals.unassignedMapKills, result.totals.kills);
});

test('transfers split historical team totals but preserve a single player career', () => {
  const first = fixture(); const second = fixture(); second.id = 'second';
  second.data.playerStats = [{ uid: 'p1', teamId: 'b', rounds: [stats(7, 1, 2, 2)] }];
  const result = calculateStatistics([first, second]);
  assert.equal(result.players.get('p1').kills, 21); assert.equal(result.players.get('p1').matchesPlayed, 2);
  assert.equal(result.teams.get('a').kills, 23); assert.equal(result.teams.get('b').kills, 13);
  assert.equal(result.players.get('p1').wins, 1); assert.equal(result.players.get('p1').losses, 1);
});

test('K/D and KDA formulas handle zero deaths without Infinity', () => {
  assert.equal(kdRatio(emptyStats()), 0); assert.equal(kdaRatio(stats(5, 0, 2)), 7);
  assert.equal(kdRatio(stats(6, 2, 4)), 3); assert.equal(kdaRatio(stats(6, 2, 4)), 5);
});

test('real data reconciles player, team and map totals', () => {
  const files = fs.readdirSync(new URL('../src/data/matches/', import.meta.url)).filter(f => f.endsWith('.json'));
  const matches = files.map(f => ({ id: f.slice(0, -5), data: JSON.parse(fs.readFileSync(new URL('../src/data/matches/' + f, import.meta.url))) }));
  const result = calculateStatistics(matches.filter(m => m.data.tournamentId === 'clash-for-glory-s1'));
  for (const key of ['kills', 'deaths', 'assists']) {
    assert.equal([...result.players.values()].reduce((sum, s) => sum + s[key], 0), result.totals[key]);
    assert.equal([...result.teams.values()].reduce((sum, s) => sum + s[key], 0), result.totals[key]);
    assert.equal([...result.maps.values()].reduce((sum, s) => sum + s[key], 0), result.totals[key]);
  }
  assert.equal(result.totals.matchesPlayed, 13); assert.equal(result.totals.mapsPlayed, 39);
  assert.equal(result.totals.kills, 2726); assert.equal(result.totals.deaths, 2731); assert.equal(result.totals.assists, 1185);
  assert.equal(result.totals.unassignedPlayerRounds, 0);
  assert.equal(result.totals.unassignedMapKills, 0);
  assert.equal(result.players.get('1551933778').kills, 51);
});


test('map winners use sweep results or explicit winners, never a guess from split scores', () => {
  const m = fixture();
  Object.assign(m.data, { score1: 3, score2: 0 });
  assert.equal(getMapWinner(m, m.data.roundDetails[0]), 'a');
  Object.assign(m.data, { score1: 2, score2: 1 });
  assert.equal(getMapWinner(m, m.data.roundDetails[0]), undefined);
  m.data.roundDetails[0].winnerId = 'b';
  assert.equal(getMapWinner(m, m.data.roundDetails[0]), 'b');
  const result = calculateStatistics([m]);
  assert.equal(result.maps.get('desert').knownResults, 1);
  assert.equal(result.maps.get('desert').teams.get('b').wins, 1);
  assert.equal(result.maps.get('desert').teams.get('a').losses, 1);
});
