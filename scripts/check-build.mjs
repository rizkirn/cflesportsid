import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';

const root = resolve('dist');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? walk(join(dir, e.name)) : join(dir, e.name)))).flat();
}
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };
const pages = (await walk(root)).filter(path => path.endsWith('.html'));
const errors = [];
for (const page of pages) {
  const html = await readFile(page, 'utf8');
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
    const target = path.startsWith('/') ? resolve(root, `.${path}`) : resolve(dirname(page), path);
    if (!(await exists(target)) && !(await exists(join(target, 'index.html')))) errors.push(`${page}: missing ${ref}`);
  }
  if (!description || canonicals !== 1) errors.push(`${page}: missing description or canonical`);
}
for (const asset of ['sitemap-index.xml', 'robots.txt', '404.html']) {
  if (!(await exists(join(root, asset)))) errors.push(`Missing ${asset}`);
}
console.log(`Checked ${pages.length} production pages: ${errors.length} issues.`);
for (const error of errors) console.error(error);
if (errors.length) process.exitCode = 1;
