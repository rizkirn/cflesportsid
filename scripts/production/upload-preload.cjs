'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const path=require('node:path');
const root=process.cwd(), repo=path.resolve(__dirname,'../..');
if(root===repo||root.startsWith(repo+path.sep))throw Error('EXTERNAL_OPERATION_DIRECTORY_REQUIRED');
const rootStat=fs.lstatSync(root);
if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||rootStat.uid!==process.getuid()||(rootStat.mode&0o077)!==0)throw Error('PRIVATE_OPERATION_DIRECTORY_REQUIRED');
const {createUploadGuard}=require('./upload-request-guard.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
const need=(condition,code)=>{if(!condition)throw Error(code);};
const plan=read(root+'/production-deployment-plan.json');
const privateRead=p=>{const s=fs.lstatSync(p);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0,'PRIVATE_APPROVAL_REQUIRED');return read(p);};
const expectedTarget={account:'bf6ed4ccd73133871881b47ea58dae3d',database:'efded3c4-1cf9-46a9-823e-d0f2d17c683a',databaseName:'cflesportsid',worker:'cflesportsid',hostname:'cflesports.com'};
function checkApproval(){
 const {digest,...body}=plan,now=Date.now(),a=privateRead(root+'/deployment-approval.json');
 need(plan.readiness?.status==='READY','DEPLOYMENT_READINESS_REQUIRED');
 need(hash(JSON.stringify(body))===digest&&plan.operation==='production-d1-cutover'&&JSON.stringify(plan.target)===JSON.stringify(expectedTarget),'DEPLOYMENT_PLAN_REJECTED');
 need(Date.parse(plan.issuedAt)<=now&&now<Date.parse(plan.expiresAt),'DEPLOYMENT_PLAN_EXPIRED');
 need(a.approved===true&&a.operation===plan.operation&&a.planDigest===digest&&JSON.stringify(a.target)===JSON.stringify(plan.target),'DEPLOYMENT_APPROVAL_REJECTED');
 need(Date.parse(a.issuedAt)<=now&&now<Date.parse(a.expiresAt)&&Date.parse(a.expiresAt)-Date.parse(a.issuedAt)<=1800000&&Date.parse(a.expiresAt)<=Date.parse(plan.expiresAt),'DEPLOYMENT_APPROVAL_EXPIRED');
 const p=privateRead(root+'/deployment-preflight.json');
 need(p.status==='PASS'&&p.versionId===plan.baseline.versionId&&p.deploymentId===plan.baseline.deploymentId&&p.traffic===100&&['hybrid','d1'].includes(plan.baseline.mode)&&p.mode===plan.baseline.mode&&JSON.stringify(p.target)===JSON.stringify(plan.target),'DEPLOYMENT_PREFLIGHT_REJECTED');
 need(Date.parse(p.checkedAt)<=now&&now-Date.parse(p.checkedAt)<300000,'DEPLOYMENT_PREFLIGHT_EXPIRED');
 need(JSON.stringify(p.fingerprints)===JSON.stringify(plan.baseline.fingerprints),'DEPLOYMENT_FINGERPRINT_CHANGED');
 need(plan.configuration.path===repo+'/wrangler.production.jsonc','EXPLICIT_PRODUCTION_CONFIG_REQUIRED');
 need(!fs.lstatSync(plan.configuration.path).isSymbolicLink(),'PRODUCTION_CONFIG_SYMLINK_REJECTED');
 need(hash(fs.readFileSync(plan.configuration.path))===plan.configuration.sha256,'DEPLOYMENT_CONFIG_CHANGED');
 for(const [p,h]of Object.entries(plan.localGuards))need(hash(fs.readFileSync(repo+'/scripts/production/'+p))===h,'DEPLOYMENT_GUARD_CHANGED');
}
checkApproval();
function inventory(path){const result={};for(const name of fs.readdirSync(path).sort()){const p=path+'/'+name,s=fs.lstatSync(p);need(!s.isSymbolicLink(),'ARTIFACT_SYMLINK_REJECTED');if(s.isDirectory())for(const [k,v]of Object.entries(inventory(p)))result[name+'/'+k]=v;else result[name]={bytes:s.size,sha256:hash(fs.readFileSync(p))};}return result;}
need(hash(JSON.stringify(inventory(plan.artifact.directory)))===plan.artifact.sha256,'ARTIFACT_CHANGED');
const args=process.argv.slice(2);
need(JSON.stringify(args)===JSON.stringify(plan.execution.uploadArguments),'EXACT_UPLOAD_ARGUMENTS_REQUIRED');
need(hash(fs.readFileSync(process.argv[1]))===plan.execution.wranglerCLI_SHA256,'WRANGLER_CHANGED');
const allowedEnvironment=new Set(['PATH','HOME','USER','LOGNAME','TMPDIR','CI','__CF_USER_TEXT_ENCODING','CLOUDFLARE_API_TOKEN','WRANGLER_SEND_METRICS','WRANGLER_LOG_PATH','WRANGLER_CACHE_DIR','WRANGLER_LOG_SANITIZE','WRANGLER_WRITE_LOGS']);
need(process.env.CLOUDFLARE_API_TOKEN&&Object.keys(process.env).every(k=>allowedEnvironment.has(k)),'AUTH_OR_ENVIRONMENT_REJECTED');
need(process.env.WRANGLER_SEND_METRICS==='false'&&process.env.WRANGLER_WRITE_LOGS==='false','PRIVATE_LOGGING_REQUIRED');
// claim before any network request; never remove the claim after failure.
fs.closeSync(fs.openSync(root+'/version-upload.claimed','wx',0o600));
require(repo+'/node_modules/undici');
const symbol=Symbol.for('undici.globalDispatcher.1'),delegate=globalThis[symbol];
need(delegate&&typeof delegate.dispatch==='function','DISPATCHER_UNAVAILABLE');
const start=Date.now();
const guarded=createUploadGuard(delegate,{checkApproval,deadline:Math.min(start+600000,Date.parse(plan.expiresAt)),audit:e=>fs.appendFileSync(root+'/upload-request-audit.jsonl',JSON.stringify(e)+'\n',{mode:0o600}),reject:e=>fs.appendFileSync(root+'/upload-request-rejections.jsonl',JSON.stringify(e)+'\n',{mode:0o600})});
Object.defineProperty(globalThis,symbol,{value:guarded,writable:false,configurable:false});
