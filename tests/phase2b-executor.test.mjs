import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {ROOT,CONFIG,TARGET,PRODUCTION,MIGRATION,MIGRATION_HASH,sha,readApproval,validateConfig,validateBindings,validateLedger,operationPlan,authorize} from '../scripts/phase2b/guards.mjs';
import {expectedSchema,compareSchema,verifyMigrationHash} from '../scripts/phase2b/schema.mjs';
import {identityImportPayload} from '../scripts/phase2b/identity-import.mjs';
import {preflight} from '../scripts/phase2b/preflight.mjs';
import {stagingAPI} from '../scripts/phase2b/api.mjs';
import {prepareOperation,guardedPlan,collectBackup,verifyExport,validateDownload,executeBackup} from '../scripts/phase2b/operations.mjs';

const read=p=>JSON.parse(fs.readFileSync(join(ROOT,p),'utf8'));
const config=read('scripts/phase2b/wrangler.staging.json');
const refs=read('scripts/phase2b/registrations.json');
const baseline=read('scripts/phase2b/baseline.json');
const artifact=read('scripts/phase2b/identity-backfill.json');
const expected=expectedSchema();
function mock(changes={}){
  const positions=new Map();
  const rows=refs.map(r=>{const k=r.tournament_id+r.team_id;positions.set(k,(positions.get(k)??0)+1);return {...r,player_id:r.uid,ign_snapshot:r.ign,position:positions.get(k)};});
  const state={roster:rows,schema:structuredClone(expected.objects),ledger:expected.files.filter(n=>n!==MIGRATION).map((name,i)=>({id:i+1,name})),bindings:[{name:'DB',type:'d1',id:TARGET.database}],fk:[],...changes};
  const api={audit:{get:0,queries:0,exports:0,rowsWritten:0},async get(path){
    api.audit.get++;
    if(path==='')return {id:TARGET.account};
    if(path==='/d1/database/'+TARGET.database)return {uuid:TARGET.database,name:'cflesportsid-staging',version:'production'};
    if(path.endsWith('/settings'))return {bindings:state.bindings};
    if(path.endsWith('/deployments'))return {deployments:[{versions:[{version_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',percentage:100}]}]};
    if(path.includes('/versions/'))return {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',resources:{bindings:state.bindings}};
    throw Error('UNEXPECTED_MOCK_ENDPOINT');
  },async query(sql){
    api.audit.queries++;
    if(sql.includes('FROM d1_migrations'))return state.ledger;
    if(sql.includes('FROM sqlite_schema'))return state.schema;
    if(sql.startsWith('PRAGMA foreign_key_list'))return state.incoming??[];
    if(sql.startsWith('PRAGMA table_info'))return [{name:'synthetic'}];
    if(sql.startsWith('PRAGMA index_list'))return state.indexes??[{unique:1,origin:'pk'},{unique:1,origin:'u'}];
    if(sql==='PRAGMA foreign_key_check')return state.fk;
    if(sql.includes('FROM tournament_rosters'))return state.roster;
    if(sql.includes('FROM players'))return [{id:'internal-player-key',uid:'1345266890'}];
    if(sql.includes('FROM tournaments'))return baseline.boundaries;
    throw Error('UNEXPECTED_MOCK_QUERY');
  }};
  return {api,state};
}
const backupPayload={maintenanceWindowConfirmed:true,outputDirectory:'/private/tmp/cfl-phase2b-backup-test'};
function approval(plan,now=Date.now()){return {format:'cfl-phase2b-approval-v1',approved:true,approvedBy:'test-only operator',id:'test-only-approval-12345',target:TARGET,operation:plan.operation,planDigest:plan.digest,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};}

test('incorrect migration bytes fail before remote preflight',()=>assert.throws(()=>verifyMigrationHash(MIGRATION,Buffer.from('wrong migration'),{[MIGRATION]:MIGRATION_HASH}),/HASH/));
test('exact staging configuration and migration artifact pass',()=>{
  validateConfig(config,CONFIG,{});
  assert.equal(sha(fs.readFileSync(join(ROOT,'migrations',MIGRATION))),MIGRATION_HASH);
  assert.equal(expected.objects.length,41);
});
for(const [label,change]of [
  ['production database',c=>c.d1_databases[0].database_id=PRODUCTION],
  ['production Worker',c=>c.name='cflesportsid'],
  ['incorrect account',c=>c.account_id='incorrect'],
  ['extra binding',c=>c.d1_databases.push({...c.d1_databases[0]})],
  ['environment section',c=>c.env={staging:{}}],
  ['preview override',c=>c.d1_databases[0].preview_database_id=PRODUCTION],
]){
  test('rejects '+label,()=>{const c=structuredClone(config);change(c);assert.throws(()=>validateConfig(c,CONFIG,{}));});
}
test('rejects default Wrangler configuration and relative paths',()=>{for(const path of [join(ROOT,'wrangler.jsonc'),'scripts/phase2b/wrangler.staging.json'])assert.throws(()=>validateConfig(config,path,{}),/EXPLICIT/);});
for(const key of ['CLOUDFLARE_ACCOUNT_ID','CF_ACCOUNT_ID','WRANGLER_ENV','CFL_PUBLIC_MODE','VITE_TARGET','NODE_OPTIONS','HTTPS_PROXY','CLOUDFLARE_API_BASE_URL'])test('rejects override '+key,()=>assert.throws(()=>validateConfig(config,CONFIG,{[key]:'unexpected'}),/OVERRIDE/));
test('rejects missing, wrong and multiple staging bindings',()=>{for(const b of [undefined,[],[{name:'DB',type:'d1',id:PRODUCTION}],[{name:'OTHER',type:'d1',id:TARGET.database}],Array(2).fill({name:'DB',type:'d1',id:TARGET.database})])assert.throws(()=>validateBindings(b));});
test('rejects unexpected pending and incomplete applied migrations',()=>{
  const applied=expected.files.slice(0,-1).map(name=>({name}));
  assert.throws(()=>validateLedger(applied,[...expected.files,'0012_unapproved.sql']));
  assert.throws(()=>validateLedger(applied.slice(1),expected.files));
  assert.throws(()=>validateLedger([...applied,{name:MIGRATION}],expected.files));
});
test('rejects changed schema objects and constraints',()=>{
  assert.throws(()=>compareSchema(expected.objects.slice(1),expected.objects));
  const changed=structuredClone(expected.objects);changed.find(o=>o.name==='tournament_rosters').sql=changed.find(o=>o.name==='tournament_rosters').sql.replace('NOT NULL','');
  assert.throws(()=>compareSchema(changed,expected.objects));
});
test('read-only mocked preflight produces a redacted report',async()=>{
  const {api}=mock();const report=await preflight(api,CONFIG,{});
  assert.equal(report.rosters.count,168);assert.equal(report.api.exports,0);assert.equal(report.api.rowsWritten,0);
  assert.equal(report.pending[0],MIGRATION);assert.ok(!JSON.stringify(report).includes('KangDedy'));
});
for(const [label,change]of [
  ['missing roster',s=>s.roster.pop()],
  ['wrong historical IGN',s=>s.roster[0].ign_snapshot='incorrect'],
  ['NULL position',s=>s.roster[0].position=null],
  ['foreign key violation',s=>s.fk=[{table:'test'}]],
  ['inbound roster foreign key',s=>s.incoming=[{table:'tournament_rosters'}]],
  ['extra roster index',s=>s.indexes=[{unique:0,origin:'c'}]],
  ['wrong deployed binding',s=>s.bindings[0].id=PRODUCTION]
])test('preflight rejects '+label,async()=>{const {api,state}=mock();change(state);await assert.rejects(preflight(api,CONFIG,{}));});
test('each operation needs its own approval; stale and wrong hashes fail',async()=>{
  const report=await preflight(mock().api,CONFIG,{});
  const plan=prepareOperation('backup',report,backupPayload);
  assert.throws(()=>authorize(undefined,plan),/AUTHORIZATION/);
  authorize(approval(plan),plan);
  assert.throws(()=>authorize({...approval(plan),operation:'migration'},plan),/SCOPE/);
  assert.throws(()=>authorize({...approval(plan),target:{...TARGET,database:PRODUCTION}},plan),/TARGET/);
  assert.throws(()=>authorize({...approval(plan),expiresAt:new Date(0).toISOString()},plan),/EXPIRED/);
  assert.throws(()=>operationPlan('backup',{...report,migrationHash:'bad'}),/PREFLIGHT/);
  assert.throws(()=>operationPlan('backup',{...report,checkedAt:new Date(0).toISOString()}),/STALE/);
  for(const operation of ['migration','identity-backfill','deployment','reader-enablement','restoration','recovery-rehearsal']){
    const other=operationPlan(operation,report);assert.throws(()=>authorize(approval(plan),other),/SCOPE/);
  }
});
test('destructive operation plans reject absent prerequisites',async()=>{
  const report=await preflight(mock().api,CONFIG,{});
  for(const op of ['migration','identity-backfill','deployment','reader-enablement','restoration','recovery-rehearsal'])assert.throws(()=>prepareOperation(op,report,{}));
  assert.throws(()=>guardedPlan('backup',report,backupPayload,undefined),/AUTHORIZATION/);
  assert.throws(()=>prepareOperation('recovery-rehearsal',report,{root:'/private/tmp/cfl-phase2b-rehearsal-test',exportHash:'a'.repeat(64),databaseId:TARGET.database}),/DATABASE/);
});
test('operation payload cannot smuggle target overrides',async()=>{
  const report=await preflight(mock().api,CONFIG,{});
  assert.throws(()=>prepareOperation('backup',report,{...backupPayload,databaseId:PRODUCTION}),/PAYLOAD/);
});
test('approval file rejects symlinks and group/world access',()=>{
  const root=fs.mkdtempSync('/private/tmp/cfl-phase2b-test-');
  try{const p=join(root,'approval.json'),link=join(root,'link.json');fs.writeFileSync(p,'{}',{mode:0o644});assert.throws(()=>readApproval(p),/PRIVATE/);fs.chmodSync(p,0o600);fs.symlinkSync(p,link);assert.throws(()=>readApproval(link),/PRIVATE/);assert.deepEqual(readApproval(p),{});}finally{fs.rmSync(root,{recursive:true});}
});
test('API denies arbitrary endpoints and write SQL without network calls',async()=>{
  const calls=[];const api=stagingAPI('mock-token',async(...args)=>{calls.push(args);throw Error('NETWORK_UNEXPECTED');});
  for(const path of ['/d1/database/'+PRODUCTION,'/workers/scripts/cflesportsid/settings','/d1/database/'+TARGET.database+'/time_travel/restore'])await assert.rejects(api.get(path),/ENDPOINT/);
  for(const sql of ['DELETE FROM players','SELECT 1; DELETE FROM players','PRAGMA foreign_keys=OFF'])await assert.rejects(api.query(sql),/READ_ONLY/);
  assert.throws(()=>api.backupClient(undefined,{}),/AUTHORIZATION/);
  assert.equal(calls.length,0);
});
test('API redacts authentication failures and rejects redirects',async()=>{
  let request;const api=stagingAPI('secret-token',async(url,options)=>{request={url,options};return {ok:false,status:401,json:async()=>({success:false,errors:[{code:10000,message:'secret-token must never appear'}]})};});
  await assert.rejects(api.get(''),e=>e.message==='CLOUDFLARE_HTTP_401_CODES_10000');
  assert.equal(request.options.redirect,'error');
});
test('backup export polls mocks only and checksum detects tampering',async()=>{
  const content=mockDump();
  let calls=0;const client={bookmark:async()=>({bookmark:'before'}),export:async()=>++calls===1?{status:'active',at_bookmark:'export'}:{status:'complete',at_bookmark:'export',result:{signed_url:'https://mock.r2.cloudflarestorage.com/dump'}}};
  const result=await collectBackup(client,async(url,options)=>{assert.equal(options.headers,undefined);return {ok:true,arrayBuffer:async()=>content};},async()=>{});
  const manifest={kind:'cfl-phase2b-backup-v1',target:TARGET,bytes:content.length,exportSHA256:sha(content)};
  assert.equal(verifyExport(result.bytes,manifest),true);
  assert.throws(()=>verifyExport(Buffer.from('tampered'),manifest),/CHECKSUM/);
  for(const url of ['http://mock.r2.cloudflarestorage.com/x','https://localhost/x','https://evil.test/x'])assert.throws(()=>validateDownload(url));
});
test('failed backup has no restoration or migration callback',async()=>{
  let restores=0;await assert.rejects(collectBackup({bookmark:async()=>({bookmark:'before'}),export:async()=>({status:'error'}),restore:()=>restores++},async()=>{throw Error('NO_DOWNLOAD');},async()=>{}),/STATUS/);
  assert.equal(restores,0);
});

function identityFixture(){
  const db=new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE players(id TEXT PRIMARY KEY,uid TEXT UNIQUE); CREATE TABLE teams(id TEXT PRIMARY KEY); CREATE TABLE tournaments(id TEXT PRIMARY KEY,is_test INTEGER,start_date TEXT); CREATE TABLE tournament_rosters(player_id TEXT,tournament_id TEXT,team_id TEXT,ign_snapshot TEXT,position INTEGER); CREATE TABLE player_identity_segments(id TEXT PRIMARY KEY NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),uid_snapshot TEXT NOT NULL,boundary_tournament_id TEXT NOT NULL REFERENCES tournaments(id),ign_snapshot TEXT NOT NULL,team_id TEXT NOT NULL REFERENCES teams(id),UNIQUE(id,player_id)); CREATE TABLE player_identity_tournaments(player_id TEXT NOT NULL,tournament_id TEXT NOT NULL REFERENCES tournaments(id),segment_id TEXT NOT NULL,PRIMARY KEY(player_id,tournament_id),FOREIGN KEY(segment_id,player_id) REFERENCES player_identity_segments(id,player_id));");
  db.prepare('INSERT INTO players VALUES(?,?)').run('different-internal-pk',artifact.identity.uid);
  db.prepare('INSERT INTO teams VALUES(?)').run(artifact.identity.team);
  for(const t of baseline.boundaries)db.prepare('INSERT INTO tournaments VALUES(?,?,?)').run(t.id,t.is_test,t.start_date);
  db.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('different-internal-pk',artifact.identity.historical,artifact.identity.team,artifact.identity.ign,7);
  return db;
}
function applyIdentity(db){
  db.exec('BEGIN');
  try{for(const s of artifact.statements){const bind=Object.fromEntries(s.params.map((v,i)=>[String(i+1),v]));db.prepare(s.sql).run(bind);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
test('backfill resolves internal ID, inserts only two rows, and repeats as no-op',()=>{
  const db=identityFixture();try{
    const before=db.prepare('SELECT * FROM tournament_rosters').all();applyIdentity(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM player_identity_segments').get().n,1);
    assert.equal(db.prepare('SELECT player_id FROM player_identity_segments').get().player_id,'different-internal-pk');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM player_identity_tournaments').get().n,1);
    const total=db.prepare('SELECT total_changes() AS n').get().n;applyIdentity(db);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,total);
    assert.deepEqual(db.prepare('SELECT * FROM tournament_rosters').all(),before);
  }finally{db.close();}
});
test('backfill rejects partial/conflicting states atomically',()=>{
  for(const kind of ['partial','conflicting','wrong-boundary','missing-player','wrong-roster']){
    const db=identityFixture();try{
      if(kind==='partial'||kind==='conflicting'){applyIdentity(db);if(kind==='partial')db.exec('DELETE FROM player_identity_tournaments');else db.exec("UPDATE player_identity_segments SET ign_snapshot='wrong'");}
      if(kind==='wrong-boundary')db.exec("UPDATE tournaments SET start_date='1900-01-01' WHERE id='clash-for-glory-s2'");
      if(kind==='missing-player')db.exec('DELETE FROM players');
      if(kind==='wrong-roster')db.exec("UPDATE tournament_rosters SET ign_snapshot='wrong'");
      const before=db.prepare('SELECT * FROM player_identity_segments').all();assert.throws(()=>applyIdentity(db));assert.deepEqual(db.prepare('SELECT * FROM player_identity_segments').all(),before);
    }finally{db.close();}
  }
});

function mockDump(){return Buffer.from(expected.objects.map(o=>o.sql).join('\n')+'\nCREATE TABLE d1_migrations(id INTEGER,name TEXT);\n'+['tournament_rosters','players','matches','d1_migrations'].map(t=>'INSERT INTO "'+t+'" VALUES(1);').join('\n'));}
test('changed approval payload fails even if the old digest remains',async()=>{
  const report=await preflight(mock().api,CONFIG,{}),plan=prepareOperation('backup',report,backupPayload);
  const signed=approval(plan);plan.payload={...plan.payload,outputDirectory:'/private/tmp/cfl-phase2b-backup-elsewhere'};
  assert.throws(()=>authorize(signed,plan),/TAMPERED/);
});
test('backfill artifact is pinned independently of supplied payload',async()=>{
  const report=await preflight(mock().api,CONFIG,{});
  assert.throws(()=>prepareOperation('identity-backfill',report,{...identityImportPayload(new Date(Date.now()+60000).toISOString()),artifactHash:'0'.repeat(64)}),/HASH/);
  assert.throws(()=>prepareOperation('identity-backfill',report,identityImportPayload(new Date(Date.now()+60000).toISOString())),/BACKFILL_PREFLIGHT_REQUIRED/);
});
test('complete-export validation rejects omitted schema and data',async()=>{
  const client={bookmark:async()=>({bookmark:'before'}),export:async()=>({status:'complete',result:{signed_url:'https://mock.r2.cloudflarestorage.com/dump'}})};
  for(const bytes of [Buffer.from('CREATE TABLE tournament_rosters(id TEXT);'),Buffer.from(expected.objects.map(o=>o.sql).join('\n')+'\nCREATE TABLE d1_migrations(id INTEGER);')]){
    await assert.rejects(collectBackup(client,async()=>({ok:true,arrayBuffer:async()=>bytes})),/EXPORT_(SCHEMA|DATA)_MISSING/);
  }
});
test('backup dispatcher uses private one-shot approval and never chains operations (mock data)',async()=>{
  const root=fs.mkdtempSync('/private/tmp/cfl-phase2b-test-');
  const output='/private/tmp/cfl-phase2b-backup-'+randomUUID();
  try{
    const {api}=mock();let exports=0;
    api.backupClient=(approved,plan)=>{authorize(approved,plan);return {bookmark:async()=>({bookmark:'mock-before'}),export:async()=>{exports++;api.audit.exports++;return {status:'complete',result:{signed_url:'https://mock.r2.cloudflarestorage.com/mock'}};}};};
    const report=await preflight(api,CONFIG,{});
    const payload={...backupPayload,outputDirectory:output},plan=prepareOperation('backup',report,payload),approved=approval(plan);
    const path=join(root,'approval.json');fs.writeFileSync(path,JSON.stringify(approved),{mode:0o600});
    const result=await executeBackup({api,configPath:CONFIG,env:{},report,payload,approval:approved,approvalPath:path,fetcher:async()=>({ok:true,arrayBuffer:async()=>mockDump()})});
    assert.equal(exports,1);assert.equal(result.nextOperation,'NONE');assert.ok(fs.existsSync(path+'.used'));
    assert.equal(fs.statSync(join(output,'staging.sql')).mode&0o077,0);
    const manifest=JSON.parse(fs.readFileSync(join(output,'manifest.json'),'utf8'));
    verifyExport(fs.readFileSync(join(output,'staging.sql')),manifest);
    await assert.rejects(executeBackup({api,configPath:CONFIG,env:{},report,payload,approval:approved,approvalPath:path}),/EEXIST|BACKUP_ALREADY_EXISTS/);
    assert.equal(exports,1);
  }finally{
    fs.rmSync(root,{recursive:true});
    if(fs.existsSync(output)){const marker=JSON.parse(fs.readFileSync(join(output,'ownership.json'),'utf8'));assert.equal(marker.root,output);assert.equal(marker.kind,'cfl-phase2b-backup-root-v1');fs.rmSync(output,{recursive:true});}
  }
});
test('backup refuses state drift before export or output creation',async()=>{
  const root=fs.mkdtempSync('/private/tmp/cfl-phase2b-test-');
  try{
    const {api,state}=mock();const report=await preflight(api,CONFIG,{});
    const plan=prepareOperation('backup',report,backupPayload),approved=approval(plan),path=join(root,'approval.json');
    fs.writeFileSync(path,JSON.stringify(approved),{mode:0o600});state.roster[0].position=7;
    let exports=0;api.backupClient=()=>{exports++;throw Error('NOT_EXPECTED');};
    await assert.rejects(executeBackup({api,configPath:CONFIG,env:{},report,payload:backupPayload,approval:approved,approvalPath:path}));
    assert.equal(exports,0);assert.ok(!fs.existsSync(path+'.used'));
  }finally{fs.rmSync(root,{recursive:true});}
});
test('CLI requires approval before credential lookup and rejects mutation commands',()=>{
  for(const args of [['backup','--config',CONFIG],['identity-backfill','--config',CONFIG],['migration','--config',CONFIG],['restoration','--config',CONFIG]]){
    try{execFileSync(process.execPath,[join(ROOT,'scripts/phase2b/run.mjs'),...args],{env:{PATH:process.env.PATH,HOME:'/private/tmp/no-cfl-credentials'},stdio:'pipe'});assert.fail('CLI should reject');}
    catch(e){assert.match(String(e.stderr),/EXPLICIT_AUTHORIZATION_REQUIRED|COMMAND_REJECTED/);assert.doesNotMatch(String(e.stderr),/AUTH_UNAVAILABLE/);}
  }
});
