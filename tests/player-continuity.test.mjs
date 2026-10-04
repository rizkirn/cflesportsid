import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { checkData } from '../scripts/data-tools.mjs';
import { loadLegacyStatistics, plain } from '../scripts/d1-parity.mjs';
import { readD1Matches, readMatches } from '../src/data-access/matches.mjs';
import * as continuity from '../src/utils/player-continuity.mjs';

const { calculateStatistics } = loadLegacyStatistics();
const { data } = checkData();
const matches = [...data.matches.values()];
const profiles = continuity.statisticalProfiles([...data.players.values()]);
const uid = '1345266890';
const historical = continuity.historicalPlayerKey(continuity.playerContinuitySplits[0]);
const kda = s => [s.kills, s.deaths, s.assists];
const fixture = (uid, ign, tournamentId = 'clash-for-glory-s2') => ({ id: uid + ign, data: {
  tournamentId, status: 'completed', team1Id: 'a', team2Id: 'b', winnerId: 'a',
  score1: 1, score2: 0, roundDetails: [{ round_number: 1, mapId: 'desert', mvp: uid }],
  playerStats: [{ uid, ign, teamId: 'a', rounds: [{ round_number: 1, kills: 5, deaths: 2, assists: 3 }] }],
} });

test('same UID with an IGN rename remains continuous without an explicit boundary', () => {
  const result = calculateStatistics([fixture('1083796629', 'HL.danilTVJ', 'clash-for-glory-s1'), fixture('1083796629', 'HWL,DANILTVJ')]);
  assert.equal(result.players.size, 1);
  assert.deepEqual(kda(result.players.get('1083796629')), [10, 4, 6]);
  assert.equal(result.players.get('1083796629').mvpCount, 2);
});

test('different UIDs never merge, even when their IGN is identical', () => {
  const result = calculateStatistics([fixture('old-account', 'KucayyPRMX'), fixture(uid, 'KucayyPRMX')]);
  assert.equal(result.players.size, 2);
  assert.equal(result.players.get(uid).kills, 5);
});

test('confirmed boundary gives KangDedy only original S1 KDA and MVP', () => {
  const result = calculateStatistics(matches);
  assert.deepEqual(kda(result.players.get(historical)), [70, 40, 42]);
  assert.equal(result.players.get(historical).matchesPlayed, 3);
  assert.equal(result.players.get(historical).mapsPlayed, 9);
  assert.equal(result.players.get(historical).mvpCount, 1);
});

test('current UID profile gets only S2 KucayyPRMX KDA and MVP', () => {
  const result = calculateStatistics(matches);
  assert.deepEqual(kda(result.players.get(uid)), [50, 16, 24]);
  assert.equal(result.players.get(uid).matchesPlayed, 2);
  assert.equal(result.players.get(uid).mapsPlayed, 6);
  assert.equal(result.players.get(uid).mvpCount, 1);
});

test('boundary uses tournament identity, unaffected by match dates or IGN spelling', () => {
  const before = fixture(uid, 'Any IGN', 'clash-for-glory-s1'); before.data.date = '2099-01-01';
  const after = fixture(uid, 'Any IGN'); after.data.date = '1900-01-01';
  const result = calculateStatistics([before, after, fixture(uid, 'Another IGN', 'future-cup')]);
  assert.equal(result.players.get(historical).kills, 5);
  assert.equal(result.players.get(uid).kills, 10);
});

test('another confirmed UID boundary requires configuration only', () => {
  const splits = [{ uid: 'another', fromTournament: 'new-cup', beforeTournaments: ['old-cup'], previous: { ign: 'Old owner', team: 'a' } }];
  assert.equal(continuity.statisticalPlayerKey('another', 'old-cup', splits), 'another--before-new-cup');
  assert.equal(continuity.statisticalPlayerKey('another', 'new-cup', splits), 'another');
  assert.equal(continuity.statisticalPlayerKey('unrelated', 'old-cup', splits), 'unrelated');
});

