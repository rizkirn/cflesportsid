import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {UAT,resolvePublicMode} from '../src/data-access/public-mode.mjs';
import {comparePublicContracts} from '../src/data-access/shadow-contract.mjs';
import {validateUATConfig,validateUATBindings,validateRemoteUAT} from '../scripts/phase2c/uat-validator.mjs';
import {readPublicData,publicErrorResponse} from '../src/data-access/public-d1.mjs';
import {expectedSchema} from '../scripts/phase2b/schema.mjs';
const flags={CFL_PUBLIC_MODE:'shadow',CFL_PUBLIC_ENVIRONMENT:'uat',CFL_PUBLIC_HOSTNAME:UAT.hostname,CFL_PUBLIC_WORKER:UAT.worker,CFL_PUBLIC_DATABASE_ID:UAT.database};
const url=new URL('https://'+UAT.hostname);
for(const mode of ['shadow','d1'])test('UAT accepts explicit '+mode,()=>assert.equal(resolvePublicMode({...flags,CFL_PUBLIC_MODE:mode},false,url),mode));
for(const [name,changes,host,dev] of [
 ['production host',{},'https://cflesports.com',false],['wrong host',{},'https://wrong.workers.dev',false],['HTTP',{},'http://'+UAT.hostname,false],
 ['production database',{CFL_PUBLIC_DATABASE_ID:'efded3c4-1cf9-46a9-823e-d0f2d17c683a'},null,false],['production worker',{CFL_PUBLIC_WORKER:'cflesportsid'},null,false],
 ['missing worker',{CFL_PUBLIC_WORKER:undefined},null,false],['missing environment',{CFL_PUBLIC_ENVIRONMENT:undefined},null,false],['local conflict',{CFL_PUBLIC_LOCAL:'phase1c-disposable'},null,false],
 ['development conflict',{},null,true],['unknown mode',{CFL_PUBLIC_MODE:'D1'},null,false],['missing database',{CFL_PUBLIC_DATABASE_ID:undefined},null,false],['missing hostname',{CFL_PUBLIC_HOSTNAME:undefined},null,false]]) {
 test('rejects '+name,()=>assert.throws(()=>resolvePublicMode({...flags,...changes},dev,new URL(host??url))));
}
test('production hybrid remains unchanged',()=>assert.equal(resolvePublicMode({},false,new URL('https://cflesports.com')),'hybrid'));
const config=JSON.parse(readFileSync(new URL('../wrangler.uat.jsonc',import.meta.url)));
test('dedicated config preserves staging assets and hybrid',()=>{validateUATConfig(config);assert.equal(config.vars.CFL_PUBLIC_MODE,'hybrid');assert.equal(config.keep_vars,true);});
test('default configuration rejected',()=>assert.throws(()=>validateUATConfig(config,new URL('../wrangler.jsonc',import.meta.url).pathname)));
for(const key of ['database_id','database_name'])test('config rejects wrong '+key,()=>{const bad=structuredClone(config);bad.d1_databases[0][key]='production';assert.throws(()=>validateUATConfig(bad));});
const bindings=[{type:'d1',name:'DB',id:UAT.database},{type:'r2_bucket',name:'CFL_ASSETS',bucket_name:'cflesportsid-assets-staging'},{type:'assets',name:'ASSETS'},...Object.entries(flags).map(([name,text])=>({type:'plain_text',name,text}))];
test('actual binding validation',()=>{validateUATBindings(bindings,'shadow');for(const bad of [bindings.filter(b=>b.type!=='d1'),bindings.map(b=>b.type==='d1'?{...b,id:'production'}:b),bindings.map(b=>b.type==='r2_bucket'?{...b,bucket_name:'production'}:b)])assert.throws(()=>validateUATBindings(bad,'shadow'));});
const activeId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',latestId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',deploymentId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const workerPath='/workers/scripts/'+UAT.worker;
function remoteFixture({activeMode='hybrid',latestMode='shadow',sameVersion=false,baseline=false}={}) {
 const calls=[];
 const scopedBindings=mode=>[...bindings.map(binding=>binding.name==='CFL_PUBLIC_MODE'?{...binding,text:mode}:binding).filter(binding=>!baseline||!binding.name.startsWith('CFL_PUBLIC_')),
  {type:'plain_text',name:'ADMIN_ACCESS_AUD',text:'PRIVATE_AUTH_SENTINEL'},{type:'secret_text',name:'ADMIN_DRAW_KEY'}];
 const deployed={id:deploymentId,versions:[{version_id:activeId,percentage:100}]};
 const latestVersionId=sameVersion?activeId:latestId;
 const replies={
  '':{id:UAT.account},['/d1/database/'+UAT.database]:{uuid:UAT.database,name:'cflesportsid-staging'},
  [workerPath+'/deployments']:{deployments:[deployed]},
  [workerPath+'/versions/'+activeId]:{id:activeId,resources:{bindings:scopedBindings(activeMode)}},
  [workerPath+'/versions']:{items:[{id:latestVersionId}]},
  [workerPath+'/settings']:{bindings:scopedBindings(sameVersion?activeMode:latestMode)},
  [workerPath+'/script-settings']:{logpush:false,observability:{enabled:false},tags:['PRIVATE_TAG_SENTINEL'],tail_consumers:[]},
 };
 if(!sameVersion)replies[workerPath+'/versions/'+latestId]={id:latestId,resources:{bindings:scopedBindings(latestMode)}};
 let deploymentReads=0;
 const fixture={calls,replies,deployed,finalDeployment:undefined,fetcher:async(address,options)=>{
  const prefix='https://api.cloudflare.com/client/v4/accounts/'+UAT.account;
  assert.equal(new URL(address).origin,'https://api.cloudflare.com');assert.ok(address.startsWith(prefix));
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);
  assert.equal(options.headers.Authorization,'Bearer mock-token');assert.ok(options.signal instanceof AbortSignal);
  const path=address.slice(prefix.length);assert.ok(Object.hasOwn(replies,path),'unexpected endpoint '+path);calls.push(path);
  let result=replies[path];
  if(path===workerPath+'/deployments'&&++deploymentReads>1&&fixture.finalDeployment)result={deployments:[fixture.finalDeployment]};
  return {ok:true,json:async()=>({success:true,result:structuredClone(result)})};
 }};
 return fixture;
}
const verifyFixture=(fixture,mode='hybrid',baseline=false)=>validateRemoteUAT({token:'mock-token',mode,baseline,fetcher:fixture.fetcher});
test('active hybrid and latest shadow are reported as separate configuration scopes',async()=>{
 const fixture=remoteFixture(),result=await verifyFixture(fixture);
 assert.equal(result.status,'PASS');assert.equal(result.mode,'hybrid');assert.equal(result.versionId,activeId);assert.equal(result.deploymentId,deploymentId);
 assert.equal(result.activeVersion.mode,'hybrid');assert.equal(result.latestUploadedVersion.mode,'shadow');assert.equal(result.latestUploadedVersion.versionId,latestId);
 assert.equal(result.combinedSettings.mode,'shadow');assert.equal(result.configurationScopesDiffer,true);assert.equal(result.authenticationBindingCount,2);
 assert.equal(result.workerSettings.logpush,false);assert.equal(result.workerSettings.tailConsumerCount,0);assert.equal(result.remoteWrites,0);
 assert.ok(fixture.calls.indexOf(workerPath+'/deployments')<fixture.calls.indexOf(workerPath+'/settings'));
 assert.ok(fixture.calls.includes(workerPath+'/script-settings'));assert.equal(fixture.calls.filter(p=>p===workerPath+'/deployments').length,2);
 assert.ok(!JSON.stringify(result).includes('PRIVATE_AUTH_SENTINEL'));assert.ok(!JSON.stringify(result).includes('PRIVATE_TAG_SENTINEL'));
});
for(const mode of ['hybrid','shadow','d1'])test('identical active and latest '+mode+' remains valid',async()=>{
 const result=await verifyFixture(remoteFixture({activeMode:mode,sameVersion:true}),mode);
 assert.equal(result.mode,mode);assert.equal(result.configurationScopesDiffer,false);assert.equal(result.latestUploadedVersion.versionId,activeId);
});
test('baseline supports original hybrid flags across both scopes',async()=>{
 const result=await verifyFixture(remoteFixture({sameVersion:true,baseline:true}),'hybrid',true);assert.equal(result.mode,'hybrid');
});
test('active wrong mode is rejected even when combined settings matches expected mode',async()=>{
 const fixture=remoteFixture({activeMode:'shadow',latestMode:'hybrid'});
 await assert.rejects(()=>verifyFixture(fixture),/UAT_MODE_REJECTED/);assert.ok(!fixture.calls.includes(workerPath+'/settings'));
});
for(const mode of [undefined,'unknown'])test('expected reader mode must be explicit: '+String(mode),async()=>{
 const fixture=remoteFixture();await assert.rejects(()=>validateRemoteUAT({token:'mock-token',mode,fetcher:fixture.fetcher}),/UAT_MODE_REJECTED/);
});
for(const [name,versions]of [
 ['split',[{version_id:activeId,percentage:50},{version_id:latestId,percentage:50}]],
 ['partial',[{version_id:activeId,percentage:99}]],['empty',[]],['invalid version ID',[{version_id:'../cflesportsid',percentage:100}]],
])test('rejects '+name+' deployment',async()=>{
 const fixture=remoteFixture();fixture.deployed.versions=versions;await assert.rejects(()=>verifyFixture(fixture),/UAT_DEPLOYMENT_AMBIGUOUS/);
});
test('missing deployment identity is rejected',async()=>{
 const fixture=remoteFixture();delete fixture.deployed.id;await assert.rejects(()=>verifyFixture(fixture),/UAT_DEPLOYMENT_AMBIGUOUS/);
});
for(const [name,change]of [
 ['version',{versions:[{version_id:latestId,percentage:100}]}],['deployment ID',{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}],
 ['split',{versions:[{version_id:activeId,percentage:50},{version_id:latestId,percentage:50}]}],
])test('rejects concurrent '+name+' change',async()=>{
 const fixture=remoteFixture();fixture.finalDeployment={...fixture.deployed,...change};await assert.rejects(()=>verifyFixture(fixture),/UAT_DEPLOYMENT_CHANGED|UAT_DEPLOYMENT_AMBIGUOUS/);
});
for(const [name,path,change,code]of [
 ['account','',r=>({...r,id:'production'}),'UAT_ACCOUNT_REJECTED'],
 ['database UUID','/d1/database/'+UAT.database,r=>({...r,uuid:'efded3c4-1cf9-46a9-823e-d0f2d17c683a'}),'UAT_DATABASE_REJECTED'],
 ['database name','/d1/database/'+UAT.database,r=>({...r,name:'production'}),'UAT_DATABASE_REJECTED'],
 ['active version identity',workerPath+'/versions/'+activeId,r=>({...r,id:latestId}),'UAT_VERSION_REJECTED'],
 ['latest version identity',workerPath+'/versions/'+latestId,r=>({...r,id:activeId}),'UAT_VERSION_REJECTED'],
 ['missing latest version',workerPath+'/versions',()=>({items:[]}),'UAT_LATEST_VERSION_AMBIGUOUS'],
 ['missing Worker settings',workerPath+'/script-settings',()=>null,'UAT_SCRIPT_SETTINGS_MISSING'],
])test('rejects '+name,async()=>{
 const fixture=remoteFixture();fixture.replies[path]=change(fixture.replies[path]);await assert.rejects(()=>verifyFixture(fixture),new RegExp(code));
});
for(const scope of ['active','latest','combined'])for(const [name,change,code]of [
 ['production D1',b=>b.name==='DB'?{...b,id:'efded3c4-1cf9-46a9-823e-d0f2d17c683a'}:b,'UAT_DATABASE_REJECTED'],
 ['production R2',b=>b.name==='CFL_ASSETS'?{...b,bucket_name:'production'}:b,'UAT_R2_REJECTED'],
 ['missing assets',b=>b.name==='ASSETS'?null:b,'UAT_ASSETS_REJECTED'],
 ['production Worker',b=>b.name==='CFL_PUBLIC_WORKER'?{...b,text:'cflesportsid'}:b,'UAT_FLAGS_REJECTED'],
 ['production hostname',b=>b.name==='CFL_PUBLIC_HOSTNAME'?{...b,text:'cflesports.com'}:b,'UAT_FLAGS_REJECTED'],
 ['conflicting environment',b=>b.name==='CFL_PUBLIC_ENVIRONMENT'?{...b,text:'local'}:b,'UAT_FLAGS_REJECTED'],
])test('rejects '+scope+' '+name+' binding',async()=>{
 const fixture=remoteFixture(),path=workerPath+(scope==='active'?'/versions/'+activeId:scope==='latest'?'/versions/'+latestId:'/settings');
 const holder=scope==='combined'?fixture.replies[path]:fixture.replies[path].resources;holder.bindings=holder.bindings.map(change).filter(Boolean);
 await assert.rejects(()=>verifyFixture(fixture),new RegExp(code));
});
for(const scope of ['latest','combined'])test('rejects '+scope+' authentication drift',async()=>{
 const fixture=remoteFixture(),path=workerPath+(scope==='latest'?'/versions/'+latestId:'/settings');const holder=scope==='combined'?fixture.replies[path]:fixture.replies[path].resources;
 holder.bindings=holder.bindings.map(b=>b.name==='ADMIN_ACCESS_AUD'?{...b,text:'different'}:b);await assert.rejects(()=>verifyFixture(fixture),/UAT_AUTH_BINDINGS_INCONSISTENT/);
});
test('rejects latest and combined settings inconsistency independently of active mode',async()=>{
 const fixture=remoteFixture();fixture.replies[workerPath+'/settings'].bindings=fixture.replies[workerPath+'/settings'].bindings.map(b=>b.name==='CFL_PUBLIC_MODE'?{...b,text:'hybrid'}:b);
 await assert.rejects(()=>verifyFixture(fixture),/UAT_LATEST_SETTINGS_INCONSISTENT/);
});
const stage={id:'s',rounds:[],byes:[],mapPool:['a','b'],veto:{steps:[{team:1,action:'ban'}],mapPoolIds:['a','b']}};
const tournament=stages=>[{id:'t',data:{teams:[],stages}}];
test('shadow derives equivalent legacy pool without dropping it',()=>{const legacy=structuredClone(stage);delete legacy.mapPool;const d1=structuredClone(stage);delete d1.veto.mapPoolIds;assert.equal(comparePublicContracts('tournaments',tournament([legacy]),tournament([d1])).mismatches,0);});
for(const field of ['mapPool','veto'])test('shadow reports changed '+field,()=>{const changed=structuredClone(stage);if(field==='mapPool')changed.mapPool.reverse();else changed.veto.mapPoolIds=['b'];const result=comparePublicContracts('tournaments',tournament([stage]),tournament([changed]));assert.equal(result.mismatches,1);assert.deepEqual(result.fields,['stages']);});
test('shadow detects D1-only entities without logging identifiers',()=>{const result=comparePublicContracts('maps',[],[{id:'PRIVATE_IDENTIFIER',data:{name:'PRIVATE_VALUE'}}]);assert.equal(result.mismatches,1);assert.ok(!JSON.stringify(result).includes('PRIVATE'));});
test('shadow detects historical identity changes',()=>{const a=[{id:'1345266890--before-clash-for-glory-s2',data:{ign:'KangDedy',uid:'1345266890',team:'cha-tra-mue'}}];const b=structuredClone(a);b[0].data.team='g2c-prmx';assert.equal(comparePublicContracts('players',a,b).mismatches,1);});
test('shadow ignores private fields and emits allowlisted field names only',()=>{const a=[{id:'map',data:{name:'a',actor_email:'PRIVATE'}}],b=[{id:'map',data:{name:'b',audit_payload:'PRIVATE'}}];const result=comparePublicContracts('maps',a,b);assert.deepEqual(result.fields,['name']);assert.ok(!JSON.stringify(result).includes('PRIVATE'));});
test('schema0011 identity projections and private isolation',async()=>{const sql=new DatabaseSync(':memory:');try{for(const type of ['table','index','trigger','view'])for(const o of expectedSchema(11).objects.filter(o=>o.type===type))sql.exec(o.sql);sql.exec("INSERT INTO teams(id,name,tag,region) VALUES('cha-tra-mue','Historical','H','ID'),('g2c-prmx','Current','C','ID'); INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES('internal','1345266890','Player','KucayyPRMX','g2c-prmx'); INSERT INTO tournaments(id,name,start_date,end_date,status,format,is_test) VALUES('clash-for-glory-s1','S1','2026-08-22','2026-08-23','completed','single-elimination',0),('clash-for-glory-s2','S2','2026-09-26','2026-09-27','completed','single-elimination',0),('private-test','PRIVATE','2026-10-01','2026-10-02','upcoming','single-elimination',1); INSERT INTO player_identity_segments VALUES('1345266890--before-clash-for-glory-s2','internal','1345266890','clash-for-glory-s2','KangDedy','cha-tra-mue'); INSERT INTO player_identity_tournaments VALUES('internal','clash-for-glory-s1','1345266890--before-clash-for-glory-s2');");const db={prepare:query=>({query}),batch:async items=>items.map(({query})=>({success:true,results:sql.prepare(query).all().map(row=>({...row,actor_email:'PRIVATE_SENTINEL'}))}))};const snapshot=await readPublicData(db);assert.equal(snapshot.get('players','1345266890').data.ign,'KucayyPRMX');assert.equal(snapshot.get('players','1345266890--before-clash-for-glory-s2').data.team,'cha-tra-mue');assert.equal(snapshot.profileIdentity('1345266890','clash-for-glory-s1'),'1345266890--before-clash-for-glory-s2');assert.equal(snapshot.profileIdentity('1345266890','clash-for-glory-s2'),'1345266890');assert.throws(()=>snapshot.get('tournaments','private-test'),e=>e.status===404);assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
for(const collection of ['teams','players','maps','matches','tournaments'])assert.throws(()=>snapshot.get(collection,'missing-public-entity'),e=>e.code==='NOT_FOUND'&&e.status===404);
sql.exec("UPDATE player_identity_segments SET uid_snapshot='999'");
await assert.rejects(()=>readPublicData(db),e=>e.code==='INVALID_IDENTITY'&&publicErrorResponse(e).status===500);
}finally{sql.close();}});
test('D1 failures explicit and sanitized',async()=>{for(const db of [null,{prepare(){throw Error('PRIVATE_TOKEN');},batch:async()=>[]}])await assert.rejects(()=>readPublicData(db),e=>{const response=publicErrorResponse(e);assert.equal(response.status,503);assert.ok(!e.message.includes('PRIVATE_TOKEN'));return true;});});

