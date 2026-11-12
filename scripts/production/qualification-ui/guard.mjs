import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
export const STABLE_VERSION='2767f1cb-5070-4012-a6bc-95afe06dfc3f';
export const ACCOUNT='bf6ed4ccd73133871881b47ea58dae3d';
export const WORKER='cflesportsid';
export const BASE=`/accounts/${ACCOUNT}`;
export const SCRIPT=`${BASE}/workers/scripts/${WORKER}`;
export const MODERN=`${BASE}/workers/workers/${WORKER}`;
export const VERSION_PATH=MODERN+'/versions?deploy=false';
export const ACTIVE_DEPLOYMENT_PATH=SCRIPT+'/deployments?page=1&per_page=1';
export const METADATA_PATHS=[ACTIVE_DEPLOYMENT_PATH,MODERN+'/versions/'+STABLE_VERSION,BASE+'/workers/domains','/zones/c8fed6ca36bcc7f2a22cd1b6aa713091/workers/routes',SCRIPT+'/subdomain'];
export const ASSET_CONFIG={base_path:'/',html_handling:'auto-trailing-slash',not_found_handling:'none',run_worker_first:false};
export const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export function requireRelease(condition,code){if(!condition)throw Error(code);}
export function validatePinnedPayload(payload,expected) {
 requireRelease(isDeepStrictEqual(payload,expected),'SEALED_PAYLOAD_CHANGED');
 requireRelease(Object.keys(payload).every(k=>['bindings','assets','modules','main_module','compatibility_date','compatibility_flags','limits','placement','usage_model','cache_options','exports'].includes(k)),'UNREVIEWED_UPLOAD_FIELD');
 requireRelease(Array.isArray(payload.bindings),'BINDINGS_REQUIRED');
 requireRelease(new Set(payload.bindings.map(b=>b.name)).size===payload.bindings.length,'DUPLICATE_BINDING');
 const inherited=payload.bindings.filter(b=>b.type==='inherit');
 requireRelease(inherited.length===1&&inherited[0].name==='ADMIN_DRAW_KEY','EXACT_SECRET_SET_REQUIRED');
 requireRelease(inherited[0].version_id===STABLE_VERSION&&Object.keys(inherited[0]).sort().join(',')==='name,type,version_id','SECRET_SOURCE_NOT_PINNED');
 requireRelease(payload.bindings.every(b=>['plain_text','d1','r2_bucket','assets','inherit'].includes(b.type)),'UNSUPPORTED_BINDING');
 requireRelease(payload.bindings.filter(b=>b.type==='d1').length===1&&payload.bindings.some(b=>b.type==='d1'&&b.name==='DB'&&b.id==='efded3c4-1cf9-46a9-823e-d0f2d17c683a'),'PRODUCTION_DATABASE_MISMATCH');
 requireRelease(payload.bindings.filter(b=>b.type==='r2_bucket').length===1&&payload.bindings.some(b=>b.type==='r2_bucket'&&b.name==='CFL_ASSETS'&&b.bucket_name==='cflesportsid-assets-production'),'PRODUCTION_R2_MISMATCH');
 requireRelease(payload.bindings.filter(b=>b.type==='assets').length===1&&payload.bindings.some(b=>b.type==='assets'&&b.name==='ASSETS'),'PRODUCTION_ASSETS_MISMATCH');
 requireRelease(isDeepStrictEqual(payload.assets?.config,ASSET_CONFIG),'ACTIVE_ASSET_CONFIGURATION_MISMATCH');
 requireRelease(typeof payload.main_module==='string'&&Array.isArray(payload.modules)&&payload.modules.some(m=>m.name===payload.main_module),'ARTIFACT_MODULES_REQUIRED');
}
export function validatePinnedApproval(plan,approval,pause,now=Date.now()) {
 const {digest,...body}=plan;
 requireRelease(digest===sha(body)&&plan.format==='cfl-pinned-release-v1'&&plan.operation==='production-pinned-version-upload','RELEASE_PLAN_INVALID');
 requireRelease(plan.baseline.versionId===STABLE_VERSION&&plan.target.account===ACCOUNT&&plan.target.worker===WORKER,'RELEASE_TARGET_INVALID');
 requireRelease(plan.readiness==='READY_FOR_OWNER_REVIEW'&&Date.parse(plan.issuedAt)<=now&&now<Date.parse(plan.expiresAt)&&Date.parse(plan.expiresAt)-Date.parse(plan.issuedAt)<=1800000,'RELEASE_PLAN_EXPIRED');
 requireRelease(approval?.approved===true&&approval.operation===plan.operation&&approval.planDigest===digest&&isDeepStrictEqual(approval.target,plan.target),'RELEASE_DIGEST_APPROVAL_REQUIRED');
 requireRelease(approval.sourceMappingUnverifiedAcknowledged===true,'SOURCE_MAPPING_REVIEW_REQUIRED');
 requireRelease(typeof approval.approvedBy==='string'&&approval.approvedBy.trim()&&typeof approval.id==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(approval.id),'APPROVAL_IDENTITY_REQUIRED');
 requireRelease(Date.parse(approval.issuedAt)<=now&&now<Date.parse(approval.expiresAt)&&Date.parse(approval.expiresAt)<=Date.parse(plan.expiresAt)&&Date.parse(approval.expiresAt)-Date.parse(approval.issuedAt)<=1800000,'APPROVAL_EXPIRED');
 requireRelease(pause?.confirmed===true&&pause.planDigest===digest&&typeof pause.confirmedBy==='string'&&pause.confirmedBy.trim()&&Date.parse(pause.confirmedAt)<=now&&now-Date.parse(pause.confirmedAt)<300000,'FRESH_WRITER_UPLOAD_PAUSE_REQUIRED');
}
export function createPinnedTransport({token,fetcher=fetch,checkApproval,expectedPayload,manifest={},assetFiles=new Map(),now=Date.now}) {
 let failed=false,created=false,session=false,count=0,sessionToken,completionToken,uploadedId;
 const start=now(),pending=new Set(),gets=new Set([...METADATA_PATHS,MODERN+'/versions/'+STABLE_VERSION+'?include=modules']);
 async function request(method,path,body,assetToken) {
  requireRelease(!failed,'TRANSPORT_STOPPED_NO_RETRY');
  try {
   checkApproval();requireRelease(now()-start<240000&&++count<=160,'TRANSPORT_LIMIT_EXCEEDED');
   let encoded,headers={Authorization:'Bearer '+(assetToken??token)};
   const completing=[];
   if(method==='GET')requireRelease(gets.has(path)&&!body&&!assetToken,'GET_SCOPE_REJECTED');
   else if(method==='POST'&&path===SCRIPT+'/assets-upload-session'){
    requireRelease(!session&&!created&&!assetToken&&isDeepStrictEqual(body,{manifest}),'ASSET_SESSION_REJECTED');session=true;encoded=JSON.stringify(body);headers['Content-Type']='application/json';
   }else if(method==='POST'&&path===BASE+'/workers/assets/upload?base64=true'){
    requireRelease(session&&!created&&body instanceof FormData&&assetToken===sessionToken,'ASSET_UPLOAD_SCOPE_REJECTED');
    for(const [hash,file]of body.entries()){
     requireRelease(pending.has(hash)&&!completing.includes(hash)&&assetFiles.has(hash)&&typeof file.arrayBuffer==='function','UNAPPROVED_ASSET');
     requireRelease(file.type===assetFiles.get(hash).contentType&&Buffer.from(await file.arrayBuffer()).toString()===assetFiles.get(hash).bytes.toString('base64'),'ASSET_BYTES_CHANGED');completing.push(hash);
    }
    requireRelease(completing.length>0,'EMPTY_ASSET_UPLOAD');encoded=body;
   }else if(method==='POST'&&new RegExp('^'+BASE+'/workers/assets/upload/[a-f0-9]{32}$').test(path)){
    const hash=path.split('/').at(-1),file=assetFiles.get(hash);
    requireRelease(session&&!created&&pending.has(hash)&&file&&assetToken===sessionToken&&body?.contentType===file.contentType&&Buffer.isBuffer(body?.bytes)&&body.bytes.equals(file.bytes),'ASSET_UPLOAD_SCOPE_REJECTED');
    completing.push(hash);encoded=body.bytes;headers['Content-Type']=body.contentType;
   }else if(method==='POST'&&path===VERSION_PATH){
    requireRelease(!created&&session&&pending.size===0&&!assetToken,'VERSION_UPLOAD_REPLAY_OR_ASSETS_PENDING');
    const {assets,...rest}=body??{};
    validatePinnedPayload({...rest,assets:{config:assets?.config}},expectedPayload);
    requireRelease(typeof completionToken==='string'&&assets.jwt===completionToken,'ASSET_COMPLETION_TOKEN_REQUIRED');
    created=true;encoded=JSON.stringify(body);headers['Content-Type']='application/json';
   }else throw Error('ENDPOINT_OR_DEPLOY_FLAG_REJECTED');
   let response;try{response=await fetcher('https://api.cloudflare.com/client/v4'+path,{method,headers,body:encoded,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE');}
   requireRelease(!response.redirected&&response.status>=200&&response.status<300,'CLOUDFLARE_HTTP_REJECTED');
   let result;try{result=await response.json();}catch{throw Error('INVALID_API_RESPONSE');}
   requireRelease(result.success===true,'CLOUDFLARE_API_REJECTED');
   const info=result.result_info;
   if(path===ACTIVE_DEPLOYMENT_PATH){
    requireRelease(Array.isArray(result.result?.deployments)&&result.result.deployments.length===1,'ACTIVE_DEPLOYMENT_RESPONSE_REJECTED');
    if(info)requireRelease((info.page===undefined||info.page===1)&&(info.per_page===undefined||info.per_page===1),'ACTIVE_DEPLOYMENT_PAGE_REJECTED');
   }else{
    const category=path===BASE+'/workers/domains'?'DOMAINS':path.includes('/workers/routes')?'ROUTES':'OTHER';
    requireRelease(!info||info.total_pages===undefined||(Number.isInteger(info.total_pages)&&info.total_pages>=0&&info.total_pages<=1),'PAGINATED_'+category+'_METADATA_REQUIRES_REVIEW');
   }
   const value=result.result;
   if(path===SCRIPT+'/assets-upload-session'){
    requireRelease(typeof value?.jwt==='string'&&Array.isArray(value.buckets)&&value.buckets.every(Array.isArray),'INVALID_ASSET_SESSION');
    sessionToken=value.jwt;
    for(const hash of value.buckets.flat()){requireRelease(assetFiles.has(hash)&&!pending.has(hash),'UNKNOWN_OR_DUPLICATE_ASSET_REQUEST');pending.add(hash);}
    if(!pending.size)completionToken=value.jwt;
   }else if(completing.length){for(const hash of completing)pending.delete(hash);if(typeof value?.jwt==='string')completionToken=value.jwt;}
   else if(path===VERSION_PATH){
    requireRelease(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value?.id??'')&&value.id!==STABLE_VERSION,'UPLOAD_VERSION_ID_REQUIRED');
    uploadedId=value.id;gets.add(MODERN+'/versions/'+uploadedId);gets.add(MODERN+'/versions/'+uploadedId+'?include=modules');
   }
   return value;
  }catch(error){failed=true;throw error;}
 }
 return {request};
}
