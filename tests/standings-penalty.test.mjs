import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports = {}) {
  const context = { exports: {}, require: name => imports[name] };
  const source = fs.readFileSync(new URL(`../src/utils/${file}.ts`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const { getOverallStandings } = load('standings', {
  './statistics': load('statistics'),
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
