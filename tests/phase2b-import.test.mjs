import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {ROOT,TARGET,PRODUCTION,MIGRATION,MIGRATION_HASH,sha,authorize} from '../scripts/phase2b/guards.mjs';
import {identityImportPayload,renderIdentityImport,renderParameters,sqlLiteral,prepareImportFile,importPaths,approvedImportBytes,validateImportPayload,validateUploadURL,md5} from '../scripts/phase2b/identity-import.mjs';
import {pinnedIdentity} from '../scripts/phase2b/identity.mjs';
import {prepareOperation} from '../scripts/phase2b/operations.mjs';
import {stagingAPI} from '../scripts/phase2b/api.mjs';

function setup(){
 const payload=identityImportPayload(new Date(Date.now()+60000).toISOString());
 const report={format:'cfl-phase2b-preflight-v1',status:'PASS',checkedAt:new Date().toISOString(),target:TARGET,configHash:'c'.repeat(64),migrationHash:MIGRATION_HASH,purpose:'identity-backfill',identity:{state:'empty',segments:0,tournaments:0,artifactHash:payload.artifactHash},pending:[],ledger:[MIGRATION],backup:{manifestHash:'b'.repeat(64)}};
 const plan=prepareOperation('identity-backfill',report,payload);
 const approval={format:'cfl-phase2b-approval-v1',approved:true,approvedBy:'Local mock operator',id:randomUUID(),target:TARGET,operation:'identity-backfill',planDigest:plan.digest,issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:payload.approvalExpiresAt};
 const paths=prepareImportFile(plan);return {plan,approval,paths,report,payload};
}
function cleanup(f){const marker=JSON.parse(fs.readFileSync(f.paths.marker));assert.equal(marker.kind,'cfl-phase2b-identity-import-v1');assert.equal(marker.root,f.paths.root);assert.equal(marker.owner,process.getuid());assert.equal(marker.nonce,f.payload.nonce);fs.rmSync(f.paths.root,{recursive:true});}
const response=(result,status=200)=>({ok:status===200,status,redirected:false,json:async()=>({success:true,result})});
const complete=()=>({success:true,status:'complete',at_bookmark:'mock-initial',result:{num_queries:2,final_bookmark:'mock-final',meta:{rows_written:999}}});
function protocol(f,change={}){
 const calls=[];let bytes,polls=0;
 const uploadURL='https://'+TARGET.account+'.r2.cloudflarestorage.com/mock/identity.sql?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=mock';
 const fetcher=async(url,options)=>{
   assert.equal(options.redirect,'error');
   if(options.method==='PUT'){
     calls.push('upload');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.authorization,undefined);
     bytes=Buffer.from(options.body);assert.equal(sha(bytes),f.payload.sqlSHA256);assert.equal(options.headers['Content-Length'],String(bytes.length));
     if(change.afterUpload)await change.afterUpload();
     return {ok:true,status:200,redirected:change.redirected??false,headers:{get:()=>change.etag??'"'+md5(bytes)+'"'}};
   }
   assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+TARGET.account+'/d1/database/'+TARGET.database+'/import');
   assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer mock-only-token');
   const body=JSON.parse(options.body);calls.push(body.action);
   if(change.fail===body.action)throw Error('must-not-expose-token-or-signed-url');
   if(body.action==='init'){
     assert.equal(body.etag,md5(approvedImportBytes(f.plan)));
     if(change.cached)return response(change.cached);
     return response({...(!change.minimalInit?{success:true}:{}),upload_url:change.url??uploadURL,filename:'mock/'+TARGET.database+'/'+body.etag+'.sql'});
   }
   if(body.action==='ingest'){
     assert.equal(body.etag,md5(bytes));assert.ok(body.filename.includes(TARGET.database));
     if(change.apply)await change.apply(bytes);
     return response(change.ingest??{success:true,status:'active',at_bookmark:'mock-initial'});
   }
   assert.equal(body.action,'poll');assert.equal(body.current_bookmark,'mock-initial');polls++;
   return response(change.poll??(polls===1?{success:true,at_bookmark:'mock-initial'}:complete()));
 };
 const api=stagingAPI('mock-only-token',fetcher,{sleep:async()=>{}});
 return {api,calls,client:()=>api.identityBackfillClient(f.approval,f.plan)};
}

