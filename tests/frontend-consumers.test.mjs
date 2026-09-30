import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const consumers = ['index.astro', 'matches/index.astro', 'matches/[id].astro', 'teams/index.astro', 'teams/[id].astro', 'players/index.astro', 'players/[id].astro', 'maps/index.astro', 'maps/[id].astro', 'tournament/index.astro', 'tournament/[id].astro', 'veto.astro', 'bracket-generator.astro'];
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
test('all audited frontend match consumers use runtime reads', () => {
  for (const file of consumers) {
    const source = readFileSync(`src/pages/${file}`, 'utf8');
    assert.match(source, /export const prerender = false;/, file);
    assert.match(source, /await getFrontendMatches\(\)/, file);
    assert.doesNotMatch(source, /getStaticPaths|Astro\.props/, file);
  }
  for (const file of walk('src').filter(f => /\.(astro|ts|mjs)$/.test(f) && f !== 'src/data-access/frontend-matches.ts')) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /get(?:Collection|Entry)\(\s*['"]matches['"]/, file);
  }
});

test('only the frontend boundary supplies the DB binding and keeps JSON fallback', () => {
  const source = readFileSync('src/data-access/frontend-matches.ts', 'utf8');
  assert.match(source, /from 'cloudflare:workers'/);
  assert.match(source, /db: env.DB/);
  assert.match(source, /loadJSON: \(\) => getCollection\('matches'\)/);
  assert.match(source, /return result.matches/);
  for (const file of walk('src').filter(f => /\.(astro|ts|mjs)$/.test(f) && !f.startsWith('src/data-access/'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"]cloudflare:workers['"]|env\.DB/, file);
  }
});
