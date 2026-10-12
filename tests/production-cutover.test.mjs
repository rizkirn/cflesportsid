import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolvePublicMode, PRODUCTION_PUBLIC, publicSitemapResponse, publicSitemapPaths, publicStaticSitemapPaths} from '../src/data-access/public-mode.mjs';
import {publicErrorResponse, readPublicData} from '../src/data-access/public-d1.mjs';
import {productionReaderFlags, requireProductionConfigurationCapture, verifyCutoverSourcePaths} from '../scripts/phase2c/production-cutover.mjs';
import {expectedSchema} from '../scripts/phase2b/schema.mjs';
const url = new URL('https://cflesports.com/');
const env = {...productionReaderFlags(), DB:{prepare(){}, batch(){}}, CFL_ASSETS:{get(){}}, ASSETS:{fetch(){}}};
test('production D1 requires explicit exact target and binding capabilities', () => assert.equal(resolvePublicMode(env, false, url), 'd1'));
test('existing production hybrid remains the default', () => assert.equal(resolvePublicMode({}, false, url), 'hybrid'));
for (const [name, changes, address, dev] of [
 ['wrong account', {CFL_PUBLIC_ACCOUNT_ID:'wrong'}], ['missing account', {CFL_PUBLIC_ACCOUNT_ID:undefined}],
 ['staging UUID', {CFL_PUBLIC_DATABASE_ID:'4ba57de7-5fda-4703-a956-b1936546986a'}],
 ['wrong Worker', {CFL_PUBLIC_WORKER:'cflesportsid-uat'}], ['missing identity', {CFL_PUBLIC_ENVIRONMENT:undefined}],
 ['wrong declared hostname', {CFL_PUBLIC_HOSTNAME:'cflesportsid-uat.cflid.workers.dev'}],
 ['shadow mode', {CFL_PUBLIC_MODE:'shadow'}], ['local override', {CFL_PUBLIC_LOCAL:'phase1c-disposable'}],
 ['staging extra binding', {cflesportsid_staging:{}}], ['missing DB', {DB:undefined}],
 ['missing R2', {CFL_ASSETS:undefined}], ['missing ASSETS', {ASSETS:undefined}],
 ['wrong request hostname', {}, 'https://cflesportsid-uat.cflid.workers.dev'],
 ['HTTP', {}, 'http://cflesports.com'], ['port', {}, 'https://cflesports.com:8443'], ['development', {}, undefined, true],
]) test('production rejects ' + name, () => assert.throws(() => resolvePublicMode({...env,...changes}, dev ?? false, new URL(address ?? url))));
test('production guard errors remain explicit 503 without sensitive values', async () => {
  let error; try {resolvePublicMode({...env,DB:undefined}, false, url);} catch(e) {error=e;}
  const response=publicErrorResponse(error);assert.equal(response.status,503);assert.ok(!(await response.text()).includes(PRODUCTION_PUBLIC.database));
});
test('cutover config cannot be derived from fingerprints or repository defaults alone', () => {
  const report={versionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'READ_ONLY_BASELINE_VERIFIED',target:{account:PRODUCTION_PUBLIC.account,database:PRODUCTION_PUBLIC.database,databaseName:'cflesportsid',worker:PRODUCTION_PUBLIC.worker,hostname:PRODUCTION_PUBLIC.hostname},mode:'hybrid',schema:{version:11,pending:[]},identityState:'EXACT',traffic:100};
  assert.throws(() => requireProductionConfigurationCapture({report}), /LIVE_CONFIGURATION_CAPTURE_REQUIRED/);
});
test('canonical D1 sitemap includes static routes, official entities and historical profiles without private test data', async () => {
 const sql=new DatabaseSync(':memory:');try {
  for(const type of ['table','index','trigger','view'])for(const o of expectedSchema(11).objects.filter(o=>o.type===type))sql.exec(o.sql);
  sql.exec("INSERT INTO teams(id,name,tag,region) VALUES('cha-tra-mue','Historical','H','ID'),('g2c-prmx','Current','C','ID'),('test-team','Private','P','ID'); INSERT INTO players(id,uid,name,current_ign,current_team_id,photo_asset_key) VALUES('internal','1345266890','Player','KucayyPRMX','g2c-prmx','players/1345266890/"+'a'.repeat(64)+".webp'),('private-player','999','Private','Private','test-team',NULL); INSERT INTO tournaments(id,name,start_date,end_date,status,format,is_test) VALUES('clash-for-glory-s1','S1','2026-08-22','2026-08-23','completed','single-elimination',0),('clash-for-glory-s2','S2','2026-09-26','2026-09-27','completed','single-elimination',0),('private-test','Private','2026-10-01','2026-10-02','upcoming','single-elimination',1); INSERT INTO tournament_teams VALUES('private-test','test-team'); INSERT INTO tournament_rosters VALUES('private-test','test-team','private-player','Private',1); INSERT INTO player_identity_segments VALUES('1345266890--before-clash-for-glory-s2','internal','1345266890','clash-for-glory-s2','KangDedy','cha-tra-mue'); INSERT INTO player_identity_tournaments VALUES('internal','clash-for-glory-s1','1345266890--before-clash-for-glory-s2');");
  const snapshot=await readPublicData({prepare:query=>({query}),batch:async items=>items.map(({query})=>({success:true,results:sql.prepare(query).all()}))});
  const response=publicSitemapResponse(snapshot),body=await response.text();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  for(const path of [...publicStaticSitemapPaths,...publicSitemapPaths(snapshot)])assert.ok(body.includes('<loc>https://cflesports.com'+path+'</loc>'));
  assert.ok(body.includes('/players/1345266890--before-clash-for-glory-s2/'));assert.ok(!/private-test|test-team|players\/999|photo_asset_key/.test(body));
  assert.equal(snapshot.get('players','1345266890').data.photo_asset_key, 'players/1345266890/'+'a'.repeat(64)+'.webp');
  const index=await publicSitemapResponse(snapshot,true).text();assert.ok(index.includes('https://cflesports.com/sitemap-0.xml'));assert.ok(!index.includes('<url>'));
 }finally{sql.close();}
});
test('runtime sitemap endpoints require the D1 request snapshot and never read JSON', () => {
 for(const name of ['sitemap-0.xml.ts','sitemap-index.xml.ts']){const s=readFileSync(new URL('../src/pages/'+name,import.meta.url),'utf8');assert.ok(s.includes('prerender = false'));assert.ok(s.includes('localD1Snapshot()'));assert.ok(s.includes('MISSING_BINDING'));assert.ok(!/astro:content|src\/data|readFile/.test(s));}
});
test('production build skips JSON entity enumeration and generated static sitemaps', () => {
 const config=readFileSync(new URL('../astro.config.mjs',import.meta.url),'utf8');assert.ok(config.includes("CFL_PUBLIC_BUILD_TARGET === 'production-d1'"));assert.ok(config.includes('detailPages = productionD1 ? []'));assert.ok(config.includes('integrations: productionD1 ? []'));
});
test('reviewed D1 no-fallback and photo reference paths are preserved', () => verifyCutoverSourcePaths(new URL('../',import.meta.url).pathname.replace(/\/$/,'')));

