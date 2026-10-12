import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEnvironment, validateCleanup, remoteIds } from '../scripts/phase1a/safety.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
function fixture(){const root=mkdtempSync('/private/tmp/cfl-phase1a-');const marker={kind:'cfl-phase1a-v1',root,repo,owner:process.getuid(),nonce:randomUUID(),databaseId:randomUUID()};const config={d1_databases:[{binding:'DB',database_id:marker.databaseId,migrations_dir:'./migrations'}]};writeFileSync(join(root,'wrangler.json'),JSON.stringify(config));return {root,marker,config,close:()=>rmSync(root,{recursive:true})};}
test('valid disposable environment passes ownership checks',()=>{const f=fixture();try{validateEnvironment(f.root,repo,f.marker,f.config);validateCleanup(f.root,repo,f.marker);}finally{f.close();}});
test('production, staging and known fixture IDs are rejected',()=>{const f=fixture();try{for(const id of [...remoteIds,'00000000-0000-0000-0000-000000000044']){f.marker.databaseId=id;f.config.d1_databases[0].database_id=id;assert.throws(()=>validateEnvironment(f.root,repo,f.marker,f.config),/forbidden/);}}finally{f.close();}});
test('remote bindings and extra databases are rejected',()=>{const f=fixture();try{f.config.d1_databases[0].remote=true;assert.throws(()=>validateEnvironment(f.root,repo,f.marker,f.config));delete f.config.d1_databases[0].remote;f.config.d1_databases.push({...f.config.d1_databases[0]});assert.throws(()=>validateEnvironment(f.root,repo,f.marker,f.config));}finally{f.close();}});
test('R2 and environment overrides are rejected',()=>{const f=fixture();try{for(const field of ['r2_buckets','env','previews','account_id','routes']){f.config[field]=[];assert.throws(()=>validateEnvironment(f.root,repo,f.marker,f.config));delete f.config[field];}}finally{f.close();}});
test('wrong owner or marker path is rejected',()=>{const f=fixture();try{assert.throws(()=>validateEnvironment(f.root,repo,{...f.marker,owner:-1},f.config));assert.throws(()=>validateEnvironment(f.root,repo,{...f.marker,root:repo},f.config));}finally{f.close();}});
test('cleanup refuses unexpected files and symlink escapes',()=>{const f=fixture();try{writeFileSync(join(f.root,'unexpected'),'retain');assert.throws(()=>validateCleanup(f.root,repo,f.marker),/Unexpected/);rmSync(join(f.root,'unexpected'));mkdirSync(join(f.root,'fixtures'));symlinkSync(repo,join(f.root,'fixtures','escape'));assert.throws(()=>validateCleanup(f.root,repo,f.marker),/symlinks/);}finally{f.close();}});
test('cleanup refuses a live controller',()=>{const f=fixture();try{assert.throws(()=>validateCleanup(f.root,repo,{...f.marker,controllerPid:process.pid}),/live controller/);}finally{f.close();}});
test('nested disposable paths are rejected',()=>{const f=fixture();try{const nested=join(f.root,'nested');mkdirSync(nested);assert.throws(()=>validateEnvironment(nested,repo,{...f.marker,root:nested},f.config),/Invalid disposable path/);}finally{f.close();}});

test('Phase 1C cleanup allows only its exact dependency link',()=>{const f=fixture();try{f.marker.phase='1C';mkdirSync(join(f.root,'project'));symlinkSync(join(repo,'node_modules'),join(f.root,'project','node_modules'));validateCleanup(f.root,repo,f.marker);symlinkSync(repo,join(f.root,'project','escape'));assert.throws(()=>validateCleanup(f.root,repo,f.marker),/symlinks/);}finally{f.close();}});
