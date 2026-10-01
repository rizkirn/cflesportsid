import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const baseCommit = 'a91700d35517cba960c64dec06a6fa6716a894bb';
const root = process.cwd();
mkdirSync('.generated', { recursive: true });
const scratch = mkdtempSync(resolve('.generated/frontend-'));
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(scratch, 'logs') };
const run = (args, cwd = root) => execFileSync(process.execPath, args, { cwd, env, stdio: 'pipe', timeout: 120000 });
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const servers = [];
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function normalized(html) {
  return html
    .replace(/(<script\b[^>]*type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/g, (_, open, data, close) => open + JSON.stringify(canonical(JSON.parse(data))) + close)
    .replace(/globalThis\.process\?\?=\{\},globalThis\.process\.env\?\?=\{\}[;,]/g, '')
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, '')
    .replace(/<script\b([^>]*?)src="\/_astro\/[^" ]+"/g, '<script$1src="BUNDLED_MODULE"')
    .replace(/\/_image\?href=([^" ]+?)(?:&amp;|&)w=\d+(?:(?:&amp;|&)[^" ,]+)*/g, (_, href) => decodeURIComponent(href))
    .replace(/\/_astro\/([\w-]+)\.[\w-]+(?:_[\w-]+)?\.webp/g, '/_astro/$1.webp');
}
function equalHTML(actual, expected, label) {
  const a = normalized(actual), b = normalized(expected);
  if (a === b) return;
  writeFileSync(join(scratch, 'actual.html'), a);
  writeFileSync(join(scratch, 'expected.html'), b);
  const index = [...a].findIndex((c, i) => c !== b[i]);
  throw new Error(`${label} at ${index}: ${a.slice(index - 70, index + 180)} / ${b.slice(index - 70, index + 180)}; full HTML in ${scratch}`);
}
async function start(config, store, port) {
  const child = spawn(process.execPath, [wrangler, 'dev', '--config', config, '--persist-to', store, '--port', String(port), '--ip', '127.0.0.1', '--local'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${url}/robots.txt`)).ok) return { url, logs: () => logs }; } catch {}
    await delay(100);
  }
  throw new Error(`Server did not start: ${logs}`);
}
async function html(url, path, status = 200) {
  const response = await fetch(`${url}${path}`);
  assert.equal(response.status, status, path);
  return response.text();
}
try {
  const baseline = process.env.FRONTEND_BASELINE_DIR;
  let baselineDir = baseline ? resolve(baseline) : join(scratch, 'baseline/dist');
  if (!baseline) {
    const source = join(scratch, 'baseline');
    mkdirSync(source);
    const archive = join(scratch, 'baseline.tar');
    execFileSync('git', ['archive', '--output', archive, baseCommit]);
    execFileSync('tar', ['-xf', archive, '-C', source]);
    symlinkSync(resolve('node_modules'), join(source, 'node_modules'), 'dir');
    run([resolve('node_modules/astro/bin/astro.mjs'), 'build'], source);
  }
  run(['scripts/generate-d1-seed.mjs']);
  const seededStore = join(scratch, 'seeded');
  run([wrangler, 'd1', 'migrations', 'apply', 'cflesportsid', '--local', '--persist-to', seededStore]);
  run([wrangler, 'd1', 'execute', 'cflesportsid', '--local', '--persist-to', seededStore, '--file=.generated/seed-s1-s2.sql']);
  const built = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  const config = { ...built, main: resolve('dist/server', built.main), assets: { ...built.assets, directory: resolve('dist/client') } };
  delete config.configPath; delete config.userConfigPath;
  const d1Config = join(scratch, 'd1.json');
  const fallbackConfig = join(scratch, 'fallback.json');
  writeFileSync(d1Config, JSON.stringify(config));
  writeFileSync(fallbackConfig, JSON.stringify({ ...config, d1_databases: [] }));
  const d1 = await start(d1Config, seededStore, 44321);
  const fallback = await start(fallbackConfig, join(scratch, 'empty'), 44322);
  // Tool economy controls predate this change; compare them with their pristine commit.
  const referenceRoot = join(scratch, 'reference');
  mkdirSync(referenceRoot);
  const referenceArchive = join(scratch, 'reference.tar');
  execFileSync('git', ['archive', '--output', referenceArchive, 'cdb6c18']);
  execFileSync('tar', ['-xf', referenceArchive, '-C', referenceRoot]);
  symlinkSync(resolve('node_modules'), join(referenceRoot, 'node_modules'), 'dir');
  run([resolve('node_modules/astro/bin/astro.mjs'), 'build'], referenceRoot);
  const referenceBuilt = JSON.parse(readFileSync(join(referenceRoot, 'dist/server/wrangler.json'), 'utf8'));
  const referenceConfig = join(scratch, 'reference.json');
  writeFileSync(referenceConfig, JSON.stringify({ ...referenceBuilt, main: resolve(referenceRoot, 'dist/server', referenceBuilt.main), assets: { ...referenceBuilt.assets, directory: resolve(referenceRoot, 'dist/client') }, d1_databases: [] }));
  const reference = await start(referenceConfig, join(scratch, 'reference-store'), 44323);
  for (const server of [d1, fallback]) {
    for (const path of ['/admin', '/admin/tournaments/new', '/admin/tournaments/test-cup/setup', '/admin/tournaments/test-cup/participants', '/admin/tournaments/test-cup/bracket', '/admin/tournaments/test-cup/matches','/admin/tournaments/test-cup/roster']) {
      for (const method of ['GET', 'POST']) {
        const denied = await fetch(server.url + path, { method, redirect: 'manual', ...(method === 'POST' ? { headers: { origin: server.url, 'content-type': 'application/x-www-form-urlencoded' }, body: 'revision=test' } : {}) });
        assert.equal(denied.status, 403, `Built admin must be closed: ${method} ${path}`);
        assert.equal(denied.headers.get('cache-control'), 'no-store', `${method} ${path}`);
      }
    }
  }
  const pages = walk(baselineDir).filter(f => f.endsWith('.html') && !f.endsWith('/404.html') && !f.includes('/google'));
  const assets = new Set();
  for (const file of pages) {
    const path = '/' + relative(baselineDir, file).replace(/index\.html$/, '');
    const original = readFileSync(file, 'utf8');
    const live = await html(d1.url, path);
    const backup = await html(fallback.url, path);
    equalHTML(live, backup, `D1/fallback HTML ${path}`);
    if (path === '/bracket-generator/') {
      for (const id of ['count-form','selection','settings','preview','custom-team-form','custom-team-name','custom-team-list','regenerate','confirm-draw','unlock-draw','download-draw','copy-draw']) assert.ok(live.includes(`id="${id}"`),`Generator control ${id}`);
      assert.match(live,/never saved to the database/);
    } else equalHTML(live, ['/map-randomizer/', '/veto/'].includes(path) ? await html(reference.url, path) : original, `Legacy/runtime HTML ${path}`);
    for (const [, url] of live.matchAll(/(?:src|href)="(\/(?:_astro\/|_image\?)[^"]+)"/g)) assets.add(url.replaceAll('&amp;', '&'));
  }
  for (const url of assets) assert.equal((await fetch(`${d1.url}${url}`)).status, 200, url);
  for (const collection of ['matches', 'teams', 'players', 'maps', 'tournament']) {
    const missing = await html(d1.url, `/${collection}/__missing__`, 404);
    assert.match(missing, /Page not found/);
  }
  const locs = s => [...s.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]).sort();
  assert.deepEqual(locs(await html(d1.url, '/sitemap-0.xml')), locs(readFileSync(join(baselineDir, 'sitemap-0.xml'), 'utf8')));
  assert.equal(await html(d1.url, '/robots.txt'), readFileSync(join(baselineDir, 'robots.txt'), 'utf8'));
  env.BUILD_CHECK_URL = d1.url;
  console.log(run(['scripts/check-build.mjs']).toString().trim());
  assert.doesNotMatch(d1.logs(), /JSON fallback/);
  assert.match(fallback.logs(), /JSON fallback/);
  const before = await html(d1.url, '/matches/');
  run([wrangler, 'd1', 'execute', 'cflesportsid', '--local', '--persist-to', seededStore, '--command', "UPDATE matches SET date = '2026-01-01T12:00:00Z';"]);
  assert.notEqual(await html(d1.url, '/matches/'), before, 'D1 changes must reach rendered pages without a rebuild');
  equalHTML(await html(fallback.url, '/matches/'), before, 'missing binding still returns the original JSON page');
  run([wrangler, 'd1', 'execute', 'cflesportsid', '--local', '--persist-to', seededStore, '--command', 'DROP TABLE match_maps;']);
  assert.equal(normalized(await html(d1.url, '/matches/')), normalized(await html(fallback.url, '/matches/')), 'query failure falls back to the whole JSON collection');
  console.log(`Frontend parity passed: ${pages.length} pages in D1 and missing-binding fallback, ${assets.size} assets, sitemap/robots, five missing-ID routes, live D1 update, query-failure fallback.`);
} finally {
  for (const child of servers) {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  }
}
