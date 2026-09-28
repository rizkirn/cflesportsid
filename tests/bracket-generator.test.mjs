import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { root, checkData } from '../scripts/data-tools.mjs';

function load(file) {
  const context = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, context);
  return context.exports;
}
const { generateBracket, bracketExport, bracketSizeFor } = load('src/utils/bracket-generator.ts');
const { validateTournament, resolveSourceTeam } = load('src/utils/tournament.ts');
const ids = Array.from({ length: 257 }, (_, i) => `team-${i + 1}`);
const options = (count, thirdPlace = true) => ({
  teamCount: count, selectedTeamIds: ids.slice(0, count), availableTeamIds: ids,
  tournamentId: 'test-cup', name: 'Test Cup', startDate: '2026-10-01', endDate: '2026-10-02', mapCount: 3, thirdPlace,
});
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

test('all counts through 257 produce a complete compatible bracket without duplicate entrants or BYE vs BYE', () => {
  for (let count = 5; count <= 257; count++) {
    for (const thirdPlace of [false, true]) {
      const bracket = generateBracket(options(count, thirdPlace), seeded(count));
      const { tournament, matches, draw } = bracket;
      const stage = tournament.data.stages[0];
      assert.equal(stage.bracketSize, 2 ** Math.ceil(Math.log2(count)));
      assert.equal(stage.byes.length, stage.bracketSize - count);
      const byeSlots = new Set(stage.byes.map(bye => bye.slot));
      let byeMeetings = 0;
      for (let slot = 1; slot <= stage.bracketSize / 2; slot += 2) {
        if (byeSlots.has(slot) && byeSlots.has(slot + 1)) byeMeetings++;
      }
      assert.equal(byeMeetings, Math.max(0, stage.byes.length - stage.bracketSize / 4));
      assert.equal(matches.length, count - 1 + Number(thirdPlace));
      assert.equal(draw.length, stage.bracketSize - 1 + Number(thirdPlace));
      assert.deepEqual(Array.from(draw, d => d.number), Array.from({ length: draw.length }, (_, i) => i + 1));
      const opening = draw.filter(d => d.roundId === stage.rounds[0].id);
      const entrants = opening.flatMap(d => [d.team1, d.team2].filter(Boolean));
      assert.equal(entrants.length, count);
      assert.equal(new Set(entrants).size, count);
      assert.ok(opening.every(d => d.team1 && (d.team2 || d.kind === 'bye')));
      assert.doesNotThrow(() => validateTournament(tournament, matches, new Set(ids)));
      for (const round of stage.rounds) {
        const expected = round.placement === 3 ? 1 : stage.bracketSize / 2 ** round.order;
        assert.equal(draw.filter(d => d.roundId === round.id).length, expected);
      }
      const bronze = matches.find(m => m.data.roundId === 'bronze');
      if (thirdPlace) {
        assert.equal(bronze.id, `test-cup-m${String(stage.bracketSize).padStart(2, '0')}`);
        for (const side of [1, 2]) {
          assert.equal(bronze.data[`team${side}Source`].type, 'loser');
          assert.equal(matches.find(m => m.id === bronze.data[`team${side}Source`].matchId).data.roundId, 'semi-final');
        }
      }
    }
  }
});

test('13-team draws never pair two BYE recipients in the next round across repeated regenerations', () => {
  const layouts = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const { tournament, matches } = generateBracket(options(13), seeded(seed));
    const byes = tournament.data.stages[0].byes;
    assert.equal(byes.length, 3);
    assert.equal(new Set(byes.map(bye => Math.floor((bye.slot - 1) / 2))).size, 3);
    for (const match of matches.filter(match => match.data.roundId === 'quarter-final')) {
      assert.ok(match.data.team1Source.type !== 'bye' || match.data.team2Source.type !== 'bye');
    }
    layouts.add(byes.map(bye => bye.slot).join(','));
  }
  assert.ok(layouts.size > 1);
});

test('regeneration changes team order and BYE positions without mutating selected teams', () => {
  const config = options(13);
  const original = structuredClone(config);
  const draws = Array.from({ length: 30 }, (_, i) => generateBracket(config, seeded(i + 1)));
  assert.ok(new Set(draws.map(d => JSON.stringify(d.draw))).size > 1);
  assert.ok(new Set(draws.map(d => JSON.stringify(d.tournament.data.stages[0].byes.map(b => b.slot)))).size > 1);
  assert.deepEqual(config, original);
});

test('BYEs resolve immediately and every subsequent winner and semifinal loser progresses through existing helpers', () => {
  for (const count of [5, 8, 13, 16, 19, 32, 64, 128]) {
    const { tournament, matches } = generateBracket(options(count), seeded(count));
    for (const match of matches) {
      for (const side of [1, 2]) {
        if (match.data[`team${side}Source`]) match.data[`team${side}Id`] = resolveSourceTeam(match, side, tournament, matches);
        assert.ok(match.data[`team${side}Id`]);
      }
      Object.assign(match.data, {
        status: 'completed', score1: 3, score2: 0, winnerId: match.data.team1Id,
        roundDetails: [1, 2, 3].map(round_number => ({ round_number, mapId: 'black-widow', winnerId: match.data.team1Id })),
      });
    }
    tournament.data.status = 'completed';
    assert.doesNotThrow(() => validateTournament(tournament, matches, new Set(ids)));
  }
});

test('invalid counts, selections, metadata, dates and collisions fail before export', () => {
  for (const count of [0, 4, 5.5, NaN, Infinity]) assert.throws(() => bracketSizeFor(count));
  for (const patch of [
    { selectedTeamIds: ids.slice(0, 12) }, { selectedTeamIds: Array(13).fill(ids[0]) },
    { availableTeamIds: [] }, { tournamentId: '../escape' }, { tournamentId: 'UPPERCASE' },
    { name: ' ' }, { startDate: '2026-02-30' }, { endDate: '2026-09-30' },
    { mapCount: 2 }, { mapCount: 0 }, { mapCount: 1.5 },
    { existingTournamentIds: ['test-cup'] }, { existingMatchIds: ['test-cup-m15'] },
  ]) assert.throws(() => generateBracket({ ...options(13), ...patch }));
  assert.throws(() => generateBracket(options(13), () => 1));
});

test('exported file contents pass the actual collection schemas and reference checker beside existing data', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfl-bracket-'));
  try {
    fs.cpSync(path.join(root, 'src/data'), temp, { recursive: true });
    const teamIds = fs.readdirSync(path.join(temp, 'teams')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
    const bracket = generateBracket({ ...options(13), selectedTeamIds: teamIds.slice(0, 13), availableTeamIds: teamIds }, seeded(9));
    const bundle = bracketExport(bracket);
    assert.equal(Object.keys(bundle.files).length, bracket.matches.length + 1);
    for (const [filename, data] of Object.entries(bundle.files)) {
      fs.writeFileSync(path.join(temp, filename.replace(/^src\/data\//, '')), JSON.stringify(data));
    }
    const result = checkData(temp);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
