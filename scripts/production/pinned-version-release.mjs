import {readFileSync,readdirSync,lstatSync,realpathSync,writeFileSync,mkdtempSync,chmodSync,openSync,closeSync} from 'node:fs';
import {resolve,dirname,extname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createRequire} from 'node:module';
import {inspectProductionBindings} from '../phase2c/production-preflight.mjs';
import {ACCOUNT,WORKER,BASE,SCRIPT,MODERN,STABLE_VERSION,VERSION_PATH,METADATA_PATHS,ASSET_CONFIG,sha,requireRelease as need,validatePinnedPayload,validatePinnedApproval,createPinnedTransport} from './pinned-version-guard.mjs';
const require=createRequire(import.meta.url),blake3=require('blake3-wasm'),mime=require('mrmime');
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const runtimeKeys=['compatibility_date','compatibility_flags','limits','placement','usage_model','cache_options','exports'];
const metadataKeys=['id','created_on','number','urls','annotations','assets','author_email','author_id','bindings','main_module','modules','source','startup_time_ms','package_dependencies','migration_tag','migrations','exports','durable_objects','containers','exports_reconciliation'];
const clone=v=>JSON.parse(JSON.stringify(v));
const sortBindings=bindings=>bindings.toSorted((a,b)=>a.name.localeCompare(b.name));
function privatePath(path,directory=false){
 const st=lstatSync(path);
 need(!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&(directory?st.isDirectory():st.isFile()),'OWNER_ONLY_PATH_REQUIRED');
 need(realpathSync(path)===resolve(path),'CANONICAL_PATH_REQUIRED');return path;
}
function files(root){
 need(!lstatSync(root).isSymbolicLink(),'ARTIFACT_SYMLINK_REJECTED');const result=[];
 for(const name of readdirSync(root).sort()){
  const path=root+'/'+name,st=lstatSync(path);need(!st.isSymbolicLink(),'ARTIFACT_SYMLINK_REJECTED');
  if(st.isDirectory())result.push(...files(path));else {need(st.isFile(),'NONREGULAR_ARTIFACT_REJECTED');result.push(path);}
 }
 return result;
}
export function buildArtifacts(workspace){
 const server=workspace+'/dist/server',client=workspace+'/dist/client',modules=[],manifest={},assetFiles=new Map(),inventory=[];
 for(const path of files(workspace+'/dist'))inventory.push([relative(workspace,path),sha(readFileSync(path))]);
 for(const path of files(server)){
  const name=relative(server,path);if(name==='wrangler.json')continue;
  const type={'.mjs':'application/javascript+module','.js':'application/javascript+module','.wasm':'application/wasm'}[extname(name)];
  need(type,'UNREVIEWED_SERVER_ARTIFACT');modules.push({name,content_type:type,content_base64:readFileSync(path).toString('base64')});
 }
 const ignore=readFileSync(client+'/.assetsignore','utf8').split(/\r?\n/).filter(Boolean);
 need(equal(ignore,['wrangler.json','.dev.vars']),'UNREVIEWED_ASSET_IGNORE_RULES');
 for(const path of files(client)){
  const name=relative(client,path),bytes=readFileSync(path);
  if(name==='_headers'||name==='_redirects'){modules.push({name,content_type:'text/plain',content_base64:bytes.toString('base64')});continue;}
  if(name==='.assetsignore'||ignore.includes(name))continue;
  need(!name.split('/').some(p=>p.startsWith('.')),'UNREVIEWED_HIDDEN_ASSET');
  need(bytes.length<=25*1024*1024,'ASSET_TOO_LARGE');
  const hash=blake3.hash(bytes.toString('base64')+extname(name).slice(1)).toString('hex').slice(0,32),contentType=mime.lookup(name)||'application/null';
  manifest['/'+name]={hash,size:bytes.length};
  if(assetFiles.has(hash))need(assetFiles.get(hash).bytes.equals(bytes)&&assetFiles.get(hash).contentType===contentType,'ASSET_HASH_COLLISION');
  assetFiles.set(hash,{bytes,contentType});
 }
 need(Object.keys(manifest).length>0&&Object.keys(manifest).length<=20000,'ASSET_COUNT_REJECTED');
 return {modules,manifest,assetFiles,artifactSHA256:sha(inventory)};
}
function safeFieldName(name){return typeof name==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(name)?name:'<redacted-field-name>';}
export function describeUnreviewedEnv(value){
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 const result={type,isProductionString:value==='production',isWorkerName:value===WORKER,valuesIncluded:false};
 if(type==='object'){
  const keys=Object.keys(value);result.fieldCount=keys.length;result.fieldNames=keys.slice(0,100).map(k=>/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(k)?k:'<redacted-field-name>').sort();
  result.identityChecks={};
  for(const key of ['name','environment','service','worker','worker_id','account_id','version_id'])if(Object.hasOwn(value,key))result.identityChecks[key]={isProduction:value[key]==='production',isWorker:value[key]===WORKER,isAccount:value[key]===ACCOUNT,isStableVersion:value[key]===STABLE_VERSION};
 }else if(type==='array')result.itemCount=value.length;
 return result;
}
export function validateEnvProjection(env,bindings){
 const object=env!==null&&typeof env==='object'&&!Array.isArray(env);
 const namesMatch=object&&equal(Object.keys(env).sort(),bindings.map(b=>b.name).sort());
 const checks=bindings.map(binding=>{
  const present=object&&Object.hasOwn(env,binding.name),value=present?env[binding.name]:undefined;
  let matches=false;
  if(present&&binding.type==='plain_text'&&typeof value==='string')matches=value===binding.text;
  if(present&&value!==null&&typeof value==='object'&&!Array.isArray(value)){
   let candidate=Object.hasOwn(value,'name')?{...value}:{name:binding.name,...value};
   if(candidate.type==='d1'&&(!candidate.id||!candidate.database_id||candidate.id===candidate.database_id)){
    const {id,database_id,...rest}=candidate;candidate={...rest,id:id??database_id};
   }
   matches=equal(candidate,binding);
  }
  const shape=describeUnreviewedEnv(value);
  return {bindingName:/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(binding.name)?binding.name:'<redacted-field-name>',bindingType:['plain_text','d1','r2_bucket','assets','secret_text'].includes(binding.type)?binding.type:'<unknown>',present,matches,valueType:shape.type,...(shape.fieldNames?{fieldNames:shape.fieldNames}:{})};
 });
 if(!namesMatch||!checks.every(c=>c.matches)){
  const error=new Error('ENV_BINDING_PROJECTION_UNVERIFIED');
  error.envDiagnostics={envShape:describeUnreviewedEnv(env),bindingNamesMatch:namesMatch,projectionChecks:checks,valuesIncluded:false};throw error;
 }
}
export function formatReleaseFailure(error){
 const reason=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'LOCAL_RELEASE_OPERATION_FAILED';
 const lines=['NO_GO: '+reason];
 if(reason==='UNREVIEWED_ACTIVE_VERSION_FIELD'&&Array.isArray(error.unreviewedFieldNames))lines.push(JSON.stringify({unreviewedFieldNames:error.unreviewedFieldNames.slice(0,100).map(safeFieldName),valuesIncluded:false}));
 if(['UNREVIEWED_ACTIVE_VERSION_FIELD','ENV_BINDING_PROJECTION_UNVERIFIED'].includes(reason)&&error.envDiagnostics)lines.push(JSON.stringify(error.envDiagnostics));
 return lines.join('\n');
}
export function activeConfiguration(version){
 need(version?.id===STABLE_VERSION,'ACTIVE_VERSION_MISMATCH');
 const unreviewed=Object.keys(version).filter(k=>![...runtimeKeys,...metadataKeys,'env'].includes(k));
 if(unreviewed.length){
  const error=new Error('UNREVIEWED_ACTIVE_VERSION_FIELD');
  error.unreviewedFieldNames=unreviewed.map(safeFieldName).sort();
  if(Object.hasOwn(version,'env'))error.envDiagnostics={envShape:describeUnreviewedEnv(version.env)};
  throw error;
 }
 for(const key of ['migrations','durable_objects','containers'])need(version[key]==null||Object.keys(version[key]).length===0,'UNREVIEWED_ACTIVE_VERSION_FEATURE');
 need(!version.migration_tag,'UNREVIEWED_ACTIVE_MIGRATION');
 if(version.exports!=null)need(Object.values(version.exports).every(e=>e.type==='worker'&&(!e.state||e.state==='created')&&Object.keys(e).every(k=>['type','cache','state'].includes(k))&&(!e.cache||Object.keys(e.cache).every(k=>k==='enabled')&&typeof e.cache.enabled==='boolean')),'UNREVIEWED_ACTIVE_EXPORT');
 need(Array.isArray(version.bindings),'ACTIVE_BINDINGS_REQUIRED');
 const bindings=version.bindings.map(binding=>{
  const allowed={plain_text:['name','type','text'],secret_text:['name','type'],d1:['name','type','id','database_id'],r2_bucket:['name','type','bucket_name'],assets:['name','type']}[binding.type];
  need(allowed&&Object.keys(binding).every(k=>allowed.includes(k)),'UNKNOWN_ACTIVE_BINDING_FIELD_OR_TYPE');
  if(binding.type==='d1'){
   need(!binding.id||!binding.database_id||binding.id===binding.database_id,'AMBIGUOUS_DATABASE_ID');
   return {name:binding.name,type:'d1',id:binding.id??binding.database_id};
  }
  if(binding.type==='plain_text')need(typeof binding.text==='string','ACTIVE_VARIABLE_VALUE_UNAVAILABLE');
  return clone(binding);
 });
 if(Object.hasOwn(version,'env'))validateEnvProjection(version.env,bindings);
 const state=inspectProductionBindings(bindings);need(state.mode==='d1','VERIFIED_D1_BASELINE_REQUIRED');
 need(bindings.some(b=>b.name==='ADMIN_ENABLED'&&b.type==='plain_text'&&b.text==='true')&&bindings.some(b=>b.name==='ADMIN_ENVIRONMENT'&&b.text==='production')&&bindings.some(b=>b.name==='ADMIN_HOSTNAME'&&b.text==='cflesports.com')&&['ADMIN_ACCESS_AUD','ADMIN_ACCESS_ISSUER'].every(n=>bindings.some(b=>b.name===n&&b.type==='plain_text'&&b.text.length>0)),'ACTIVE_AUTHENTICATION_CONFIGURATION_REJECTED');
 need(equal(version.assets?.config,ASSET_CONFIG),'ACTIVE_ASSET_CONFIGURATION_MISMATCH');
 need(typeof version.compatibility_date==='string'&&Array.isArray(version.compatibility_flags),'ACTIVE_RUNTIME_UNAVAILABLE');
 const runtime=Object.fromEntries(runtimeKeys.filter(k=>version[k]!=null).map(k=>[k,clone(version[k])]));
 const secrets=bindings.filter(b=>b.type==='secret_text');need(equal(secrets,[{name:'ADMIN_DRAW_KEY',type:'secret_text'}]),'EXACT_SECRET_SET_REQUIRED');
 return {...runtime,bindings:sortBindings(bindings),assets:{config:clone(ASSET_CONFIG)}};
}
export function verifyRouting(domains,routes,subdomain){
 need(Array.isArray(domains)&&Array.isArray(routes),'ROUTING_METADATA_REQUIRED');
 const custom=domains.filter(d=>d.hostname==='cflesports.com');
 need(custom.length===1&&custom[0].service===WORKER&&custom[0].zone_id==='c8fed6ca36bcc7f2a22cd1b6aa713091'&&(!custom[0].environment||custom[0].environment==='production'),'PRODUCTION_DOMAIN_MISMATCH');
 need(!routes.some(r=>r.script===WORKER||/cflesports\.com/.test(r.pattern)),'ADDITIONAL_ROUTES_REQUIRE_REVIEW');
 need(typeof subdomain?.enabled==='boolean'&&typeof subdomain.previews_enabled==='boolean','SUBDOMAIN_METADATA_REQUIRED');
 return {domains:clone(domains),routes:clone(routes),subdomain:clone(subdomain)};
}
export function validateReleaseTemplate(template,workspace,baseline){
 const allowed=['$schema','name','account_id','main','no_bundle','find_additional_modules','rules','compatibility_date','compatibility_flags','workers_dev','preview_urls','routes','assets','d1_databases','r2_buckets','keep_vars','vars','send_metrics','secrets'];
 need(Object.keys(template).every(k=>allowed.includes(k)),'UNREVIEWED_RELEASE_CONFIGURATION_KEY');
 need(template.name===WORKER&&template.account_id===ACCOUNT&&template.keep_vars===true&&template.no_bundle===true&&template.find_additional_modules===true,'PRODUCTION_CONFIGURATION_REQUIRED');
 need(realpathSync(template.main)===workspace+'/dist/server/entry.mjs'&&realpathSync(template.assets.directory)===workspace+'/dist/client','ISOLATED_ARTIFACT_PATH_REQUIRED');
 const active=baseline.configuration;
 need(template.compatibility_date===active.compatibility_date&&equal(template.compatibility_flags,active.compatibility_flags),'RELEASE_RUNTIME_MISMATCH');
 need(equal(template.d1_databases,[{binding:'DB',database_name:'cflesportsid',database_id:'efded3c4-1cf9-46a9-823e-d0f2d17c683a'}])&&equal(template.r2_buckets,[{binding:'CFL_ASSETS',bucket_name:'cflesportsid-assets-production'}]),'RELEASE_RESOURCE_MISMATCH');
 need(Object.keys(template.assets).every(k=>['binding','directory',...Object.keys(ASSET_CONFIG)].includes(k))&&template.assets.binding==='ASSETS'&&Object.keys(ASSET_CONFIG).every(k=>k==='base_path'&&!Object.hasOwn(template.assets,k)||equal(template.assets[k],ASSET_CONFIG[k])),'RELEASE_ASSETS_MISMATCH');
 need(equal(template.routes,[{pattern:'cflesports.com',custom_domain:true,zone_id:'c8fed6ca36bcc7f2a22cd1b6aa713091',enabled:true,previews_enabled:false}])&&template.workers_dev===baseline.routing.subdomain.enabled&&template.preview_urls===baseline.routing.subdomain.previews_enabled,'RELEASE_ROUTING_MISMATCH');
 if(Object.hasOwn(template,'vars'))need(equal(template.vars,Object.fromEntries(active.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]))),'EXPLICIT_VARIABLES_MUST_MATCH_ACTIVE_VERSION');
 if(Object.hasOwn(template,'secrets'))need(equal(template.secrets,{required:['ADMIN_DRAW_KEY']}),'SECRET_REQUIREMENTS_MISMATCH');
}
export async function capturePinnedBaseline(get){
 const values=[];for(const path of METADATA_PATHS)values.push(await get(path));
 const [deployments,version,domains,routes,subdomain]=values,active=deployments?.deployments?.[0];
 need(active?.id&&active.versions?.length===1&&active.versions[0].version_id===STABLE_VERSION&&active.versions[0].percentage===100,'ACTIVE_VERSION_OR_TRAFFIC_CHANGED');
 const configuration=activeConfiguration(version),routing=verifyRouting(domains,routes,subdomain);
 for(let i=0;i<METADATA_PATHS.length;i++)need(equal(values[i],await get(METADATA_PATHS[i])),'PRODUCTION_METADATA_CHANGED_DURING_CAPTURE');
 return {versionId:STABLE_VERSION,deploymentId:active.id,traffic:100,configuration,routing};
}
export function createPayload(baseline,modules){
 const config=clone(baseline.configuration);
 config.bindings=config.bindings.map(b=>b.type==='secret_text'?{name:b.name,type:'inherit',version_id:STABLE_VERSION}:b);
 const payload={...config,main_module:'entry.mjs',modules};validatePinnedPayload(payload,payload);return payload;
}
export function verifyUploadedVersion(version,payload){
 const expected=clone(payload);expected.bindings=sortBindings(expected.bindings.map(b=>b.type==='inherit'?{name:b.name,type:'secret_text'}:b));
 const observed=activeConfiguration({...version,id:STABLE_VERSION});
 const expectedConfig=clone(expected);delete expectedConfig.modules;delete expectedConfig.main_module;
 need(equal(observed,expectedConfig),'UPLOADED_CONFIGURATION_MISMATCH');
 need(version.main_module===payload.main_module&&Array.isArray(version.modules),'UPLOADED_MODULES_UNAVAILABLE');
 const canonical=ms=>ms.map(m=>({name:m.name,content_type:m.content_type,content_base64:m.content_base64})).toSorted((a,b)=>a.name.localeCompare(b.name));
 need(equal(canonical(version.modules),canonical(payload.modules)),'UPLOADED_ARTIFACT_MISMATCH');
}
export async function stageAndUpload(api,artifacts,payload){
 const session=await api.request('POST',SCRIPT+'/assets-upload-session',{manifest:artifacts.manifest});
 let single=false;try{single=JSON.parse(Buffer.from(session.jwt.split('.')[1],'base64url')).wrangler_single_asset_uploads===true;}catch{}
 let completion=session.buckets.flat().length?null:session.jwt;
 for(const bucket of session.buckets){
  if(single){for(const hash of bucket){const result=await api.request('POST',BASE+'/workers/assets/upload/'+hash,artifacts.assetFiles.get(hash),session.jwt);if(result?.jwt)completion=result.jwt;}}
  else if(bucket.length){const form=new FormData();for(const hash of bucket){const file=artifacts.assetFiles.get(hash);form.append(hash,new Blob([file.bytes.toString('base64')],{type:file.contentType}),hash);}const result=await api.request('POST',BASE+'/workers/assets/upload?base64=true',form,session.jwt);if(result?.jwt)completion=result.jwt;}
 }
 need(typeof completion==='string','ASSET_COMPLETION_TOKEN_REQUIRED');
 return api.request('POST',VERSION_PATH,{...payload,assets:{config:payload.assets.config,jwt:completion}});
}
export async function executePinnedUpload({plan,artifacts,api,checkApproval,claim,record,now=Date.now}){
 const fresh=await capturePinnedBaseline(path=>api.request('GET',path));need(equal(fresh,plan.baseline),'PRODUCTION_BASELINE_CHANGED');const checkedAt=now();
 checkApproval();need(now()-checkedAt<300000,'FRESH_PREFLIGHT_REQUIRED');claim();
 const uploaded=await stageAndUpload(api,artifacts,plan.payload);record(uploaded);
 verifyUploadedVersion(await api.request('GET',MODERN+'/versions/'+uploaded.id+'?include=modules'),plan.payload);
 need(equal(await capturePinnedBaseline(path=>api.request('GET',path)),plan.baseline),'PRODUCTION_CHANGED_AFTER_UPLOAD');
 return {status:'UPLOADED_VERIFIED_NOT_ACTIVATED',versionId:uploaded.id,planDigest:plan.digest,stableVersionId:STABLE_VERSION,stableTraffic:100,activationAuthorized:false};
}
export function toolingSeal(){
 const names=['scripts/production/pinned-version-guard.mjs','scripts/production/pinned-version-release.mjs','scripts/phase2c/production-preflight.mjs','scripts/phase2c/uat-validator.mjs','scripts/phase2b/guards.mjs','scripts/phase2b/schema.mjs','src/utils/asset-keys.mjs','src/data-access/public-mode.mjs','package-lock.json','node_modules/wrangler/bin/wrangler.js','node_modules/wrangler/wrangler-dist/cli.js'];
 const deps=['blake3-wasm','mrmime'].flatMap(name=>files(dirname(require.resolve(name+'/package.json'))));
 return sha([...names.map(p=>[p,sha(readFileSync(ROOT+'/'+p))]),...deps.map(p=>[p,sha(readFileSync(p))])]);
}
function token(config){
 need(!Object.keys(process.env).some(k=>k==='NODE_OPTIONS'||k==='NODE_EXTRA_CA_CERTS'||k==='NODE_TLS_REJECT_UNAUTHORIZED'||k.startsWith('CFL_PUBLIC_')||k.startsWith('ADMIN_')||/^(HTTPS?|ALL)_PROXY$/i.test(k)),'PROCESS_OVERRIDE_REJECTED');
 let auth;try{auth=JSON.parse(execFileSync(process.execPath,[ROOT+'/node_modules/wrangler/bin/wrangler.js','auth','token','--json','--config',config],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}}));}catch{throw Error('AUTHENTICATION_UNAVAILABLE');}
 need(['oauth','api_token'].includes(auth.type)&&typeof auth.token==='string','TOKEN_AUTHENTICATION_REQUIRED');return auth.token;
}
function writePrivate(path,value){writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
function readPrivate(path){privatePath(path);return JSON.parse(readFileSync(path,'utf8'));}
export async function main(args=process.argv.slice(2)){
 need(args.length===3&&args[1]===(args[0]==='prepare'?'--workspace':'--operation')&&['prepare','upload'].includes(args[0]),'INVALID_ARGUMENTS');
 if(args[0]==='prepare'){
  const workspace=realpathSync(args[2]);privatePath(workspace,true);need(workspace.startsWith('/private/tmp/'),'ISOLATED_WORKSPACE_REQUIRED');
  const config=privatePath(workspace+'/wrangler.production.jsonc'),template=readPrivate(config);
  need(template.name===WORKER&&template.account_id===ACCOUNT&&template.keep_vars===true,'PRODUCTION_CONFIGURATION_REQUIRED');
  need(realpathSync(template.main)===workspace+'/dist/server/entry.mjs'&&realpathSync(template.assets.directory)===workspace+'/dist/client','ISOLATED_ARTIFACT_PATH_REQUIRED');
  const auth=token(config),api=createPinnedTransport({token:auth,checkApproval:()=>{}});
  const baseline=await capturePinnedBaseline(path=>api.request('GET',path));
  validateReleaseTemplate(template,workspace,baseline);
  const artifacts=buildArtifacts(workspace),payload=createPayload(baseline,artifacts.modules),now=Date.now();
  const body={format:'cfl-pinned-release-v1',operation:'production-pinned-version-upload',readiness:'READY_FOR_OWNER_REVIEW',target:{account:ACCOUNT,worker:WORKER},baseline,workspace,nonce:randomUUID(),issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString(),sourceMappingVerified:false,artifactSHA256:artifacts.artifactSHA256,manifestSHA256:sha(artifacts.manifest),configurationSHA256:sha(readFileSync(config)),toolingSHA256:toolingSeal(),payload};
  const plan={...body,digest:sha(body)},output=mkdtempSync('/private/tmp/cfl-pinned-release-');chmodSync(output,0o700);writePrivate(output+'/release-plan.private.json',plan);
  const report={status:'READY_FOR_OWNER_REVIEW',planDigest:plan.digest,versionId:STABLE_VERSION,deploymentId:baseline.deploymentId,traffic:100,mode:'d1',secretSourceVersionId:STABLE_VERSION,secretValuesExported:false,sourceMappingVerified:false,artifactSHA256:plan.artifactSHA256,expiresAt:plan.expiresAt,approvalCreated:false,uploadAuthorized:false};
  writePrivate(output+'/report.json',report);console.log(JSON.stringify(report,null,2));console.log('Private operation directory: '+output);return;
 }
 const operation=realpathSync(args[2]);privatePath(operation,true);need(operation.startsWith('/private/tmp/'),'PRIVATE_OPERATION_REQUIRED');
 const plan=readPrivate(operation+'/release-plan.private.json');
 const checkApproval=()=>validatePinnedApproval(plan,readPrivate(operation+'/deployment-approval.json'),readPrivate(operation+'/writer-upload-pause.json'));
 checkApproval();privatePath(plan.workspace,true);
 need(plan.toolingSHA256===toolingSeal(),'SEALED_TOOLING_CHANGED');
 const config=privatePath(plan.workspace+'/wrangler.production.jsonc');need(sha(readFileSync(config))===plan.configurationSHA256,'SEALED_CONFIGURATION_CHANGED');
 const artifacts=buildArtifacts(plan.workspace);need(artifacts.artifactSHA256===plan.artifactSHA256&&sha(artifacts.manifest)===plan.manifestSHA256,'SEALED_ARTIFACT_CHANGED');
 need(equal(createPayload(plan.baseline,artifacts.modules),plan.payload),'SEALED_PAYLOAD_CHANGED');
 const api=createPinnedTransport({token:token(config),checkApproval,expectedPayload:plan.payload,manifest:artifacts.manifest,assetFiles:artifacts.assetFiles});
 const result=await executePinnedUpload({plan,artifacts,api,checkApproval,
  claim:()=>closeSync(openSync(operation+'/upload.claimed','wx',0o600)),
  record:uploaded=>writePrivate(operation+'/uploaded-version.json',{versionId:uploaded.id,planDigest:plan.digest,activationAuthorized:false})});
 writePrivate(operation+'/upload-report.json',result);console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(formatReleaseFailure(error));process.exitCode=1;});
