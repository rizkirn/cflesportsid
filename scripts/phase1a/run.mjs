import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, sha, validateEnvironment, validateCleanup } from './safety.mjs';

const repo = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const protectedRoot = join(repo, '.wrangler/state/v3/d1');
execFileSync('git',['diff','--exit-code','HEAD','--','src/data','migrations','src/utils/statistics.ts','src/utils/player-continuity.mjs','src/config/player-continuity.mjs','src/data-access/matches.mjs'],{cwd:repo,stdio:'pipe'});
const sourceBefore = {data:inventory(join(repo,'src/data')),migrations:inventory(join(repo,'migrations'))};
const before = inventory(protectedRoot);
const stores = Object.keys(before).filter(p => p.endsWith('.sqlite') && !p.endsWith('metadata.sqlite'));
assert.equal(stores.length, 7, 'Expected exactly seven protected local D1 stores; investigate before proceeding');
const args = process.argv.slice(2);
const phase1c=args.length===1&&args[0]==='--phase1c';
const phase1b=phase1c || args.length===1&&args[0]==='--phase1b';
if (args.length && !phase1b) {
  assert.equal(args.length, 2); assert.equal(args[0], '--cleanup');
  const root = args[1], marker = JSON.parse(readFileSync(join(root, 'ownership.json'), 'utf8'));
  validateCleanup(root, repo, marker);
  rmSync(root, {recursive:true});
  assert.deepEqual(inventory(protectedRoot), before);
  console.log('Validated disposable environment removed; existing stores unchanged.');
} else {
  const root = realpathSync(mkdtempSync('/private/tmp/cfl-phase1a-'));
  for (const dir of ['tmp','auth','logs','migrations','fixtures']) mkdirSync(join(root, dir), {mode:0o700});
  const marker = {phase:phase1c?'1C':phase1b?'1B':'1A',kind:'cfl-phase1a-v1', root, repo, owner:process.getuid(), controllerPid:process.pid, nonce:randomUUID(), databaseId:randomUUID(), protectedStores:before,sourceFiles:sourceBefore};
  const config = {name:'cfl-phase1a-disposable', compatibility_date:'2026-09-30', d1_databases:[{binding:'DB', database_name:'cfl-phase1a-disposable', database_id:marker.databaseId, migrations_dir:'./migrations'}]};
  writeFileSync(join(root,'ownership.json'), JSON.stringify(marker,null,2), {mode:0o600});
  writeFileSync(join(root,'wrangler.json'), JSON.stringify(config,null,2), {mode:0o600});
  writeFileSync(join(root,'worker.mjs'), 'export default {fetch(){return new Response("Phase 1A local verification")}};');
  validateEnvironment(root, repo, marker, config);
  const migrationNames = readdirSync(join(repo,'migrations')).filter(x=>/^\d{4}.*\.sql$/.test(x)&&Number(x.slice(0,4))<=(phase1b?11:10)).sort();
  assert.deepEqual(migrationNames.map(x=>x.slice(0,4)),Array.from({length:phase1b?11:10},(_,i)=>String(i+1).padStart(4,'0')));
  marker.migrations = Object.fromEntries(migrationNames.map(name=>{copyFileSync(join(repo,'migrations',name),join(root,'migrations',name));return [name,sha(readFileSync(join(root,'migrations',name)))];}));
  writeFileSync(join(root,'ownership.json'),JSON.stringify(marker,null,2),{mode:0o600});
  const quote = value => JSON.stringify(value);
  const credentialDirectory = join(process.env.HOME ?? '/Users/rizkirn','Library/Preferences/.wrangler');
  const profile = `(version 1)\n(allow default)\n(deny network*)\n(allow network-inbound (local ip "localhost:*"))\n(allow network-outbound (remote ip "localhost:*"))\n(deny file-write*)\n(allow file-write* (subpath ${quote(root)}) (literal "/dev/null"))\n(deny file-read* (subpath ${quote(credentialDirectory)}) (subpath ${quote(join(process.env.HOME ?? '/Users/rizkirn','.wrangler'))}) (regex #".*/\\\\.env.*"))\n`;
  writeFileSync(join(root,'sandbox.sb'),profile);
  writeFileSync(join(root,'probe.mjs'), `import assert from 'node:assert/strict';import{writeFileSync,readFileSync}from'node:fs';import net from'node:net';\nassert.throws(()=>writeFileSync(${quote(root+'-outside-probe')},'forbidden'),e=>e.code==='EPERM'||e.code==='EACCES');\nassert.throws(()=>readFileSync(${quote(join(credentialDirectory,'config/default.toml'))}),e=>['EPERM','EACCES','ENOENT'].includes(e.code));\nawait new Promise((resolve,reject)=>{const s=net.connect({host:'1.1.1.1',port:443});s.setTimeout(2000,()=>reject(new Error('Network denial not verified')));s.on('connect',()=>reject(new Error('Outbound network permitted')));s.on('error',e=>e.code==='EPERM'?resolve():reject(e));});\nconst server=net.createServer(s=>s.end());await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).on('error',reject));await new Promise(resolve=>server.close(resolve));console.log('Safety probe passed');\n`);
  const env = {PATH:process.env.PATH, LANG:'en_US.UTF-8', TMPDIR:join(root,'tmp'), XDG_CONFIG_HOME:join(root,'auth'), WRANGLER_LOG_PATH:join(root,'logs'), WRANGLER_SEND_METRICS:'false', WRANGLER_SEND_ERROR_REPORTS:'false', CFL_PHASE1A_ROOT:root};
  function isolated(file) {
    try { return execFileSync('/usr/bin/sandbox-exec',['-f',join(root,'sandbox.sb'),process.execPath,file],{cwd:root,env,stdio:['ignore','pipe','pipe'],encoding:'utf8',maxBuffer:8*1024*1024}); }
    catch(error) { throw new Error('Isolated process failed; inspect temporary report. '+String(error.stderr??error.message).slice(0,500)); }
  }
  console.log('Disposable directory: '+root);
  try {
    console.log(isolated(join(root,'probe.mjs')).trim());
    assert.deepEqual(inventory(protectedRoot),before,'Protected stores changed during safety verification');
    console.log(isolated(fileURLToPath(new URL('./verify.mjs',import.meta.url))).trim());
    if(phase1c)console.log(isolated(fileURLToPath(new URL('./http.mjs',import.meta.url))).trim());
  } finally {
    const after = inventory(protectedRoot);
    assert.deepEqual(after,before,'Protected stores changed; stop and investigate');
    assert.deepEqual({data:inventory(join(repo,'src/data')),migrations:inventory(join(repo,'migrations'))},sourceBefore,'Historical source files changed');
    const reportPath=join(root,'report.json');
    if(existsSync(reportPath)){const report=JSON.parse(readFileSync(reportPath,'utf8'));report.safety={existingStoresUnchanged:true,protectedStoreCount:7,remoteNetworkDenied:true,credentialsUnavailable:true,writeBoundary:root};writeFileSync(reportPath,JSON.stringify(report,null,2));}
    console.log('Seven existing stores and sidecars byte-identical. Evidence retained in '+root);
  }
}
