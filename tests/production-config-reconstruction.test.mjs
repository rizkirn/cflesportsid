import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconstructActiveConfiguration,validateActiveConfiguration,privateActiveCapture} from '../scripts/production/active-configuration.mjs';
import {captureActiveConfiguration} from '../scripts/production/reconstruct-config.mjs';
import {verifyFrontendCapture} from '../scripts/production/frontend-preflight.mjs';
import {productionReaderFlags} from '../scripts/production/metadata-helpers.mjs';
const versionId='6f6f4073-6cdd-428e-8951-3c4cdf7a2e15';
function fixture(){
 const template=JSON.parse(readFileSync('wrangler.production.jsonc'));delete template.vars;
 const bindings=[{name:'DB',type:'d1',id:template.d1_databases[0].database_id},{name:'CFL_ASSETS',type:'r2_bucket',bucket_name:template.r2_buckets[0].bucket_name},{name:'ASSETS',type:'assets'},{name:'ADMIN_ACCESS_AUD',type:'plain_text',text:'PRIVATE_AUD_ACTIVE'},{name:'ADMIN_WRITES_ENABLED',type:'plain_text',text:'true'},{name:'ADMIN_DRAW_KEY',type:'secret_text'},...Object.entries(productionReaderFlags()).map(([name,text])=>({name,type:'plain_text',text}))];
 const assets={config:{html_handling:template.assets.html_handling,not_found_handling:template.assets.not_found_handling,run_worker_first:template.assets.run_worker_first}};
 const version={id:versionId,resources:{bindings,assets,script_runtime:{compatibility_date:template.compatibility_date,compatibility_flags:template.compatibility_flags}}};
 const latestVersion=structuredClone(version);
 const currentSettings={bindings:[{name:'DB',type:'d1',database_id:bindings[0].id},{name:'ASSETS',type:'assets'},{name:'ADMIN_ACCESS_AUD',type:'plain_text',text:'PRIVATE_AUD_CURRENT'},{name:'ADMIN_DRAW_KEY',type:'secret_text'},{name:'cflesportsid_staging',type:'d1',id:'4ba57de7-5fda-4703-a956-b1936546986a'}]};
 return {template,version,latestVersion,currentSettings,scriptSettings:{},domains:[{hostname:'cflesports.com',service:'cflesportsid',zone_id:'c8fed6ca36bcc7f2a22cd1b6aa713091'}],routes:[],subdomain:{enabled:template.workers_dev,previews_enabled:template.preview_urls}};
}
test('reconstructs all active plain-text values and bindings despite rollback drift, without secret export',()=>{
 const f=fixture(),before=JSON.stringify(f),result=reconstructActiveConfiguration(f.template,f);
 assert.deepEqual(result.blockers,[]);assert.equal(result.config.vars.ADMIN_ACCESS_AUD,'PRIVATE_AUD_ACTIVE');
 assert.equal(result.config.vars.CFL_PUBLIC_MODE,'d1');assert.equal(result.config.vars.ADMIN_WRITES_ENABLED,'true');
 assert.equal(result.config.d1_databases.length,1);assert.ok(result.config.r2_buckets.some(b=>b.binding==='CFL_ASSETS'));
 assert.equal(Object.hasOwn(result.config.vars,'ADMIN_DRAW_KEY'),false);assert.deepEqual(result.config.secrets,{required:['ADMIN_DRAW_KEY']});
 assert.equal(JSON.stringify(f),before);
 const report=verifyFrontendCapture({config:result.config,version:f.version,settings:f.currentSettings,latestVersion:f.latestVersion,scriptSettings:f.scriptSettings,domains:f.domains,routes:f.routes,subdomain:f.subdomain});
 assert.equal(report.explicitActiveConfiguration,true);assert.ok(!JSON.stringify(report).includes('PRIVATE_AUD'));
});
for(const [name,change,code]of [
 ['AUD override',f=>f.config.vars.ADMIN_ACCESS_AUD='wrong','EXPLICIT_VARIABLES_MUST_MATCH_ACTIVE_VERSION'],
 ['missing variable',f=>delete f.config.vars.CFL_PUBLIC_MODE,'EXPLICIT_VARIABLES_MUST_MATCH_ACTIVE_VERSION'],
 ['extra variable',f=>f.config.vars.UNREVIEWED='x','EXPLICIT_VARIABLES_MUST_MATCH_ACTIVE_VERSION'],
 ['staging DB in candidate',f=>f.config.d1_databases.push({binding:'stage',database_id:'wrong'}),'RELEASE_DATABASE_MISMATCH'],
 ['unknown current binding',f=>f.currentSettings.bindings.push({name:'OTHER',type:'secret_text'}),'UNKNOWN_CURRENT_BINDING'],
 ['missing secret in current',f=>f.currentSettings.bindings=f.currentSettings.bindings.filter(b=>b.type!=='secret_text'),'CURRENT_SECRET_METADATA_DRIFT'],
 ['different latest upload',f=>f.latestVersion.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','SECRET_INHERITANCE_FROM_ACTIVE_VERSION_UNVERIFIED'],
 ['same secret names but different latest bindings',f=>f.latestVersion.resources.bindings[3].text='changed','SECRET_INHERITANCE_FROM_ACTIVE_VERSION_UNVERIFIED'],
 ['missing active assets',f=>delete f.version.resources.assets,'ACTIVE_ASSET_SETTINGS_UNRECOVERABLE'],
 ['asset mismatch',f=>f.config.assets.run_worker_first=true,'RELEASE_ASSET_SETTINGS_MISMATCH'],
 ['unknown active binding',f=>f.version.resources.bindings.push({name:'OPAQUE',type:'service'}),'UNSUPPORTED_ACTIVE_BINDING_TYPE'],
 ['unsafe override',f=>f.config.unsafe={metadata:{bindings:[]}},'UNREVIEWED_CONFIGURATION_KEY'],
 ['route conflict',f=>f.routes.push({pattern:'cflesports.com/*',script:'other'}),'ADDITIONAL_HOST_ROUTES_REQUIRE_REVIEW'],
 ['secret value in JSON vars',f=>f.config.vars.ADMIN_DRAW_KEY='SECRET_VALUE_SENTINEL','EXPLICIT_VARIABLES_MUST_MATCH_ACTIVE_VERSION'],
])test('configuration reconstruction rejects '+name,()=>{const f=fixture();f.config=reconstructActiveConfiguration(f.template,f).config;change(f);assert.ok(validateActiveConfiguration(f).blockers.includes(code));});
test('private capture strips arbitrary secret fields and asset credentials',()=>{
 const f=fixture();f.version.resources.bindings.find(b=>b.type==='secret_text').text='SECRET_VALUE_SENTINEL';f.version.resources.assets.jwt='ASSET_JWT_SENTINEL';
 const text=JSON.stringify(privateActiveCapture(f));assert.ok(!text.includes('SECRET_VALUE_SENTINEL'));assert.ok(!text.includes('ASSET_JWT_SENTINEL'));assert.ok(text.includes('PRIVATE_AUD_ACTIVE'));
 assert.ok(reconstructActiveConfiguration(f.template,f).blockers.includes('SECRET_VALUE_PRESENT_IN_METADATA'));
});
test('reports all unrecoverable conditions together',()=>{const f=fixture();delete f.version.resources.assets;f.latestVersion.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const result=reconstructActiveConfiguration(f.template,f);assert.ok(result.blockers.includes('ACTIVE_ASSET_SETTINGS_UNRECOVERABLE'));assert.ok(result.blockers.includes('SECRET_INHERITANCE_FROM_ACTIVE_VERSION_UNVERIFIED'));});
test('consolidated capture is GET-only through injected client and checks all snapshots twice',async()=>{
 const f=fixture(),calls=[];const get=async path=>{calls.push(path);if(path.endsWith('/deployments'))return {deployments:[{id:'deployment',versions:[{version_id:versionId,percentage:100}]}]};if(path.endsWith('/versions/'+versionId))return f.version;if(path.endsWith('/versions'))return {items:[{id:versionId}]};if(path.endsWith('/script-settings'))return f.scriptSettings;if(path.endsWith('/settings'))return f.currentSettings;if(path.endsWith('/domains'))return f.domains;if(path.endsWith('/routes'))return f.routes;if(path.endsWith('/subdomain'))return f.subdomain;assert.fail('unexpected request');};
 const captured=await captureActiveConfiguration({get,expectedVersion:versionId});assert.equal(captured.version.id,versionId);assert.equal(calls.length,16);assert.ok(calls.every(p=>!p.includes('/d1/')));
});
