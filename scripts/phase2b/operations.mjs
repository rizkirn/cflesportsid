import {readFileSync,existsSync,realpathSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {check,same,sha,ROOT,TARGET,operationPlan,authorize,readApproval} from './guards.mjs';
import {blockedIds} from '../phase1a/safety.mjs';
import {preflight} from './preflight.mjs';
import {expectedSchema} from './schema.mjs';
import {pinnedIdentity} from './identity.mjs';
import {validateImportPayload,prepareImportFile} from './identity-import.mjs';
import {validateBackupDirectory,verifyCapacity,writePrivateFile,syncDirectory} from './storage.mjs';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function prepareOperation(operation,report,payload={}){
  const fields={backup:['maintenanceWindowConfirmed','outputDirectory'],migration:['backupManifestHash','rosterHash'],'identity-backfill':['artifactHash','transport','rendererVersion','rendererSHA256','sqlSHA256','nonce','approvalExpiresAt'],deployment:['artifactHash','mode'],'reader-enablement':['artifactHash','mode','validationReportHash'],restoration:['bookmark','reason','maintenanceWindowConfirmed'],'recovery-rehearsal':['exportHash','root','databaseId']};
  check(Object.hasOwn(fields,operation),'OPERATION_REJECTED');
  same(Object.keys(payload).sort(),[...fields[operation]].sort(),'OPERATION_PAYLOAD_REJECTED');
  if(operation==='backup'){
    check(payload.maintenanceWindowConfirmed===true,'MAINTENANCE_CONFIRMATION_REQUIRED');
    const storage=validateBackupDirectory(payload.outputDirectory);
    verifyCapacity(storage.parent);
    same(Object.keys(payload).sort(),['maintenanceWindowConfirmed','outputDirectory'],'BACKUP_PAYLOAD_REJECTED');
  }else if(operation==='identity-backfill'){
    const pinned=JSON.parse(readFileSync(join(ROOT,'scripts/phase2b/baseline.json'),'utf8')).backfillHash;
    check(payload.artifactHash===pinned&&sha(readFileSync(join(ROOT,'scripts/phase2b/identity-backfill.json')))===pinned,'BACKFILL_HASH_REJECTED');
    validateImportPayload(payload);
    check(Date.parse(payload.approvalExpiresAt)>Date.now()&&Date.parse(payload.approvalExpiresAt)<=Date.now()+30*60*1000,'IMPORT_APPROVAL_EXPIRATION_REJECTED');
    check(report.purpose==='identity-backfill'&&report.identity?.state==='empty'&&report.identity.segments===0&&report.identity.tournaments===0&&report.identity.artifactHash===pinned&&report.pending?.length===0&&report.ledger?.filter(n=>n==='0011_public_identity_contracts.sql').length===1&&report.backup?.manifestHash,'BACKFILL_PREFLIGHT_REQUIRED');
  }else if(operation==='migration'){
    check(hash(payload.backupManifestHash)&&payload.rosterHash===report.rosters.savedRowsHash,'BACKUP_EVIDENCE_REQUIRED');
  }else if(operation==='deployment'){
    check(hash(payload.artifactHash)&&payload.mode==='hybrid','HYBRID_DEPLOYMENT_REQUIRED');
  }else if(operation==='reader-enablement'){
    check(hash(payload.artifactHash)&&hash(payload.validationReportHash)&&['shadow','d1'].includes(payload.mode),'READER_VALIDATION_REQUIRED');
  }else if(operation==='restoration'){
    check(typeof payload.bookmark==='string'&&/^[a-zA-Z0-9-]+$/.test(payload.bookmark)&&payload.reason?.trim()&&payload.maintenanceWindowConfirmed===true,'RESTORATION_SCOPE_REQUIRED');
  }else if(operation==='recovery-rehearsal'){
    check(hash(payload.exportHash)&&/^\/private\/tmp\/cfl-phase2b-rehearsal-[a-zA-Z0-9-]+$/.test(payload.root??''),'REHEARSAL_SCOPE_REQUIRED');
    check(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(payload.databaseId??'')&&!blockedIds(ROOT).includes(payload.databaseId),'REHEARSAL_DATABASE_REJECTED');
    check(!existsSync(payload.root),'REHEARSAL_MUST_BE_FRESH');
  }
  return operationPlan(operation,report,payload);
}
export function guardedPlan(operation,report,payload,approval){const plan=prepareOperation(operation,report,payload);authorize(approval,plan);return plan;}
export function stableState(report){
  return {target:report.target,configHash:report.configHash,migrationHash:report.migrationHash,workerVersion:report.workerVersion,ledger:report.ledger,pending:report.pending,schema:report.schema,rosters:report.rosters,identityPlayerId:report.identityPlayerId};
}
export function verifyExport(bytes,manifest){
  check(manifest?.kind==='cfl-phase2b-backup-v1','BACKUP_MANIFEST_REJECTED');
  same(manifest.target,TARGET,'BACKUP_TARGET_REJECTED');
  check(bytes.length===manifest.bytes&&sha(bytes)===manifest.exportSHA256,'EXPORT_CHECKSUM_REJECTED');
  return true;
}
export function validateDownload(url){
  const parsed=new URL(url);
  check(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port&&(parsed.hostname.endsWith('.r2.cloudflarestorage.com')||parsed.hostname==='cloudflare-d1.s3.amazonaws.com'),'EXPORT_DOWNLOAD_HOST_REJECTED');
  return parsed.href;
}
export async function collectBackup(client,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  const bookmark=await client.bookmark();check(typeof bookmark.bookmark==='string'&&bookmark.bookmark.length>0,'BOOKMARK_MISSING');
  let response=await client.export();
  for(let attempts=0;response.status!=='complete'&&attempts<120;attempts++){
    check(response.status==='active'&&typeof response.at_bookmark==='string','EXPORT_STATUS_REJECTED');
    await sleep(1000);response=await client.export(response.at_bookmark);
  }
  check(response.status==='complete'&&typeof response.result?.signed_url==='string','EXPORT_INCOMPLETE');
  const result=await fetcher(validateDownload(response.result.signed_url),{redirect:'error',signal:AbortSignal.timeout(60000)});
  check(result.ok,'EXPORT_DOWNLOAD_FAILED');
  const bytes=Buffer.from(await result.arrayBuffer());
  check(bytes.length>0,'EXPORT_EMPTY');
  const sql=bytes.toString('utf8');
  const definitions=[...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?(TABLE|VIEW|INDEX|TRIGGER)\s+(?:IF NOT EXISTS\s+)?["`]?([a-z_][a-z0-9_]*)["`]?/gi)].map(m=>m[1].toLowerCase()+':'+m[2]);
  for(const object of [...expectedSchema().objects,{type:'table',name:'d1_migrations'}])check(definitions.includes(object.type+':'+object.name),'EXPORT_SCHEMA_MISSING');
  for(const table of ['tournament_rosters','players','matches','d1_migrations'])check(new RegExp('INSERT INTO\\s+["\\x60]?'+table+'\\b','i').test(sql),'EXPORT_DATA_MISSING');
  return {bookmark:bookmark.bookmark,exportBookmark:response.at_bookmark??null,bytes};
}
export async function executeBackup({api,configPath,env,report,payload,approval,approvalPath,fetcher=fetch}){
  same(readApproval(approvalPath),approval,'APPROVAL_FILE_CHANGED');
  const plan=guardedPlan('backup',report,payload,approval);
  const storage=validateBackupDirectory(payload.outputDirectory);verifyCapacity(storage.parent);
  const current=await preflight(api,configPath,env);same(stableState(current),stableState(report),'PREFLIGHT_STATE_CHANGED');
  authorize(approval,plan);
  same(readApproval(approvalPath),approval,'APPROVAL_FILE_CHANGED');
  check(typeof approvalPath==='string'&&realpathSync(approvalPath)===approvalPath,'APPROVAL_PATH_REJECTED');
  // Exclusive claim survives failures; retry needs another explicit approval.
  const claim=openSync(approvalPath+'.used','wx',0o600);closeSync(claim);
  const root=payload.outputDirectory;
  same(validateBackupDirectory(root),storage,'BACKUP_PARENT_CHANGED');verifyCapacity(storage.parent);
  mkdirSync(root,{mode:0o700});
  writePrivateFile(join(root,'ownership.json'),JSON.stringify({kind:'cfl-phase2b-backup-root-v1',root,owner:process.getuid(),approvalId:approval.id,target:TARGET}));
  syncDirectory(storage.parent);
  const client=api.backupClient(approval,plan);
  const result=await collectBackup(client,fetcher);
  verifyCapacity(root,result.bytes.length);
  const file=join(root,'staging.sql');writePrivateFile(file,result.bytes);
  const manifest={kind:'cfl-phase2b-backup-v1',target:TARGET,createdAt:new Date().toISOString(),approvalId:approval.id,planDigest:plan.digest,preflight:stableState(current),bookmark:result.bookmark,exportBookmark:result.exportBookmark,bytes:result.bytes.length,exportSHA256:sha(result.bytes),recoveryRehearsal:'NOT_RUN'};
  verifyExport(readFileSync(file),manifest);
  const after=await preflight(api,configPath,env);
  same(stableState(after),stableState(current),'DATABASE_CHANGED_DURING_BACKUP');
  writePrivateFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2));syncDirectory(root);
  return {status:'BACKUP_COMPLETE',directory:root,exportSHA256:manifest.exportSHA256,recoveryRehearsal:'NOT_RUN',nextOperation:'NONE'};
}

export async function executeIdentityBackfill({api,configPath,env,report,payload,approval,approvalPath}){
  same(readApproval(approvalPath),approval,'APPROVAL_FILE_CHANGED');
  const plan=guardedPlan('identity-backfill',report,payload,approval);
  const options={purpose:'identity-backfill',identityState:'empty',backupManifestPath:report.backup.manifestPath};
  const current=await preflight(api,configPath,env,options);
  same(stableState(current),stableState(report),'PREFLIGHT_STATE_CHANGED');same(current.identity,report.identity,'IDENTITY_STATE_CHANGED');same(current.backup,report.backup,'BACKUP_CHANGED');
  authorize(approval,prepareOperation('identity-backfill',report,payload));same(readApproval(approvalPath),approval,'APPROVAL_FILE_CHANGED');
  check(realpathSync(approvalPath)===approvalPath,'APPROVAL_PATH_REJECTED');pinnedIdentity();
  const claim=openSync(approvalPath+'.used','wx',0o600);closeSync(claim);
  const sqlFile=prepareImportFile(plan);
  const result=await api.identityBackfillClient(approval,plan,()=>{same(readApproval(approvalPath),approval,'APPROVAL_FILE_CHANGED');authorize(approval,prepareOperation('identity-backfill',report,payload));}).applyPinnedArtifact();
  check(result.status==='complete'&&result.numQueries===2&&result.sqlSHA256===payload.sqlSHA256,'BACKFILL_RESULT_REJECTED');
  const after=await preflight(api,configPath,env,{...options,identityState:'exact'});
  same(stableState(after),stableState(current),'DATABASE_CHANGED_DURING_BACKFILL');same(after.backup,current.backup,'BACKUP_CHANGED');
  for(const key of ['masterHash','entriesHash','roundsHash','combatHash','matchesHash','mapsHash','walkoversHash'])check(after.identity[key]===current.identity[key],'BACKFILL_PRESERVATION_REJECTED:'+key);
  return {status:'BACKFILL_COMPLETE',target:TARGET,planDigest:plan.digest,artifactHash:payload.artifactHash,transport:payload.transport,rendererVersion:payload.rendererVersion,rendererSHA256:payload.rendererSHA256,sqlSHA256:payload.sqlSHA256,sqlFile:sqlFile.file,importBookmark:result.finalBookmark,identity:{segments:1,tournaments:1},preservationVerified:true,foreignKeyViolations:0,nextOperation:'NONE'};
}
