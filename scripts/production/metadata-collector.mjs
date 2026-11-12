import {createHash} from 'node:crypto';
import {PRODUCTION, PRODUCTION_ZONE} from './metadata-helpers.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
const safeCodes=new Set([
 'EXPECTED_VERSION_REQUIRED','INVALID_METADATA_LIMITS','READ_ONLY_CAPTURE_SCOPE_REJECTED',
 'CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE','INVALID_METADATA_RESPONSE','METADATA_HTTP_FAILED',
 'METADATA_PAGINATION_INCOMPLETE','METADATA_PAGINATION_INVALID','SECRET_VALUE_PRESENT_IN_METADATA',
 'ACTIVE_VERSION_OR_TRAFFIC_CHANGED','ACTIVE_VERSION_RESPONSE_MISMATCH','VERSION_RESPONSE_MISMATCH',
 'LATEST_UPLOADED_VERSION_REQUIRED','LATEST_VERSION_RESPONSE_MISMATCH','LATEST_VERSION_CHANGED_DURING_CAPTURE',
 'PRODUCTION_METADATA_CHANGED_DURING_CAPTURE','DEPLOYMENT_CHANGED_DURING_CAPTURE',
 'CURRENT_SETTINGS_CHANGED_DURING_CAPTURE','ACTIVE_METADATA_CHANGED_DURING_CAPTURE',
 'ROUTING_OR_ASSETS_CHANGED_DURING_CAPTURE','LATEST_UPLOAD_CHANGED_DURING_CAPTURE',
 'AUTHENTICATION_UNAVAILABLE','AUTHENTICATION_UNAVAILABLE_NO_CREDENTIALS_PRINTED',
 'TOKEN_AUTHENTICATION_REQUIRED','RELEASE_TARGET_MISMATCH','PRIVATE_ISOLATED_WORKSPACE_REQUIRED',
 'CONFIGURATION_SYMLINK_REJECTED','RECOVERY_CONFIGURATION_CHANGED','RECOVERY_CONFIGURATION_PATH_REJECTED',
]);

export function sanitizedMetadataError(error) {
 return safeCodes.has(error?.message)?error.message:'LOCAL_METADATA_VALIDATION_FAILED';
}

function rejectSecretValues(value) {
 if(!value||typeof value!=='object')return;
 if(value.type==='secret_text')need(Object.keys(value).every(k=>k==='name'||k==='type'),'SECRET_VALUE_PRESENT_IN_METADATA');
 for(const child of Object.values(value))rejectSecretValues(child);
}

export function requireCompleteMetadata(body) {
 const result=body?.result;
 for(const info of [body?.result_info,result?.result_info,result?.pagination]) {
  if(info===undefined)continue;
  need(info&&typeof info==='object'&&!Array.isArray(info),'METADATA_PAGINATION_INVALID');
  for(const key of ['page','total_pages','count','total_count','per_page'])if(info[key]!==undefined)
   need(Number.isSafeInteger(info[key])&&info[key]>=0&&(key!=='page'||info[key]>=1),'METADATA_PAGINATION_INVALID');
  need((info.page??1)===1&&(info.total_pages??1)<=1,'METADATA_PAGINATION_INCOMPLETE');
  const rows=Array.isArray(result)?result:result?.items??result?.deployments;
  if(info.total_count!==undefined)need(Array.isArray(rows)&&info.total_count===rows.length,'METADATA_PAGINATION_INCOMPLETE');
  if(info.count!==undefined&&Array.isArray(rows))need(info.count===rows.length,'METADATA_PAGINATION_INVALID');
  need(!info.cursor&&!info.next_cursor&&!info.next_page&&!info.next&&!info.has_more&&!info.cursors?.after,'METADATA_PAGINATION_INCOMPLETE');
 }
 need(!body?.next_cursor&&!result?.next_cursor&&!result?.cursor&&!result?.cursors?.after&&!result?.has_more&&!result?.next_page,'METADATA_PAGINATION_INCOMPLETE');
 rejectSecretValues(result);
 return result;
}

