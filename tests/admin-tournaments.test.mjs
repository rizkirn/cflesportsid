import {testAdminDatabase} from './helpers/admin-database.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { AdminError, requireLocalAdmin, readCreateForm, validateTournament, tournamentId, createTournament, listTournaments, getTournament } from '../src/admin/tournaments.mjs';

const input = { name: 'Clash for Glory S3', start_date: '2026-11-01', end_date: '2026-11-02' };
const request = (fields = input, options = {}) => new Request('http://127.0.0.1:4321/admin/tournaments/new', {
  method: 'POST', headers: { origin: 'http://127.0.0.1:4321', 'content-type': 'application/x-www-form-urlencoded', ...options.headers },
  body: options.body ?? new URLSearchParams(fields),
});

test('admin denies deployments, non-loopback, forwarded requests and missing staging without consulting production', () => {
  const staging = {}; const env = { cflesportsid_staging: staging, get DB() { throw new Error('Production accessed'); } };
  assert.equal(requireLocalAdmin(request(), true, env), staging);
  assert.equal(requireLocalAdmin(request(input, { headers: { 'x-forwarded-host': '127.0.0.1:4321' } }), true, env), staging);
  for (const req of [new Request('https://cflesportsid.pages.dev/admin'), request(input, { headers: { forwarded: 'host=localhost' } }), request(input, { headers: { 'x-forwarded-for': '127.0.0.1' } }), request(input, { headers: { 'x-forwarded-host': 'evil.example' } })]) {
    assert.throws(() => requireLocalAdmin(req, true, env), e => e.status === 403);
  }
  assert.throws(() => requireLocalAdmin(request(), false, env), e => e.status === 403);
  assert.throws(() => requireLocalAdmin(request(), true, { DB: {} }), e => e.status === 503);
});

test('form enforces Origin, request metadata, media type, size and exact fields', async () => {
  assert.deepEqual(await readCreateForm(request()), input);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    await assert.rejects(readCreateForm(request(input, { headers })), e => e.status === 403);
  }
  await assert.rejects(readCreateForm(request(input, { headers: { 'content-type': 'application/json' } })), e => e.status === 415);
  await assert.rejects(readCreateForm(request(input, { body: 'x'.repeat(4097) })), e => e.status === 413);
  await assert.rejects(readCreateForm(request(input, { body: 'name=One&name=Two' })), AdminError);
  await assert.rejects(readCreateForm(request({ ...input, status: 'completed' })), AdminError);
});

test('validates real dates, order, required fields and bounded readable names', () => {
  assert.equal(validateTournament({ ...input, name: '  Clash   for Glory S3  ' }).name, input.name);
  for (const value of [{ ...input, name: 'ab' }, { ...input, name: 'x'.repeat(121) }, { ...input, name: 'Bad\nName' }, { ...input, name: 'Bad\u200bName' }, { ...input, start_date: '' }, { ...input, start_date: '2026-02-30' }, { ...input, end_date: '2026-10-31' }, { ...input, end_date: '0000-01-01' }]) {
    assert.throws(() => validateTournament(value), AdminError);
  }
  assert.doesNotThrow(() => validateTournament({ ...input, end_date: input.start_date }));
});

test('stable slug handles accents, punctuation, case and names without ASCII', async () => {
  assert.equal(await tournamentId(input.name), 'clash-for-glory-s3');
  assert.equal(await tournamentId(' CLASH for Glory S3 '), 'clash-for-glory-s3');
  assert.equal(await tournamentId('Café Cup!'), 'cafe-cup');
  assert.match(await tournamentId('冠军联赛'), /^tournament-[a-f0-9]{24}$/);
  assert.equal(await tournamentId('冠军联赛'), await tournamentId('冠军联赛'));
});

test('real schema insert preserves server defaults, collisions and foreign key integrity', async () => {
  const sqlite = new DatabaseSync(':memory:');

  sqlite.exec(readFileSync('migrations/0001_initial_schema.sql', 'utf8'));
  const rawDb = { prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    };
  } };
sqlite.exec(readFileSync('migrations/0010_admin_audit_log.sql','utf8'));
const db=testAdminDatabase(rawDb,sqlite);

  try {
    const id = await createTournament(db, { ...input, game: 'evil', status: 'completed', winner_team_id: 'evil' });
    assert.equal(id, 'clash-for-glory-s3');
    const row = await getTournament(db, id);
    assert.equal(row.game, 'crossfire-legends'); assert.equal(row.region, 'ID');
    assert.equal(row.status, 'upcoming'); assert.equal(row.format, 'single-elimination');
    assert.equal(row.winner_team_id, null); assert.equal(row.start_date, input.start_date);
    await assert.rejects(createTournament(db, { ...input, name: 'CLASH FOR GLORY S3' }), e => e.status === 409);
    assert.equal((await listTournaments(db)).length, 1);
    assert.equal(await getTournament(db, "' OR 1=1--"), null);
    assert.equal(await getTournament(db, 'missing'), null);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    const hostile = "Cup '); DROP TABLE tournaments;--";
    await createTournament(db, { ...input, name: hostile });
    assert.equal((await listTournaments(db)).length, 2);
  } finally { sqlite.close(); }
});
