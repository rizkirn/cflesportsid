import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyFrontendCapture,captureFrontend} from '../scripts/production/frontend-preflight.mjs';
import {productionReaderFlags} from '../scripts/production/metadata-helpers.mjs';
const versionId='6f6f4073-6cdd-428e-8951-3c4cdf7a2e15';
function fixture(){
 const config=JSON.parse(readFileSync('wrangler.production.jsonc'));delete config.vars;
 const bindings=[{name:'DB',type:'d1',id:config.d1_databases[0].database_id},{name:'CFL_ASSETS',type:'r2_bucket',bucket_name:config.r2_buckets[0].bucket_name},{name:'ASSETS',type:'assets'},{name:'ADMIN_HOSTNAME',type:'plain_text',text:'PRIVATE_SENTINEL'},{name:'ADMIN_DRAW_KEY',type:'secret_text'},...Object.entries(productionReaderFlags()).map(([name,text])=>({name,type:'plain_text',text}))];
 const assetConfig=Object.fromEntries(['html_handling','not_found_handling','run_worker_first'].map(k=>[k,config.assets[k]]));
 return {config,version:{id:versionId,resources:{bindings,script_runtime:{compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags},assets:{config:assetConfig}}},settings:{bindings:[...structuredClone(bindings),{name:'cflesportsid_staging',type:'d1',id:'4ba57de7-5fda-4703-a956-b1936546986a'}]},scriptSettings:{},domains:[{hostname:'cflesports.com',service:'cflesportsid'}],routes:[],subdomain:{enabled:config.workers_dev,previews_enabled:config.preview_urls}};
}
test('frontend rollback review uses one active DB while identifying additional current staging DB',()=>{
 const input=fixture(),before=JSON.stringify(input),report=verifyFrontendCapture(input);
 assert.equal(report.additionalCurrentD1Bindings[0].name,'cflesportsid_staging');
 assert.equal(report.additionalCurrentD1Bindings[0].purpose,'known staging database');
 assert.equal(JSON.stringify(input),before);assert.ok(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});
for(const [name,change]of [
 ['active DB',f=>f.version.resources.bindings[0].id='wrong'],
 ['inherited admin value',f=>f.settings.bindings.find(b=>b.name==='ADMIN_HOSTNAME').text='changed'],
 ['missing secret',f=>f.settings.bindings=f.settings.bindings.filter(b=>b.type!=='secret_text')],
 ['unknown extra variable',f=>f.settings.bindings.push({name:'OTHER',type:'plain_text',text:'private'})],
 ['unidentified extra DB',f=>f.settings.bindings.at(-1).id='unknown'],
 ['candidate staging DB',f=>f.config.d1_databases.push({binding:'cflesportsid_staging',database_id:'4ba57de7-5fda-4703-a956-b1936546986a'})],
 ['runtime override',f=>f.config.vars={CFL_PUBLIC_MODE:'hybrid'}],
 ['route conflict',f=>f.routes.push({pattern:'cflesports.com/*',script:'other'})],
 ['asset mismatch',f=>f.version.resources.assets.config.run_worker_first=true],
 ['missing active assets',f=>{f.settings.assets=f.version.resources.assets;delete f.version.resources.assets;}],
 ['subdomain drift',f=>f.subdomain.enabled=!f.config.workers_dev],
 ['runtime drift',f=>f.version.resources.script_runtime.compatibility_date='2025-01-01'],
])test('frontend review rejects '+name,()=>{const input=fixture();change(input);assert.throws(()=>verifyFrontendCapture(input));});
function transport(f,change=false){let deploymentReads=0;const paths=[];return {paths,get:async path=>{paths.push(path);if(path.endsWith('/deployments'))return {deployments:[{id:change&&deploymentReads++?'changed':'deployment',versions:[{version_id:versionId,percentage:100}]}]};if(path.endsWith('/versions/'+versionId))return f.version;if(path.endsWith('/script-settings'))return f.scriptSettings;if(path.endsWith('/settings'))return f.settings;if(path.endsWith('/domains'))return f.domains;if(path.endsWith('/routes'))return f.routes;if(path.endsWith('/subdomain'))return f.subdomain;assert.fail('Unexpected endpoint');}};}
test('one consolidated capture accepts rollback, rereads drift surfaces, and does not approve upload',async()=>{
 const f=fixture(),api=transport(f),report=await captureFrontend({get:api.get,config:f.config,expectedVersion:versionId});
 assert.equal(report.status,'GO_FOR_RELEASE_REVIEW');assert.equal(report.sourceMappingVerified,false);assert.equal(report.approvalCreated,false);assert.equal(report.uploadAuthorized,false);
 assert.equal(api.paths.length,14);assert.ok(api.paths.every(p=>!p.includes('/d1/')&&!p.includes('/query')));
});
test('deployment change during capture fails closed',async()=>{const f=fixture(),api=transport(f,true);await assert.rejects(captureFrontend({get:api.get,config:f.config,expectedVersion:versionId}),/DEPLOYMENT_CHANGED/);});

test('capture propagates safe named drift diagnostics with current-only D1 identification',async()=>{
 const f=fixture();f.settings.bindings.find(b=>b.name==='ADMIN_HOSTNAME').text='PRIVATE_CHANGED_SENTINEL';
 const api=transport(f);
 await assert.rejects(captureFrontend({get:api.get,config:f.config,expectedVersion:versionId}),error=>{
  assert.equal(error.message,'PRODUCTION_INHERITED_BINDING_DRIFT');
  assert.equal(error.bindingDifferences[0].bindingName,'ADMIN_HOSTNAME');
  assert.deepEqual(error.bindingDifferences[0].differingFields,['text']);
  assert.equal(error.additionalD1Bindings[0].purpose,'known staging database');
  assert.ok(!JSON.stringify(error.bindingDifferences).includes('PRIVATE_CHANGED_SENTINEL'));
  return true;
 });
});
