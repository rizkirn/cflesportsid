import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {UAT,resolvePublicMode} from '../../src/data-access/public-mode.mjs';
const configPath=fileURLToPath(new URL('../../wrangler.uat.jsonc',import.meta.url));
const check=(ok,code)=>{if(!ok)throw Error(code);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity={CFL_PUBLIC_ENVIRONMENT:'uat',CFL_PUBLIC_HOSTNAME:UAT.hostname,CFL_PUBLIC_WORKER:UAT.worker,CFL_PUBLIC_DATABASE_ID:UAT.database};
export function validateUATConfig(config,path=configPath) {
  check(path===configPath&&!lstatSync(path).isSymbolicLink()&&realpathSync(path)===configPath,'EXPLICIT_UAT_CONFIG_REQUIRED');
  check(Object.keys(config).every(key=>['$schema','name','account_id','main','no_bundle','find_additional_modules','rules','compatibility_date','compatibility_flags','workers_dev','preview_urls','routes','assets','d1_databases','r2_buckets','keep_vars','vars'].includes(key)),'UAT_CONFIG_RESOURCES_REJECTED');
  check(config.name===UAT.worker&&config.account_id===UAT.account&&config.keep_vars===true,'UAT_CONFIG_IDENTITY_REQUIRED');
  check(!config.env&&!config.previews&&config.workers_dev===true&&config.preview_urls===false&&equal(config.routes,[]),'UAT_CONFIG_OVERRIDES_REJECTED');
  check(equal(config.d1_databases,[{binding:'DB',database_name:'cflesportsid-staging',database_id:UAT.database,migrations_dir:'migrations'}]),'UAT_DATABASE_REJECTED');
  check(equal(config.r2_buckets,[{binding:'CFL_ASSETS',bucket_name:'cflesportsid-assets-staging'}]),'UAT_R2_REJECTED');
  check(equal(config.assets,{binding:'ASSETS',directory:'dist/client'}),'UAT_ASSETS_REJECTED');
  for(const [key,value]of Object.entries(identity))check(config.vars?.[key]===value,'UAT_FLAGS_REJECTED');
  check(config.vars.CFL_PUBLIC_LOCAL===undefined&&['hybrid','shadow','d1'].includes(config.vars.CFL_PUBLIC_MODE),'UAT_MODE_REJECTED');
  check(Object.keys(config.vars).every(key=>key==='CFL_PUBLIC_MODE'||Object.hasOwn(identity,key)),'UAT_VARS_REJECTED');
  return config;
}
export function validateUATBindings(bindings,mode,{baseline=false}={}) {
  check(Array.isArray(bindings),'UAT_BINDINGS_MISSING');
  check(new Set(bindings.map(b=>b.name)).size===bindings.length,'UAT_BINDINGS_AMBIGUOUS');
  const d1=bindings.filter(b=>b.type==='d1');
  check(d1.length===1&&d1[0].name==='DB'&&(d1[0].id??d1[0].database_id)===UAT.database,'UAT_DATABASE_REJECTED');
  const r2=bindings.filter(b=>b.type==='r2_bucket');
  check(r2.length===1&&r2[0].name==='CFL_ASSETS'&&r2[0].bucket_name==='cflesportsid-assets-staging','UAT_R2_REJECTED');
  check(bindings.filter(b=>b.type==='assets').length===1&&bindings.some(b=>b.type==='assets'&&b.name==='ASSETS'),'UAT_ASSETS_REJECTED');
  const flags=Object.fromEntries(bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
  check(!baseline||mode==='hybrid','UAT_BASELINE_HYBRID_REQUIRED');
  check(['hybrid','shadow','d1'].includes(mode)&&(flags.CFL_PUBLIC_MODE===mode||baseline&&flags.CFL_PUBLIC_MODE===undefined),'UAT_MODE_REJECTED');
  for(const[key,value]of Object.entries(identity))check(flags[key]===value||baseline&&flags[key]===undefined,'UAT_FLAGS_REJECTED');
  check(!bindings.some(b=>b.name==='CFL_PUBLIC_LOCAL'),'UAT_FLAGS_REJECTED');
  resolvePublicMode(flags,false,new URL('https://'+UAT.hostname));
  const auth=bindings.filter(b=>b.name.startsWith('ADMIN_')).map(b=>({name:b.name,type:b.type,...(b.type==='plain_text'?{text:b.text}:{})})).sort((a,b)=>a.name.localeCompare(b.name));
  return {authenticationFingerprint:createHash('sha256').update(JSON.stringify(auth)).digest('hex'),authenticationBindingCount:auth.length};
}
export async function validateRemoteUAT({token,mode,baseline=false,fetcher=fetch}) {
  check(typeof token==='string'&&token.length>0,'AUTH_REQUIRED');
  check(['hybrid','shadow','d1'].includes(mode),'UAT_MODE_REJECTED');
  check(!baseline||mode==='hybrid','UAT_BASELINE_HYBRID_REQUIRED');
  const worker='/workers/scripts/'+UAT.worker;
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  async function get(path){
    check(['','/d1/database/'+UAT.database,worker+'/settings',worker+'/script-settings',worker+'/deployments',worker+'/versions'].includes(path)||new RegExp('^'+worker+'/versions/[a-f0-9-]{36}$').test(path),'READ_ONLY_UAT_ENDPOINT_REQUIRED');
    const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+UAT.account+path,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
    check(response.ok,'UAT_HTTP_'+response.status);const body=await response.json();check(body.success===true,'UAT_API_FAILURE');return body.result;
  }
  async function activeDeployment(){
    const deployment=(await get(worker+'/deployments'))?.deployments?.[0];
    check(uuid.test(deployment?.id??'')&&deployment?.versions?.length===1&&deployment.versions[0].percentage===100&&uuid.test(deployment.versions[0].version_id??''),'UAT_DEPLOYMENT_AMBIGUOUS');
    return {id:deployment.id,versionId:deployment.versions[0].version_id,percentage:deployment.versions[0].percentage};
  }
  function configuration(bindings,expectedMode){
    const observedMode=Array.isArray(bindings)?bindings.find(binding=>binding.name==='CFL_PUBLIC_MODE'&&binding.type==='plain_text')?.text:undefined;
    const readerMode=expectedMode??observedMode??(baseline?'hybrid':undefined);
    return {mode:readerMode,...validateUATBindings(bindings,readerMode,{baseline})};
  }
  check((await get(''))?.id===UAT.account,'UAT_ACCOUNT_REJECTED');
  const db=await get('/d1/database/'+UAT.database);check(db?.uuid===UAT.database&&db.name==='cflesportsid-staging','UAT_DATABASE_REJECTED');
  const deployment=await activeDeployment();
  const version=await get(worker+'/versions/'+deployment.versionId);check(version?.id===deployment.versionId,'UAT_VERSION_REJECTED');
  const active=configuration(version.resources?.bindings,mode);
  const versions=await get(worker+'/versions');
  const latestId=versions?.items?.[0]?.id;check(uuid.test(latestId??''),'UAT_LATEST_VERSION_AMBIGUOUS');
  const latest=latestId===deployment.versionId?version:await get(worker+'/versions/'+latestId);check(latest?.id===latestId,'UAT_VERSION_REJECTED');
  const latestConfiguration=configuration(latest.resources?.bindings);
  const settings=await get(worker+'/settings');const combinedConfiguration=configuration(settings?.bindings);
  const authentication=configuration=>({authenticationFingerprint:configuration.authenticationFingerprint,authenticationBindingCount:configuration.authenticationBindingCount});
  check(equal(authentication(active),authentication(latestConfiguration))&&equal(authentication(active),authentication(combinedConfiguration)),'UAT_AUTH_BINDINGS_INCONSISTENT');
  check(latestConfiguration.mode===combinedConfiguration.mode,'UAT_LATEST_SETTINGS_INCONSISTENT');
  const settingsScope=await get(worker+'/script-settings');check(settingsScope&&typeof settingsScope==='object'&&!Array.isArray(settingsScope),'UAT_SCRIPT_SETTINGS_MISSING');
  check(settingsScope.tail_consumers==null||Array.isArray(settingsScope.tail_consumers),'UAT_SCRIPT_SETTINGS_INVALID');
  const workerSettings={fingerprint:createHash('sha256').update(JSON.stringify(settingsScope)).digest('hex'),
    ...(typeof settingsScope.logpush==='boolean'?{logpush:settingsScope.logpush}:{}),
    ...(typeof settingsScope.observability?.enabled==='boolean'?{observabilityEnabled:settingsScope.observability.enabled}:{}),
    tailConsumerCount:settingsScope.tail_consumers?.length??0};
  check(equal(deployment,await activeDeployment()),'UAT_DEPLOYMENT_CHANGED');
  return {status:'PASS',mode:active.mode,target:UAT,versionId:deployment.versionId,deploymentId:deployment.id,...authentication(active),
    activeVersion:{versionId:deployment.versionId,...active},latestUploadedVersion:{versionId:latestId,...latestConfiguration},
    combinedSettings:combinedConfiguration,workerSettings,configurationScopesDiffer:deployment.versionId!==latestId||active.mode!==latestConfiguration.mode,remoteWrites:0};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [command,flag,path,modeFlag,mode]=process.argv.slice(2);
    check(['check-config','remote','baseline'].includes(command)&&flag==='--config'&&path===configPath,'EXPLICIT_UAT_CONFIG_REQUIRED');
    const config=validateUATConfig(JSON.parse(readFileSync(path,'utf8')),path);
    if(command==='check-config'){check(modeFlag===undefined,'ARGUMENT_REJECTED');console.log(JSON.stringify({status:'PASS',mode:config.vars.CFL_PUBLIC_MODE,remoteAccess:false}));}
    else {check(modeFlag==='--expect-mode'&&process.argv.length===7,'ARGUMENT_REJECTED');for(const[key,value]of Object.entries(process.env))if(value!==undefined&&/^(CLOUDFLARE_|CF_|WRANGLER_|CFL_|VITE_|ASTRO_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$|NODE_TLS_REJECT_UNAUTHORIZED$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key))check(key==='CLOUDFLARE_API_TOKEN','ENVIRONMENT_OVERRIDE_REJECTED');const {credential}=await import('../phase2b/api.mjs');console.log(JSON.stringify(await validateRemoteUAT({token:credential(),mode,baseline:command==='baseline'})));}
  } catch(error){console.error(JSON.stringify({status:'BLOCKED',code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'UAT_VALIDATION_FAILED'}));process.exitCode=1;}
}

export function rejectEnvironmentOverrides(env=process.env){
 for(const [key,value]of Object.entries(env))if(value!==undefined&&/^(CLOUDFLARE_|CF_|WRANGLER_|CFL_|VITE_|ASTRO_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$|NODE_TLS_REJECT_UNAUTHORIZED$|HTTPS?_PROXY$|ALL_PROXY$)/i.test(key))check(key==='CLOUDFLARE_API_TOKEN','ENVIRONMENT_OVERRIDE_REJECTED');
}
