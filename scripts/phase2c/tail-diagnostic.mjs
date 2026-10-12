import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,lstatSync,realpathSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {UAT} from '../../src/data-access/public-mode.mjs';
import {createShadowCollector,createPublicMarker} from './shadow-diagnostics.mjs';
import {createTailSession,TAIL_TRANSPORT} from './tail-session.mjs';
import {validateRemoteUAT,validateUATConfig,rejectEnvironmentOverrides} from './uat-validator.mjs';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=value=>createHash('sha256').update(value).digest('hex');
const root=fileURLToPath(new URL('../../',import.meta.url));
const pinned={versionId:'7c776a53-7832-4753-aad5-ef2e191a8687',deploymentId:'5c5b44df-0d6c-4862-bf84-0f57c86f4cce',authenticationFingerprint:'b5e07393fae55436f7f4a4758bf742985fbaac64abb77dd459a0555130a77dc0',authenticationBindingCount:7,publicBindingsFingerprint:'f571dac3ad3e784d51c682e36fe17aa15bb442f72b6a40526862a7863181a41c',scriptRuntimeFingerprint:'6923502d620b8d4e2d41a88ac220c1c26423b67191d16a42c408fdbf0a23b7b5',workerSettingsFingerprint:'545d8bace27331c05236e601cffba0fdabfd22e6f2e0f8af0c53698c58b1a423'};
const evidenceRoot='/Users/rizkirn/CFL-Private-Backups/staging/cfl-uat-shadow-fix-mtd3safp';
const sourcePaths=['scripts/phase2c/tail-session.mjs','scripts/phase2c/tail-diagnostic.mjs','scripts/phase2c/shadow-diagnostics.mjs','scripts/phase2c/uat-validator.mjs','src/data-access/public-mode.mjs','src/data-access/public-d1.mjs','scripts/phase2b/api.mjs','scripts/phase2b/guards.mjs','wrangler.uat.jsonc','node_modules/ws/index.js','node_modules/ws/package.json',...readdirSync(join(root,'node_modules/ws/lib')).filter(name=>name.endsWith('.js')).sort().map(name=>'node_modules/ws/lib/'+name)];
export const planDigest=plan=>sha(JSON.stringify(plan));
function files(){return Object.fromEntries(sourcePaths.map(path=>[path,sha(readFileSync(join(root,path)))]));}
export function prepareDiagnosticPlan(destination,now=Date.now()){
 const post=JSON.parse(readFileSync(evidenceRoot+'/deployment-postflight.json'));
 check(post.versionId===pinned.versionId&&post.deploymentId===pinned.deploymentId&&post.authenticationFingerprint===pinned.authenticationFingerprint&&post.workerSettings.fingerprint===pinned.workerSettingsFingerprint,'RETAINED_TARGET_REJECTED');
 const baselinePath=evidenceRoot+'/canary-http.json',baseline=JSON.parse(readFileSync(baselinePath));
 check(baseline.index===0&&baseline.status===200&&baseline.sha256==='8b8aaa53dd7d0251e15432ac9040e540561e5fd26c2a2494207e7aec98c115c2','BASELINE_REJECTED');
 return {operation:'uat-tail-diagnostic',transport:TAIL_TRANSPORT,target:UAT,expected:pinned,mode:'shadow',destination,nonce:randomUUID(),marker:createPublicMarker(),createdAt:new Date(now).toISOString(),expiresAt:new Date(now+2*60*60*1000).toISOString(),readinessTimeoutMs:30000,canaryTimeoutMs:30000,disableServerVersionFilter:true,homepageRequests:1,remotePreflight:'MANDATORY_AFTER_APPROVAL',allowedEffects:['GET_UAT_PREFLIGHT','POST_ONE_EPHEMERAL_UAT_TAIL','CONNECT_TRACE_V1','GET_ONE_CORRELATED_HOMEPAGE','DELETE_CREATED_TAIL'],baseline:{path:baselinePath,fileSha256:sha(readFileSync(baselinePath)),row:baseline},sources:files(),runtime:{path:process.execPath,version:process.version,sha256:sha(readFileSync(process.execPath))}};
}
export function validateDiagnosticApproval(plan,approvedDigest,now=Date.now()){
 check(typeof approvedDigest==='string'&&approvedDigest===planDigest(plan),'DIAGNOSTIC_APPROVAL_REQUIRED');
 check(plan.operation==='uat-tail-diagnostic'&&plan.transport===TAIL_TRANSPORT&&equal(plan.target,UAT)&&equal(plan.expected,pinned)&&plan.mode==='shadow','DIAGNOSTIC_TARGET_REJECTED');
 check(Number.isFinite(Date.parse(plan.createdAt))&&Date.parse(plan.createdAt)<=now&&Date.parse(plan.expiresAt)>now&&Date.parse(plan.expiresAt)-Date.parse(plan.createdAt)===7200000,'DIAGNOSTIC_APPROVAL_EXPIRED');
 check(plan.readinessTimeoutMs===30000&&plan.canaryTimeoutMs===30000&&plan.disableServerVersionFilter===true&&plan.homepageRequests===1&&plan.remotePreflight==='MANDATORY_AFTER_APPROVAL'&&equal(plan.allowedEffects,['GET_UAT_PREFLIGHT','POST_ONE_EPHEMERAL_UAT_TAIL','CONNECT_TRACE_V1','GET_ONE_CORRELATED_HOMEPAGE','DELETE_CREATED_TAIL']),'DIAGNOSTIC_SCOPE_REJECTED');
 check(equal(plan.sources,files()),'DIAGNOSTIC_SOURCE_CHANGED');
 check(equal(plan.runtime,{path:process.execPath,version:process.version,sha256:sha(readFileSync(process.execPath))}),'DIAGNOSTIC_RUNTIME_CHANGED');
 check(sha(readFileSync(plan.baseline.path))===plan.baseline.fileSha256&&equal(JSON.parse(readFileSync(plan.baseline.path)),plan.baseline.row),'DIAGNOSTIC_BASELINE_CHANGED');
}
export {rejectEnvironmentOverrides} from './uat-validator.mjs';
export async function verifyVersionPreservation({token,fetcher=fetch}){
 const url='https://api.cloudflare.com/client/v4/accounts/'+UAT.account+'/workers/scripts/'+UAT.worker+'/versions/'+pinned.versionId;
 const response=await fetcher(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 check(response.ok,'DIAGNOSTIC_VERSION_HTTP_'+response.status);const body=await response.json();
 check(body.success===true&&body.result?.id===pinned.versionId&&Array.isArray(body.result.resources?.bindings),'DIAGNOSTIC_VERSION_REJECTED');
 const bindings=body.result.resources.bindings.filter(binding=>!binding.name.startsWith('ADMIN_')).sort((a,b)=>a.name.localeCompare(b.name));
 check(sha(JSON.stringify(bindings))===pinned.publicBindingsFingerprint,'DIAGNOSTIC_BINDINGS_CHANGED');
 check(sha(JSON.stringify(body.result.resources.script_runtime))===pinned.scriptRuntimeFingerprint,'DIAGNOSTIC_RUNTIME_CHANGED');
}
export async function runDiagnostic({plan,approvedDigest,token,verify=validateRemoteUAT,preserve=verifyVersionPreservation,fetcher=fetch,socketFactory,validateApproval=validateDiagnosticApproval,claim=()=>{throw Error('DURABLE_CLAIM_REQUIRED');}}){
 let session,code=null,http=null,preflight=null,postflight=null;
 const lifecycle={requestDispatchedAt:null,requestCompletedAt:null};
 const collector=createShadowCollector({versionId:plan.expected.versionId,marker:plan.marker,routes:[{path:'/',shadowDiagnosticRequired:true}]});
 const authorize=()=>validateApproval(plan,approvedDigest);
 const verifyTarget=async()=>{
  authorize();const result=await verify({token,mode:'shadow',fetcher});
  check(result.status==='PASS'&&equal(result.target,UAT)&&result.mode==='shadow'&&result.versionId===plan.expected.versionId&&result.deploymentId===plan.expected.deploymentId&&result.authenticationFingerprint===plan.expected.authenticationFingerprint&&result.authenticationBindingCount===plan.expected.authenticationBindingCount&&result.workerSettings?.fingerprint===plan.expected.workerSettingsFingerprint,'DIAGNOSTIC_TARGET_CHANGED');
  await preserve({token,fetcher});authorize();return result;
 };
 try{
  authorize();preflight=await verifyTarget();authorize();claim();
  session=createTailSession({token,collector,versionId:plan.expected.versionId,disableServerVersionFilter:plan.disableServerVersionFilter,fetcher,socketFactory,timeoutMs:plan.readinessTimeoutMs});
  await session.start();await verifyTarget();authorize();session.assertReady();
  const gate=collector.waitForCanary(plan.canaryTimeoutMs);void gate.catch(()=>{});
  lifecycle.requestDispatchedAt=new Date().toISOString();
  const url=collector.canaryURL();check(url.origin==='https://'+UAT.hostname&&url.pathname==='/','DIAGNOSTIC_URL_REJECTED');
  const response=await Promise.race([fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(plan.canaryTimeoutMs)}),session.failure,gate.then(()=>new Promise(()=>{}))]);
  const body=await Promise.race([response.text(),session.failure,gate.then(()=>new Promise(()=>{}))]);
  lifecycle.requestCompletedAt=new Date().toISOString();
  const observed={index:0,status:response.status,sha256:sha(body),headers:Object.fromEntries(Object.keys(plan.baseline.row.headers).map(key=>[key,response.headers.get(key)]))};
  http={index:0,status:observed.status,sha256:observed.sha256,headersMatch:equal(observed.headers,plan.baseline.row.headers)};
  check(equal(observed,plan.baseline.row),'DIAGNOSTIC_HTTP_DIFFERENCE');
  await Promise.race([gate,session.failure]);session.assertReady();
  const summary=collector.summary();check(summary.canaryCaptured&&summary.comparisonsAccepted>=6&&summary.mismatchCount===0,'DIAGNOSTIC_COMPARISON_COVERAGE_FAILED');
  postflight=await verifyTarget();session.assertReady();check(!collector.summary().failure,'DIAGNOSTIC_COLLECTION_FAILED');
 }catch(error){code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'DIAGNOSTIC_EXECUTION_FAILED';}
 finally{if(session)try{await session.stop();}catch{code??='TAIL_CLEANUP_UNCONFIRMED';}}
 return {status:code?'BLOCKED':'PASS',code,operation:plan.operation,digest:approvedDigest,preflight,postflight,http,lifecycle,tail:session?.summary()??null,collector:collector.summary(),matrixRequests:0};
}
function privateDestination(path){
 check(typeof path==='string'&&/^\/private\/tmp\/cfl-tail-diagnostic-[A-Za-z0-9]+$/.test(path)&&realpathSync(path)===path,'DIAGNOSTIC_STORAGE_REJECTED');
 const stat=lstatSync(path);check(stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700,'DIAGNOSTIC_STORAGE_REJECTED');
 check(readFileSync(path+'/ownership','utf8')==='cfl-tail-diagnostic-v1','DIAGNOSTIC_STORAGE_REJECTED');
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [command,path,flag,digest]=process.argv.slice(2);
  if(command==='prepare'){
   check(path===undefined,'ARGUMENT_REJECTED');const destination=mkdtempSync('/private/tmp/cfl-tail-diagnostic-');writeFileSync(destination+'/ownership','cfl-tail-diagnostic-v1',{mode:0o600,flag:'wx'});const plan=prepareDiagnosticPlan(destination);writeFileSync(destination+'/plan.json',JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({path:destination+'/plan.json',digest:planDigest(plan),expiresAt:plan.expiresAt,remoteAccess:false}));
  }else{
   check(command==='execute'&&flag==='--approve'&&process.argv.length===6,'ARGUMENT_REJECTED');
   const plan=JSON.parse(readFileSync(path));privateDestination(plan.destination);check(path===plan.destination+'/plan.json'&&!lstatSync(path).isSymbolicLink(),'DIAGNOSTIC_STORAGE_REJECTED');validateDiagnosticApproval(plan,digest);rejectEnvironmentOverrides();validateUATConfig(JSON.parse(readFileSync(join(root,'wrangler.uat.jsonc'))));
   const {credential}=await import('../phase2b/api.mjs');const {default:WebSocket}=await import('ws');
   const report=await runDiagnostic({plan,approvedDigest:digest,token:credential(),socketFactory:(...args)=>new WebSocket(...args),claim:()=>writeFileSync(plan.destination+'/execution.claim',digest,{mode:0o600,flag:'wx'})});
   writeFileSync(plan.destination+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({status:report.status,code:report.code,report:plan.destination+'/report.json'}));if(report.status!=='PASS')process.exitCode=1;
  }
 }catch(error){console.error(JSON.stringify({status:'BLOCKED',code:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'DIAGNOSTIC_PREPARATION_FAILED'}));process.exitCode=1;}
}