test('rendered SQL is deterministic, contains exactly the two pinned inserts, and has a nonce-bound SHA',()=>{
 const nonce='00000000-0000-4000-8000-000000000001',r=renderIdentityImport(nonce),again=renderIdentityImport(nonce);
 assert.ok(r.bytes.equals(again.bytes));assert.equal(r.statements.length,2);assert.equal((r.bytes.toString().match(/INSERT INTO /g)??[]).length,2);
 assert.equal(r.sqlSHA256,sha(r.bytes));assert.notEqual(r.sqlSHA256,renderIdentityImport(randomUUID()).sqlSHA256);assert.equal(r.artifactHash,pinnedIdentity().hash);
 for(const sql of r.statements){assert.ok(!sql.includes('?'));assert.doesNotMatch(sql,/\b(?:CREATE|ALTER|DROP|PRAGMA|COMMIT|BEGIN TRANSACTION|ROLLBACK|d1_migrations)\b/i);}
});
test('numbered replacement handles ?1 and ?10 without prefix substitution',()=>{
 const sql='SELECT '+Array.from({length:10},(_,i)=>'?'+(i+1)).join(',')+',?1';
 const db=new DatabaseSync(':memory:');try{assert.deepEqual(Object.values(db.prepare(renderParameters(sql,Array.from({length:10},(_,i)=>'value'+(i+1)))).get()),Array.from({length:10},(_,i)=>'value'+(i+1)));}finally{db.close();}
});
test('literal escaping preserves quotes, unicode, newlines and apparent injected statements',()=>{
 const db=new DatabaseSync(':memory:');try{for(const value of ["O'Brien","'; DROP TABLE players; --",'?1 ?10','KangDedy\nIndonesia','名字'])assert.equal(db.prepare('SELECT '+sqlLiteral(value)+' AS value').get().value,value);assert.equal(sqlLiteral(null),'NULL');assert.equal(sqlLiteral(12),'12');}finally{db.close();}
});
test('quoted identifiers, literal parameters and comments are not substituted',()=>{
 const rendered=renderParameters("SELECT ?1, '?1', \"?1\", [x?1], `?1` -- ?1\n/* ?1 */",["O'Brien"]);
 assert.equal(rendered,"SELECT 'O''Brien', '?1', \"?1\", [x?1], `?1` -- ?1\n/* ?1 */");
});
test('malformed, missing, unnamed and unused parameters reject',()=>{
 for(const [sql,params]of [['SELECT ?0',[1]],['SELECT ?',[1]],['SELECT ?2',[1]],['SELECT ?1x',[1]],['SELECT 1',[1]],['SELECT ?1,:x',[1]],['SELECT ?1,\'unterminated',[1]]])assert.throws(()=>renderParameters(sql,params));
 for(const value of [undefined,NaN,Infinity,'nul\0text',{}])assert.throws(()=>sqlLiteral(value));
});
test('extra SQL, wrong transport, altered checksum and invalid nonce reject',()=>{
 const f=setup();try{
 for(const [key,value]of [['transport','rest-query'],['rendererVersion','unknown'],['rendererSHA256','0'.repeat(64)],['sqlSHA256','0'.repeat(64)],['artifactHash','0'.repeat(64)],['nonce','../escape'],['sql','DROP TABLE players']])assert.throws(()=>validateImportPayload({...f.payload,[key]:value}));
 }finally{cleanup(f);}
});
test('approval expiry is bound to the digest and cannot be extended',()=>{const f=setup();try{authorize(f.approval,f.plan);assert.throws(()=>authorize({...f.approval,expiresAt:new Date(Date.now()+120000).toISOString()},f.plan),/EXPIRATION_MISMATCH/);}finally{cleanup(f);}});
test('successful mocked import traverses init/upload/ingest/poll without using rows_written as identity count',async()=>{
 const f=setup();try{const mock=protocol(f),result=await mock.client().applyPinnedArtifact();assert.equal(result.numQueries,2);assert.equal(result.sqlSHA256,f.payload.sqlSHA256);assert.deepEqual(mock.calls,['init','upload','ingest','poll','poll']);assert.equal(mock.api.audit.rowsWritten,999);assert.equal(mock.api.audit.queries,0);}finally{cleanup(f);}
});
for(const cached of [{success:true,status:'active',at_bookmark:'mock-initial'},complete()])test('cached-upload initialization '+cached.status+' never reuploads or reingests',async()=>{
 const f=setup();try{const mock=protocol(f,{cached});assert.equal((await mock.client().applyPinnedArtifact()).status,'complete');assert.ok(!mock.calls.includes('upload'));assert.ok(!mock.calls.includes('ingest'));assert.equal(mock.calls[0],'init');}finally{cleanup(f);}
});
for(const [label,change]of [
 ['expired',f=>f.approval.expiresAt=new Date(0).toISOString()],
 ['wrong digest',f=>f.approval.planDigest='0'.repeat(64)],
 ['wrong operation',f=>f.approval.operation='backup'],
 ['production target',f=>f.approval.target={...TARGET,database:PRODUCTION}],
 ['missing approval',f=>f.approval=undefined],
 ['modified SQL',f=>fs.appendFileSync(f.paths.file,'DROP TABLE players;')],
 ['modified transport',f=>f.plan.payload.transport='rest-query'],
])test('rejects '+label+' before import initialization',async()=>{
 const f=setup();try{const mock=protocol(f);change(f);await assert.rejects(async()=>mock.client().applyPinnedArtifact());assert.deepEqual(mock.calls,[]);}finally{cleanup(f);}
});
test('stale preflight rejects even when approval has not expired',()=>{const f=setup();try{const report={...f.report,checkedAt:new Date(Date.now()-14.5*60*1000).toISOString()},plan=prepareOperation('identity-backfill',report,f.payload),approval={...f.approval,planDigest:plan.digest};const future=Date.parse(plan.preflightExpiresAt)+1;assert.ok(Date.parse(approval.expiresAt)>future);assert.throws(()=>authorize(approval,plan,future),/STALE/);}finally{cleanup(f);}});
test('private SQL file and ownership marker cannot be replaced or overwritten',()=>{
 const f=setup();try{assert.throws(()=>prepareImportFile(f.plan),/EEXIST/);fs.chmodSync(f.paths.file,0o644);assert.throws(()=>approvedImportBytes(f.plan),/PRIVATE/);fs.chmodSync(f.paths.file,0o600);const file=f.paths.file+'.copy';fs.renameSync(f.paths.file,file);fs.symlinkSync(file,f.paths.file);assert.throws(()=>approvedImportBytes(f.plan),/PRIVATE/);}finally{cleanup(f);}
});
for(const url of ['http://'+TARGET.account+'.r2.cloudflarestorage.com/x','https://evil.example/x','https://'+TARGET.account+'.r2.cloudflarestorage.com.evil.example/x','https://user:password@'+TARGET.account+'.r2.cloudflarestorage.com/x','https://127.0.0.1/x','https://'+TARGET.account+'.r2.cloudflarestorage.com/x'])test('rejects upload destination '+url.split('/')[2],()=>assert.throws(()=>validateUploadURL(url),/HOST/));
for(const [label,change,pattern]of [
 ['unexpected signed upload host',{url:'https://evil.example/signed'},/HOST/],
 ['upload redirect',{redirected:true},/UPLOAD_REJECTED/],
 ['upload checksum mismatch',{etag:'incorrect'},/CHECKSUM/],
 ['failed import',{ingest:{success:true,status:'error'}},/IMPORT_FAILED/],
 ['unexpected status',{ingest:{success:true,status:'unknown',at_bookmark:'mock-initial'}},/STATUS/],
 ['wrong completion count',{ingest:{...complete(),result:{num_queries:3,final_bookmark:'mock-final'}}},/COMPLETION/],
 ['changed poll bookmark',{poll:{success:true,status:'active',at_bookmark:'different'}},/BOOKMARK_CHANGED/],
 ['poll limit',{poll:{success:true,status:'active',at_bookmark:'mock-initial'}},/POLL_LIMIT/],
])test('stops on '+label+' without automatic resubmission',async()=>{
 const f=setup();try{const mock=protocol(f,change);await assert.rejects(mock.client().applyPinnedArtifact(),pattern);assert.equal(mock.calls.filter(c=>c==='init').length,1);assert.ok(mock.calls.filter(c=>c==='ingest').length<=1);assert.ok(!mock.calls.includes('restore'));}finally{cleanup(f);}
});
for(const phase of ['init','ingest','poll'])test('ambiguous '+phase+' timeout stops with a secret-free investigation error',async()=>{
 const f=setup();try{const mock=protocol(f,{fail:phase});await assert.rejects(mock.client().applyPinnedArtifact(),e=>e.message.includes('IMPORT_OUTCOME_AMBIGUOUS')&&e.message.includes('READ_ONLY_INVESTIGATION_REQUIRED')&&!e.message.includes('token-or-signed-url'));assert.equal(mock.calls.filter(c=>c===phase).length,1);}finally{cleanup(f);}
});
test('SQL changed after upload prevents ingest',async()=>{const f=setup();try{const mock=protocol(f,{afterUpload:()=>fs.appendFileSync(f.paths.file,'\n-- changed')});await assert.rejects(mock.client().applyPinnedArtifact(),/APPROVED_SQL_CHANGED/);assert.deepEqual(mock.calls,['init','upload']);}finally{cleanup(f);}});
test('expiration after upload prevents ingest',async()=>{const f=setup();try{const mock=protocol(f,{afterUpload:()=>{f.approval.expiresAt=new Date(0).toISOString();}});await assert.rejects(mock.client().applyPinnedArtifact(),/APPROVAL_EXPIRED/);assert.deepEqual(mock.calls,['init','upload']);}finally{cleanup(f);}});

