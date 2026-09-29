import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const context = { exports: {} };
const source = fs.readFileSync(new URL('../src/utils/map-randomizer.ts', import.meta.url), 'utf8');
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { randomizeMaps } = context.exports;
test('draws unique maps without modifying the available pool', () => {
  const maps = Object.freeze(['Aztec', 'Ankara', 'Port', 'Desert']);
  for (const rounds of [1, 3, 4]) {
    const result = randomizeMaps(maps, rounds, () => 0.4);
    assert.equal(result.length, rounds);
    assert.equal(new Set(result).size, rounds);
    assert.ok(result.every(map => maps.includes(map)));
  }
  assert.deepEqual(maps, ['Aztec', 'Ankara', 'Port', 'Desert']);
});
test('rejects impossible or noninteger round counts', () => {
  for (const count of [0, -1, 4, 1.5, NaN]) {
    assert.throws(() => randomizeMaps(['Aztec', 'Port', 'Ankara'], count), /Rounds must/);
  }
  assert.throws(() => randomizeMaps([], 1), /Rounds must/);
});