test('validator rejects duplicate names and inconsistent claimed identity',()=>{assert.throws(()=>validateUATBindings([...bindings,bindings[0]],'shadow'));assert.throws(()=>validateUATBindings(bindings.map(b=>b.name==='CFL_PUBLIC_WORKER'?{...b,text:'cflesportsid'}:b),'shadow'));});
test('predeployment baseline supports original hybrid flags only',()=>{const old=bindings.filter(b=>!b.name.startsWith('CFL_PUBLIC_'));validateUATBindings(old,'hybrid',{baseline:true});assert.throws(()=>validateUATBindings(old,'d1',{baseline:true}));assert.throws(()=>validateUATBindings(old,'hybrid'));});

test('UAT config rejects additional resource bindings and environment overrides',()=>{for(const changes of [{services:[{binding:'production',service:'cflesportsid'}]},{env:{production:{}}},{r2_buckets:[{binding:'CFL_ASSETS',bucket_name:'production'}]}])assert.throws(()=>validateUATConfig({...config,...changes}));});
test('missing schema is explicit rather than empty catalog or fallback',async()=>{const sql=new DatabaseSync(':memory:');try{const db={prepare:query=>({query}),batch:async items=>items.map(({query})=>({success:true,results:sql.prepare(query).all()}))};await assert.rejects(()=>readPublicData(db),e=>e.code==='SCHEMA_REQUIRED'&&e.status===503);}finally{sql.close();}});

for(const value of [null,undefined,[],[{service:'test-consumer'}]])test('Worker tail consumers accepts '+JSON.stringify(value),async()=>{
 const fixture=remoteFixture();fixture.replies[workerPath+'/script-settings'].tail_consumers=value;
 const result=await verifyFixture(fixture);assert.equal(result.workerSettings.tailConsumerCount,value?.length??0);
});
for(const value of [false,0,'none',{}])test('Worker tail consumers rejects '+JSON.stringify(value),async()=>{
 const fixture=remoteFixture();fixture.replies[workerPath+'/script-settings'].tail_consumers=value;
 await assert.rejects(()=>verifyFixture(fixture),/UAT_SCRIPT_SETTINGS_INVALID/);
});
