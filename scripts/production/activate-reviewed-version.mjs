import {readFileSync,writeFileSync,lstatSync,realpathSync,openSync,closeSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {isDeepStrictEqual as equal} from 'node:util';
import {ACCOUNT,WORKER,STABLE_VERSION,MODERN,SCRIPT,METADATA_PATHS,sha,requireRelease as need} from './pinned-version-guard.mjs';
import {buildArtifacts,toolingSeal,verifyUploadedVersion,activeConfiguration,formatReleaseFailure} from './pinned-version-release.mjs';
import {UPLOADED_VERSION,liveActivationReview,sourceReview} from './activation-review.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const ACTIVATION_DIGEST='81bf1b804113db785deccad5a7501681f2434a24fae01f4e80a90ccb43d7f34e';
const UPLOAD_DIGEST='44387a38b46536bb731a4635519b5d2c848323074cc3da2c4cb553a6ed69581d';
export const ACTION={method:'POST',path:SCRIPT+'/deployments',body:{strategy:'percentage',versions:[{version_id:UPLOADED_VERSION,percentage:100}]}};
export function validateActivation(plan,approval,pause,now=Date.now()){
 const {digest,...body}=plan;
 need(digest===ACTIVATION_DIGEST&&sha(body)===digest&&plan.format==='cfl-production-activation-plan-v1'&&plan.operation==='production-version-activation','ACTIVATION_PLAN_INVALID');
 need(equal(plan.target,{account:ACCOUNT,worker:WORKER})&&plan.versionId===UPLOADED_VERSION&&plan.uploadPlanDigest===UPLOAD_DIGEST&&equal(plan.action,ACTION),'ACTIVATION_TARGET_OR_ACTION_REJECTED');
 need(plan.baseline.versionId===STABLE_VERSION&&plan.baseline.traffic===100&&equal(plan.rollback,{versionId:STABLE_VERSION,available:true,automatic:false}),'ACTIVATION_BASELINE_REJECTED');
 need(Date.parse(plan.issuedAt)<=now&&now<Date.parse(plan.expiresAt)&&Date.parse(plan.expiresAt)-Date.parse(plan.issuedAt)<=1800000,'ACTIVATION_PLAN_EXPIRED');
 need(approval?.approved===true&&approval.operation===plan.operation&&approval.planDigest===digest&&equal(approval.target,plan.target)&&approval.sourceMappingUnverifiedAcknowledged===true&&approval.versionId===UPLOADED_VERSION,'ACTIVATION_APPROVAL_REQUIRED');
 need(typeof approval.approvedBy==='string'&&approval.approvedBy.trim()&&typeof approval.id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(approval.id),'ACTIVATION_APPROVAL_IDENTITY_REQUIRED');
 need(Date.parse(approval.issuedAt)<=now&&now<Date.parse(approval.expiresAt)&&Date.parse(approval.expiresAt)<=Date.parse(plan.expiresAt)&&Date.parse(approval.expiresAt)-Date.parse(approval.issuedAt)<=1800000,'ACTIVATION_APPROVAL_EXPIRED');
 if(pause!==undefined)need(pause.confirmed===true&&pause.planDigest===digest&&typeof pause.confirmedBy==='string'&&pause.confirmedBy.trim()&&Date.parse(pause.confirmedAt)<=now&&now-Date.parse(pause.confirmedAt)<300000,'FRESH_ACTIVATION_PAUSE_REQUIRED');
}
export function activationTransport({token,check,fetcher=fetch,now=Date.now}){
 const paths=new Set([...METADATA_PATHS,MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules']);
 let stopped=false,sent=false,armed=false,readyAt;const start=now();let requests=0;
 async function request(method,path,body){
  need(!stopped,'ACTIVATION_TRANSPORT_STOPPED_NO_RETRY');
  try{
   check();need(now()-start<240000&&++requests<=64,'ACTIVATION_TRANSPORT_LIMIT');
   if(method==='GET')need(paths.has(path)&&body===undefined,'ACTIVATION_GET_SCOPE_REJECTED');
   else {need(method==='POST'&&path===ACTION.path&&equal(body,ACTION.body)&&armed&&!sent&&now()-readyAt<300000,'ACTIVATION_POST_SCOPE_REJECTED');sent=true;}
   let response;try{response=await fetcher('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error(sent?'ACTIVATION_OUTCOME_UNCERTAIN_NETWORK_FAILURE':'CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE');}
   need(!response.redirected&&response.ok,'ACTIVATION_METADATA_OR_DEPLOYMENT_HTTP_REJECTED');let data;try{data=await response.json();}catch{throw Error(sent?'ACTIVATION_OUTCOME_UNCERTAIN_RESPONSE':'INVALID_ACTIVATION_METADATA_RESPONSE');}need(data.success===true,'ACTIVATION_API_REJECTED');
   if(method==='GET'&&path===METADATA_PATHS[0])need(data.result?.deployments?.length===1&&(!data.result_info||(data.result_info.page===undefined||data.result_info.page===1)&&(data.result_info.per_page===undefined||data.result_info.per_page===1)),'ACTIVE_DEPLOYMENT_PAGE_REJECTED');
   else if(method==='GET')need(!data.result_info||data.result_info.total_pages===undefined||Number.isInteger(data.result_info.total_pages)&&data.result_info.total_pages>=0&&data.result_info.total_pages<=1,'INCOMPLETE_ACTIVATION_METADATA');
   return data.result;
  }catch(error){stopped=true;throw error;}
 }
 return {get:path=>request('GET',path),post:(path,body)=>request('POST',path,body),arm(){need(!armed&&!stopped,'ACTIVATION_ARM_REJECTED');armed=true;readyAt=now();}};
}
export async function executeActivation({api,activation,upload,claim,record}){
 await liveActivationReview({get:api.get,baseline:activation.baseline,payload:upload.payload});
 claim();api.arm();const deployment=await api.post(ACTION.path,ACTION.body);
 need(typeof deployment?.id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deployment.id),'ACTIVATION_OUTCOME_UNCERTAIN_DEPLOYMENT_RESPONSE');record({deploymentId:deployment.id,versionId:UPLOADED_VERSION,postflightVerified:false});
 need(equal(deployment.versions,ACTION.body.versions),'ACTIVATION_DEPLOYMENT_RESPONSE_MISMATCH');
 const verify=async()=>{
  const active=(await api.get(METADATA_PATHS[0])).deployments[0];need(active.id===deployment.id&&equal(active.versions,ACTION.body.versions),'ACTIVATION_TRAFFIC_NOT_VERIFIED');
  const version=await api.get(MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules');need(version.id===UPLOADED_VERSION,'ACTIVE_VERSION_ID_MISMATCH');verifyUploadedVersion(version,upload.payload);
  for(const [path,expected]of [[METADATA_PATHS[2],activation.baseline.routing.domains],[METADATA_PATHS[3],activation.baseline.routing.routes],[METADATA_PATHS[4],activation.baseline.routing.subdomain]])need(equal(await api.get(path),expected),'ACTIVATION_ROUTING_DRIFT');
  const rollback=await api.get(MODERN+'/versions/'+STABLE_VERSION);need(rollback.id===STABLE_VERSION,'ROLLBACK_VERSION_UNAVAILABLE');need(equal(activeConfiguration(rollback),upload.baseline.configuration),'ROLLBACK_CONFIGURATION_CHANGED');
 };
 await verify();await verify();
 return {status:'ACTIVATED_VERIFIED',versionId:UPLOADED_VERSION,deploymentId:deployment.id,traffic:100,activationApprovalDigest:activation.digest,rollbackVersionId:STABLE_VERSION,rollbackVersionAvailable:true,bindingsVariablesAssetsVerified:true,routesUnchanged:true,secretValuesExported:false,databaseRequests:0,automaticRollbackPerformed:false};
}
function readPrivate(path){const st=lstatSync(path);need(!st.isSymbolicLink()&&st.isFile()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_ACTIVATION_FILE_REQUIRED');return JSON.parse(readFileSync(path,'utf8'));}
async function main(){
 const args=process.argv.slice(2);need(args.length===4&&args[0]==='--review'&&args[2]==='--upload-operation','INVALID_ARGUMENTS');
 const review=realpathSync(args[1]),operation=realpathSync(args[3]);
 for(const dir of [review,operation]){const st=lstatSync(dir);need(dir.startsWith('/private/tmp/')&&st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_ACTIVATION_DIRECTORY_REQUIRED');}
 const activation=readPrivate(review+'/activation-plan.private.json'),approval=readPrivate(review+'/activation-approval.json'),upload=readPrivate(operation+'/release-plan.private.json');
 validateActivation(activation,approval);
 need(approval.executionToolSHA256===sha(readFileSync(fileURLToPath(import.meta.url)))&&activation.reviewToolSHA256===sha(readFileSync(ROOT+'/scripts/production/activation-review.mjs'))&&activation.uploadToolingSHA256===toolingSeal(),'ACTIVATION_TOOLING_CHANGED');
 const {digest,...uploadBody}=upload;need(digest===UPLOAD_DIGEST&&sha(uploadBody)===digest&&equal(activation.baseline,upload.baseline),'ACTIVATION_UPLOAD_PLAN_CHANGED');
 const artifacts=buildArtifacts(upload.workspace);need(artifacts.artifactSHA256===activation.artifactSHA256&&artifacts.artifactSHA256===upload.artifactSHA256&&sha(readFileSync(upload.workspace+'/wrangler.production.jsonc'))===upload.configurationSHA256,'ACTIVATION_ARTIFACT_OR_CONFIGURATION_CHANGED');need(equal(sourceReview(upload.workspace),activation.sourceReview),'ACTIVATION_SOURCE_CHANGED');
 need(process.stdin.isTTY&&process.stdout.isTTY,'INTERACTIVE_OWNER_PAUSE_CONFIRMATION_REQUIRED');
 const rl=createInterface({input:process.stdin,output:process.stdout});let answer;try{answer=await rl.question('Confirm admin/data writers and other uploads are paused. Type PAUSED to continue: ');}finally{rl.close();}need(answer==='PAUSED','ACTIVATION_PAUSE_NOT_CONFIRMED');
 const pause={confirmed:true,planDigest:activation.digest,confirmedBy:approval.approvedBy,confirmedAt:new Date().toISOString()};
 writeFileSync(review+'/activation-pause.json',JSON.stringify(pause,null,2)+'\n',{flag:'wx',mode:0o600});
 const check=()=>validateActivation(activation,approval,pause);check();
 need(!Object.keys(process.env).some(k=>['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED'].includes(k)||/^(HTTPS?|ALL)_PROXY$/i.test(k)),'PROCESS_OVERRIDE_REJECTED');
 let auth;try{auth=JSON.parse(execFileSync(process.execPath,[ROOT+'/node_modules/wrangler/bin/wrangler.js','auth','token','--json','--config',upload.workspace+'/wrangler.production.jsonc'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}}));}catch{throw Error('AUTHENTICATION_UNAVAILABLE');}
 need(['oauth','api_token'].includes(auth.type)&&typeof auth.token==='string','TOKEN_AUTHENTICATION_REQUIRED');
 const api=activationTransport({token:auth.token,check});
 const result=await executeActivation({api,activation,upload,claim:()=>closeSync(openSync(review+'/activation.claimed','wx',0o600)),record:value=>writeFileSync(review+'/activation-submitted.json',JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})});
 writeFileSync(review+'/activation-report.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(formatReleaseFailure(error));process.exitCode=1;});
