import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as assets from '../src/utils/assets.mjs';

const homepage = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../src/pages/matches/[id].astro', import.meta.url), 'utf8');
const resolveSource = homepage.slice(homepage.indexOf('const teamById ='), homepage.indexOf('const completedMatches ='));

function identity(teams, id) {
  return vm.runInNewContext(ts.transpileModule(`${resolveSource}\n({name:teamName(id), logo:teamLogo(id)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    teams, id, resolveAsset: assets.resolveAsset,
  });
}

test('Latest Matches shares detail team loader and resolves all D1-only names and official logos', async () => {
  const rows = [
    { id: 'g2c-prmx', name: 'G2C PRMX', tag: 'PRMX' },
    { id: 'biawak-esports', name: 'BIAWAK Esports', tag: 'BWK' },
    { id: 'another-d1-team', name: 'Another D1 Team', tag: 'D1' },
  ].map(row => ({ ...row, logo_asset_key: `teams/${row.id}/logo/${'a'.repeat(64)}.webp` }));
  const legacy = [{ id: rows[0].id, data: { name: rows[0].name, tag: rows[0].tag } }];
  const before = JSON.stringify({ rows, legacy });
  assert.equal(identity(legacy, 'biawak-esports').name, 'biawak-esports');
  assert.equal(identity(legacy, 'biawak-esports').logo, '/logos/default.webp');
  const exports = {};
  const source = readFileSync(new URL('../src/data-access/frontend-bracket.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, console,
    require: name => ({
      './frontend-public': { selectPublicCollection: (_collection, fallback) => fallback() },
      'astro:content': { getCollection: async () => legacy },
      'cloudflare:workers': { env: { DB: { prepare: () => ({ all: async () => ({ success: true, results: rows }) }) } } },
      '../utils/assets.mjs': assets,
    })[name],
  });
  const teams = await exports.getFrontendTeams();
  for (const row of rows) {
    const resolved = identity(teams, row.id);
    const detailTeam = teams.find(team => team.id === row.id);
    assert.equal(resolved.name, row.name);
    assert.equal(resolved.logo, `/media/${row.logo_asset_key}`);
    assert.equal(resolved.logo, assets.resolveAsset('teams', detailTeam).src);
  }
  assert.match(homepage, /const teams = await getFrontendTeams\(\)/);
  assert.match(detail, /const allTeams = await getFrontendTeams\(\)/);
  assert.match(homepage, /const standings = await getFrontendStandings\(\)/);
  assert.equal(JSON.stringify({ rows, legacy }), before);
});
