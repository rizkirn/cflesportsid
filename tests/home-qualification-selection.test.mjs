import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('qualification takes the first ten existing standings entries without changing order, identity or scores', () => {
  const source = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  const selection = source.match(/^const qualifiedTeams = .*;$/m)?.[0];
  assert.ok(selection);
  const standings = Array.from({ length: 22 }, (_, index) => Object.freeze({
    id: `team-${index}`, name: `Team ${index}`, logo: `/media/team-${index}.webp`,
    killPoints: 1000 - index, placementPoints: index % 4, penaltyPoints: index % 3,
    totalScore: 1000 - index + index % 4 - index % 3,
    isQualified: false, isTournamentWinner: index === 21,
  }));
  Object.freeze(standings);
  const qualified = vm.runInNewContext(`${selection}\nqualifiedTeams`, { standings, ALL_STAR_SPOTS: 10 });
  assert.equal(qualified.length, 10);
  qualified.forEach((team, index) => assert.equal(team, standings[index]));
  assert.equal(standings.length, 22);
});

test('both standings Status renderers use the qualification list and exclude rank eleven despite stale flags', () => {
  const source = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  const selection = source.match(/^const qualifiedTeams = .*;$/m)[0];
  const statusExpressions = [...source.matchAll(/\{([^{}\n]+) \? \(\s*<span class="qualified-label">/g)].map(match => match[1].trim());
  assert.equal(statusExpressions.length, 2);
  const standings = Object.freeze(Array.from({ length: 22 }, (_, index) => Object.freeze({
    id: `team-${index}`, isQualified: index >= 10, isTournamentWinner: index === 10,
  })));
  for (const expression of statusExpressions) {
    const statuses = vm.runInNewContext(`${selection}\nstandings.map(team => (${expression}) ? 'QUALIFIED' : '—')`, {
      standings, ALL_STAR_SPOTS: 10,
    });
    assert.equal(statuses[9], 'QUALIFIED');
    assert.equal(statuses[10], '—');
    assert.equal(statuses.filter(status => status === 'QUALIFIED').length, 10);
    assert.ok(statuses.slice(10).every(status => status === '—'));
  }
});
