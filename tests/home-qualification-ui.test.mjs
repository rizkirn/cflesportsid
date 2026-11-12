import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from '@astrojs/compiler-rs';
import { experimental_AstroContainer } from 'astro/container';
import { resolveAsset } from '../src/utils/assets.mjs';

const root = process.cwd();
const source = readFileSync(join(root, 'src/pages/index.astro'), 'utf8');
const section = source.match(/<section\s+class="home-panel qualification-section"[\s\S]*?<\/section>/)?.[0];
assert.ok(section);
mkdirSync(join(root, '.generated'), { recursive: true });
const temporary = mkdtempSync(join(root, '.generated/qualification-ui-test-'));
const frontmatter = 'const { qualifiedTeams } = Astro.props; const allStarSpots = 10; const remainingSpots = Math.max(0, allStarSpots - qualifiedTeams.length); const qualificationPercent = Math.min(qualifiedTeams.length / allStarSpots * 100, 100);';
const compiled = transform(`---\n${frontmatter}\n---\n${section.replace('<Thumbnail ', '<img ')}`, {
  filename: 'qualification-fixture.astro', internalURL: 'astro/compiler-runtime',
  resolvePath: specifier => specifier, resultScopedSlot: true,
});
const componentPath = join(temporary, 'qualification-fixture.mjs');
writeFileSync(componentPath, compiled.code);
const { default: component } = await import(pathToFileURL(componentPath));
const container = await experimental_AstroContainer.create();
const teams = readdirSync(join(root, 'src/data/teams')).filter(name => name.endsWith('.json')).sort().slice(0, 10).map(file => {
  const data = JSON.parse(readFileSync(join(root, 'src/data/teams', file), 'utf8'));
  return { id: file.slice(0, -5), name: data.name, logo: resolveAsset('teams', { id: file.slice(0, -5), data }).src };
});
const render = qualifiedTeams => container.renderToString(component, { props: { qualifiedTeams } });

test('qualification preserves ten names, logos and links, with status only in the header', async () => {
  assert.match(section, /<Thumbnail src=\{team\.logo\} onerror=\{team\.logoError\} fallback="\/logos\/default\.webp" width=\{40\} height="40"/);
  const html = await render(teams);
  assert.equal((html.match(/class="qualification-team"/g) ?? []).length, 10);
  assert.equal((html.match(/QUALIFIED/g) ?? []).length, 1);
  assert.match(html, /<strong>10<\/strong>\s*<span>\/10 QUALIFIED<\/span>/);
  assert.match(html, /The top 10 teams from the final Road to All-Star standings qualify for All-Star\./);
  assert.doesNotMatch(html, /<small|qualification-remaining|All places filled/);
  for (const team of teams) {
    assert.ok(html.includes(`href="/teams/${team.id}"`));
    assert.ok(html.includes(`src="${team.logo}"`));
    assert.ok(html.includes(`<strong>${team.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</strong>`));
  }
});

test('remaining-place text is shown only for unfilled slots', async () => {
  for (const count of [0, 9, 10]) {
    const html = await render(teams.slice(0, count));
    assert.equal(html.includes('class="qualification-remaining"'), count < 10);
    assert.doesNotMatch(html, /All places filled/);
    if (count === 9) assert.match(html, /place remaining/);
    if (count === 0) assert.match(html, /places remaining/);
  }
});

test.after(() => rmSync(temporary, { recursive: true, force: true }));
