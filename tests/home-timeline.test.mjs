import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const homepage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const timelineSource = homepage.slice(homepage.indexOf('const seasons ='), homepage.indexOf('const placements ='));
const ids = ['clash-for-glory-s1', 'clash-for-glory-s2', 'clash-for-glory-road-to-all-star-s3', 'clash-for-glory-road-to-all-star-s4'];
function timeline(tournaments) {
  return vm.runInNewContext(`${timelineSource}\nseasons`, { timelineTournaments: tournaments });
}

test('homepage timeline recognizes all four D1 IDs independently of display names and preserves links', () => {
  const tournaments = ids.map((id, index) => ({ id, data: { name: `Tournament ${index + 1}`, status: 'completed' } }));
  const before = JSON.stringify(tournaments);
  const result = timeline(tournaments);
  assert.deepEqual(Array.from(result, season => season.tournament.id), ids);
  assert.deepEqual(Array.from(result, season => season.status), Array(4).fill('completed'));
  assert.equal(JSON.stringify(tournaments), before);
});

test('timeline reads changing statuses from data and leaves absent seasons planned', () => {
  const result = timeline([
    { id: ids[0], data: { name: 'First tournament', status: 'completed' } },
    { id: ids[2], data: { name: 'Third tournament', status: 'ongoing' } },
    { id: ids[3], data: { name: 'Fourth tournament', status: 'upcoming' } },
  ]);
  assert.deepEqual(Array.from(result, season => season.status), ['completed', null, 'ongoing', 'upcoming']);
  assert.equal(result[1].tournament, undefined);
});

test('canonical IDs take precedence over ambiguous names, while legacy name matching remains available', () => {
  const result = timeline([
    { id: 'unrelated', data: { name: 'Other S3', status: 'upcoming' } },
    { id: ids[2], data: { name: 'Third tournament', status: 'completed' } },
    { id: 'legacy-season', data: { name: 'Road to All-Star S2', status: 'ongoing' } },
    { id: 'clash-for-glory-s10', data: { name: 'Season ten', status: 'completed' } },
  ]);
  assert.equal(result[0].tournament, undefined);
  assert.equal(result[1].tournament.id, 'legacy-season');
  assert.equal(result[2].tournament.id, ids[2]);
  assert.equal(result[2].status, 'completed');
});

async function dataAccessFixture() {
  const ts = (await import('typescript')).default;
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const modes = await import('../src/data-access/public-mode.mjs');
  const all = ids.map(id => ({ id, data: { name: id, status: 'completed' } }));
  const legacy = all.slice(0, 2);
  const snapshot = { tournaments: all };
  let legacyReads = 0;
  function load(file, imports) {
    const exports = {};
    const source = readFileSync(new URL(`../src/data-access/${file}.ts`, import.meta.url), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, console, URL, Response });
    return exports;
  }
  const publicAccess = load('frontend-public', {
    'node:async_hooks': { AsyncLocalStorage },
    '../utils/statistics': {}, '../utils/player-continuity.mjs': {}, '../utils/cfg-membership.mjs': {},
    './public-d1.mjs': { readPublicData: async () => snapshot },
    './public-mode.mjs': modes, './shadow-contract.mjs': {},
  });
  const db = {
    prepare: sql => ({ sql }),
    batch: async () => [
      all.map(t => ({ id: t.id, name: t.data.name, status: t.data.status })),
      all.map(t => ({ tournament_id: t.id, id: 'playoffs', name: 'Playoffs' })), [], [], [],
    ].map(results => ({ success: true, results })),
  };
  const imports = {
    './frontend-public': publicAccess,
    'astro:content': { getCollection: async () => { legacyReads++; return legacy; } },
    'cloudflare:workers': { env: { DB: db } },
    '../utils/assets.mjs': {
      overlayAssetReferences: entries => entries,
      readAssetReferences: async (_db, entries) => entries,
    },
  };
  return { ...load('frontend-bracket', imports), ...load('frontend-assets', imports),
    publicAccess, db, legacyReads: () => legacyReads };
}

test('partial S1/S2 asset collection reproduces missing seasons; shared tournament loader restores S3/S4', async () => {
  const access = await dataAccessFixture();
  const partial = await access.getAssetCollection('tournaments');
  assert.equal(partial.length, 2);
  assert.deepEqual(Array.from(timeline(partial), season => season.status), ['completed', 'completed', null, null]);
  const authoritative = await access.getFrontendTournaments();
  assert.deepEqual(Array.from(timeline(authoritative), season => season.status), Array(4).fill('completed'));
  assert.deepEqual(Array.from(authoritative, t => t.id), ids);
});

test('production D1 mode gives both loaders the same complete request snapshot without reading S1/S2 legacy data', async () => {
  const access = await dataAccessFixture();
  const { PRODUCTION_PUBLIC: target } = await import('../src/data-access/public-mode.mjs');
  const bindings = {
    CFL_PUBLIC_MODE: 'd1', CFL_PUBLIC_ENVIRONMENT: 'production', CFL_PUBLIC_ACCOUNT_ID: target.account,
    CFL_PUBLIC_WORKER: target.worker, CFL_PUBLIC_HOSTNAME: target.hostname, CFL_PUBLIC_DATABASE_ID: target.database,
    DB: access.db, CFL_ASSETS: { get() {} }, ASSETS: { fetch() {} },
  };
  for (const path of ['/', '/tournament']) {
    await access.publicAccess.publicRequest(bindings, false, new URL(`https://${target.hostname}${path}`), async () => {
      const tournaments = await access.getFrontendTournaments();
      assert.equal(tournaments, await access.getAssetCollection('tournaments'));
      assert.deepEqual(Array.from(timeline(tournaments), season => season.status), Array(4).fill('completed'));
      return new Response('ok');
    });
  }
  assert.equal(access.legacyReads(), 0);
});

test('homepage timeline and tournament index are wired to the same authoritative loader without changing standings input', () => {
  const index = readFileSync(new URL('../src/pages/tournament/index.astro', import.meta.url), 'utf8');
  assert.match(homepage, /import \{ getFrontendTeams, getFrontendTournaments \} from '..\/data-access\/frontend-bracket'/);
  assert.match(homepage, /const timelineTournaments = await getFrontendTournaments\(\)/);
  assert.match(index, /const allTournaments = await getFrontendTournaments\(\)/);
  assert.match(timelineSource, /timelineTournaments\.find/);
  assert.match(homepage, /const standings = await getFrontendStandings\(\)/);
});
