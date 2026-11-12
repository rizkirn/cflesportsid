import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdtempSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {PRODUCTION} from './metadata-helpers.mjs';
import {collectWorkerMetadata,createMetadataTransport,sanitizedMetadataError} from './metadata-collector.mjs';
import {inventory} from '../phase1a/safety.mjs';
import {readRecoveryConfiguration,replaceRecoveryConfiguration} from './recovery-workspace.mjs';
import {reconstructActiveConfiguration,privateActiveCapture} from './active-configuration.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
export async function captureActiveConfiguration({get,expectedVersion}) {
 const {validation,...capture}=await collectWorkerMetadata({get,expectedVersion,includeLatest:true});
 return capture;
}

async function main() {
 const args=process.argv.slice(2);need(args.length===4&&args[0]==='--workspace'&&args[2]==='--expected-version','INVALID_ARGUMENTS');
 const snapshot=readRecoveryConfiguration(args[1]),workspace=snapshot.workspace,expectedVersion=args[3];
 const output=mkdtempSync('/private/tmp/cfl-active-config-');chmodSync(output,0o700);
 try {
  const template=JSON.parse(snapshot.bytes.toString('utf8'));
  need(template.name===PRODUCTION.worker&&template.account_id===PRODUCTION.account,'RELEASE_TARGET_MISMATCH');
  const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');let auth;
  try{auth=JSON.parse(execFileSync(process.execPath,[repo+'/node_modules/wrangler/bin/wrangler.js','auth','token','--json','--config',snapshot.path],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'}}));}catch{throw Error('AUTHENTICATION_UNAVAILABLE');}
  need(['oauth','api_token'].includes(auth.type)&&typeof auth.token==='string','TOKEN_AUTHENTICATION_REQUIRED');
  const get=createMetadataTransport({fetcher:fetch,token:auth.token,expectedVersion,maxRequests:18});
  const capture=await captureActiveConfiguration({get,expectedVersion});
  writeFileSync(output+'/active-config.private.json',JSON.stringify(privateActiveCapture(capture),null,2)+'\n',{mode:0o600,flag:'wx'});
  const result=reconstructActiveConfiguration(template,capture);
  const report={status:result.blockers.length?'NO_GO':'GO_FOR_RELEASE_REVIEW',blockers:result.blockers,versionId:expectedVersion,deploymentId:capture.deploymentId,latestUploadedVersionId:capture.latestVersion.id,checkedAt:capture.checkedAt,secretSourceVerified:result.secretSourceVerified,secretValuesExported:false,configurationInstalled:false,sourceMappingVerified:false,approvalCreated:false,uploadAuthorized:false};
  report.additionalCurrentD1Bindings=result.additionalCurrentD1Bindings??[];
  if(capture.version.resources.bindings.some(b=>b.type==='secret_text'&&Object.hasOwn(template.vars??{},b.name)))report.blockers.push('SECRET_VALUE_IN_EXISTING_CONFIGURATION');
  report.status=report.blockers.length?'NO_GO':'GO_FOR_RELEASE_REVIEW';
  if(!report.blockers.length){
   const configText=JSON.stringify(result.config,null,2)+'\n';
   writeFileSync(output+'/wrangler.production.jsonc',configText,{mode:0o600,flag:'wx'});
   report.configurationSHA256=createHash('sha256').update(configText).digest('hex');
   report.artifactSHA256=hash(inventory(workspace+'/dist'));
   report.fingerprints={activeVersion:hash(privateActiveCapture(capture)),currentBindings:hash(capture.currentSettings.bindings),routing:hash([capture.domains,capture.routes]),scriptSettings:hash(capture.scriptSettings),subdomain:hash(capture.subdomain)};
   // Preserve the existing private local config before installing the verified replacement.
   replaceRecoveryConfiguration(snapshot,output,configText);report.configurationInstalled=true;
  }
  writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify(report,null,2));console.log('Saved private capture and report: '+output);
  if(report.blockers.length)process.exitCode=1;
 }catch(error){const reason=sanitizedMetadataError(error);const report={status:'NO_GO',blockers:[reason],configurationInstalled:false,approvalCreated:false,uploadAuthorized:false};writeFileSync(output+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));console.log('Saved: '+output+'/report.json');process.exitCode=1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('NO_GO: invalid invocation or unavailable private workspace');process.exitCode=1;});
