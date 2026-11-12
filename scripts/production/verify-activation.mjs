import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual as equal} from 'node:util';
import {ACCOUNT,WORKER,STABLE_VERSION,MODERN,METADATA_PATHS,sha,requireRelease as need} from './pinned-version-guard.mjs';
import {UPLOADED_VERSION} from './activation-review.mjs';
import {verifyUploadedVersion,activeConfiguration,toolingSeal,formatReleaseFailure} from './pinned-version-release.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const DIGEST='81bf1b804113db785deccad5a7501681f2434a24fae01f4e80a90ccb43d7f34e';
const UPLOAD_DIGEST='44387a38b46536bb731a4635519b5d2c848323074cc3da2c4cb553a6ed69581d';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function exactTraffic(versions,target){return Array.isArray(versions)&&versions.length===1&&versions[0]?.version_id===target&&versions[0]?.percentage===100;}
export function deploymentSummary(deployment){
 return {deploymentId:uuid.test(deployment?.id??'')?deployment.id:null,versions:Array.isArray(deployment?.versions)?deployment.versions.map(v=>({versionId:uuid.test(v?.version_id??'')?v.version_id:null,percentage:typeof v?.percentage==='number'?v.percentage:null,fieldNames:v&&typeof v==='object'?Object.keys(v).map(k=>/^[a-z][a-z0-9_]{0,79}$/.test(k)?k:'<redacted-field-name>').sort():[]})):null};
}
export async function verifyActivationReadOnly({get,activation,upload,submitted}){
 const first=(await get(METADATA_PATHS[0]))?.deployments?.[0];
 const summary=deploymentSummary(first);
 if(exactTraffic(first?.versions,STABLE_VERSION))return {status:'NOT_ACTIVATED_STABLE_ACTIVE',...summary,trafficChangedByVerification:false};
 if(first?.id!==submitted.deploymentId||!exactTraffic(first?.versions,UPLOADED_VERSION)){const error=new Error('ACTIVE_DEPLOYMENT_OR_TRAFFIC_UNEXPECTED');error.deploymentSummary=summary;throw error;}
 const uploadedPath=MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules';
 async function inspect(){
  const version=await get(uploadedPath);need(version.id===UPLOADED_VERSION,'ACTIVE_VERSION_ID_MISMATCH');verifyUploadedVersion(version,upload.payload);
  for(const [path,expected]of [[METADATA_PATHS[2],activation.baseline.routing.domains],[METADATA_PATHS[3],activation.baseline.routing.routes],[METADATA_PATHS[4],activation.baseline.routing.subdomain]])need(equal(await get(path),expected),'ACTIVE_ROUTES_OR_SUBDOMAIN_CHANGED');
  const stable=await get(MODERN+'/versions/'+STABLE_VERSION);need(stable.id===STABLE_VERSION&&equal(activeConfiguration(stable),upload.baseline.configuration),'ROLLBACK_CONFIGURATION_UNAVAILABLE_OR_CHANGED');
 }
 await inspect();const middle=(await get(METADATA_PATHS[0]))?.deployments?.[0];need(equal(middle,first),'DEPLOYMENT_CHANGED_DURING_POSTFLIGHT');
 await inspect();const last=(await get(METADATA_PATHS[0]))?.deployments?.[0];need(equal(last,first),'DEPLOYMENT_CHANGED_DURING_POSTFLIGHT');
 return {status:'ACTIVATED_VERIFIED',versionId:UPLOADED_VERSION,deploymentId:first.id,traffic:100,activationApprovalDigest:activation.digest,artifactMatchesApproved:true,bindingsVariablesAssetsVerified:true,secretInheritanceSourceVersionId:STABLE_VERSION,secretValuesExported:false,routesUnchanged:true,rollbackVersionId:STABLE_VERSION,rollbackVersionAvailable:true,deploymentVersionFields:summary.versions[0].fieldNames,trafficChangedByVerification:false,databaseRequests:0};
}
function readPrivate(path){const st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_POSTFLIGHT_FILE_REQUIRED');return JSON.parse(readFileSync(path,'utf8'));}
async function main(){
 const args=process.argv.slice(2);need(args.length===4&&args[0]==='--review'&&args[2]==='--upload-operation','INVALID_ARGUMENTS');
 const review=realpathSync(args[1]),operation=realpathSync(args[3]);for(const dir of [review,operation]){const st=lstatSync(dir);need(dir.startsWith('/private/tmp/')&&st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_POSTFLIGHT_DIRECTORY_REQUIRED');}
 const activation=readPrivate(review+'/activation-plan.private.json'),upload=readPrivate(operation+'/release-plan.private.json'),submitted=readPrivate(review+'/activation-submitted.json'),approval=readPrivate(review+'/activation-approval.json');
 for(const [plan,digest]of [[activation,DIGEST],[upload,UPLOAD_DIGEST]]){const {digest:actual,...body}=plan;need(actual===digest&&sha(body)===actual,'POSTFLIGHT_PLAN_DIGEST_MISMATCH');}
 need(activation.target.account===ACCOUNT&&activation.target.worker===WORKER&&activation.versionId===UPLOADED_VERSION&&submitted.versionId===UPLOADED_VERSION&&uuid.test(submitted.deploymentId??''),'POSTFLIGHT_TARGET_REJECTED');
 need(approval.approved===true&&approval.operation===activation.operation&&approval.planDigest===DIGEST&&approval.versionId===UPLOADED_VERSION,'ACTIVATION_APPROVAL_RECORD_REQUIRED');
 need(activation.uploadToolingSHA256===toolingSeal()&&activation.reviewToolSHA256===sha(readFileSync(ROOT+'/scripts/production/activation-review.mjs'))&&equal(activation.baseline,upload.baseline),'POSTFLIGHT_SEALS_CHANGED');
 need(!Object.keys(process.env).some(k=>['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED'].includes(k)||/^(HTTPS?|ALL)_PROXY$/i.test(k)),'PROCESS_OVERRIDE_REJECTED');
 let auth;try{auth=JSON.parse(execFileSync(process.execPath,[ROOT+'/node_modules/wrangler/bin/wrangler.js','auth','token','--json','--config',upload.workspace+'/wrangler.production.jsonc'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}}));}catch{throw Error('AUTHENTICATION_UNAVAILABLE');}need(['oauth','api_token'].includes(auth.type)&&typeof auth.token==='string','TOKEN_AUTHENTICATION_REQUIRED');
 const allowed=new Set([...METADATA_PATHS,MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules']);let count=0,stopped=false;const deadline=Date.now()+240000;
 const get=async path=>{
  need(!stopped&&allowed.has(path)&&++count<=16&&Date.now()<deadline,'READ_ONLY_POSTFLIGHT_SCOPE_REJECTED');
  try{
   let response;try{response=await fetch('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{Authorization:'Bearer '+auth.token},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE');}
   need(response.ok&&!response.redirected,'POSTFLIGHT_METADATA_HTTP_REJECTED');let data;try{data=await response.json();}catch{throw Error('INVALID_POSTFLIGHT_METADATA_RESPONSE');}need(data.success===true,'POSTFLIGHT_METADATA_API_REJECTED');
   if(path===METADATA_PATHS[0])need(data.result?.deployments?.length===1&&(!data.result_info||(data.result_info.page===undefined||data.result_info.page===1)&&(data.result_info.per_page===undefined||data.result_info.per_page===1)),'ACTIVE_DEPLOYMENT_PAGE_REJECTED');
   else need(!data.result_info||data.result_info.total_pages===undefined||Number.isInteger(data.result_info.total_pages)&&data.result_info.total_pages>=0&&data.result_info.total_pages<=1,'INCOMPLETE_POSTFLIGHT_METADATA');
   return data.result;
  }catch(error){stopped=true;throw error;}
 };
 const result=await verifyActivationReadOnly({get,activation,upload,submitted});
 const report={...result,checkedAt:new Date().toISOString()};writeFileSync(review+'/activation-postflight-report-'+Date.now()+'.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(formatReleaseFailure(error));if(error.deploymentSummary)console.log(JSON.stringify({activeDeployment:error.deploymentSummary,valuesIncluded:false}));process.exitCode=1;});