test('profiles retain raw UID, deterministic URLs, historical name and team without borrowing socials', () => {
  const old = profiles.find(p => p.id === historical), current = profiles.find(p => p.id === uid);
  assert.equal(old.data.uid, uid); assert.equal(old.data.ign, 'KangDedy');
  assert.equal(old.data.team, 'cha-tra-mue'); assert.equal(old.data.socials, undefined);
  assert.equal(current.data.ign, 'KucayyPRMX');
  assert.equal(continuity.matchPlayerProfile([...data.players.values()], uid, 'clash-for-glory-s1').id, historical);
  assert.equal(continuity.matchPlayerProfile([...data.players.values()], uid, 'clash-for-glory-s2').id, uid);
  assert.notEqual(profiles.find(p => p.id === '1080212105').id, current.id);
});

test('golden S1, S2 and overall raw totals and sum of leaderboard rows are unchanged', () => {
  for (const [scope, expected] of [['clash-for-glory-s1', [2726, 2731, 1185]], ['clash-for-glory-s2', [2293, 2279, 1133]], [null, [5019, 5010, 2318]]]) {
    const result = calculateStatistics(matches.filter(m => !scope || m.data.tournamentId === scope));
    assert.deepEqual(kda(result.totals), expected);
    assert.deepEqual(['kills', 'deaths', 'assists'].map(key => [...result.players.values()].reduce((n, p) => n + p[key], 0)), expected);
  }
});

const source = fs.readFileSync(new URL('../src/utils/statistics.ts', import.meta.url), 'utf8');
const originalContext = { exports: {}, require: () => ({ statisticalPlayerKey: uid => uid }) };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, originalContext);

test('team and map team statistics are identical to unsplit UID aggregation', () => {
  const before = originalContext.exports.calculateStatistics(matches), after = calculateStatistics(matches);
  assert.deepEqual(plain(after.teams), plain(before.teams));
  assert.deepEqual(plain(after.totals), plain(before.totals));
  for (const [id, map] of after.maps) assert.deepEqual(plain(map.teams), plain(before.maps.get(id).teams));
});

test('sum of every additive player leaderboard metric is preserved by splitting rows', () => {
  const before = originalContext.exports.calculateStatistics(matches), after = calculateStatistics(matches);
  for (const key of ['kills', 'deaths', 'assists', 'matchesPlayed', 'mapsPlayed', 'wins', 'losses', 'mvpCount']) {
    const sum = result => [...result.players.values()].reduce((total, player) => total + player[key], 0);
    assert.equal(sum(after), sum(before), key);
  }
});

test('single-tournament leaderboard scores remain unchanged, with only historical display identity corrected', () => {
  for (const scope of ['clash-for-glory-s1', 'clash-for-glory-s2']) {
    const rows = matches.filter(m => m.data.tournamentId === scope);
    const before = originalContext.exports.calculateStatistics(rows), after = calculateStatistics(rows);
    assert.equal(after.players.size, before.players.size);
    for (const [id, stats] of before.players) assert.deepEqual(plain(after.players.get(continuity.statisticalPlayerKey(id, scope))), plain(stats));
  }
});

test('D1 output and outage JSON fallback retain identical continuity splits without rewriting raw rows', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    for (const f of fs.readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sql.exec(fs.readFileSync('migrations/' + f, 'utf8'));
    execFileSync(process.execPath, ['scripts/generate-d1-seed.mjs']);
    sql.exec(fs.readFileSync('.generated/seed-s1-s2.sql', 'utf8'));
    const before = sql.prepare('SELECT * FROM player_match_entries ORDER BY match_id, entry_index').all();
    const db = { prepare: q => q, batch: async queries => queries.map(q => ({ success: true, results: sql.prepare(q).all() })) };
    const d1 = await readD1Matches(db, matches);
    const fallback = await readMatches({ db: { prepare: q => q, batch: async () => { throw Error('offline'); } }, loadJSON: async () => matches });
    assert.equal(fallback.source, 'json');
    assert.deepEqual(plain(calculateStatistics(d1)), plain(calculateStatistics(fallback.matches)));
    assert.deepEqual(sql.prepare('SELECT * FROM player_match_entries ORDER BY match_id, entry_index').all(), before);
    assert.deepEqual(kda(calculateStatistics(d1).players.get(historical)), [70, 40, 42]);
  } finally { sql.close(); }
});
