import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {TARGET,ROOT,check,same,sha,MIGRATION_HASH,validateBindings,validateLedger,loadConfig} from './guards.mjs';
import {expectedSchema,compareSchema} from './schema.mjs';
import {identitySnapshot,backupEvidence} from './identity.mjs';

export async function preflight(api,configPath,env={},options={}){
  const identityMode=options.purpose==='identity-backfill';
  check(!Object.keys(options).some(k=>!['purpose','identityState','backupManifestPath'].includes(k)),'PREFLIGHT_OPTIONS_REJECTED');
  check(!options.purpose||identityMode,'PREFLIGHT_PURPOSE_REJECTED');
  const auditBefore={...api.audit};
  const {hash:configHash}=loadConfig(configPath,env);
  const expected=expectedSchema(identityMode?11:10);
  const fixtureBytes=readFileSync(join(ROOT,'scripts/phase2b/registrations.json'));
  const manifest=JSON.parse(readFileSync(join(ROOT,'scripts/phase2b/baseline.json'),'utf8'));
  check(sha(fixtureBytes)===manifest.registrationsHash,'REGISTRATION_HASH_REJECTED');
  const registrations=JSON.parse(fixtureBytes);
  const account=await api.get('');check(account.id===TARGET.account,'ACCOUNT_REJECTED');
  const database=await api.get('/d1/database/'+TARGET.database);
  check(database.uuid===TARGET.database&&database.name==='cflesportsid-staging','DATABASE_IDENTITY_REJECTED');
  check(database.version==='production','TIME_TRAVEL_BACKEND_REQUIRED');
  const worker='/workers/scripts/'+TARGET.worker;
  validateBindings((await api.get(worker+'/settings')).bindings);
  const deployments=await api.get(worker+'/deployments');
  const active=deployments.deployments?.[0];
  check(active?.versions?.length===1&&active.versions[0].percentage===100,'AMBIGUOUS_DEPLOYMENT');
  const versionId=active.versions[0].version_id;
  const version=await api.get(worker+'/versions/'+versionId);
  check(version.id===versionId,'VERSION_REJECTED');validateBindings(version.resources?.bindings);
  const ledger=await api.query('SELECT id,name FROM d1_migrations ORDER BY id');
  if(identityMode)same(ledger.map(r=>r.name),expected.files,'APPLIED_MIGRATIONS_REJECTED');else validateLedger(ledger,expected.files);
  const schema=await api.query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT IN('_cf_KV','_cf_METADATA','d1_migrations') ORDER BY type,name");
  compareSchema(schema,expected.objects);
  let columnCount=0;
  for(const table of schema.filter(o=>o.type==='table')){
    check(/^[a-z_]+$/.test(table.name),'TABLE_NAME_REJECTED');
    const fk=await api.query('PRAGMA foreign_key_list('+table.name+')');
    check(!fk.some(f=>f.table==='tournament_rosters'),'INBOUND_ROSTER_DEPENDENCY');
    columnCount+=(await api.query('PRAGMA table_info('+table.name+')')).length;
  }
  const indexes=await api.query('PRAGMA index_list(tournament_rosters)');
  check(indexes.length===2&&indexes.every(i=>i.unique===1&&['pk','u'].includes(i.origin)),'ROSTER_INDEX_REJECTED');
  check((await api.query('PRAGMA foreign_key_check')).length===0,'FOREIGN_KEY_VIOLATION');
  const roster=await api.query('SELECT r.tournament_id,r.team_id,r.player_id,p.uid,r.ign_snapshot,r.position FROM tournament_rosters r JOIN players p ON p.id=r.player_id ORDER BY r.tournament_id,r.player_id');
  const key=r=>JSON.stringify([r.tournament_id,r.team_id,r.uid,r.ign_snapshot??r.ign]);
  check(roster.length===168&&registrations.length===168,'ROSTER_COUNT_REJECTED');
  same(roster.map(key).sort(),registrations.map(key).sort(),'ROSTER_MEMBERSHIP_REJECTED');
  check(roster.every(r=>Number.isInteger(r.position)&&r.position>=1&&r.position<=7),'ROSTER_POSITION_REJECTED');
  check(new Set(roster.map(r=>JSON.stringify([r.tournament_id,r.team_id,r.position]))).size===168,'DUPLICATE_ROSTER_POSITION');
  const identity=await api.query("SELECT id,uid,current_ign,current_team_id FROM players WHERE uid='1345266890'");
  check(identity.length===1,'IDENTITY_PLAYER_REJECTED');
  const boundaries=await api.query("SELECT id,start_date,end_date,is_test FROM tournaments WHERE id IN('clash-for-glory-s1','clash-for-glory-s2') ORDER BY id");
  same(boundaries,manifest.boundaries,'IDENTITY_BOUNDARY_REJECTED');
  let identityEvidence,backup;
  if(identityMode){identityEvidence=await identitySnapshot(api,identity[0].id,options.identityState??'empty');backup=backupEvidence(options.backupManifestPath);check(backup.rosterHash===sha(JSON.stringify(roster)),'BACKUP_ROSTER_REJECTED');}
  const report={format:'cfl-phase2b-preflight-v1',status:'PASS',checkedAt:new Date().toISOString(),target:TARGET,configHash,migrationHash:MIGRATION_HASH,workerVersion:versionId,ledger:ledger.map(r=>r.name),pending:identityMode?[]:[expected.files.at(-1)],schema:{objects:schema.length,columns:columnCount,hash:sha(JSON.stringify(schema))},foreignKeyViolations:0,rosters:{count:168,s1:roster.filter(r=>r.tournament_id.endsWith('s1')).length,s2:roster.filter(r=>r.tournament_id.endsWith('s2')).length,membershipMismatches:0,nullPositions:0,savedRowsHash:sha(JSON.stringify(roster))},identityPlayerId:identity[0].id,retention:{days:30,evidence:'Workers Paid confirmed by account owner in Phase 2A'},backend:database.version,api:Object.fromEntries(Object.entries(api.audit).map(([k,v])=>[k,v-(auditBefore[k]??0)]))};
  if(identityMode)Object.assign(report,{purpose:'identity-backfill',identity:identityEvidence,backup});
  check(report.api.rowsWritten===0&&report.api.exports===0&&(report.api.imports??0)===0&&(report.api.uploads??0)===0,'PREFLIGHT_MUTATION_REJECTED');
  return report;
}