test('rendered inserts preserve original SQL semantics and roll back the first on second failure (local SQLite)',()=>{
 const artifact=pinnedIdentity().artifact,r=renderIdentityImport(randomUUID());
 function fixture(){const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON; CREATE TABLE players(id TEXT PRIMARY KEY,uid TEXT UNIQUE); CREATE TABLE teams(id TEXT PRIMARY KEY); CREATE TABLE tournaments(id TEXT PRIMARY KEY,is_test INTEGER,start_date TEXT); CREATE TABLE tournament_rosters(player_id TEXT,tournament_id TEXT,team_id TEXT,ign_snapshot TEXT,position INTEGER); CREATE TABLE player_identity_segments(id TEXT PRIMARY KEY NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),uid_snapshot TEXT NOT NULL,boundary_tournament_id TEXT NOT NULL REFERENCES tournaments(id),ign_snapshot TEXT NOT NULL,team_id TEXT NOT NULL REFERENCES teams(id),UNIQUE(id,player_id)); CREATE TABLE player_identity_tournaments(player_id TEXT NOT NULL,tournament_id TEXT NOT NULL REFERENCES tournaments(id),segment_id TEXT NOT NULL,PRIMARY KEY(player_id,tournament_id),FOREIGN KEY(segment_id,player_id) REFERENCES player_identity_segments(id,player_id)); INSERT INTO players VALUES('internal','1345266890'); INSERT INTO teams VALUES('cha-tra-mue'); INSERT INTO tournaments VALUES('clash-for-glory-s1',0,'2026-08-22'); INSERT INTO tournaments VALUES('clash-for-glory-s2',0,'2026-09-26'); INSERT INTO tournament_rosters VALUES('internal','clash-for-glory-s1','cha-tra-mue','KangDedy',7);");return db;}
 const original=fixture(),rendered=fixture();try{
 for(const s of artifact.statements)original.prepare(s.sql).run(Object.fromEntries(s.params.map((v,i)=>[String(i+1),v])));
 rendered.exec('BEGIN');for(const sql of r.statements)rendered.prepare(sql).run();rendered.exec('COMMIT');
 for(const table of ['player_identity_segments','player_identity_tournaments','tournament_rosters','players'])assert.deepEqual(rendered.prepare('SELECT * FROM '+table).all(),original.prepare('SELECT * FROM '+table).all());
 rendered.exec("DELETE FROM player_identity_tournaments; DELETE FROM player_identity_segments; CREATE TRIGGER reject_second BEFORE INSERT ON player_identity_tournaments BEGIN SELECT RAISE(ABORT,'forced failure'); END;");
 rendered.exec('BEGIN');assert.throws(()=>{for(const sql of r.statements)rendered.prepare(sql).run();});rendered.exec('ROLLBACK');assert.equal(rendered.prepare('SELECT COUNT(*) n FROM player_identity_segments').get().n,0);assert.equal(rendered.prepare('SELECT COUNT(*) n FROM player_identity_tournaments').get().n,0);
 }finally{original.close();rendered.close();}
});

