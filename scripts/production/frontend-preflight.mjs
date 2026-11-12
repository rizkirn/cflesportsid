import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {inventory} from '../phase1a/safety.mjs';
import {validateActiveConfiguration} from './active-configuration.mjs';
import {inspectProductionBindings,inspectCurrentSettings,PRODUCTION} from './metadata-helpers.mjs';
import {collectWorkerMetadata,createMetadataTransport,sanitizedMetadataError} from './metadata-collector.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
export function verifyFrontendCapture({config,version,settings,scriptSettings,domains,routes,subdomain,latestVersion}) {
 need(config.name===PRODUCTION.worker&&config.account_id===PRODUCTION.account,'RELEASE_TARGET_MISMATCH');
 if(Object.keys(config.vars??{}).length) {
  const validated=validateActiveConfiguration({config,version,currentSettings:settings,latestVersion,domains,routes,subdomain});
  if(validated.blockers.length){const error=Error(validated.blockers[0]);error.blockers=validated.blockers;throw error;}
  const state=inspectProductionBindings(version.resources.bindings);
  return {mode:state.mode,explicitActiveConfiguration:true,secretSourceVerified:validated.secretSourceVerified,additionalCurrentD1Bindings:validated.additionalCurrentD1Bindings,bindingDifferences:[],fingerprints:{activeBindings:state.bindingsHash,authentication:state.authenticationFingerprint,currentBindings:hash(settings.bindings),routes:hash([domains,routes]),assets:hash(version.resources.assets),scriptSettings:hash(scriptSettings),subdomain:hash(subdomain)},secretValuesVerified:false};
 }
 need(config.keep_vars===true&&Object.keys(config.env??{}).length===0,'RUNTIME_OVERRIDE_REJECTED');
 const state=inspectProductionBindings(version.resources?.bindings);
 const rollback=inspectCurrentSettings(version.resources.bindings,settings.bindings);
 need(rollback.additionalD1Bindings.every(b=>b.purpose==='known staging database'),'ADDITIONAL_DATABASE_PURPOSE_UNVERIFIED');
 const d1=version.resources.bindings.filter(b=>b.type==='d1');
 const r2=version.resources.bindings.filter(b=>b.type==='r2_bucket');
 need(config.d1_databases?.length===d1.length&&d1.every(b=>config.d1_databases.some(c=>c.binding===b.name&&c.database_id===(b.id??b.database_id))),'RELEASE_DATABASE_MISMATCH');
 need(config.r2_buckets?.length===r2.length&&r2.every(b=>config.r2_buckets.some(c=>c.binding===b.name&&c.bucket_name===b.bucket_name)),'RELEASE_BUCKET_MISMATCH');
 need(config.assets?.binding==='ASSETS','RELEASE_ASSETS_BINDING_MISMATCH');
 need(config.compatibility_date===version.resources.script_runtime?.compatibility_date&&hash([...(config.compatibility_flags??[])].sort())===hash([...(version.resources.script_runtime?.compatibility_flags??[])].sort()),'RELEASE_RUNTIME_MISMATCH');
 need(Array.isArray(domains)&&Array.isArray(routes),'ROUTING_METADATA_REQUIRED');
 const custom=domains.filter(d=>d.hostname===PRODUCTION.hostname);
 const hostRoutes=routes.filter(r=>/^(?:https?:\/\/)?cflesports\.com(?:\/|$)/.test(r.pattern));
 need(config.routes?.length===1&&config.routes[0].custom_domain===true&&config.routes[0].pattern===PRODUCTION.hostname&&custom.length===1&&custom[0].service===PRODUCTION.worker&&(!custom[0].environment||custom[0].environment==='production')&&hostRoutes.every(r=>r.script===PRODUCTION.worker),'RELEASE_ROUTE_MISMATCH');
 need(typeof subdomain?.enabled==='boolean'&&typeof subdomain.previews_enabled==='boolean'&&config.workers_dev===subdomain.enabled&&config.preview_urls===subdomain.previews_enabled,'RELEASE_SUBDOMAIN_MISMATCH');
 const candidates=[version.resources.assets,settings.assets,scriptSettings.assets].filter(Boolean).map(a=>a.config??a);
 const keys=['html_handling','not_found_handling','run_worker_first'];
 const activeAssets=version.resources.assets?.config??version.resources.assets;
 // Mutable settings may corroborate but cannot substitute for active-version asset settings.
 need(activeAssets&&keys.every(k=>Object.hasOwn(activeAssets,k)),'ACTIVE_ASSET_SETTINGS_REQUIRED');
 need(keys.every(k=>hash(activeAssets[k])===hash(config.assets[k])),'RELEASE_ASSET_SETTINGS_MISMATCH');
 need(candidates.every(a=>keys.every(k=>!Object.hasOwn(a,k)||hash(a[k])===hash(activeAssets[k]))),'CURRENT_ASSET_SETTINGS_DRIFT');
 return {mode:state.mode,additionalCurrentD1Bindings:rollback.additionalD1Bindings,bindingDifferences:rollback.bindingDifferences,
   fingerprints:{activeBindings:state.bindingsHash,authentication:state.authenticationFingerprint,currentBindings:rollback.currentSettingsHash,routes:hash([domains,routes]),assets:hash(activeAssets),scriptSettings:hash(scriptSettings),subdomain:hash(subdomain)},
   secretValuesVerified:false};
}

