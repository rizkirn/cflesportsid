import {readFileSync,writeFileSync,lstatSync,realpathSync,mkdtempSync,chmodSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {ACCOUNT,WORKER,STABLE_VERSION,MODERN,METADATA_PATHS,sha,requireRelease as need} from './guard.mjs';
import {buildArtifacts,createPayload,toolingSeal,capturePinnedBaseline,verifyUploadedVersion,verifyUiSourceScope,formatReleaseFailure} from './release.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const UPLOADED_VERSION='06da29a3-91ac-4379-aeab-0b798335c38b';
export const UPLOAD_DIGEST='25cb3b125f326f0085b60256e5db26f2b3471880404f4ef9bfd3a3bb9ebb010e';
function privateRead(path){const st=lstatSync(path);need(st.isFile()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_REVIEW_FILE_REQUIRED');return JSON.parse(readFileSync(path,'utf8'));}
export async function liveActivationReview({get,baseline,payload}){
 const before=await capturePinnedBaseline(get);need(equal(before,baseline),'UI_ACTIVE_BASELINE_CHANGED');
 const path=MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules';
 const uploaded=await get(path);need(uploaded?.id===UPLOADED_VERSION,'UI_UPLOADED_VERSION_MISMATCH');verifyUploadedVersion(uploaded,payload);
 need(equal(await capturePinnedBaseline(get),before),'UI_BASELINE_CHANGED_DURING_REVIEW');need(equal(await get(path),uploaded),'UI_UPLOADED_VERSION_CHANGED');
 return {uploadedArtifactMatchesApproved:true,bindingsAndVariablesMatchApproved:true,assetsMatchApproved:true,routesMatchApproved:true,secretMetadataMatches:true,secretInheritanceSourceVersionId:STABLE_VERSION,secretValuesExported:false,rollbackVersionId:STABLE_VERSION,rollbackVersionAvailable:true,stableDeploymentId:before.deploymentId,stableTraffic:100};
}
async function main(){
 const args=process.argv.slice(2);need(args.length===2&&args[0]==='--operation','INVALID_ARGUMENTS');
 const operation=realpathSync(args[1]),st=lstatSync(operation);need(operation.startsWith('/private/tmp/')&&st.isDirectory()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_OPERATION_REQUIRED');
 const output=mkdtempSync('/private/tmp/cfl-ui-activation-review-');chmodSync(output,0o700);
 const save=(name,value)=>writeFileSync(output+'/'+name,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 const report={status:'NO_GO',blockers:[],versionId:UPLOADED_VERSION,uploadPlanDigest:UPLOAD_DIGEST,activationApprovalDigest:null,activationAuthorized:false,trafficChanged:false};
 try{
  const plan=privateRead(operation+'/release-plan.private.json'),upload=privateRead(operation+'/upload-report.json'),approval=privateRead(operation+'/deployment-approval.json'),{digest,...body}=plan;
  need(digest===UPLOAD_DIGEST&&sha(body)===digest&&plan.baseline.versionId===STABLE_VERSION,'UI_UPLOAD_PLAN_CHANGED');
  need(upload.status==='UPLOADED_VERIFIED_NOT_ACTIVATED'&&upload.versionId===UPLOADED_VERSION&&upload.planDigest===digest&&upload.activationAuthorized===false,'UI_VERIFIED_UPLOAD_REQUIRED');
  need(approval.approved===true&&approval.planDigest===digest&&approval.operation===plan.operation&&equal(approval.target,plan.target)&&approval.sourceMappingUnverifiedAcknowledged===true,'UI_UPLOAD_APPROVAL_REQUIRED');
  need(plan.toolingSHA256===toolingSeal()&&plan.configurationSHA256===sha(readFileSync(plan.workspace+'/wrangler.production.jsonc')),'UI_SEALED_TOOLING_OR_CONFIGURATION_CHANGED');
  const artifacts=buildArtifacts(plan.workspace);need(artifacts.artifactSHA256===plan.artifactSHA256&&sha(artifacts.manifest)===plan.manifestSHA256&&equal(createPayload(plan.baseline,artifacts.modules),plan.payload),'UI_ARTIFACT_CHANGED');
  const sourceProof=verifyUiSourceScope(plan.workspace,'/private/tmp/cfl-qualification-release-p2xl37xp');need(equal(sourceProof,plan.sourceProof),'UI_SOURCE_PROOF_CHANGED');
  report.local={artifactSHA256:plan.artifactSHA256,artifactMatchesApproved:true,sourceProof};
  need(!Object.keys(process.env).some(k=>['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED'].includes(k)||/^(HTTPS?|ALL)_PROXY$/i.test(k)),'PROCESS_OVERRIDE_REJECTED');
  let auth;try{auth=JSON.parse(execFileSync(process.execPath,[ROOT+'/node_modules/wrangler/bin/wrangler.js','auth','token','--json','--config',plan.workspace+'/wrangler.production.jsonc'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}}));}catch{throw Error('AUTHENTICATION_UNAVAILABLE');}need(['oauth','api_token'].includes(auth.type)&&typeof auth.token==='string','TOKEN_AUTHENTICATION_REQUIRED');
  const allowed=new Set([...METADATA_PATHS,MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules']);let count=0,failed=false;const deadline=Date.now()+240000;
  const get=async path=>{
   need(!failed&&allowed.has(path)&&++count<=24&&Date.now()<deadline,'UI_READ_ONLY_REVIEW_SCOPE_REJECTED');
   try{
    let response;try{response=await fetch('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{Authorization:'Bearer '+auth.token},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE');}
    need(response.ok&&!response.redirected,'UI_METADATA_HTTP_REJECTED');let data;try{data=await response.json();}catch{throw Error('INVALID_UI_METADATA_RESPONSE');}need(data.success===true,'UI_METADATA_API_REJECTED');
    if(path===METADATA_PATHS[0])need(data.result?.deployments?.length===1&&(!data.result_info||(data.result_info.page===undefined||data.result_info.page===1)&&(data.result_info.per_page===undefined||data.result_info.per_page===1)),'ACTIVE_DEPLOYMENT_PAGE_REJECTED');
    else need(!data.result_info||data.result_info.total_pages===undefined||Number.isInteger(data.result_info.total_pages)&&data.result_info.total_pages>=0&&data.result_info.total_pages<=1,'INCOMPLETE_UI_METADATA');return data.result;
   }catch(error){failed=true;throw error;}
  };
  report.live=await liveActivationReview({get,baseline:plan.baseline,payload:plan.payload});
  const now=Date.now(),activation={format:'cfl-production-activation-plan-v1',operation:'production-version-activation',target:{account:ACCOUNT,worker:WORKER},versionId:UPLOADED_VERSION,uploadPlanDigest:digest,artifactSHA256:plan.artifactSHA256,baseline:plan.baseline,rollback:{versionId:STABLE_VERSION,available:true,automatic:false},action:{method:'POST',path:`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/deployments`,body:{strategy:'percentage',versions:[{version_id:UPLOADED_VERSION,percentage:100}]}},issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),nonce:randomUUID(),sourceReview:sourceProof,sourceMappingVerified:false,validation:report.live,reviewToolSHA256:sha(readFileSync(fileURLToPath(import.meta.url))),uploadToolingSHA256:plan.toolingSHA256,requirements:{separateExplicitDigestApproval:true,sourceMappingLimitationAcknowledgement:true,freshReadOnlyPreflightMaxAgeMs:300000,separateWriterUploadPause:true,singleUseClaim:true,retries:0,postActivationVerification:true}};
  const sealed={...activation,digest:sha(activation)};save('activation-plan.private.json',sealed);report.status='GO_FOR_ACTIVATION_APPROVAL';report.activationApprovalDigest=sealed.digest;report.expiresAt=sealed.expiresAt;
 }catch(error){report.blockers.push(formatReleaseFailure(error).split('\n')[0].replace('NO_GO: ',''));}
 report.checkedAt=new Date().toISOString();save('report.json',report);console.log(JSON.stringify(report,null,2));console.log('Review directory: '+output);if(report.blockers.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(formatReleaseFailure(error));process.exitCode=1;});