test('an import attempt cannot be replayed through the same API client',async()=>{const f=setup();try{const mock=protocol(f),client=mock.client();await client.applyPinnedArtifact();const count=mock.calls.length;assert.throws(()=>client.applyPinnedArtifact(),/IMPORT_ALREADY_ATTEMPTED/);assert.throws(()=>mock.client().applyPinnedArtifact(),/IMPORT_ALREADY_ATTEMPTED/);assert.equal(mock.calls.length,count);}finally{cleanup(f);}});
test('HTTP authentication error is retained without server messages or credentials',async()=>{const f=setup();try{let calls=0;const api=stagingAPI('must-stay-secret',async()=>{calls++;return {ok:false,status:403,json:async()=>({success:false,errors:[{code:9109,message:'must-stay-secret'}]})};});await assert.rejects(api.identityBackfillClient(f.approval,f.plan).applyPinnedArtifact(),e=>e.message.includes('CLOUDFLARE_HTTP_403_CODES_9109')&&!e.message.includes('must-stay-secret'));assert.equal(calls,1);}finally{cleanup(f);}});
test('default configuration, direct import endpoint access, and stale preflight fail before requests',async()=>{const f=setup();try{const {loadConfig,CONFIG,operationPlan}=await import('../scripts/phase2b/guards.mjs');assert.throws(()=>loadConfig(ROOT+'/wrangler.jsonc',{}),/EXPLICIT/);assert.throws(()=>prepareOperation('identity-backfill',{...f.report,checkedAt:new Date(0).toISOString()},f.payload),/STALE/);let calls=0;const api=stagingAPI('mock',async()=>{calls++;throw Error('UNEXPECTED');});await assert.rejects(api.get('/d1/database/'+TARGET.database+'/import'),/ENDPOINT/);await assert.rejects(api.get('/d1/database/'+PRODUCTION),/ENDPOINT/);assert.equal(calls,0);}finally{cleanup(f);}});
test('expired approval after upload stops before any ingest',async()=>{const f=setup();try{const mock=protocol(f,{afterUpload:()=>{f.approval.expiresAt=new Date(0).toISOString();}});await assert.rejects(mock.client().applyPinnedArtifact(),/APPROVAL_EXPIRED/);assert.equal(mock.calls.filter(x=>x==='init').length,1);assert.equal(mock.calls.filter(x=>x==='ingest').length,0);}finally{cleanup(f);}});