function retainedConfigurationFixture() {
  const target={account:PRODUCTION_PUBLIC.account,database:PRODUCTION_PUBLIC.database,databaseName:'cflesportsid',worker:PRODUCTION_PUBLIC.worker,hostname:PRODUCTION_PUBLIC.hostname};
  const version={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',resources:{script_runtime:{compatibility_date:'2026-09-30',compatibility_flags:['nodejs_compat']},bindings:[{type:'assets',name:'ASSETS'},{type:'r2_bucket',name:'CFL_ASSETS',bucket_name:'cflesportsid-assets-production'},{type:'d1',name:'DB',id:target.database},{type:'plain_text',name:'ADMIN_HOSTNAME',text:'PRIVATE_TEST_AUTH_VALUE'}]}};
  const scriptSettings={logpush:false,tail_consumers:null,observability:{enabled:false}},routing={domains:[{hostname:target.hostname,service:target.worker}],routes:[]},assets={config:{}},subdomain={enabled:false,previews_enabled:false};
  return {target,version,scriptSettings,routing,assets,subdomain};
}
async function completeCaptureFixture() {
 const {inspectProductionBindings}=await import('../scripts/phase2c/production-preflight.mjs');const {sha}=await import('../scripts/phase2b/guards.mjs');const input=retainedConfigurationFixture(),b=inspectProductionBindings(input.version.resources.bindings);
 input.report={target:input.target,status:'READ_ONLY_BASELINE_VERIFIED',mode:'hybrid',traffic:100,schema:{version:11,pending:[]},identityState:'EXACT',versionId:input.version.id,bindingsHash:b.bindingsHash,authenticationFingerprint:b.authenticationFingerprint,scriptSettingsHash:sha(JSON.stringify(input.scriptSettings)),routesHash:sha(JSON.stringify([input.routing.domains,input.routing.routes]))};return input;
}
test('complete configuration capture reuses exact verified resources without repository defaults', async () => {
 const input=await completeCaptureFixture(),result=requireProductionConfigurationCapture(input);assert.equal(result.bindings.bucket,'cflesportsid-assets-production');assert.deepEqual(result.readerFlags,productionReaderFlags());assert.deepEqual(result.runtime,input.version.resources.script_runtime);
});
for(const [name,change]of [
 ['wrong target',i=>i.report.target.database='4ba57de7-5fda-4703-a956-b1936546986a'],
 ['wrong active version',i=>i.version.id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
 ['split traffic',i=>i.report.traffic=50],
 ['binding drift',i=>i.version.resources.bindings[2].id='4ba57de7-5fda-4703-a956-b1936546986a'],
 ['authentication drift',i=>i.version.resources.bindings[3].text='CHANGED_TEST_VALUE'],
 ['settings drift',i=>i.scriptSettings.observability.enabled=true],
 ['routing drift',i=>i.routing.domains[0].service='cflesportsid-uat'],
 ['ambiguous subdomain',i=>i.subdomain.enabled=undefined],
 ['missing asset settings',i=>i.assets=undefined],
])test('configuration capture rejects '+name, async () => {const input=await completeCaptureFixture();change(input);assert.throws(()=>requireProductionConfigurationCapture(input));});
