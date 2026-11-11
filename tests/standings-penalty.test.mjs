import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as continuity from '../src/utils/player-continuity.mjs';
import * as assets from '../src/utils/assets.mjs';

function load(file, imports = {}) {
  const context = { exports: {}, require: name => imports[name] };
  const source = fs.readFileSync(new URL(`../src/utils/${file}.ts`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const { getOverallStandings } = load('standings', {
  './assets.mjs': assets,
  './statistics': load('statistics', { './player-continuity.mjs': continuity }),
  './tournament': load('tournament'),
});

test('penalty changes overall ranking without changing earned points or match data', () => {
  const teams = [
    { id: 'howl', data: { name: 'HOWL', penalties: [{ tournamentId: 's2', points: 30, reason: 'Administrative penalty (S2)' }] } },
    { id: 'ctm', data: { name: 'CTM' } },
  ];
  const matches = [{ data: {
    tournamentId: 's2', stageId: 'playoffs', roundId: 'final', status: 'completed',
    team1Id: 'howl', team2Id: 'ctm', winnerId: 'howl', roundDetails: [],
    playerStats: [
      { uid: 'a', teamId: 'howl', rounds: [{ kills: 100, deaths: 0, assists: 0 }] },
      { uid: 'b', teamId: 'ctm', rounds: [{ kills: 90, deaths: 0, assists: 0 }] },
    ],
  } }];
  const tournaments = [{ id: 's2', data: { stages: [{ id: 'playoffs', rounds: [{ id: 'final', placement: 1 }] }] } }];
  const before = JSON.stringify(matches);
  const result = getOverallStandings(teams, matches, tournaments);
  assert.equal(result[0].id, 'ctm');
  assert.equal(result[0].totalScore, 96);
  const howl = result.find(t => t.id === 'howl');
  assert.equal(howl.killPoints, 100);
  assert.equal(howl.placementPoints, 10);
  assert.equal(howl.totalScore, 80);
  assert.equal(howl.penaltyPoints, 30);
  assert.equal(JSON.stringify(matches), before);
});

test('D1-only contender displaces legacy K2 at the cutoff with all season placement points and penalties preserved', async () => {
  // Synthetic scores reproduce incomplete collection behavior, not live production totals.
  const teams = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `leader-${i}`, data: { name: `Leader ${i}` } })),
    { id: 'k2-evolve', data: { name: 'K2 EVOLVE', penalties: [{ tournamentId: 's4', points: 30, reason: 'TM absence' }] } },
    { id: 'd1-biawak', data: { name: 'BIAWAK Esports' } },
  ];
  const matches = [{ data: {
    tournamentId: 's4', stageId: 'playoffs', roundId: 'final', status: 'completed',
    team1Id: 'd1-biawak', team2Id: 'leader-0', winnerId: 'd1-biawak', roundDetails: [],
    playerStats: teams.map((team, i) => ({ uid: `uid-${i}`, teamId: team.id,
      rounds: [{ kills: i < 9 ? 300 : i === 9 ? 200 : 165, deaths: 0, assists: 0 }] })),
  } }];
  const tournaments = [{ id: 's4', data: { stages: [{ id: 'playoffs', rounds: [{ id: 'final', placement: 1 }] }] } }];
  const before = JSON.stringify({ teams, matches, tournaments });
  const incomplete = getOverallStandings(teams.slice(0, 10), matches, []);
  assert.equal(incomplete[9].id, 'k2-evolve');
  assert.equal(incomplete[9].isQualified, true);

  const source = fs.readFileSync(new URL('../src/data-access/frontend-standings.ts', import.meta.url), 'utf8');
  let reads = 0;
  const snapshot = { teams, matches, tournaments };
  const loadStandings = (selectPublicCollection) => {
    const context = { exports: {}, require: name => ({
      'cloudflare:workers': { env: { DB: {} } },
      './frontend-public': { selectPublicCollection },
      './public-d1.mjs': { readPublicData: async () => { reads++; return snapshot; } },
      '../utils/standings': { getOverallStandings },
    })[name] };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
    return context.exports.getFrontendStandings;
  };
  for (const mode of ['hybrid', 'd1']) {
    const getStandings = loadStandings((collection, fallback) => mode === 'd1' ? snapshot[collection] : fallback());
    const standings = await getStandings();
    assert.equal(standings.filter(team => team.isQualified).length, 10);
    const biawak = standings.find(team => team.id === 'd1-biawak');
    const k2 = standings.find(team => team.id === 'k2-evolve');
    assert.equal(standings[9], biawak);
    assert.equal(biawak.killPoints, 165);
    assert.equal(biawak.placementPoints, 10);
    assert.equal(biawak.penaltyPoints, 0);
    assert.equal(biawak.totalScore, 175);
    assert.equal(biawak.isQualified, true);
    assert.equal(k2.killPoints, 200);
    assert.equal(k2.penaltyPoints, 30);
    assert.equal(k2.totalScore, 170);
    assert.equal(k2.isQualified, false);
  }
  assert.equal(reads, 1);
  assert.equal(JSON.stringify({ teams, matches, tournaments }), before);
});
