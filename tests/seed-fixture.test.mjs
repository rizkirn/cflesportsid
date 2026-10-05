import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const exec = promisify(execFile);

test('concurrent seed fixtures preserve the checkout seed and produce complete isolated imports', async () => {
  const shared = new URL('../.generated/seed-s1-s2.sql', import.meta.url);
  const before = existsSync(shared) ? {bytes: readFileSync(shared), mtime: statSync(shared).mtimeMs} : null;
  const helper = new URL('./helpers/seed-fixture.mjs', import.meta.url).href;
  const runs = await Promise.all(Array.from({length: 4}, () => exec(process.execPath,
    ['--input-type=module', '-e', `import {seedFixture} from ${JSON.stringify(helper)};process.stdout.write(seedFixture());`], {maxBuffer: 1024 * 1024})));
  assert.ok(runs[0].stdout.length > 0);
  for (const run of runs) assert.equal(run.stdout, runs[0].stdout);
  if (before) {
    assert.deepEqual(readFileSync(shared), before.bytes);
    assert.equal(statSync(shared).mtimeMs, before.mtime);
  } else assert.equal(existsSync(shared), false);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../migrations/0001_initial_schema.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('../migrations/0002_preserve_player_rounds.sql', import.meta.url), 'utf8'));
    db.exec(runs[0].stdout);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players').get().n, 127);
    assert.deepEqual({...db.prepare('SELECT SUM(kills) AS k, SUM(deaths) AS d, SUM(assists) AS a FROM player_round_stats').get()}, {k: 5019, d: 5010, a: 2318});
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {db.close();}
});
