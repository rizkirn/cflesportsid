import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const runtime = existsSync('dist/server/wrangler.json');
const root = resolve(runtime ? 'dist/client' : 'dist');
const baseURL = process.env.BUILD_CHECK_URL;
if (runtime && !baseURL) throw new Error('Runtime build: start npm run preview and set BUILD_CHECK_URL to check all rendered pages.');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name)))).flat();
}
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };
const pages = (await walk(root)).filter(path => path.endsWith('.html'));
const errors = [];
const renderedPages = new Map(await Promise.all(pages.map(async page => [page, await readFile(page, 'utf8')])));
if (runtime) {
  const sitemap = await readFile(join(root, 'sitemap-0.xml'), 'utf8');
  for (const [, location] of sitemap.matchAll(/<loc>(.*?)<\/loc>/g)) {
    const path = new URL(location).pathname;
    const response = await fetch(new URL(path, baseURL));
    if (!response.ok) errors.push(`${path}: HTTP ${response.status}`);
    renderedPages.set(path, await response.text());
  }
}
const routes = new Set([...renderedPages.keys()].map(path => path.replace(/\/$/, '') || '/'));
for (const [page, html] of renderedPages) {
  if (/^google-site-verification: google[a-z0-9]+\.html\s*$/.test(html)) continue;
  const tags = [...html.matchAll(/<([a-z][\w-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)];
  const ids = new Set();
  let description = false, canonicals = 0;
  for (const [, tag, raw] of tags) {
    const attrs = Object.fromEntries([...raw.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    if (attrs.id) {
      if (ids.has(attrs.id)) errors.push(`${page}: duplicate ID ${attrs.id}`);
      ids.add(attrs.id);
    }
    if (tag === 'meta' && attrs.name === 'description' && attrs.content) description = true;
    if (tag === 'link' && attrs.rel === 'canonical') canonicals++;
    const ref = ['a', 'link'].includes(tag) ? attrs.href : ['img', 'script'].includes(tag) ? attrs.src : undefined;
    if (!ref || ref.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) continue;
    const path = decodeURIComponent(ref.split(/[?#]/)[0]);
    if (runtime && (routes.has(path.replace(/\/$/, '') || '/') || path === '/_image')) continue;
    const target = path.startsWith('/') ? resolve(root, `.${path}`) : resolve(dirname(page), path);
    if (!(await exists(target)) && !(await exists(join(target, 'index.html')))) {
      const fallback = tag === 'img' && attrs.onerror?.match(/this\.src='(\/[^']+)'/)?.[1];
      if (!fallback || !(await exists(resolve(root, `.${fallback}`)))) errors.push(`${page}: missing ${ref}`);
    }
  }
  if (!description || canonicals !== 1) errors.push(`${page}: missing description or canonical`);
}
for (const asset of ['sitemap-index.xml', 'robots.txt', '404.html']) {
  if (!(await exists(join(root, asset)))) errors.push(`Missing ${asset}`);
}
console.log(`Checked ${renderedPages.size} production page responses/files: ${errors.length} issues.`);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
