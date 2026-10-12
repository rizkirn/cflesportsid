import { createHash, createHmac } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const remoteIds = ['efded3c4-1cf9-46a9-823e-d0f2d17c683a', '4ba57de7-5fda-4703-a956-b1936546986a'];
export const sha = value => createHash('sha256').update(value).digest('hex');
export function actorId(id) {
  const key = createHash('sha256').update('miniflare-D1DatabaseObject').digest();
  const half = createHmac('sha256', key).update(id).digest().subarray(0, 16);
  return Buffer.concat([half, createHmac('sha256', key).update(half).digest().subarray(0, 16)]).toString('hex');
}
export function inventory(root) {
  const files = {};
  if (!existsSync(root)) return files;
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in protected database storage');
    if (stat.isDirectory()) for (const [key, value] of Object.entries(inventory(path))) files[join(name, key)] = value;
    else files[name] = { bytes: stat.size, sha256: sha(readFileSync(path)) };
  }
  return files;
}
export function blockedIds(repo) {
  const ids = new Set(remoteIds);
  function scan(path) {
    if (!existsSync(path)) return;
    for (const name of readdirSync(path)) {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) scan(file);
      else if (/\.jsonc?$/.test(name)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/"(?:database_id|preview_database_id)"\s*:\s*"([^"]+)"/g)) ids.add(match[1]);
      }
    }
  }
  scan(join(repo, '.generated'));
  return [...ids];
}
export function validateEnvironment(root, repo, marker, config) {
  const canonical = realpathSync(root);
  if (lstatSync(root).isSymbolicLink() || canonical !== resolve(root) || !/^\/private\/tmp\/cfl-phase1a-[A-Za-z0-9]{6}$/.test(canonical)) throw new Error('Invalid disposable path');
  if (canonical === realpathSync(repo) || canonical.startsWith(realpathSync(repo) + sep)) throw new Error('Repository persistence is forbidden');
  if (marker.root !== canonical || marker.repo !== realpathSync(repo) || marker.owner !== process.getuid() || marker.kind !== 'cfl-phase1a-v1') throw new Error('Ownership marker mismatch');
  const bindings = config.d1_databases;
  if (!Array.isArray(bindings) || bindings.length !== 1 || bindings[0].binding !== 'DB' || bindings[0].database_id !== marker.databaseId) throw new Error('Invalid database binding');
  if (blockedIds(repo).includes(marker.databaseId) || marker.databaseId === '00000000-0000-0000-0000-000000000044') throw new Error('Existing or remote database ID forbidden');
  const existing = join(repo, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject', actorId(marker.databaseId) + '.sqlite');
  if (existsSync(existing)) throw new Error('Existing local database ID forbidden');
  if (!/^[0-9a-f-]{36}$/.test(marker.databaseId) || !marker.nonce || config.env || config.previews || config.r2_buckets || config.routes || config.account_id || bindings[0].remote || bindings[0].preview_database_id) throw new Error('Remote-capable configuration forbidden');
  if (config.migrations_dir || bindings[0].migrations_dir !== './migrations') throw new Error('Unexpected migration directory');
}
export function validateCleanup(root, repo, marker) {
  validateEnvironment(root, repo, marker, JSON.parse(readFileSync(join(root, 'wrangler.json'), 'utf8')));
  if (marker.controllerPid) {
    try { process.kill(marker.controllerPid,0); throw new Error('Cleanup refuses a live controller'); }
    catch(error) { if (error.code !== 'ESRCH') throw error; }
  }
  const allowed = new Set(['ownership.json','wrangler.json','worker.mjs','probe.mjs','sandbox.sb','tmp','auth','logs','migrations','state','fixture-generator','fixtures','report.json','baseline.json']);
  if(marker.phase==='1C')for(const name of ['project','http-report.json','empty-state'])allowed.add(name);
  for (const name of readdirSync(root)) if (!allowed.has(name)) throw new Error('Unexpected cleanup entry: ' + name);
  function rejectLinks(path) {
    for (const name of readdirSync(path)) {
      const file = join(path, name), stat = lstatSync(file);
      if (stat.isSymbolicLink()) {
        if(marker.phase==='1C' && file===join(root,'project','node_modules') && realpathSync(file)===realpathSync(join(repo,'node_modules')))continue;
        throw new Error('Cleanup refuses symlinks');
      }
      if (stat.isDirectory()) rejectLinks(file);
    }
  }
  rejectLinks(root);
}
