import {isDeepStrictEqual} from 'node:util';
import {inspectProductionBindings,PRODUCTION} from './metadata-helpers.mjs';

const equal=(a,b)=>isDeepStrictEqual(a,b);
const allowedTypes=new Set(['plain_text','d1','r2_bucket','assets','secret_text']);
const assetKeys=['html_handling','not_found_handling','run_worker_first'];
const staging='4ba57de7-5fda-4703-a956-b1936546986a';
export function activeVariableValues(bindings) {
 return Object.fromEntries(bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
}
export function validateActiveConfiguration({config,version,currentSettings,latestVersion,domains,routes,subdomain}) {
 const blockers=[];const requireCheck=(condition,code)=>{if(!condition)blockers.push(code);};
 try{inspectProductionBindings(version.resources?.bindings);}catch(error){blockers.push(error.message);}
 const bindings=version.resources?.bindings??[],current=currentSettings.bindings??[];
 requireCheck(Array.isArray(bindings)&&Array.isArray(current),'BINDING_METADATA_REQUIRED');
 if(!Array.isArray(bindings)||!Array.isArray(current))return {blockers};
 requireCheck(bindings.every(b=>allowedTypes.has(b.type)),'UNSUPPORTED_ACTIVE_BINDING_TYPE');
 requireCheck(new Set(current.map(b=>b.name)).size===current.length,'DUPLICATE_CURRENT_BINDING');
 const vars=activeVariableValues(bindings);
 requireCheck(bindings.filter(b=>b.type==='plain_text').every(b=>typeof b.text==='string'),'ACTIVE_VARIABLE_VALUE_UNAVAILABLE');
 requireCheck(equal(config.vars,vars),'EXPLICIT_VARIABLES_MUST_MATCH_ACTIVE_VERSION');
 requireCheck(config.name===PRODUCTION.worker&&config.account_id===PRODUCTION.account&&config.keep_vars===true,'RELEASE_TARGET_OR_PRESERVATION_MISMATCH');
 const allowedConfigKeys=new Set(['$schema','name','account_id','main','no_bundle','find_additional_modules','rules','compatibility_date','compatibility_flags','workers_dev','preview_urls','routes','assets','d1_databases','r2_buckets','keep_vars','vars','send_metrics','secrets']);
 requireCheck(Object.keys(config).every(k=>allowedConfigKeys.has(k)),'UNREVIEWED_CONFIGURATION_KEY');
 const d1=bindings.filter(b=>b.type==='d1').map(b=>({binding:b.name,database_name:PRODUCTION.databaseName,database_id:b.id??b.database_id}));
 const r2=bindings.filter(b=>b.type==='r2_bucket').map(b=>({binding:b.name,bucket_name:b.bucket_name}));
 requireCheck(equal(config.d1_databases,d1),'RELEASE_DATABASE_MISMATCH');
 requireCheck(equal(config.r2_buckets,r2),'RELEASE_BUCKET_MISMATCH');
 requireCheck(bindings.filter(b=>b.type==='assets').length===1&&config.assets?.binding===bindings.find(b=>b.type==='assets')?.name,'RELEASE_ASSETS_BINDING_MISMATCH');
 const runtime=version.resources?.script_runtime;
 requireCheck(Boolean(runtime)&&config.compatibility_date===runtime.compatibility_date&&equal(config.compatibility_flags,runtime.compatibility_flags),'RELEASE_RUNTIME_MISMATCH');
 const assets=version.resources?.assets?.config??version.resources?.assets;
 requireCheck(Boolean(assets)&&assetKeys.every(k=>Object.hasOwn(assets,k)),'ACTIVE_ASSET_SETTINGS_UNRECOVERABLE');
 if(assets)requireCheck(assetKeys.every(k=>equal(config.assets?.[k],assets[k])),'RELEASE_ASSET_SETTINGS_MISMATCH');
 const custom=Array.isArray(domains)?domains.filter(d=>d.hostname===PRODUCTION.hostname):[];
 const hostRoutes=Array.isArray(routes)?routes.filter(r=>/^(?:https?:\/\/)?cflesports\.com(?:\/|$)/.test(r.pattern)):[];
 requireCheck(Array.isArray(routes)&&custom.length===1&&custom[0].service===PRODUCTION.worker&&custom[0].zone_id==='c8fed6ca36bcc7f2a22cd1b6aa713091'&&(!custom[0].environment||custom[0].environment==='production'),'ACTIVE_DOMAIN_UNVERIFIED');
 // A custom-domain release must not silently add, remove or rewrite zone routes.
 requireCheck(hostRoutes.length===0,'ADDITIONAL_HOST_ROUTES_REQUIRE_REVIEW');
 requireCheck(equal(config.routes,[{pattern:PRODUCTION.hostname,custom_domain:true,zone_id:'c8fed6ca36bcc7f2a22cd1b6aa713091',enabled:true,previews_enabled:false}]),'RELEASE_ROUTE_MISMATCH');
 requireCheck(typeof subdomain?.enabled==='boolean'&&typeof subdomain.previews_enabled==='boolean'&&config.workers_dev===subdomain.enabled&&config.preview_urls===subdomain.previews_enabled,'RELEASE_SUBDOMAIN_MISMATCH');
 const activeNames=new Set(bindings.map(b=>b.name));
 const extras=current.filter(b=>!activeNames.has(b.name));
 requireCheck(extras.every(b=>b.type==='d1'&&(b.id??b.database_id)===staging),'UNKNOWN_CURRENT_BINDING');
 const secrets=bindings.filter(b=>b.type==='secret_text');
 requireCheck(equal(config.secrets,{required:secrets.map(b=>b.name).sort()}),'SECRET_REQUIREMENTS_MISMATCH');
 // Strict inheritance is defined against the latest uploaded version, not an arbitrary historical version.
 const secretSourceVerified=secrets.length===0||(latestVersion?.id===version.id&&equal(latestVersion.resources?.bindings,bindings));
 requireCheck(secretSourceVerified,'SECRET_INHERITANCE_FROM_ACTIVE_VERSION_UNVERIFIED');
 requireCheck(equal(current.filter(b=>b.type==='secret_text'),secrets),'CURRENT_SECRET_METADATA_DRIFT');
 requireCheck(secrets.every(b=>!Object.keys(b).some(k=>['text','value','secret','plaintext'].includes(k))),'SECRET_VALUE_PRESENT_IN_METADATA');
 return {blockers:[...new Set(blockers)],secretSourceVerified,additionalCurrentD1Bindings:extras.filter(b=>b.type==='d1').map(b=>({name:b.name,purpose:(b.id??b.database_id)===staging?'known staging database':'unknown'}))};
}
export function reconstructActiveConfiguration(template,capture) {
 const {version,subdomain}=capture,bindings=version.resources?.bindings??[];
 const assets=version.resources?.assets?.config??version.resources?.assets;
 const config={...template,vars:activeVariableValues(bindings),keep_vars:true,
  d1_databases:bindings.filter(b=>b.type==='d1').map(b=>({binding:b.name,database_name:PRODUCTION.databaseName,database_id:b.id??b.database_id})),
  r2_buckets:bindings.filter(b=>b.type==='r2_bucket').map(b=>({binding:b.name,bucket_name:b.bucket_name})),
  compatibility_date:version.resources?.script_runtime?.compatibility_date,
  compatibility_flags:version.resources?.script_runtime?.compatibility_flags,
  workers_dev:subdomain?.enabled,preview_urls:subdomain?.previews_enabled,
  secrets:{required:bindings.filter(b=>b.type==='secret_text').map(b=>b.name).sort()},
  routes:[{pattern:PRODUCTION.hostname,custom_domain:true,zone_id:'c8fed6ca36bcc7f2a22cd1b6aa713091',enabled:true,previews_enabled:false}],
  assets:{...template.assets,binding:bindings.find(b=>b.type==='assets')?.name,
    ...Object.fromEntries(assetKeys.map(k=>[k,assets?.[k]]))}};
 const validation=validateActiveConfiguration({...capture,config});
 return {config,...validation};
}
export function privateActiveCapture(capture) {
 const {version,latestVersion}=capture;
 // Deliberately exclude raw API responses and all fields of secret bindings except name/type.
 return {activeVersionId:version.id,latestUploadedVersionId:latestVersion.id,
  variables:activeVariableValues(version.resources.bindings),
  bindings:version.resources.bindings.map(b=>({name:b.name,type:b.type,...(b.type==='d1'?{databaseId:b.id??b.database_id}:{}),...(b.type==='r2_bucket'?{bucketName:b.bucket_name}:{})})),
  runtime:version.resources.script_runtime,assets:version.resources.assets?Object.fromEntries(assetKeys.map(k=>[k,(version.resources.assets.config??version.resources.assets)[k]])):null,
  domains:capture.domains,routes:capture.routes,subdomain:capture.subdomain};
}
