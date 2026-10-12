import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {productionReaderFlags} from '../scripts/phase2c/production-cutover.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createUploadGuard,prefix,workerPath,servicePath,previewMetadataPath}=require('../scripts/production/upload-request-guard.cjs');
const read=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
test('portable production config preserves captured production resources and runtime',()=>{
 const c=read('wrangler.production.jsonc');
 assert.equal(c.name,'cflesportsid');assert.equal(c.account_id,'bf6ed4ccd73133871881b47ea58dae3d');
 assert.deepEqual(c.d1_databases,[{binding:'DB',database_name:'cflesportsid',database_id:'efded3c4-1cf9-46a9-823e-d0f2d17c683a'}]);
 assert.deepEqual(c.r2_buckets,[{binding:'CFL_ASSETS',bucket_name:'cflesportsid-assets-production'}]);
 assert.deepEqual(c.vars,productionReaderFlags());assert.equal(c.keep_vars,true);
 assert.equal(c.main,'dist/server/entry.mjs');assert.equal(c.no_bundle,true);assert.equal(c.find_additional_modules,true);
 assert.equal(c.compatibility_date,'2026-09-30');assert.deepEqual(c.compatibility_flags,['nodejs_compat']);
 assert.equal(c.workers_dev,true);assert.equal(c.preview_urls,true);
 assert.deepEqual(c.routes,[{pattern:'cflesports.com',custom_domain:true,zone_id:'c8fed6ca36bcc7f2a22cd1b6aa713091',enabled:true,previews_enabled:false}]);
 assert.deepEqual(c.assets,{binding:'ASSETS',directory:'dist/client',html_handling:'auto-trailing-slash',not_found_handling:'none',run_worker_first:false});
 assert.ok(!/staging|uat|\/private\/tmp|\/Users\/|ADMIN_|token|secret|jwt/i.test(JSON.stringify(c)));
});
test('build config has no account or data resources and production build target is explicit',()=>{
 const c=read('wrangler.production-build.jsonc');for(const k of ['account_id','d1_databases','r2_buckets','routes','vars','env'])assert.ok(!(k in c));
 assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);
 assert.equal(read('package.json').scripts['build:production'],'CFL_PUBLIC_BUILD_TARGET=production-d1 CFL_ADMIN_CONFIG=wrangler.production-build.jsonc astro build');
});
test('complete preview-enabled installed upload sequence stays within guarded endpoints',()=>{
 const admitted=[];const guard=createUploadGuard({dispatch(o){admitted.push([o.method,o.path]);return true;},close(){},destroy(){}},{checkApproval(){},deadline:100,now:()=>1});
 const sequence=[['GET',servicePath],['GET',workerPath+'/secrets'],['POST',workerPath+'/assets-upload-session'],['GET',workerPath+'/settings'],['POST',workerPath+'/versions?bindings_inherit=strict'],['GET',previewMetadataPath]];
 for(const [method,path]of sequence)guard.dispatch({origin:'https://api.cloudflare.com',path,method},{});
 assert.deepEqual(admitted,sequence);
 assert.throws(()=>guard.dispatch({origin:'https://api.cloudflare.com',path:workerPath+'/deployments',method:'POST'},{}));
 assert.equal(admitted.length,6);
});
