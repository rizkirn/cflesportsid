import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {check,loadConfig,readApproval} from './guards.mjs';
import {credential,stagingAPI} from './api.mjs';
import {identityImportPayload} from './identity-import.mjs';
import {preflight} from './preflight.mjs';
import {prepareOperation,executeBackup,executeIdentityBackfill,verifyExport} from './operations.mjs';

const [command,...rest]=process.argv.slice(2);
const allowed={'identity-payload':['config','expires','out'],preflight:['config','out','purpose','backup-manifest'],plan:['config','report','operation','payload','out'],backup:['config','report','payload','approval'],'identity-backfill':['config','report','payload','approval'], 'verify-export':['config','file','manifest']};
try{
  check(Object.hasOwn(allowed,command),'COMMAND_REJECTED');
  const args={};
  for(let i=0;i<rest.length;i+=2){
    check(rest[i]?.startsWith('--')&&rest[i+1]&&!rest[i+1].startsWith('--'),'ARGUMENT_REJECTED');
    const key=rest[i].slice(2);check(allowed[command].includes(key)&&!Object.hasOwn(args,key),'ARGUMENT_REJECTED');args[key]=rest[i+1];
  }
  const read=path=>JSON.parse(readFileSync(path,'utf8'));
  loadConfig(args.config,process.env);
  let result;
  if(command==='identity-payload'){
    result=identityImportPayload(args.expires);
  }else if(command==='plan'){
    result=prepareOperation(args.operation,read(args.report),read(args.payload));
  }else if(command==='verify-export'){
    result={checksumVerified:verifyExport(readFileSync(args.file),read(args.manifest))};
  }else{
    // Refuse missing approval before reading credentials or issuing any network request.
    let approval,report,payload;
    if(command==='backup'||command==='identity-backfill'){
      check(args.approval&&args.report&&args.payload,'EXPLICIT_AUTHORIZATION_REQUIRED');
      approval=readApproval(args.approval);report=read(args.report);payload=read(args.payload);
      const {authorize}=await import('./guards.mjs');authorize(approval,prepareOperation(command,report,payload));
    }
    if(command==='preflight')check(Boolean(args.purpose)===Boolean(args['backup-manifest']),'PREFLIGHT_OPTIONS_REQUIRED');
    const api=stagingAPI(credential());
    if(command==='preflight')result=await preflight(api,args.config,process.env,args.purpose?{purpose:args.purpose,backupManifestPath:args['backup-manifest']}:{ });
    else result=await (command==='identity-backfill'?executeIdentityBackfill:executeBackup)({api,configPath:args.config,env:process.env,report,payload,approval,approvalPath:args.approval});
  }
  if(args.out)writeFileSync(resolve(args.out),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify(result,null,2));
}catch(error){
  console.error(JSON.stringify({status:'BLOCKED',code:error instanceof Error?error.message:'UNKNOWN_FAILURE'}));process.exitCode=1;
}
