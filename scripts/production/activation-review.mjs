import {readFileSync,readdirSync,lstatSync,realpathSync,writeFileSync,mkdtempSync,chmodSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {ACCOUNT,WORKER,STABLE_VERSION,MODERN,METADATA_PATHS,VERSION_PATH,sha,requireRelease as need} from './pinned-version-guard.mjs';
import {buildArtifacts,createPayload,toolingSeal,capturePinnedBaseline,verifyUploadedVersion,formatReleaseFailure} from './pinned-version-release.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const UPLOADED_VERSION='2767f1cb-5070-4012-a6bc-95afe06dfc3f';
const APPROVED_DIGEST='44387a38b46536bb731a4635519b5d2c848323074cc3da2c4cb553a6ed69581d';
const CANDIDATE='f8a1fcbb4083859cf51bec32ed0e61a42fe9e900';
function privateRead(path){const st=lstatSync(path);need(!st.isSymbolicLink()&&st.isFile()&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_REVIEW_INPUT_REQUIRED');return JSON.parse(readFileSync(path,'utf8'));}
function walk(dir){const output=[];for(const name of readdirSync(dir).sort()){const path=dir+'/'+name,st=lstatSync(path);need(!st.isSymbolicLink(),'SOURCE_SYMLINK_REJECTED');if(st.isDirectory())output.push(...walk(path));else {need(st.isFile(),'NONREGULAR_SOURCE_REJECTED');output.push(path);}}return output;}
export function qualificationOnly(before,after){
 const start=before.indexOf('/*\n * Tournament winners are the teams already guaranteed');
 const end=before.indexOf('const remainingSpots =');
 need(start>=0&&end>start,'CANDIDATE_QUALIFICATION_BLOCK_UNRECOGNIZED');
 let expected=before.slice(0,start)+'const ALL_STAR_SPOTS = 10;\nconst qualifiedTeams = standings.slice(0, ALL_STAR_SPOTS);\nconst allStarSpots = ALL_STAR_SPOTS;\n\n'+before.slice(end);
 need(expected.split('{team.isTournamentWinner ? (').length===3,'CANDIDATE_STATUS_RENDERERS_UNRECOGNIZED');
 expected=expected.replaceAll('{team.isTournamentWinner ? (','{qualifiedTeams.includes(team) ? (');
 need(after===expected,'UNRELATED_HOMEPAGE_CHANGE');return true;
}
export function sourceReview(workspace){
 const tree=execFileSync('git',['ls-tree','-r','-z',CANDIDATE],{cwd:ROOT}).toString().split('\0').filter(Boolean),tracked=new Set(),changed=[],missing=[];
 for(const item of tree){const [head,path]=item.split('\t'),[mode,,hash]=head.split(' ');tracked.add(path);need(mode!=='120000','UNREVIEWED_BASELINE_SYMLINK');if(!existsSync(workspace+'/'+path)){missing.push(path);continue;}need(!lstatSync(workspace+'/'+path).isSymbolicLink(),'SOURCE_SYMLINK_REJECTED');const bytes=readFileSync(workspace+'/'+path);if(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==hash)changed.push(path);}
 need(missing.length===0,'CANDIDATE_SOURCE_FILES_MISSING');
 const appChanged=changed.filter(p=>/^(src|public)\//.test(p));need(equal(appChanged,['src/pages/index.astro']),'UNRELATED_APPLICATION_SOURCE_CHANGE');
 const extras=['src','public'].flatMap(dir=>walk(workspace+'/'+dir)).map(p=>relative(workspace,p)).filter(p=>!tracked.has(p));need(extras.length===0,'UNREVIEWED_EXTRA_APPLICATION_SOURCE');
 const before=execFileSync('git',['show',CANDIDATE+':src/pages/index.astro'],{cwd:ROOT,encoding:'utf8'}),after=readFileSync(workspace+'/src/pages/index.astro','utf8');qualificationOnly(before,after);
 return {candidateCommit:CANDIDATE,sourceMappingVerified:false,trackedFilesCompared:tree.length,applicationChangedFiles:appChanged,auxiliaryChangedFiles:changed.filter(p=>!appChanged.includes(p)),qualificationDiffExact:true,adminUnchanged:true,latestMatchesUnchanged:true,identityAndLogoResolutionUnchanged:true,loadersUnchanged:true,cssUnchanged:true};
}
export async function liveActivationReview({get,baseline,payload}){
 const before=await capturePinnedBaseline(get);need(equal(before,baseline),'ACTIVE_BASELINE_CHANGED');
 const path=MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules';
 const uploaded=await get(path);need(uploaded?.id===UPLOADED_VERSION,'UPLOADED_VERSION_ID_MISMATCH');verifyUploadedVersion(uploaded,payload);
 const after=await capturePinnedBaseline(get);need(equal(after,before),'ACTIVE_BASELINE_CHANGED_DURING_REVIEW');
 const repeated=await get(path);need(equal(uploaded,repeated),'UPLOADED_VERSION_CHANGED_DURING_REVIEW');
 return {uploadedVersionAvailable:true,uploadedArtifactMatchesApproved:true,bindingsAndVariablesMatchApproved:true,secretMetadataMatches:true,secretInheritanceSourceVersionId:STABLE_VERSION,secretInheritanceEvidence:'approved sealed request pins exact source UUID; successful upload and returned secret metadata verified; secret values not retrieved',assetsMatchApproved:true,routesMatchApproved:true,stableVersionAvailable:true,rollbackVersionId:STABLE_VERSION,stableDeploymentId:before.deploymentId,stableTraffic:100};
}
async function run(){
 const args=process.argv.slice(2);need(args.length===2&&args[0]==='--operation','INVALID_ARGUMENTS');
 const operation=realpathSync(args[1]),st=lstatSync(operation);need(operation.startsWith('/private/tmp/')&&st.uid===process.getuid()&&(st.mode&0o077)===0,'PRIVATE_OPERATION_REQUIRED');
 const output=mkdtempSync('/private/tmp/cfl-activation-review-');chmodSync(output,0o700);
 const save=(name,value)=>writeFileSync(output+'/'+name,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 const report={status:'NO_GO',blockers:[],versionId:UPLOADED_VERSION,uploadPlanDigest:APPROVED_DIGEST,activationApprovalDigest:null,checkedAt:new Date().toISOString(),sourceMappingVerified:false,activationAuthorized:false,trafficChanged:false};
 try{
  const plan=privateRead(operation+'/release-plan.private.json'),upload=privateRead(operation+'/upload-report.json'),approval=privateRead(operation+'/deployment-approval.json'),{digest,...body}=plan;
  need(digest===APPROVED_DIGEST&&sha(body)===digest,'UPLOAD_PLAN_DIGEST_MISMATCH');need(upload.status==='UPLOADED_VERIFIED_NOT_ACTIVATED'&&upload.versionId===UPLOADED_VERSION&&upload.planDigest===digest&&upload.activationAuthorized===false,'UPLOAD_VERIFICATION_RECORD_REQUIRED');
  need(approval.approved===true&&approval.operation===plan.operation&&approval.planDigest===digest&&approval.sourceMappingUnverifiedAcknowledged===true,'UPLOAD_APPROVAL_RECORD_MISMATCH');
  need(plan.toolingSHA256===toolingSeal(),'UPLOAD_TOOLING_CHANGED');need(plan.configurationSHA256===sha(readFileSync(plan.workspace+'/wrangler.production.jsonc')),'SEALED_CONFIGURATION_CHANGED');
  const artifacts=buildArtifacts(plan.workspace);need(artifacts.artifactSHA256===plan.artifactSHA256&&sha(artifacts.manifest)===plan.manifestSHA256&&equal(createPayload(plan.baseline,artifacts.modules),plan.payload),'SEALED_ARTIFACT_CHANGED');
  const home=artifacts.modules.filter(m=>m.content_type==='application/javascript+module').map(m=>Buffer.from(m.content_base64,'base64').toString()).filter(s=>s.includes('const qualifiedTeams = standings.slice(0, ALL_STAR_SPOTS)'));
  need(home.length===1&&home[0].includes('const ALL_STAR_SPOTS = 10;')&&home[0].split('qualifiedTeams.includes(team)').length===3,'BUILT_QUALIFICATION_PATCH_MISSING');
  report.local={artifactSHA256:plan.artifactSHA256,artifactMatchesApproved:true,qualificationIncludedInBuiltArtifact:true,uploadWasDeployFalse:VERSION_PATH.endsWith('?deploy=false'),secretPinMatches:plan.payload.bindings.filter(b=>b.type==='inherit').length===1&&plan.payload.bindings.some(b=>b.type==='inherit'&&b.name==='ADMIN_DRAW_KEY'&&b.version_id===STABLE_VERSION),source:sourceReview(plan.workspace)};
  need(report.local.secretPinMatches,'SECRET_PIN_MISMATCH');
  need(!Object.keys(process.env).some(k=>['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED'].includes(k)||/^(HTTPS?|ALL)_PROXY$/i.test(k)),'PROCESS_OVERRIDE_REJECTED');
  let auth;try{auth=JSON.parse(execFileSync(process.execPath,[ROOT+'/node_modules/wrangler/bin/wrangler.js','auth','token','--json','--config',plan.workspace+'/wrangler.production.jsonc'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}}));}catch{throw Error('AUTHENTICATION_UNAVAILABLE');}
  need(['oauth','api_token'].includes(auth.type)&&typeof auth.token==='string','TOKEN_AUTHENTICATION_REQUIRED');
  const allowed=new Set([...METADATA_PATHS,MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules']);let requests=0;const deadline=Date.now()+240000;
  const get=async path=>{
   need(allowed.has(path)&&++requests<=24&&Date.now()<deadline,'READ_ONLY_ACTIVATION_REVIEW_SCOPE_REJECTED');let response;
   try{response=await fetch('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{Authorization:'Bearer '+auth.token},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE');}
   need(!response.redirected&&response.ok,'CLOUDFLARE_METADATA_HTTP_REJECTED');let data;try{data=await response.json();}catch{throw Error('INVALID_METADATA_RESPONSE');}need(data.success===true,'CLOUDFLARE_METADATA_API_REJECTED');
   if(path===METADATA_PATHS[0])need(data.result?.deployments?.length===1&&(!data.result_info||(data.result_info.page===undefined||data.result_info.page===1)&&(data.result_info.per_page===undefined||data.result_info.per_page===1)),'ACTIVE_DEPLOYMENT_PAGE_REJECTED');
   else need(!data.result_info||data.result_info.total_pages===undefined||Number.isInteger(data.result_info.total_pages)&&data.result_info.total_pages>=0&&data.result_info.total_pages<=1,'INCOMPLETE_REVIEW_METADATA');return data.result;
  };
  report.live=await liveActivationReview({get,baseline:plan.baseline,payload:plan.payload});
  const now=Date.now(),activation={format:'cfl-production-activation-plan-v1',operation:'production-version-activation',target:{account:ACCOUNT,worker:WORKER},versionId:UPLOADED_VERSION,uploadPlanDigest:digest,artifactSHA256:plan.artifactSHA256,baseline:plan.baseline,rollback:{versionId:STABLE_VERSION,available:true,automatic:false},action:{method:'POST',path:`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/deployments`,body:{strategy:'percentage',versions:[{version_id:UPLOADED_VERSION,percentage:100}]}},issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),nonce:randomUUID(),sourceMappingVerified:false,sourceReview:report.local.source,validation:report.live,reviewToolSHA256:sha(readFileSync(fileURLToPath(import.meta.url))),uploadToolingSHA256:plan.toolingSHA256,requirements:{separateExplicitDigestApproval:true,sourceMappingLimitationAcknowledgement:true,freshReadOnlyPreflightMaxAgeMs:300000,separateWriterUploadPause:true,singleUseClaim:true,retries:0,postActivationVerification:true}};
  const sealed={...activation,digest:sha(activation)};save('activation-plan.private.json',sealed);report.status='GO_FOR_ACTIVATION_APPROVAL';report.activationApprovalDigest=sealed.digest;report.expiresAt=sealed.expiresAt;
 }catch(error){const reason=formatReleaseFailure(error).split('\n')[0].replace('NO_GO: ','');report.blockers.push(reason);}
 save('report.json',report);console.log(JSON.stringify(report,null,2));console.log('Review directory: '+output);if(report.blockers.length)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)run().catch(error=>{console.error(formatReleaseFailure(error));process.exitCode=1;});
