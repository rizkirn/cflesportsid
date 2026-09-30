import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkData, root } from '../scripts/data-tools.mjs';
import { calculateD1Statistics, compareStatistics } from '../scripts/d1-parity.mjs';

const schema = fs.readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0002_preserve_player_rounds.sql', import.meta.url), 'utf8');
const tableNames = ['players', 'teams', 'maps', 'tournaments', 'matches', 'match_maps', 'player_match_entries', 'player_round_stats'];
const snapshot = db => Object.fromEntries(tableNames.map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
const source = () => checkData().data;
function seed(data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd1-parity-'));
  try {
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/generate-d1-seed.mjs'), path.join(dir, 'scripts/generate-d1-seed.mjs'));
    for (const [name, entries] of Object.entries(data)) {
      fs.mkdirSync(path.join(dir, 'src/data', name), { recursive: true });
      for (const [id, entry] of entries) fs.writeFileSync(path.join(dir, 'src/data', name, `${id}.json`), JSON.stringify(entry.data));
    }
    execFileSync(process.execPath, [path.join(dir, 'scripts/generate-d1-seed.mjs')], { stdio: 'pipe' });
    return fs.readFileSync(path.join(dir, '.generated/seed-s1-s2.sql'), 'utf8');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function imported(data) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema); db.exec(migration); db.exec(seed(data));
  return db;
}

test('real seed matches every legacy statistic and all 127 registered players in all scopes', () => {
  const data = source(), db = imported(data);
  try {
    const report = compareStatistics(data, snapshot(db));
    assert.deepEqual(report.mismatches, []);
    assert.deepEqual(report.scopes.map(s => [s.players, s.totals.matchesPlayed, s.totals.mapsPlayed]), [[127, 13, 39], [127, 13, 39], [127, 26, 78]]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM player_map_stats').get().n, 712);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('import preserves unassigned/anonymous/empty rows, repeated maps, MVP-only players, transfers and unfinished matches', () => {
  const data = source();
  const template = structuredClone([...data.matches.values()][0]);
  const [p1, p2, p3, p4] = [...data.players.keys()];
  const [map1, map2] = [...data.maps.keys()];
  const a = template.data.team1Id, b = template.data.team2Id;
  const make = (id, overrides = {}) => ({ id, data: { ...structuredClone(template.data), status: 'completed', score1: 2, score2: 1, winnerId: a,
    roundDetails: [
      { round_number: 1, mapId: map1, winnerId: b, resultNote: '7-2', mvp: p3 },
      { round_number: 2, mapId: map2, resultNote: '7-0 (WO)' },
      { round_number: 3, mapId: map1, winnerId: a, resultNote: 'Awarded despite score' },
    ],
    playerStats: [
      { uid: p1, teamId: a, ign: "Player's name", rounds: [{ round_number: 1, kills: 10, deaths: 0, assists: 3 }, { round_number: 3, kills: 2, deaths: 1, assists: 0 }, { kills: 9, deaths: 4, assists: 2 }, { kills: 1, deaths: 1, assists: 1 }] },
      { uid: null, teamId: b, rounds: [{ round_number: 2, kills: 4, deaths: 3, assists: 1 }] },
      { teamId: null, rounds: [{ kills: 3, deaths: 2, assists: 0 }] },
      { uid: p2, teamId: null, rounds: [{ round_number: 2, kills: 5, deaths: 2, assists: 1 }] },
      { uid: p4, teamId: a, rounds: [] },
    ], ...overrides } });
  data.matches = new Map([
    ['edge', make('edge')],
    ['transfer', make('transfer', { playerStats: [{ uid: p1, teamId: b, rounds: [{ round_number: 1, kills: 1, deaths: 2, assists: 3 }] }] })],
    ['live', make('live', { status: 'live' })],
    ['upcoming', make('upcoming', { status: 'upcoming' })],
    ['sweep', make('sweep', { score1: 0, score2: 3, winnerId: b, roundDetails: [{ round_number: 1, mapId: map1 }], playerStats: [] })],
  ]);
  const db = imported(data);
  try {
    assert.deepEqual(compareStatistics(data, snapshot(db)).mismatches, []);
    const stats = calculateD1Statistics(snapshot(db));
    assert.equal(stats.players.get(p1).mapsPlayed, 5);
    assert.equal(stats.players.get(p1).matchesPlayed, 2);
    assert.equal(stats.players.get(p1).wins, 1);
    assert.equal(stats.players.get(p1).losses, 1);
    assert.equal(stats.players.get(p4).matchesPlayed, 0);
    assert.equal(stats.players.get(p3).mvpCount, 2);
    assert.equal(stats.totals.unassignedPlayerRounds, 3);
    assert.equal(stats.totals.unassignedMapKills, 13);
    const validation = fs.readFileSync(new URL('../scripts/validate-d1.sql', import.meta.url), 'utf8').replace(/--[^\n]*/g, '').split(';').filter(s => s.trim()).map(s => db.prepare(s).all());
    assert.equal(validation[1][0].kills, 35);
    assert.equal(validation[2].find(p => p.player_id === p1).kills, 23);
    assert.equal(validation[2].find(p => p.player_id === p1).maps_played, 5);
    assert.equal(stats.maps.get(map1).players.get(p1).matchesPlayed, 2);
    assert.equal(stats.maps.get(map1).players.get(p1).wins, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM match_maps WHERE score_team1 IS NOT NULL OR score_team2 IS NOT NULL').get().n, 0);
    assert.equal(db.prepare("SELECT winner_team_id FROM match_maps WHERE match_id='sweep'").get().winner_team_id, b);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('migration upgrades populated 0001 without reseeding and clears unverified score orientation', () => {
  const data = source(), fresh = imported(data), old = new DatabaseSync(':memory:');
  try {
    const rows = fresh.prepare('SELECT * FROM player_map_stats').all();
    old.exec(schema);
    const baseSeed = seed(data).split('\n').filter(line => !line.startsWith('INSERT INTO player_match_entries') && !line.startsWith('INSERT INTO player_round_stats')).join('\n');
    old.exec(baseSeed);
    const put = old.prepare('INSERT INTO player_map_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of rows) put.run(r.match_id, r.map_number, r.player_id, r.team_id, r.uid_snapshot, r.ign_snapshot, r.kills, r.deaths, r.assists);
    old.exec('UPDATE match_maps SET score_team1 = 7, score_team2 = 2');
    old.exec(migration);
    assert.deepEqual(compareStatistics(data, snapshot(old)).mismatches, []);
    assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM player_map_stats').get().n, 712);
  } finally { fresh.close(); old.close(); }
});

test('checker exposes compensating K/D/A corruption, omitted players, map winners and stale score assumptions', () => {
  const data = source(), db = imported(data);
  try {
    const rows = snapshot(db);
    rows.player_round_stats[0].kills++;
    rows.player_round_stats.find(r => r.match_id === rows.player_round_stats[0].match_id && r.entry_index !== rows.player_round_stats[0].entry_index).kills--;
    rows.match_maps[0].winner_team_id = null;
    rows.match_maps[0].score_team1 = 7;
    rows.players.pop();
    const report = compareStatistics(data, rows);
    assert.ok(report.mismatches.some(m => m.path.startsWith('import.players.ids')));
    assert.ok(report.mismatches.some(m => m.path.endsWith('.score_team1')));
    assert.ok(report.mismatches.some(m => m.path.endsWith('.winner_team_id')));
    assert.ok(report.mismatches.some(m => m.path.startsWith('overall.players.') && m.path.endsWith('.kills')));
    assert.ok(report.mismatches.some(m => m.path.startsWith('overall.maps.')));
    assert.ok(compareStatistics(data, Object.fromEntries(tableNames.map(t => [t, []]))).mismatches.length > 0);
  } finally { db.close(); }
});

test('unknown numbered maps and unknown MVP identities fail import instead of silently losing data', () => {
  for (const mutate of [m => { m.playerStats[0].rounds[0].round_number = 999; }, m => { m.roundDetails[0].mvp = 'missing-player'; }]) {
    const data = source(); mutate([...data.matches.values()][0].data);
    assert.throws(() => seed(data));
  }
});
