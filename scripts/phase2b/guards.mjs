import {createHash} from 'node:crypto';
import {readFileSync, realpathSync, lstatSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

export const ROOT=realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
export const TARGET=Object.freeze({account:'bf6ed4ccd73133871881b47ea58dae3d',database:'4ba57de7-5fda-4703-a956-b1936546986a',worker:'cflesportsid-uat'});
export const PRODUCTION='efded3c4-1cf9-46a9-823e-d0f2d17c683a';
export const CONFIG=join(ROOT,'scripts/phase2b/wrangler.staging.json');
export const MIGRATION='0011_public_identity_contracts.sql';
export const MIGRATION_HASH='6796ab50117db75baa7050d9346f111bd5d4f4e0c7d61ab96c915f770a701860';
export const OPERATIONS=Object.freeze(['backup','migration','identity-backfill','deployment','reader-enablement','restoration','recovery-rehearsal']);
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function check(condition,code){if(!condition)throw new Error(code);}
export function same(a,b,code){try{assert.deepEqual(a,b);}catch{throw new Error(code);}}
export function validateConfig(config,path,env={}){
  check(isAbsolute(path)&&path===CONFIG&&!lstatSync(path).isSymbolicLink()&&realpathSync(path)===CONFIG,'EXPLICIT_STAGING_CONFIG_REQUIRED');
  const expected={name:TARGET.worker,account_id:TARGET.account,compatibility_date:'2026-09-30',d1_databases:[{binding:'DB',database_name:'cflesportsid-staging',database_id:TARGET.database,migrations_dir:'../../migrations'}]};
  check(!JSON.stringify(config).includes(PRODUCTION),'PRODUCTION_REJECTED');
  same(config,expected,'STAGING_CONFIG_REJECTED');
  for(const [key,value]of Object.entries(env))if(value!==undefined&&/^(?:CLOUDFLARE_|CF_|WRANGLER_|CFL_|VITE_|ASTRO_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$|NODE_TLS_REJECT_UNAUTHORIZED$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key))
    check(key==='CLOUDFLARE_API_TOKEN','ENVIRONMENT_OVERRIDE_REJECTED');
  return sha(JSON.stringify(config));
}
export function loadConfig(path,env){check(typeof path==='string'&&path===CONFIG,'EXPLICIT_STAGING_CONFIG_REQUIRED');const config=JSON.parse(readFileSync(path,'utf8'));return {config,hash:validateConfig(config,path,env)};}
export function validateBindings(bindings){
  check(Array.isArray(bindings),'BINDINGS_MISSING');
  const databases=bindings.filter(b=>b.type==='d1');
  check(databases.length===1&&databases[0].name==='DB'&&(databases[0].id??databases[0].database_id)===TARGET.database,'STAGING_BINDING_REJECTED');
  const mode=bindings.find(b=>b.name==='CFL_PUBLIC_MODE');
  check(!mode||mode.text==='hybrid','HYBRID_REQUIRED');
}
export function validateLedger(ledger,files){
  const expected=files.filter(n=>n!==MIGRATION);
  check(expected.length===10&&expected.every((n,i)=>n.startsWith(String(i+1).padStart(4,'0')+'_')),'MIGRATION_FILES_REJECTED');
  same(ledger.map(r=>r.name),expected,'APPLIED_MIGRATIONS_REJECTED');
  same(files.filter(n=>!ledger.some(r=>r.name===n)),[MIGRATION],'PENDING_MIGRATIONS_REJECTED');
}
export function operationPlan(operation,report,payload={},now=Date.now()){
  check(OPERATIONS.includes(operation),'OPERATION_REJECTED');
  same(report.target,TARGET,'TARGET_REJECTED');
  check(report.status==='PASS'&&report.migrationHash===MIGRATION_HASH,'PREFLIGHT_REQUIRED');
  check(now-Date.parse(report.checkedAt)>=0&&now-Date.parse(report.checkedAt)<=15*60*1000,'STALE_PREFLIGHT');
  const plan={format:'cfl-phase2b-plan-v1',operation,target:TARGET,...(operation==='identity-backfill'?{preflightExpiresAt:new Date(Date.parse(report.checkedAt)+15*60*1000).toISOString()}:{}),preflightHash:sha(JSON.stringify(report)),migrationHash:MIGRATION_HASH,configHash:report.configHash,payload};
  return {...plan,digest:sha(JSON.stringify(plan))};
}
export function authorize(approval,plan,now=Date.now()){
  check(approval?.format==='cfl-phase2b-approval-v1'&&approval.approved===true,'EXPLICIT_AUTHORIZATION_REQUIRED');
  const {digest,...body}=plan;
  check(typeof digest==='string'&&sha(JSON.stringify(body))===digest,'PLAN_TAMPERED');
  same(approval.target,TARGET,'APPROVAL_TARGET_REJECTED');
  check(approval.operation===plan.operation&&approval.planDigest===plan.digest,'APPROVAL_SCOPE_REJECTED');
  check(typeof approval.approvedBy==='string'&&approval.approvedBy.trim().length>0,'APPROVER_REQUIRED');
  check(typeof approval.id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(approval.id),'APPROVAL_ID_REQUIRED');
  const issued=Date.parse(approval.issuedAt),expires=Date.parse(approval.expiresAt);
  check(Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=now&&expires>now&&expires-issued<=30*60*1000,'APPROVAL_EXPIRED');
  if(plan.operation==='identity-backfill'){
    check(approval.expiresAt===plan.payload.approvalExpiresAt,'APPROVAL_EXPIRATION_MISMATCH');
    check(Date.parse(plan.preflightExpiresAt)>now,'STALE_PREFLIGHT');
  }
  return approval;
}
export function readApproval(path){
  check(isAbsolute(path)&&!path.startsWith(ROOT+'/'),'EXTERNAL_APPROVAL_REQUIRED');
  const stat=lstatSync(path);
  check(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'PRIVATE_APPROVAL_REQUIRED');
  return JSON.parse(readFileSync(path,'utf8'));
}