export function createMetadataTransport({fetcher,token,expectedVersion,maxRequests=18,durationMs=240000,timeoutMs=15000,now=Date.now}) {
 need(typeof fetcher==='function'&&typeof token==='string'&&token.length>0,'TOKEN_AUTHENTICATION_REQUIRED');
 need(uuid.test(expectedVersion??''),'EXPECTED_VERSION_REQUIRED');
 need(Number.isInteger(maxRequests)&&maxRequests>=1&&maxRequests<=20&&Number.isInteger(durationMs)&&durationMs>0&&durationMs<=240000&&Number.isInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=15000,'INVALID_METADATA_LIMITS');
 const base=`/accounts/${PRODUCTION.account}`,worker=`${base}/workers/scripts/${PRODUCTION.worker}`;
 const allowed=new Set([worker+'/deployments',worker+'/versions',worker+'/settings',worker+'/script-settings',worker+'/subdomain',base+'/workers/domains',`/zones/${PRODUCTION_ZONE}/workers/routes`]);
 const versions=new Set([expectedVersion]);let requests=0;const started=now();
 return async path=>{
  const id=path.startsWith(worker+'/versions/')?path.slice((worker+'/versions/').length):null;
  need((allowed.has(path)||(uuid.test(id??'')&&versions.has(id)))&&requests<maxRequests&&now()-started<durationMs,'READ_ONLY_CAPTURE_SCOPE_REJECTED');
  requests++;
  let response;
  try{response=await fetcher('https://api.cloudflare.com/client/v4'+path,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(Math.min(timeoutMs,Math.max(1,durationMs-(now()-started))))});}
  catch{throw Error('CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE');}
  need(response&&!response.redirected,'INVALID_METADATA_RESPONSE');
  let body;try{body=await response.json();}catch{throw Error('INVALID_METADATA_RESPONSE');}
  need(response.ok&&body?.success===true,'METADATA_HTTP_FAILED');
  need(now()-started<durationMs,'READ_ONLY_CAPTURE_SCOPE_REJECTED');
  const result=requireCompleteMetadata(body);
  if(path===worker+'/versions'){
   const latest=result?.items?.[0]?.id;need(uuid.test(latest??''),'LATEST_UPLOADED_VERSION_REQUIRED');versions.add(latest);
  }
  return result;
 };
}

export async function collectWorkerMetadata({get,expectedVersion,includeLatest=false,maxRequests=18,now=Date.now,validate,frontendDiagnostics=false}) {
 need(uuid.test(expectedVersion??''),'EXPECTED_VERSION_REQUIRED');
 need(typeof get==='function'&&Number.isInteger(maxRequests)&&maxRequests>0&&maxRequests<=20,'INVALID_METADATA_LIMITS');
 const started=now();let requests=0;
 const read=async path=>{
  need(requests++<maxRequests&&now()-started<240000,'READ_ONLY_CAPTURE_SCOPE_REJECTED');
  let value;try{value=await get(path);}catch(error){throw Error(sanitizedMetadataError(error));}
  need(now()-started<240000,'READ_ONLY_CAPTURE_SCOPE_REJECTED');
  rejectSecretValues(value);return value;
 };
 const base=`/accounts/${PRODUCTION.account}`,worker=`${base}/workers/scripts/${PRODUCTION.worker}`;
 const paths=[worker+'/deployments',worker+'/versions/'+expectedVersion,worker+'/settings',worker+'/script-settings',base+'/workers/domains',`/zones/${PRODUCTION_ZONE}/workers/routes`,worker+'/subdomain'];
 if(includeLatest)paths.push(worker+'/versions');
 const snapshots=[];for(const path of paths)snapshots.push(await read(path));
 const [deployments,version,currentSettings,scriptSettings,domains,routes,subdomain,versions]=snapshots;
 const active=deployments?.deployments?.[0];
 need(active?.id&&active.versions?.length===1&&active.versions[0].version_id===expectedVersion&&active.versions[0].percentage===100,'ACTIVE_VERSION_OR_TRAFFIC_CHANGED');
 need(version?.id===expectedVersion,frontendDiagnostics?'VERSION_RESPONSE_MISMATCH':'ACTIVE_VERSION_RESPONSE_MISMATCH');
 let latestVersion;
 if(includeLatest){
  const latestId=versions?.items?.[0]?.id;need(uuid.test(latestId??''),'LATEST_UPLOADED_VERSION_REQUIRED');
  latestVersion=latestId===expectedVersion?version:await read(worker+'/versions/'+latestId);
  need(latestVersion?.id===latestId,'LATEST_VERSION_RESPONSE_MISMATCH');
 }
 const capture={deploymentId:active.id,version,currentSettings,latestVersion,scriptSettings,domains,routes,subdomain,checkedAt:new Date(now()).toISOString()};
 const validation=validate?await validate(capture):undefined;
 const codes=['DEPLOYMENT_CHANGED_DURING_CAPTURE','ACTIVE_METADATA_CHANGED_DURING_CAPTURE','CURRENT_SETTINGS_CHANGED_DURING_CAPTURE',...Array(4).fill('ROUTING_OR_ASSETS_CHANGED_DURING_CAPTURE'),'LATEST_UPLOAD_CHANGED_DURING_CAPTURE'];
 for(let i=0;i<paths.length;i++)need(hash(await read(paths[i]))===hash(snapshots[i]),frontendDiagnostics?codes[i]:'PRODUCTION_METADATA_CHANGED_DURING_CAPTURE');
 if(latestVersion&&latestVersion.id!==expectedVersion)need(hash(await read(worker+'/versions/'+latestVersion.id))===hash(latestVersion),'LATEST_VERSION_CHANGED_DURING_CAPTURE');
 return {...capture,validation};
}