export async function captureFrontend({get,config,expectedVersion}) {
 const capture=await collectWorkerMetadata({get,expectedVersion,includeLatest:Object.keys(config.vars??{}).length>0,frontendDiagnostics:true,
  validate:({version,currentSettings:settings,latestVersion,scriptSettings,domains,routes,subdomain})=>{
   try{return verifyFrontendCapture({config,version,settings,latestVersion,scriptSettings,domains,routes,subdomain});}
   catch(error){try{error.additionalD1Bindings=inspectCurrentSettings(version.resources.bindings,settings.bindings).additionalD1Bindings;}catch{}throw error;}
  }});
 return {status:'GO_FOR_RELEASE_REVIEW',target:PRODUCTION,versionId:expectedVersion,deploymentId:capture.deploymentId,traffic:100,checkedAt:capture.checkedAt,...capture.validation,configurationHash:hash(config),sourceMappingVerified:false,approvalCreated:false,uploadAuthorized:false};
}

async function main() {
 const args=process.argv.slice(2);need(args.length===4&&args[0]==='--workspace'&&args[2]==='--expected-version','USAGE: --workspace PATH --expected-version UUID');
 const workspace=realpathSync(args[1]),configPath=workspace+'/wrangler.production.jsonc';
 const output=mkdtempSync('/private/tmp/cfl-frontend-preflight-');
 try {
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
  let credentials;try{credentials=JSON.parse(execFileSync(process.execPath,[repo+'/node_modules/wrangler/bin/wrangler.js','auth','token','--json','--config',configPath],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}}));}catch{throw Error('AUTHENTICATION_UNAVAILABLE_NO_CREDENTIALS_PRINTED');}
  need(['oauth','api_token'].includes(credentials.type)&&typeof credentials.token==='string','TOKEN_AUTHENTICATION_REQUIRED');
  const get=createMetadataTransport({fetcher:fetch,token:credentials.token,expectedVersion:args[3],maxRequests:20});
  const report=await captureFrontend({get,config,expectedVersion:args[3]});
  report.configurationSHA256=createHash('sha256').update(readFileSync(configPath)).digest('hex');
  report.artifact={directory:workspace+'/dist',sha256:hash(inventory(workspace+'/dist'))};
  report.releaseGuards=Object.fromEntries(['upload-boundary-preload.cjs','upload-preload.cjs','upload-request-guard.cjs'].map(name=>[name,createHash('sha256').update(readFileSync(workspace+'/scripts/production/'+name)).digest('hex')]));
  const path=output+'/report.json';writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));console.log('Saved: '+path);
 }catch(error){const reason=sanitizedMetadataError(error);const report={status:'NO_GO',reason,blockers:[reason],approvalCreated:false,uploadAuthorized:false};writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));console.log('Saved: '+output+'/report.json');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('NO_GO: invalid invocation or inaccessible workspace');process.exitCode=1;});
