import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkData } from '../scripts/data-tools.mjs';
import { compareReadMatches } from '../scripts/d1-read-parity.mjs';
import { loadLegacyStatistics, plain } from '../scripts/d1-parity.mjs';
import { matchReadQueries, readD1Matches, readMatches } from '../src/data-access/matches.mjs';

const legacy = [...checkData().data.matches.values()];
const stats = loadLegacyStatistics();
function binding() {
  const sql = new DatabaseSync(':memory:');
  for (const file of ['0001_initial_schema.sql', '0002_preserve_player_rounds.sql', '0003_tournament_rosters.sql', '0004_match_detail_edits.sql','0005_walkovers.sql']) sql.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  execFileSync(process.execPath, ['scripts/generate-d1-seed.mjs']);
  sql.exec(readFileSync(new URL('../.generated/seed-s1-s2.sql', import.meta.url), 'utf8'));
  return { sql, prepare: query => query, batch: async queries => queries.map(query => ({ success: true, results: sql.prepare(query).all() })) };
}
const normalized = matches => matches.map(m => ({ id: m.id, data: { ...m.data,
  roundDetails: m.data.roundDetails.map(r => ({ ...r, winnerId: stats.getMapWinner(m, r) })) } }));

test('D1 binding output preserves all legacy match fields and existing statistics for S1, S2 and overall', async () => {
  const db = binding();
  try {
    const output = await readD1Matches(db, legacy);
    assert.deepEqual(normalized(output), normalized(legacy));
    assert.deepEqual(compareReadMatches(legacy, output), []);
    for (const tournamentId of [null, ...checkData().data.tournaments.keys()]) {
      const scope = rows => rows.filter(m => !tournamentId || m.data.tournamentId === tournamentId);
      assert.deepEqual(plain(stats.calculateStatistics(scope(output))), plain(stats.calculateStatistics(scope(legacy))));
    }
    assert.equal(output.length, legacy.length);
    assert.ok(matchReadQueries.every(q => q.startsWith('SELECT ')));
  } finally { db.sql.close(); }
});

test('missing binding, query errors, malformed results and incomplete migration fall back atomically', async () => {
  const db = binding();
  try {
    db.sql.exec('DELETE FROM player_round_stats; DELETE FROM player_match_entries; DELETE FROM match_maps; DELETE FROM match_sources; DELETE FROM matches;');
    for (const broken of [undefined, db, { prepare: q => q, batch: async () => { throw new Error('offline'); } }, { prepare: q => q, batch: async () => [] }]) {
      let reason;
      const output = await readMatches({ db: broken, loadJSON: async () => legacy, onFallback: e => { reason = e; } });
      assert.equal(output.source, 'json'); assert.equal(output.matches, legacy); assert.ok(reason instanceof Error);
    }
  } finally { db.sql.close(); }
});

test('D1 is authoritative for stored fields and does not mutate JSON', async () => {
  const db = binding();
  try {
    const before = structuredClone(legacy);
    db.sql.exec('UPDATE player_round_stats SET kills = kills + 1');
    const output = await readMatches({ db, loadJSON: async () => legacy });
    assert.equal(output.source, 'd1');
    assert.notDeepEqual(plain(stats.calculateStatistics(output.matches)), plain(stats.calculateStatistics(legacy)));
    assert.deepEqual(legacy, before);
    db.sql.exec('UPDATE player_round_stats SET kills = -1');
    assert.equal((await readMatches({ db, loadJSON: async () => legacy })).source, 'json');
  } finally { db.sql.close(); }
});

test('a missing child row triggers fallback instead of displaying partial statistics', async () => {
  const db = binding();
  try {
    db.sql.exec('DELETE FROM player_round_stats WHERE rowid = (SELECT rowid FROM player_round_stats LIMIT 1)');
    assert.equal((await readMatches({ db, loadJSON: async () => legacy })).source, 'json');
  } finally { db.sql.close(); }
});

test('unknown attribution, anonymous players, empty entries, sources and unfinished matches survive shaping', async () => {
  const db = binding();
  try {
    const snapshot = structuredClone(legacy);
    const target = snapshot[0];
    const id = target.id;
    db.sql.prepare('UPDATE player_round_stats SET map_number = NULL WHERE match_id = ?').run(id);
    target.data.playerStats.forEach(e => e.rounds.forEach(r => { delete r.round_number; }));
    db.sql.prepare('UPDATE player_match_entries SET uid_snapshot = NULL, player_id = NULL, team_id = NULL WHERE match_id = ?').run(id);
    target.data.playerStats.forEach(e => { e.uid = null; e.teamId = null; });
    const output = await readD1Matches(db, snapshot);
    assert.deepEqual(normalized(output), normalized(snapshot));
    assert.deepEqual(plain(stats.calculateStatistics(output)), plain(stats.calculateStatistics(snapshot)));
    db.sql.prepare("UPDATE matches SET status = 'live' WHERE id = ?").run(id);
    target.data.status = 'live';
    const live = await readD1Matches(db, snapshot);
    assert.deepEqual(plain(stats.calculateStatistics(live)), plain(stats.calculateStatistics(snapshot)));
  } finally { db.sql.close(); }
});

test('read comparison detects non-statistical field changes even when totals remain equal', async () => {
  const db = binding();
  try {
    db.sql.exec("UPDATE matches SET date = '2026-01-01'");
    const output = await readD1Matches(db, legacy);
    const mismatches = compareReadMatches(legacy, output);
    assert.ok(mismatches.some(m => m.path.endsWith('.date')));
    assert.ok(mismatches.every(m => m.path.startsWith('read.matches.')));
  } finally { db.sql.close(); }
});