test('a rehashed plan naming production still cannot initialize an import',async()=>{const f=setup();try{const mock=protocol(f);f.plan.target={...TARGET,database:PRODUCTION};const {digest,...body}=f.plan;f.plan.digest=sha(JSON.stringify(body));f.approval.planDigest=f.plan.digest;await assert.rejects(mock.client().applyPinnedArtifact(),/TARGET/);assert.deepEqual(mock.calls,[]);}finally{cleanup(f);}});
test('Cloudflare API redirects stop without following another endpoint',async()=>{const f=setup();try{let calls=0;const api=stagingAPI('mock',async(url,options)=>{calls++;assert.equal(options.redirect,'error');return {ok:true,status:200,redirected:true,json:async()=>({success:true,result:complete()})};});await assert.rejects(api.identityBackfillClient(f.approval,f.plan).applyPinnedArtifact(),/AMBIGUOUS/);assert.equal(calls,1);}finally{cleanup(f);}});

test('CLI creates a unique import payload without credentials or file generation',()=>{const config=ROOT+'/scripts/phase2b/wrangler.staging.json';const args=[ROOT+'/scripts/phase2b/run.mjs','identity-payload','--config',config,'--expires',new Date(Date.now()+60000).toISOString()];const environment={PATH:process.env.PATH,HOME:'/private/tmp/no-import-credentials'};const first=JSON.parse(execFileSync(process.execPath,args,{cwd:ROOT,env:environment,encoding:'utf8'}));const second=JSON.parse(execFileSync(process.execPath,args,{cwd:ROOT,env:environment,encoding:'utf8'}));assert.notEqual(first.nonce,second.nonce);validateImportPayload(first);validateImportPayload(second);assert.ok(!fs.existsSync('/private/tmp/cfl-phase2b-identity-import-'+first.nonce));assert.ok(!fs.existsSync('/private/tmp/cfl-phase2b-identity-import-'+second.nonce));});

test('Wrangler-compatible initialization accepts filename and upload_url without a nested success flag',async()=>{const f=setup();try{const mock=protocol(f,{minimalInit:true});assert.equal((await mock.client().applyPinnedArtifact()).status,'complete');assert.deepEqual(mock.calls,['init','upload','ingest','poll','poll']);}finally{cleanup(f);}});
