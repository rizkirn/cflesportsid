import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {blockedIds} from '../scripts/phase1a/safety.mjs';
import {ROOT,CONFIG,TARGET,PRODUCTION,sha,authorize} from '../scripts/phase2b/guards.mjs';
import {expectedSchema} from '../scripts/phase2b/schema.mjs';
import {identityImportPayload,renderIdentityImport,importPaths,md5} from '../scripts/phase2b/identity-import.mjs';
import {pinnedIdentity} from '../scripts/phase2b/identity.mjs';
import {preflight} from '../scripts/phase2b/preflight.mjs';
import {stagingAPI} from '../scripts/phase2b/api.mjs';
import {prepareOperation,executeIdentityBackfill} from '../scripts/phase2b/operations.mjs';

const refs=JSON.parse(fs.readFileSync(join(ROOT,'scripts/phase2b/registrations.json')));
const baseline=JSON.parse(fs.readFileSync(join(ROOT,'scripts/phase2b/baseline.json')));
const expected=expectedSchema(11),pinned=pinnedIdentity();
const root=fs.mkdtempSync('/private/tmp/cfl-phase2b-backfill-test-');
fs.chmodSync(root,0o700);
const databaseId=randomUUID();assert.ok(!blockedIds(ROOT).includes(databaseId));assert.notEqual(databaseId,TARGET.database);assert.notEqual(databaseId,PRODUCTION);
fs.writeFileSync(join(root,'ownership.json'),JSON.stringify({kind:'backfill-local-test',root,databaseId}),{mode:0o600});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"backfill-local-fixture",modules:true,script:'export default {fetch(){return new Response("local fixture");}}',compatibilityDate:'2026-09-30',d1Databases:{DB:databaseId}}],rootPath:root,defaultPersistRoot:join(root,'state'),d1Persist:join(root,'state','d1'),inspectorPort:0}));
let db,api,manifestPath,batchCalls=0,uploadedBytes,forceSecondFailure=false;
const importRoots=new Set();
const run=async(sql,params=[])=>db.prepare(sql).bind(...params).run();
const query=async(sql,params=[]) => (await db.prepare(sql).bind(...params).all()).results;
async function initialize(){
 db=await mf.getD1Database('DB');
 // Initialize the final schema directly. No migration files or migration runner execute.
 for(const type of ['table','index','trigger','view'])for(const o of expected.objects.filter(o=>o.type===type))await run(o.sql);
 await run('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL)');
 for(const [index,name]of expected.files.entries())await run('INSERT INTO d1_migrations VALUES(?,?)',[index+1,name]);
 for(const team of new Set(refs.map(r=>r.team_id)))await run('INSERT INTO teams(id,name,tag,region) VALUES(?,?,?,?)',[team,team,'test','ID']);
 for(const b of baseline.boundaries)await run('INSERT INTO tournaments(id,name,start_date,end_date,status,format,is_test) VALUES(?,?,?,?,?,?,?)',[b.id,b.id,b.start_date,b.end_date,'completed','single-elimination',b.is_test]);
 const players=new Map(refs.map(r=>[r.uid,r]));
 for(const [uid,r]of players)await run('INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES(?,?,?,?,?)',[uid===pinned.artifact.identity.uid?'internal-player-key':uid,uid,'Synthetic fixture',uid===pinned.artifact.identity.uid?'KucayyPRMX':r.ign,uid===pinned.artifact.identity.uid?'g2c-prmx':r.team_id]);
 const teams=new Set(),positions=new Map();
 for(const r of refs){
   const key=r.tournament_id+'/'+r.team_id;
   if(!teams.has(key)){await run('INSERT INTO tournament_teams VALUES(?,?)',[r.tournament_id,r.team_id]);teams.add(key);}
   // Synthetic ordering only; deliberately not an authoritative historical ordering claim.
   const position=(positions.get(key)??0)+1;positions.set(key,position);
   await run('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)',[r.tournament_id,r.team_id,r.uid===pinned.artifact.identity.uid?'internal-player-key':r.uid,r.ign,position]);
 }
 await run("INSERT INTO maps(id,name) VALUES('fixture-map','Fixture map')");
 await run("INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count) VALUES('clash-for-glory-s1','fixture-stage','Fixture','single-elimination',2,'bo1',1)");
 await run("INSERT INTO tournament_rounds VALUES('clash-for-glory-s1','fixture-stage','fixture-round','Fixture',1,NULL)");
 await run("INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id,team2_id,score1,score2,winner_id) VALUES('fixture-match','clash-for-glory-s1','fixture-stage','fixture-round',1,'2026-08-22','completed','cha-tra-mue','g2c-prmx',1,0,'cha-tra-mue')");
 await run("INSERT INTO match_maps(match_id,map_number,map_id,winner_team_id,score_team1,score_team2,mvp_player_id) VALUES('fixture-match',1,'fixture-map','cha-tra-mue',7,4,'internal-player-key')");
 await run("INSERT INTO player_match_entries(match_id,entry_index,player_id,team_id,uid_snapshot,ign_snapshot) VALUES('fixture-match',1,'internal-player-key','cha-tra-mue','1345266890','KangDedy')");
 await run("INSERT INTO player_round_stats(match_id,entry_index,map_number,round_index,kills,deaths,assists) VALUES('fixture-match',1,1,1,12,4,3)");
 const rosters=await query('SELECT r.tournament_id,r.team_id,r.player_id,p.uid,r.ign_snapshot,r.position FROM tournament_rosters r JOIN players p ON p.id=r.player_id ORDER BY r.tournament_id,r.player_id');
 const sql=Buffer.from('Synthetic backup evidence for local tests only');fs.writeFileSync(join(root,'staging.sql'),sql,{mode:0o600});
 manifestPath=join(root,'manifest.json');fs.writeFileSync(manifestPath,JSON.stringify({kind:'cfl-phase2b-backup-v1',target:TARGET,bytes:sql.length,exportSHA256:sha(sql),preflight:{rosters:{savedRowsHash:sha(JSON.stringify(rosters))}}}),{mode:0o600});
 api=stagingAPI('local-test-token',async(url,options)=>{
   // Every Cloudflare call terminates here: never delegate to fetch or a remote socket.
   const prefix='https://api.cloudflare.com/client/v4/accounts/'+TARGET.account;if(options.method!=='PUT')assert.ok(url.startsWith(prefix));const path=url.slice(prefix.length);
   let result;
   if(options.method==='PUT'){
     assert.ok(url.startsWith('https://'+TARGET.account+'.r2.cloudflarestorage.com/'));assert.equal(options.headers.Authorization,undefined);uploadedBytes=Buffer.from(options.body);return {ok:true,status:200,headers:{get:()=>md5(uploadedBytes)}};
   }
   if(path==='')result={id:TARGET.account};
   else if(path==='/d1/database/'+TARGET.database)result={uuid:TARGET.database,name:'cflesportsid-staging',version:'production'};
   else if(path.endsWith('/settings'))result={bindings:[{name:'DB',type:'d1',id:TARGET.database}]};
   else if(path.endsWith('/deployments'))result={deployments:[{versions:[{version_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',percentage:100}]}]};
   else if(path.includes('/versions/'))result={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',resources:{bindings:[{name:'DB',type:'d1',id:TARGET.database}]}};
   else if(path==='/d1/database/'+TARGET.database+'/query'){
     const body=JSON.parse(options.body);
     try{
       if(body.batch){assert.deepEqual(body.batch,pinned.artifact.statements);batchCalls++;result=await db.batch(body.batch.map(s=>db.prepare(s.sql).bind(...s.params)));}
       else result=[await db.prepare(body.sql).bind(...body.params).all()];
     }catch{return {ok:false,status:400,json:async()=>({success:false,errors:[{code:7500}]})};}
   }else if(path==='/d1/database/'+TARGET.database+'/import'){
     const body=JSON.parse(options.body);
     if(body.action==='init')result={success:true,upload_url:'https://'+TARGET.account+'.r2.cloudflarestorage.com/fixture.sql?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=mock',filename:'fixture.sql'};
     else{
       assert.equal(body.action,'ingest');assert.equal(body.etag,md5(uploadedBytes));
       const nonce=uploadedBytes.toString().split('\n')[0].split(' ').at(-1),rendered=renderIdentityImport(nonce);assert.ok(rendered.bytes.equals(uploadedBytes));
       if(forceSecondFailure)await run("CREATE TRIGGER fixture_failure BEFORE INSERT ON player_identity_tournaments BEGIN SELECT RAISE(ABORT,'forced second failure'); END");
       batchCalls++;try{await db.batch(rendered.statements.map(sql=>db.prepare(sql)));result={success:true,status:'complete',result:{num_queries:2,final_bookmark:'local-fixture',meta:{rows_written:99}}};}
       catch{result={success:true,status:'error'};}finally{if(forceSecondFailure)await run('DROP TRIGGER fixture_failure');}
     }
   }else assert.fail('Unexpected endpoint '+path);
   return {ok:true,status:200,json:async()=>({success:true,result})};
 });
}
const options=()=>({purpose:'identity-backfill',backupManifestPath:manifestPath});
async function approvedPlan(){
 const report=await preflight(api,CONFIG,{},options()),payload=identityImportPayload(new Date(Date.now()+60000).toISOString()),plan=prepareOperation('identity-backfill',report,payload),now=Date.now();
 importRoots.add(importPaths(plan).root);
 const approval={format:'cfl-phase2b-approval-v1',approved:true,approvedBy:'Local fixture only',id:randomUUID(),target:TARGET,operation:'identity-backfill',planDigest:plan.digest,issuedAt:new Date(now-1000).toISOString(),expiresAt:payload.approvalExpiresAt};
 const approvalPath=join(root,approval.id+'.json');fs.writeFileSync(approvalPath,JSON.stringify(approval),{mode:0o600});return {api,configPath:CONFIG,env:{},report,payload,approval,approvalPath,plan};
}
async function tables(){const result={};for(const table of expected.objects.filter(o=>o.type==='table').map(o=>o.name))result[table]=await query('SELECT * FROM '+table+' ORDER BY rowid');return result;}

test('isolated D1 backfill executor',async t=>{
 try{
 await initialize();
 await t.test('schema 0011 preflight: exact ledger, 168 memberships and redacted evidence',async()=>{const r=await preflight(api,CONFIG,{},options());assert.equal(r.schema.objects,44);assert.equal(r.rosters.count,168);assert.equal(r.ledger.length,11);assert.deepEqual(r.pending,[]);assert.equal(r.api.rowsWritten,0);assert.ok(!JSON.stringify(r).includes('KangDedy'));});
 await t.test('unapproved import initialization is rejected without requests',async()=>{const input=await approvedPlan();let calls=0;const guarded=stagingAPI('never-sent',async()=>{calls++;throw Error('UNEXPECTED');});assert.throws(()=>guarded.identityBackfillClient(undefined,input.plan),/AUTHORIZATION/);assert.equal(calls,0);});
 await t.test('missing migration 0011 rejects',async()=>{await run('DELETE FROM d1_migrations WHERE id=11');await assert.rejects(preflight(api,CONFIG,{},options()),/MIGRATIONS/);await run('INSERT INTO d1_migrations VALUES(11,?)',[expected.files.at(-1)]);});
 await t.test('atomic rollback when the second insert fails',async()=>{
   await run("CREATE TRIGGER fixture_failure BEFORE INSERT ON player_identity_tournaments BEGIN SELECT RAISE(ABORT,'forced second-insert failure'); END");
   await assert.rejects(db.batch(renderIdentityImport(randomUUID()).statements.map(sql=>db.prepare(sql))));
   assert.equal((await query('SELECT * FROM player_identity_segments')).length,0);assert.equal((await query('SELECT * FROM player_identity_tournaments')).length,0);
   await assert.rejects(preflight(api,CONFIG,{},options()),/SCHEMA/);await run('DROP TRIGGER fixture_failure');
 });
 for(const [label,change]of [['expired approval',a=>a.expiresAt=new Date(0).toISOString()],['wrong digest',a=>a.planDigest='0'.repeat(64)],['wrong operation',a=>a.operation='backup'],['production target',a=>a.target={...TARGET,database:PRODUCTION}]])await t.test('rejects '+label+' without writes',async()=>{const input=await approvedPlan(),before=batchCalls;change(input.approval);fs.writeFileSync(input.approvalPath,JSON.stringify(input.approval),{mode:0o600});await assert.rejects(executeIdentityBackfill(input));assert.equal(batchCalls,before);assert.ok(!fs.existsSync(input.approvalPath+'.used'));});
 await t.test('missing approval is rejected before writes',async()=>{const input=await approvedPlan();input.approval=undefined;await assert.rejects(executeIdentityBackfill(input));assert.equal(batchCalls,0);});
 await t.test('conflicting and partial identity states reject',async()=>{
   const s=pinned.artifact.statements[0];await run(s.sql,s.params);await assert.rejects(preflight(api,CONFIG,{},options()),/IDENTITY_SEGMENTS/);
   await run("UPDATE player_identity_segments SET ign_snapshot='Conflict'");await assert.rejects(preflight(api,CONFIG,{},options()),/IDENTITY_SEGMENTS/);await run('DELETE FROM player_identity_segments');
 });
 await t.test('backup checksum tampering rejects',async()=>{const path=join(root,'staging.sql'),bytes=fs.readFileSync(path);fs.writeFileSync(path,'tampered');await assert.rejects(preflight(api,CONFIG,{},options()),/CHECKSUM/);fs.writeFileSync(path,bytes);});
 await t.test('wrong pinned artifact checksum rejects',async()=>{const input=await approvedPlan();assert.throws(()=>prepareOperation('identity-backfill',input.report,{...input.payload,artifactHash:'0'.repeat(64)}),/HASH/);});
 await t.test('executor stops after a second-insert failure with no partial local backfill',async()=>{const before=await tables(),input=await approvedPlan();forceSecondFailure=true;try{await assert.rejects(executeIdentityBackfill(input),/IMPORT_FAILED_READ_ONLY_INVESTIGATION_REQUIRED/);assert.deepEqual(await tables(),before);assert.ok(fs.existsSync(input.approvalPath+'.used'));assert.equal(batchCalls,1);}finally{forceSecondFailure=false;}});
 await t.test('successful backfill inserts two records and preserves every other table',async()=>{
   const before=await tables(),input=await approvedPlan(),result=await executeIdentityBackfill(input),after=await tables();
   assert.equal(result.status,'BACKFILL_COMPLETE');assert.equal(result.nextOperation,'NONE');assert.equal(batchCalls,2);assert.equal(after.player_identity_segments.length,1);assert.equal(after.player_identity_tournaments.length,1);
   assert.equal(after.player_identity_segments[0].player_id,'internal-player-key');assert.equal(after.player_identity_segments[0].ign_snapshot,'KangDedy');
   for(const [table,rows]of Object.entries(before))if(!table.startsWith('player_identity_'))assert.deepEqual(after[table],rows,table);
   assert.deepEqual(await query('PRAGMA foreign_key_check'),[]);
   await assert.rejects(executeIdentityBackfill(input));assert.equal(batchCalls,2);await assert.rejects(preflight(api,CONFIG,{},options()),/IDENTITY_SEGMENTS/);
 });
 await t.test('postflight query failure stops without restoring committed local rows',async()=>{
   await run('DELETE FROM player_identity_tournaments');await run('DELETE FROM player_identity_segments');
   const input=await approvedPlan(),original=api.query;
   api.query=async(sql,params)=>{if(batchCalls===3&&sql.includes('FROM player_identity_segments'))throw Error('POSTFLIGHT_QUERY_FAILED');return original(sql,params);};
   try{await assert.rejects(executeIdentityBackfill(input),/POSTFLIGHT_QUERY_FAILED/);assert.equal((await query('SELECT * FROM player_identity_segments')).length,1);assert.equal((await query('SELECT * FROM player_identity_tournaments')).length,1);assert.equal(batchCalls,3);assert.ok(fs.existsSync(input.approvalPath+'.used'));}finally{api.query=original;}
 });
 }finally{await mf.dispose();for(const directory of importRoots)if(fs.existsSync(directory)){const marker=JSON.parse(fs.readFileSync(join(directory,'ownership.json')));assert.equal(marker.root,directory);assert.equal(marker.kind,'cfl-phase2b-identity-import-v1');fs.rmSync(directory,{recursive:true});}assert.equal(JSON.parse(fs.readFileSync(join(root,'ownership.json'))).root,root);fs.rmSync(root,{recursive:true});}
});
