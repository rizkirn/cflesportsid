import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {STABLE_VERSION,ACCOUNT,WORKER,BASE,SCRIPT,MODERN,VERSION_PATH,ACTIVE_DEPLOYMENT_PATH,METADATA_PATHS,ASSET_CONFIG,sha,validatePinnedPayload,validatePinnedApproval,createPinnedTransport} from '../scripts/production/pinned-version-guard.mjs';
import {exactTraffic,verifyActivationReadOnly} from '../scripts/production/verify-activation.mjs';
import {activationTransport,executeActivation,ACTION} from '../scripts/production/activate-reviewed-version.mjs';
import {liveActivationReview,qualificationOnly,UPLOADED_VERSION} from '../scripts/production/activation-review.mjs';
import {activeConfiguration,capturePinnedBaseline,createPayload,verifyUploadedVersion,stageAndUpload,buildArtifacts,verifyRouting,validateReleaseTemplate,executePinnedUpload,toolingSeal,formatReleaseFailure,describeUnreviewedEnv,validateEnvProjection,main} from '../scripts/production/pinned-version-release.mjs';
const copy=v=>structuredClone(v),newID='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const flags={ADMIN_ENABLED:'true',ADMIN_ENVIRONMENT:'production',ADMIN_HOSTNAME:'cflesports.com',ADMIN_ACCESS_AUD:'private-audience',ADMIN_ACCESS_ISSUER:'https://cflesports.cloudflareaccess.com',ADMIN_WRITES_ENABLED:'true',CFL_PUBLIC_MODE:'d1',CFL_PUBLIC_ACCOUNT_ID:ACCOUNT,CFL_PUBLIC_DATABASE_ID:'efded3c4-1cf9-46a9-823e-d0f2d17c683a',CFL_PUBLIC_ENVIRONMENT:'production',CFL_PUBLIC_HOSTNAME:'cflesports.com',CFL_PUBLIC_WORKER:WORKER};
function version(){return {id:STABLE_VERSION,compatibility_date:'2026-09-30',compatibility_flags:['nodejs_compat'],assets:{config:copy(ASSET_CONFIG)},bindings:[...Object.entries(flags).map(([name,text])=>({name,type:'plain_text',text})),{name:'DB',type:'d1',id:flags.CFL_PUBLIC_DATABASE_ID},{name:'CFL_ASSETS',type:'r2_bucket',bucket_name:'cflesportsid-assets-production'},{name:'ASSETS',type:'assets'},{name:'ADMIN_DRAW_KEY',type:'secret_text'}]};}
const modules=[{name:'entry.mjs',content_type:'application/javascript+module',content_base64:Buffer.from('export default {}').toString('base64')}];
const domains=[{hostname:'cflesports.com',service:WORKER,zone_id:'c8fed6ca36bcc7f2a22cd1b6aa713091',environment:'production'}],subdomain={enabled:true,previews_enabled:true};
function baseline(){return {versionId:STABLE_VERSION,deploymentId:'stable-deployment',traffic:100,configuration:activeConfiguration(version()),routing:{domains,routes:[],subdomain}};}
function payload(){return createPayload(baseline(),copy(modules));}
const response=result=>({status:200,redirected:false,json:async()=>({success:true,result})});
function approvals(){
 const now=Date.now(),body={format:'cfl-pinned-release-v1',operation:'production-pinned-version-upload',readiness:'READY_FOR_OWNER_REVIEW',baseline:{versionId:STABLE_VERSION},target:{account:ACCOUNT,worker:WORKER},issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 const plan={...body,digest:sha(body)};
 return {plan,approval:{approved:true,operation:body.operation,target:body.target,planDigest:plan.digest,approvedBy:'owner',id:'0123456789abcdef',issuedAt:body.issuedAt,expiresAt:body.expiresAt,sourceMappingUnverifiedAcknowledged:true},pause:{confirmed:true,planDigest:plan.digest,confirmedBy:'owner',confirmedAt:body.issuedAt},now};
}
const hash='a'.repeat(32),file={bytes:Buffer.from('asset-content'),contentType:'text/plain'},manifest={'/a.txt':{hash,size:file.bytes.length}};
function transport(fetcher,options={}){return createPinnedTransport({token:'not-a-real-token',fetcher,checkApproval:()=>{},expectedPayload:payload(),manifest,assetFiles:new Map([[hash,file]]),...options});}
const secret=p=>p.bindings.find(b=>b.name==='ADMIN_DRAW_KEY');
test('active stable baseline copies every variable and pins only secret metadata',()=>{
 const p=payload();assert.deepEqual(secret(p),{name:'ADMIN_DRAW_KEY',type:'inherit',version_id:STABLE_VERSION});assert.equal(p.bindings.filter(b=>b.type==='plain_text').length,Object.keys(flags).length);assert(!JSON.stringify(p).includes('secret_text'));assert.equal(p.bindings.filter(b=>b.type==='d1').length,1);validatePinnedPayload(p,p);
});
for(const source of ['latest',undefined,'57e6f48a-ef3f-4283-89ed-9e6c4deef309','6f6f4073'])test('rejects secret source '+source,()=>{const p=payload();secret(p).version_id=source;assert.throws(()=>validatePinnedPayload(p,p),/SECRET_SOURCE_NOT_PINNED/);});
for(const mutation of [p=>{secret(p).old_name='OTHER';},p=>{secret(p).text='never-export';},p=>{secret(p).type='secret_text';},p=>{secret(p).name='OTHER';},p=>{p.bindings.push(copy(p.bindings[0]));},p=>{p.assets.config.run_worker_first=true;},p=>{p.bindings.push({name:'staging',type:'d1',id:'4ba57de7-5fda-4703-a956-b1936546986a'});},p=>{p.bindings.push({name:'other',type:'service'});}])test('rejects changed binding or asset shape '+mutation.toString(),()=>{const p=payload();mutation(p);assert.throws(()=>validatePinnedPayload(p,p));});
for(const mutation of [v=>v.bindings.push({name:'unknown',type:'service'}),v=>{v.bindings.at(-1).text='secret-value';},v=>{v.bindings.find(b=>b.name==='DB').database_id='conflict';},v=>{v.bindings.find(b=>b.name==='CFL_PUBLIC_MODE').text='hybrid';},v=>{delete v.assets;},v=>{v.assets.config.base_path='/changed';},v=>{v.unknown_option=true;},v=>{v.bindings.find(b=>b.name==='ADMIN_ENABLED').text='false';}])test('active baseline rejects unverified configuration '+mutation.toString(),()=>{const v=version();mutation(v);assert.throws(()=>activeConfiguration(v));});
test('equivalent D1 id alias is normalized, active worker exports and limits preserved',()=>{const v=version(),db=v.bindings.find(b=>b.name==='DB');db.database_id=db.id;delete db.id;v.exports={default:{type:'worker',cache:{enabled:false}}};v.limits={cpu_ms:30000};const result=activeConfiguration(v);assert.equal(result.bindings.find(b=>b.name==='DB').id,flags.CFL_PUBLIC_DATABASE_ID);assert.deepEqual(result.exports,v.exports);assert.deepEqual(result.limits,v.limits);});
test('routing remains unchanged and rejects unexpected routes or domain ownership',()=>{assert.deepEqual(verifyRouting(domains,[],subdomain),{domains,routes:[],subdomain});assert.throws(()=>verifyRouting(domains,[{pattern:'cflesports.com/*',script:'other'}],subdomain));assert.throws(()=>verifyRouting([{...domains[0],service:'other'}],[],subdomain));});
function metadata(){return copy([{deployments:[{id:'stable-deployment',versions:[{version_id:STABLE_VERSION,percentage:100}]}]},version(),domains,[],subdomain]);}
test('capture uses modern active version and repeated read-only metadata, excludes mutable settings',async()=>{const values=metadata(),paths=[];const b=await capturePinnedBaseline(async p=>{paths.push(p);return copy(values[METADATA_PATHS.indexOf(p)]);});assert.equal(paths.length,10);assert(paths.includes(MODERN+'/versions/'+STABLE_VERSION));assert(!paths.some(p=>p.endsWith('/settings')));assert.equal(b.configuration.bindings.filter(b=>b.type==='d1').length,1);});
test('capture rejects concurrent route drift',async()=>{const values=metadata();let n=0;await assert.rejects(()=>capturePinnedBaseline(async p=>{n++;return n===9?[{pattern:'new'}]:copy(values[METADATA_PATHS.indexOf(p)]);}),/METADATA_CHANGED/);});
test('capture rejects split traffic',async()=>{const values=metadata();values[0].deployments[0].versions[0].percentage=99;await assert.rejects(()=>capturePinnedBaseline(async p=>copy(values[METADATA_PATHS.indexOf(p)])),/TRAFFIC_CHANGED/);});
for(const mutation of [a=>{a.approval=null;},a=>{a.approval.sourceMappingUnverifiedAcknowledged=false;},a=>{a.approval.planDigest='other';},a=>{a.approval.expiresAt=new Date(a.now-1).toISOString();},a=>{a.pause.confirmed=false;},a=>{a.pause.confirmedAt=new Date(a.now-300001).toISOString();},a=>{a.plan.readiness='GO';},a=>{a.approval.target={worker:'other'};}])test('approval or pause rejection '+mutation.toString(),()=>{const a=approvals();mutation(a);assert.throws(()=>validatePinnedApproval(a.plan,a.approval,a.pause,a.now));});
test('fresh digest approval and independent pause pass',()=>{const a=approvals();validatePinnedApproval(a.plan,a.approval,a.pause,a.now);});
for(const path of [MODERN+'/versions',MODERN+'/versions?deploy=true',MODERN+'/versions?deploy=false&deploy=true',SCRIPT+'/versions',SCRIPT+'/deployments',SCRIPT+'/settings',BASE+'/d1/database/id/query'])test('transport denies write endpoint '+path,async()=>{let calls=0;const api=transport(async()=>{calls++;return response({});});await assert.rejects(()=>api.request('POST',path,payload()),/ENDPOINT_OR_DEPLOY_FLAG/);assert.equal(calls,0);});
test('successful cached assets upload explicitly uses deploy=false and stable secret UUID',async()=>{
 const calls=[],api=transport(async(url,init)=>{calls.push([url,init]);return response(url.endsWith('assets-upload-session')?{jwt:'completion',buckets:[]}: {id:newID});});
 const result=await stageAndUpload(api,{manifest,assetFiles:new Map([[hash,file]])},payload());assert.equal(result.id,newID);assert.equal(calls.length,2);assert(calls[1][0].endsWith(VERSION_PATH));const p=JSON.parse(calls[1][1].body);assert.equal(secret(p).version_id,STABLE_VERSION);assert.equal(p.assets.jwt,'completion');
 await assert.rejects(()=>api.request('POST',VERSION_PATH,p),/REPLAY/);assert.equal(calls.length,2);
});
for(const single of [true,false])test('sealed static assets transfer protocol '+single,async()=>{
 const jwt='x.'+Buffer.from(JSON.stringify({wrangler_single_asset_uploads:single})).toString('base64url')+'.x',calls=[];
 const api=transport(async(url,init)=>{calls.push([url,init]);if(url.endsWith('assets-upload-session'))return response({jwt,buckets:[[hash]]});if(url.includes('/assets/upload'))return response({jwt:'complete'});return response({id:newID});});
 await stageAndUpload(api,{manifest,assetFiles:new Map([[hash,file]])},payload());assert.equal(calls.length,3);assert.equal(calls[1][1].headers.Authorization,'Bearer '+jwt);
});
test('unknown asset hash response fails closed',async()=>{const api=transport(async()=>response({jwt:'x',buckets:[['b'.repeat(32)]]}));await assert.rejects(()=>api.request('POST',SCRIPT+'/assets-upload-session',{manifest}),/UNKNOWN_OR_DUPLICATE/);});
test('changed manifest and asset bytes fail before transfer',async()=>{
 let calls=0;const api=transport(async()=>{calls++;return response({jwt:'session',buckets:[[hash]]});});await api.request('POST',SCRIPT+'/assets-upload-session',{manifest});await assert.rejects(()=>api.request('POST',BASE+'/workers/assets/upload/'+hash,{...file,bytes:Buffer.from('changed')},'session'),/ASSET_UPLOAD_SCOPE/);assert.equal(calls,1);
 const other=transport(async()=>{throw Error('must not reach');});await assert.rejects(()=>other.request('POST',SCRIPT+'/assets-upload-session',{manifest:{}}),/ASSET_SESSION_REJECTED/);
});
test('payload mutation cannot reach version endpoint',async()=>{let calls=0;const api=transport(async()=>{calls++;return response({jwt:'complete',buckets:[]});});await api.request('POST',SCRIPT+'/assets-upload-session',{manifest});const p=payload();p.bindings[0].text='changed';p.assets.jwt='complete';await assert.rejects(()=>api.request('POST',VERSION_PATH,p),/SEALED_PAYLOAD_CHANGED/);assert.equal(calls,1);});
test('injected completion JWT is rejected',async()=>{const api=transport(async()=>response({jwt:'complete',buckets:[]}));await api.request('POST',SCRIPT+'/assets-upload-session',{manifest});const p=payload();p.assets.jwt='injected';await assert.rejects(()=>api.request('POST',VERSION_PATH,p),/COMPLETION_TOKEN/);});
test('network failure is sanitized and no retries are possible',async()=>{let calls=0;const api=transport(async()=>{calls++;throw Error('token=secret');});await assert.rejects(()=>api.request('GET',METADATA_PATHS[0]),/^Error: CLOUDFLARE_NETWORK_OR_DNS_UNAVAILABLE$/);await assert.rejects(()=>api.request('GET',METADATA_PATHS[0]),/STOPPED_NO_RETRY/);assert.equal(calls,1);});
test('approval is checked on each request',async()=>{const api=transport(async()=>response({}),{checkApproval:()=>{throw Error('APPROVAL_EXPIRED');}});await assert.rejects(()=>api.request('GET',METADATA_PATHS[0]),/APPROVAL_EXPIRED/);});
test('uploaded version verification requires exact artifact, variables, asset settings and secret metadata',()=>{
 const v={...version(),id:newID,main_module:'entry.mjs',modules:copy(modules)};verifyUploadedVersion(v,payload());
 for(const change of [v=>v.bindings.push({name:'staging',type:'d1',id:'other'}),v=>{v.bindings[0].text='different';},v=>{v.modules[0].content_base64='changed';},v=>{v.assets.config.base_path='/wrong';},v=>{v.bindings.at(-1).type='inherit';}]){const changed=copy(v);change(changed);assert.throws(()=>verifyUploadedVersion(changed,payload()));}
});
function fixture(){const dir=realpathSync(mkdtempSync(tmpdir()+'/cfl-pinned-artifact-'));mkdirSync(dir+'/dist/server',{recursive:true});mkdirSync(dir+'/dist/client',{recursive:true});writeFileSync(dir+'/dist/server/entry.mjs','export default {}');writeFileSync(dir+'/dist/client/.assetsignore','wrangler.json\n.dev.vars\n');writeFileSync(dir+'/dist/client/a.txt','hello');writeFileSync(dir+'/dist/client/_headers','/*\n X-Test: yes');return dir;}
test('artifact seal covers files and headers use text/plain modules, not static manifest',()=>{const dir=fixture();try{const a=buildArtifacts(dir);assert.deepEqual(Object.keys(a.manifest),['/a.txt']);assert(a.modules.some(m=>m.name==='_headers'&&m.content_type==='text/plain'));writeFileSync(dir+'/dist/client/a.txt','changed');assert.notEqual(buildArtifacts(dir).artifactSHA256,a.artifactSHA256);}finally{rmSync(dir,{recursive:true});}});
test('artifact symlinks and unreviewed ignore rules rejected',()=>{const dir=fixture();try{symlinkSync('/etc/hosts',dir+'/dist/client/link');assert.throws(()=>buildArtifacts(dir),/SYMLINK/);rmSync(dir+'/dist/client/link');writeFileSync(dir+'/dist/client/.assetsignore','*');assert.throws(()=>buildArtifacts(dir),/IGNORE/);}finally{rmSync(dir,{recursive:true});}});
test('CLI requires explicit prepare or upload operation arguments',async()=>{await assert.rejects(()=>main([]),/INVALID_ARGUMENTS/);await assert.rejects(()=>main(['deploy','--operation','anything']),/INVALID_ARGUMENTS/);});

test('approved orchestration captures twice, verifies upload, never activates or changes settings',async()=>{
 const b=baseline(),p=payload(),values=metadata(),calls=[];let claims=0,recorded;
 const api=transport(async(url,init)=>{
  const path=url.replace('https://api.cloudflare.com/client/v4','');calls.push([init.method,path]);
  if(init.method==='GET'&&METADATA_PATHS.includes(path))return response(copy(values[METADATA_PATHS.indexOf(path)]));
  if(path===SCRIPT+'/assets-upload-session')return response({jwt:'completion',buckets:[]});
  if(path===VERSION_PATH)return response({id:newID});
  if(path===MODERN+'/versions/'+newID+'?include=modules')return response({...version(),id:newID,main_module:'entry.mjs',modules:copy(modules)});
  throw Error('UNEXPECTED_REQUEST');
 });
 const result=await executePinnedUpload({plan:{baseline:b,payload:p,digest:'reviewed'},artifacts:{manifest,assetFiles:new Map([[hash,file]])},api,checkApproval:()=>{},claim:()=>claims++,record:v=>{recorded=v.id;}});
 assert.equal(result.status,'UPLOADED_VERIFIED_NOT_ACTIVATED');assert.equal(claims,1);assert.equal(recorded,newID);assert.equal(result.activationAuthorized,false);
 assert.deepEqual(calls.filter(([m])=>m!=='GET').map(([,p])=>p),[SCRIPT+'/assets-upload-session',VERSION_PATH]);assert.equal(calls.length,23);
});
test('orchestration rejects a changed baseline before claim or any POST',async()=>{
 const values=metadata();values[4].enabled=false;let claimed=false,posts=0;
 const api=transport(async(url,init)=>{if(init.method==='POST')posts++;return response(copy(values[METADATA_PATHS.indexOf(url.replace('https://api.cloudflare.com/client/v4',''))]));});
 await assert.rejects(()=>executePinnedUpload({plan:{baseline:baseline(),payload:payload()},artifacts:{},api,checkApproval:()=>{},claim:()=>{claimed=true;},record:()=>{}}),/PRODUCTION_BASELINE_CHANGED/);assert.equal(claimed,false);assert.equal(posts,0);
});
test('upload result remains ineligible when independent version verification fails',async()=>{
 const values=metadata();let recorded=false;
 const api=transport(async(url,init)=>{const path=url.replace('https://api.cloudflare.com/client/v4','');if(init.method==='GET'&&METADATA_PATHS.includes(path))return response(copy(values[METADATA_PATHS.indexOf(path)]));if(path.endsWith('assets-upload-session'))return response({jwt:'complete',buckets:[]});if(path===VERSION_PATH)return response({id:newID});return response({...version(),id:newID,main_module:'entry.mjs',modules:[]});});
 await assert.rejects(()=>executePinnedUpload({plan:{baseline:baseline(),payload:payload()},artifacts:{manifest,assetFiles:new Map([[hash,file]])},api,checkApproval:()=>{},claim:()=>{},record:()=>{recorded=true;}}),/UPLOADED_ARTIFACT_MISMATCH/);assert.equal(recorded,true);
});
test('private release config accepts exact active overrides and rejects unexpected values',()=>{
 const dir=fixture();try{
 const config={name:WORKER,account_id:ACCOUNT,keep_vars:true,no_bundle:true,find_additional_modules:true,main:dir+'/dist/server/entry.mjs',assets:{binding:'ASSETS',directory:dir+'/dist/client',html_handling:'auto-trailing-slash',not_found_handling:'none',run_worker_first:false},compatibility_date:'2026-09-30',compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:true,routes:[{pattern:'cflesports.com',custom_domain:true,zone_id:'c8fed6ca36bcc7f2a22cd1b6aa713091',enabled:true,previews_enabled:false}],d1_databases:[{binding:'DB',database_name:'cflesportsid',database_id:flags.CFL_PUBLIC_DATABASE_ID}],r2_buckets:[{binding:'CFL_ASSETS',bucket_name:'cflesportsid-assets-production'}]};
 validateReleaseTemplate(config,dir,baseline());config.vars=copy(flags);validateReleaseTemplate(config,dir,baseline());
 for(const change of [c=>{c.vars.CFL_PUBLIC_MODE='hybrid';},c=>{c.env={};},c=>{c.assets.run_worker_first=true;},c=>{c.d1_databases.push({binding:'staging'});},c=>{c.preview_urls=false;},c=>{c.secrets={required:['OTHER']};}]){const c=copy(config);change(c);assert.throws(()=>validateReleaseTemplate(c,dir,baseline()));}
 }finally{rmSync(dir,{recursive:true});}
});

test('local tooling seal resolves installed CLI and hashing dependencies without network',()=>{assert.match(toolingSeal(),/^[a-f0-9]{64}$/);});

test('active deployment request reads exactly first page, safely ignoring historical pages',async()=>{
 const calls=[],current=metadata()[0];
 const api=transport(async(url)=>{calls.push(url);return {status:200,redirected:false,json:async()=>({success:true,result:current,result_info:{page:1,per_page:1,count:1,total_count:90,total_pages:90}})};});
 assert.deepEqual(await api.request('GET',ACTIVE_DEPLOYMENT_PATH),current);
 assert.deepEqual(calls,['https://api.cloudflare.com/client/v4'+SCRIPT+'/deployments?page=1&per_page=1']);
});
for(const info of [{page:2,per_page:1,total_pages:90},{page:1,per_page:20,total_pages:5}])test('rejects unexpected active deployment pagination '+JSON.stringify(info),async()=>{
 const api=transport(async()=>({status:200,redirected:false,json:async()=>({success:true,result:metadata()[0],result_info:info})}));
 await assert.rejects(()=>api.request('GET',ACTIVE_DEPLOYMENT_PATH),/ACTIVE_DEPLOYMENT_PAGE_REJECTED/);
});
test('cannot request arbitrary deployment history pages or unbounded deployment list',async()=>{
 for(const path of [SCRIPT+'/deployments',SCRIPT+'/deployments?page=2&per_page=1',SCRIPT+'/deployments?page=1&per_page=100']){
  let calls=0;const api=transport(async()=>{calls++;return response({});});await assert.rejects(()=>api.request('GET',path),/GET_SCOPE_REJECTED/);assert.equal(calls,0);
 }
});
for(const [path,category]of [[BASE+'/workers/domains','DOMAINS'],[METADATA_PATHS[3],'ROUTES']])test('incomplete '+category+' metadata remains rejected with safe endpoint diagnostic',async()=>{
 const api=transport(async()=>({status:200,redirected:false,json:async()=>({success:true,result:[],result_info:{page:1,per_page:20,total_pages:2}})}));
 await assert.rejects(()=>api.request('GET',path),new RegExp('PAGINATED_'+category+'_METADATA_REQUIRES_REVIEW'));
});
test('empty or ambiguous first deployment response is rejected',async()=>{
 for(const deployments of [[],[{},{}]]){const api=transport(async()=>response({deployments}));await assert.rejects(()=>api.request('GET',ACTIVE_DEPLOYMENT_PATH),/ACTIVE_DEPLOYMENT_RESPONSE_REJECTED/);}
});

test('unknown active fields report only names and remain rejected',()=>{
 const v=version();v.unreviewed_setting={value:'must-never-be-printed',token:'also-private'};v.another_option='sensitive-value';
 let error;try{activeConfiguration(v);}catch(e){error=e;}
 assert.equal(error.message,'UNREVIEWED_ACTIVE_VERSION_FIELD');
 const lines=formatReleaseFailure(error).split('\n');assert.equal(lines[0],'NO_GO: UNREVIEWED_ACTIVE_VERSION_FIELD');
 assert.deepEqual(JSON.parse(lines[1]),{unreviewedFieldNames:['another_option','unreviewed_setting'],valuesIncluded:false});
 for(const value of ['must-never-be-printed','also-private','sensitive-value'])assert(!lines.join('').includes(value));
});
test('failure formatter redacts unusual field names and arbitrary exception values',()=>{
 const v=version();v['injected\nprivate-value']='hidden';let error;try{activeConfiguration(v);}catch(e){error=e;}
 const output=formatReleaseFailure(error);assert(!output.includes('private-value'));assert(!output.includes('hidden'));assert(output.includes('<redacted-field-name>'));
 assert.equal(formatReleaseFailure(Error('request failed token=secret')),'NO_GO: LOCAL_RELEASE_OPERATION_FAILED');
});

test('unverified env remains rejected and diagnostics reveal only structural metadata',()=>{
 const v=version();v.env={name:'production',service:WORKER,token:'do-not-print-secret',variables:{PRIVATE:'do-not-print-variable'}};
 let error;try{activeConfiguration(v);}catch(e){error=e;}
 assert.equal(error.message,'ENV_BINDING_PROJECTION_UNVERIFIED');
 const output=formatReleaseFailure(error),shape=JSON.parse(output.split('\n')[1]).envShape;
 assert.equal(shape.type,'object');assert.deepEqual(shape.fieldNames,['name','service','token','variables']);assert.equal(shape.identityChecks.name.isProduction,true);assert.equal(shape.identityChecks.service.isWorker,true);
 assert(!output.includes('do-not-print'));assert(!output.includes('PRIVATE'));assert.equal(shape.valuesIncluded,false);
});
test('env scalar, null and array shapes do not disclose contents',()=>{
 for(const value of [null,'private-environment',['secret-array-entry']]){
  const v=version();v.env=value;let error;try{activeConfiguration(v);}catch(e){error=e;}
  const output=formatReleaseFailure(error);assert(output.includes('envShape'));assert(!output.includes('private-environment'));assert(!output.includes('secret-array-entry'));
 }
 assert.equal(describeUnreviewedEnv('production').isProductionString,true);
});
test('env diagnostic redacts unsafe keys without accepting the configuration',()=>{
 const v=version();v.env={'unsafe\nkey':'secret',ADMIN_ENABLED:'private-value'};let error;try{activeConfiguration(v);}catch(e){error=e;}
 const output=formatReleaseFailure(error);assert(!output.includes('unsafe'));assert(!output.includes('private-value'));assert(output.includes('<redacted-field-name>'));assert(output.startsWith('NO_GO: ENV_BINDING_PROJECTION_UNVERIFIED'));
});

function envProjection(v){return Object.fromEntries(v.bindings.map(b=>{const {name,...entry}=b;return [name,entry];}));}
test('verified 16-binding env projection produces identical configuration without exporting env',()=>{
 const v=version(),expected=activeConfiguration(v);v.env=envProjection(v);assert.equal(Object.keys(v.env).length,16);
 const actual=activeConfiguration(v);assert.deepEqual(actual,expected);assert(!Object.hasOwn(actual,'env'));
 const p=createPayload({...baseline(),configuration:actual},modules);assert.equal(secret(p).version_id,STABLE_VERSION);assert(!Object.hasOwn(p,'env'));
});
test('equivalent plaintext scalar and D1 id alias in env are checked against active bindings',()=>{
 const v=version();v.env=envProjection(v);v.env.ADMIN_ENABLED=flags.ADMIN_ENABLED;v.env.DB.database_id=v.env.DB.id;delete v.env.DB.id;
 assert.deepEqual(activeConfiguration(v),activeConfiguration(version()));
});
test('env binding entries including exact names are accepted only when equal',()=>{
 const v=version();v.env=Object.fromEntries(v.bindings.map(b=>[b.name,copy(b)]));assert.deepEqual(activeConfiguration(v),activeConfiguration(version()));
 v.env.DB.name='OTHER';assert.throws(()=>activeConfiguration(v),/ENV_BINDING_PROJECTION_UNVERIFIED/);
});
for(const mutate of [v=>{v.env.ADMIN_ACCESS_AUD.text='changed-audience';},v=>{v.env.DB.id='changed-database';},v=>{v.env.DB.database_id='conflict';},v=>{v.env.CFL_ASSETS.bucket_name='other';},v=>{v.env.ADMIN_DRAW_KEY='must-not-be-exported';},v=>{v.env.ADMIN_DRAW_KEY.text='must-not-be-exported';},v=>{delete v.env.ADMIN_ENABLED;},v=>{v.env.EXTRA={type:'service'};},v=>{v.env.ASSETS.extra='unexpected';}])test('env mismatch is rejected without leaking values '+mutate.toString(),()=>{
 const v=version();v.env=envProjection(v);mutate(v);let error;try{activeConfiguration(v);}catch(e){error=e;}
 assert.equal(error.message,'ENV_BINDING_PROJECTION_UNVERIFIED');const output=formatReleaseFailure(error);
 for(const value of ['changed-audience','changed-database','must-not-be-exported','unexpected'])assert(!output.includes(value));
 assert(!JSON.stringify(error.envDiagnostics).includes('must-not-be-exported'));
});

test('activation review uses only read-only version, rollback and routing metadata',async()=>{
 const calls=[],values=metadata();
 const result=await liveActivationReview({baseline:baseline(),payload:payload(),get:async path=>{
  calls.push(path);if(path===MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules')return {...version(),id:UPLOADED_VERSION,main_module:'entry.mjs',modules:copy(modules)};
  assert(METADATA_PATHS.includes(path));return copy(values[METADATA_PATHS.indexOf(path)]);
 }});
 assert.equal(result.rollbackVersionId,STABLE_VERSION);assert.equal(result.stableTraffic,100);assert.equal(result.uploadedArtifactMatchesApproved,true);assert.equal(calls.length,22);
});
test('activation review rejects wrong uploaded artifact and unavailable rollback metadata',async()=>{
 const values=metadata();
 await assert.rejects(()=>liveActivationReview({baseline:baseline(),payload:payload(),get:async path=>path.includes(UPLOADED_VERSION)?{...version(),id:UPLOADED_VERSION,main_module:'entry.mjs',modules:[]}:copy(values[METADATA_PATHS.indexOf(path)])}),/UPLOADED_ARTIFACT_MISMATCH/);
 await assert.rejects(()=>liveActivationReview({baseline:baseline(),payload:payload(),get:async path=>{if(path===MODERN+'/versions/'+STABLE_VERSION)throw Error('ROLLBACK_UNAVAILABLE');return copy(values[METADATA_PATHS.indexOf(path)]);}}),/ROLLBACK_UNAVAILABLE/);
});
test('qualification scope review rejects any additional homepage change',()=>{
 const prefix='prefix\n',old='/*\n * Tournament winners are the teams already guaranteed\n */\nold selection\n',rest='const remainingSpots = 0;\n{team.isTournamentWinner ? (\n{team.isTournamentWinner ? (';
 const before=prefix+old+rest;
 const after=prefix+'const ALL_STAR_SPOTS = 10;\nconst qualifiedTeams = standings.slice(0, ALL_STAR_SPOTS);\nconst allStarSpots = ALL_STAR_SPOTS;\n\n'+rest.replaceAll('{team.isTournamentWinner ? (','{qualifiedTeams.includes(team) ? (');
 assert.equal(qualificationOnly(before,after),true);assert.throws(()=>qualificationOnly(before,after+'\nchanged loader'),/UNRELATED_HOMEPAGE_CHANGE/);
});

function activeResponse(result){return {ok:true,redirected:false,json:async()=>({success:true,result})};}
test('activation transport permits only one exact approved deployment after arming',async()=>{
 const calls=[],api=activationTransport({token:'test-token',check:()=>{},fetcher:async(url,init)=>{calls.push([url,init]);return activeResponse({id:newID});}});
 api.arm();await api.post(ACTION.path,ACTION.body);assert.equal(calls.length,1);assert(calls[0][0].endsWith(ACTION.path));assert.equal(calls[0][1].body,JSON.stringify(ACTION.body));await assert.rejects(()=>api.post(ACTION.path,ACTION.body),/POST_SCOPE_REJECTED/);assert.equal(calls.length,1);
});
for(const [path,body]of [[ACTION.path+'?force=true',ACTION.body],[ACTION.path,{...ACTION.body,versions:[{version_id:STABLE_VERSION,percentage:100}]}],[ACTION.path,{...ACTION.body,versions:[{version_id:UPLOADED_VERSION,percentage:50}]}],[ACTION.path,{...ACTION.body,annotations:{unexpected:'value'}}],[SCRIPT+'/settings',ACTION.body]])test('activation denies unapproved mutation '+path+' '+JSON.stringify(body),async()=>{
 let calls=0;const api=activationTransport({token:'test-token',check:()=>{},fetcher:async()=>{calls++;return activeResponse({});}});api.arm();await assert.rejects(()=>api.post(path,body),/POST_SCOPE_REJECTED/);assert.equal(calls,0);
});
test('activation transport rejects unarmed deployment and expired checks before network',async()=>{
 let calls=0;const api=activationTransport({token:'test-token',check:()=>{},fetcher:async()=>{calls++;return activeResponse({});}});await assert.rejects(()=>api.post(ACTION.path,ACTION.body),/POST_SCOPE_REJECTED/);assert.equal(calls,0);
 const denied=activationTransport({token:'test-token',check:()=>{throw Error('ACTIVATION_APPROVAL_EXPIRED');},fetcher:async()=>{calls++;return activeResponse({});}});await assert.rejects(()=>denied.get(METADATA_PATHS[0]),/APPROVAL_EXPIRED/);assert.equal(calls,0);
});
test('ambiguous activation network failure stops without retry or automatic rollback',async()=>{
 let calls=0;const api=activationTransport({token:'test-token',check:()=>{},fetcher:async()=>{calls++;throw Error('sensitive-token');}});api.arm();await assert.rejects(()=>api.post(ACTION.path,ACTION.body),/^Error: ACTIVATION_OUTCOME_UNCERTAIN_NETWORK_FAILURE$/);await assert.rejects(()=>api.get(METADATA_PATHS[0]),/STOPPED_NO_RETRY/);assert.equal(calls,1);
});
test('guarded activation validates before mutation and verifies traffic, routing and rollback twice',async()=>{
 const values=metadata(),calls=[];let activated=false,claims=0,recorded=false;
 const api=activationTransport({token:'test-token',check:()=>{},fetcher:async(url,init)=>{
  const path=url.replace('https://api.cloudflare.com/client/v4','');calls.push([init.method,path]);
  if(init.method==='POST'){activated=true;return activeResponse({id:newID,versions:copy(ACTION.body.versions)});}
  if(path===METADATA_PATHS[0]&&activated)return activeResponse({deployments:[{id:newID,versions:copy(ACTION.body.versions)}]});
  if(path===MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules')return activeResponse({...version(),id:UPLOADED_VERSION,main_module:'entry.mjs',modules:copy(modules)});
  return activeResponse(copy(values[METADATA_PATHS.indexOf(path)]));
 }});
 const b=baseline(),result=await executeActivation({api,activation:{baseline:b,digest:'reviewed-digest'},upload:{payload:payload(),baseline:b},claim:()=>{claims++;},record:()=>{recorded=true;}});
 assert.equal(result.status,'ACTIVATED_VERIFIED');assert.equal(result.traffic,100);assert.equal(claims,1);assert.equal(recorded,true);assert.equal(calls.filter(([method])=>method==='POST').length,1);assert.equal(result.databaseRequests,0);assert.equal(result.automaticRollbackPerformed,false);
});
test('failed fresh activation baseline never claims or sends a deployment',async()=>{
 const values=metadata();values[0].deployments[0].versions[0].percentage=90;let claims=0,posts=0;
 const api=activationTransport({token:'test-token',check:()=>{},fetcher:async(url,init)=>{if(init.method==='POST')posts++;return activeResponse(copy(values[METADATA_PATHS.indexOf(url.replace('https://api.cloudflare.com/client/v4',''))]));}});
 await assert.rejects(()=>executeActivation({api,activation:{baseline:baseline()},upload:{payload:payload()},claim:()=>{claims++;},record:()=>{}}),/TRAFFIC_CHANGED/);assert.equal(claims,0);assert.equal(posts,0);
});

test('postflight accepts read-only deployment enrichment but requires exact UUID and numeric 100%',()=>{
 assert(exactTraffic([{version_id:UPLOADED_VERSION,percentage:100,created_on:'2026-11-11',metadata:{read_only:true}}],UPLOADED_VERSION));
 for(const versions of [[{version_id:STABLE_VERSION,percentage:100}],[{version_id:UPLOADED_VERSION,percentage:99}],[{version_id:UPLOADED_VERSION,percentage:'100'}],[{version_id:UPLOADED_VERSION,percentage:100},{version_id:STABLE_VERSION,percentage:1}],[]])assert.equal(exactTraffic(versions,UPLOADED_VERSION),false);
});
test('read-only recovery verifies already active deployment without making any mutation',async()=>{
 const b=baseline(),calls=[],active={id:newID,versions:[{version_id:UPLOADED_VERSION,percentage:100,created_on:'metadata'}]};
 const result=await verifyActivationReadOnly({activation:{baseline:b,digest:'approved'},upload:{baseline:b,payload:payload()},submitted:{deploymentId:newID},get:async path=>{
  calls.push(path);if(path===METADATA_PATHS[0])return {deployments:[copy(active)]};if(path===MODERN+'/versions/'+UPLOADED_VERSION+'?include=modules')return {...version(),id:UPLOADED_VERSION,main_module:'entry.mjs',modules:copy(modules)};
  const values=metadata();assert(METADATA_PATHS.includes(path));return copy(values[METADATA_PATHS.indexOf(path)]);
 }});
 assert.equal(result.status,'ACTIVATED_VERIFIED');assert.equal(result.traffic,100);assert.equal(result.trafficChangedByVerification,false);assert.equal(calls.length,13);assert(result.deploymentVersionFields.includes('created_on'));
});
test('read-only recovery reports stable still active without attempting activation',async()=>{
 const result=await verifyActivationReadOnly({get:async path=>{assert.equal(path,METADATA_PATHS[0]);return metadata()[0];},activation:{},upload:{},submitted:{}});assert.equal(result.status,'NOT_ACTIVATED_STABLE_ACTIVE');
});
test('read-only recovery rejects unexpected traffic with sanitized deployment identity',async()=>{
 let error;try{await verifyActivationReadOnly({get:async()=>({deployments:[{id:newID,versions:[{version_id:UPLOADED_VERSION,percentage:50}]}]}),activation:{},upload:{},submitted:{deploymentId:newID}});}catch(e){error=e;}
 assert.equal(error.message,'ACTIVE_DEPLOYMENT_OR_TRAFFIC_UNEXPECTED');assert.equal(error.deploymentSummary.versions[0].percentage,50);
});
