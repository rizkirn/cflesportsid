'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),root=repo+'/scripts/production';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const scenario of ['accepted','expired','wrong operation','wrong target','wrong digest','modified config','ambiguous environment','repeated attempt','blocked plan','accepted d1 baseline','wrong active mode','default config'])test('preload '+scenario,()=>{
 const fixture=fs.mkdtempSync(require('node:os').tmpdir()+'/cfl-production-preload-');fs.chmodSync(fixture,0o700);
 for(const n of ['upload-preload.cjs','upload-request-guard.cjs'])fs.copyFileSync(root+'/'+n,fixture+'/'+n);
 const preload=fixture+'/upload-preload.cjs';fs.writeFileSync(preload,fs.readFileSync(preload,'utf8').replace("repo=path.resolve(__dirname,'../..')",'repo='+JSON.stringify(repo)));
 const asset=fixture+'/artifact';fs.mkdirSync(asset);fs.writeFileSync(asset+'/entry.mjs','export default {};');
 const configPath=repo+'/wrangler.production.jsonc',configSHA=sha(fs.readFileSync(configPath));
 const target={account:'bf6ed4ccd73133871881b47ea58dae3d',database:'efded3c4-1cf9-46a9-823e-d0f2d17c683a',databaseName:'cflesportsid',worker:'cflesportsid',hostname:'cflesports.com'};
 const now=Date.now(),cli=repo+'/node_modules/wrangler/wrangler-dist/cli.js';
 const body={readiness:{status:'READY'},operation:'production-d1-cutover',target,issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),artifact:{directory:asset,sha256:sha(JSON.stringify({'entry.mjs':{bytes:18,sha256:sha('export default {};')}}))},configuration:{path:configPath,sha256:configSHA},baseline:{mode:'hybrid',versionId:'mock-active-version',deploymentId:'mock-active-deployment',fingerprints:{mock:'fingerprint'}},localGuards:Object.fromEntries(['upload-preload.cjs','upload-request-guard.cjs'].map(n=>[n,sha(fs.readFileSync(root+'/'+n))])),execution:{uploadArguments:['versions','upload'],wranglerCLI_SHA256:sha(fs.readFileSync(cli))}};
 if(scenario==='accepted d1 baseline')body.baseline.mode='d1';
 if(scenario==='default config')body.configuration={path:repo+'/wrangler.jsonc',sha256:sha(fs.readFileSync(repo+'/wrangler.jsonc'))};
 if(scenario==='blocked plan')body.readiness.status='BLOCKED';
 const plan={...body,digest:sha(JSON.stringify(body))};
 const approval={approved:true,operation:body.operation,target,planDigest:plan.digest,issuedAt:body.issuedAt,expiresAt:body.expiresAt};
 if(scenario==='expired')approval.expiresAt=new Date(now-500).toISOString();
 if(scenario==='wrong operation')approval.operation='identity-backfill';
 if(scenario==='wrong target')approval.target={...target,worker:'cflesportsid-uat'};
 if(scenario==='wrong digest')approval.planDigest='0'.repeat(64);
 if(scenario==='modified config')body.configuration.sha256='0'.repeat(64);
 const write=(n,v)=>fs.writeFileSync(fixture+'/'+n,JSON.stringify(v),{mode:0o600});
 write('production-deployment-plan.json',plan);write('deployment-approval.json',approval);write('deployment-preflight.json',{status:'PASS',target,versionId:body.baseline.versionId,deploymentId:body.baseline.deploymentId,traffic:100,mode:scenario==='wrong active mode'?'shadow':body.baseline.mode,checkedAt:new Date(now).toISOString(),fingerprints:body.baseline.fingerprints});
 const env={PATH:process.env.PATH,HOME:process.env.HOME,CI:'true',CLOUDFLARE_API_TOKEN:'LOCAL_MOCK_NOT_A_CREDENTIAL',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'};
 if(scenario==='ambiguous environment')env.CFL_PUBLIC_MODE='d1';
 const script="process.argv=[process.execPath,"+JSON.stringify(cli)+",'versions','upload'];require("+JSON.stringify(repo+'/node_modules/undici')+");globalThis[Symbol.for('undici.globalDispatcher.1')]={dispatch(){throw Error('MOCK_ONLY_NO_NETWORK');},close(){},destroy(){}};require("+JSON.stringify(fixture+'/upload-preload.cjs')+");const guard=globalThis[Symbol.for('undici.globalDispatcher.1')];if(Object.getOwnPropertyDescriptor(globalThis,Symbol.for('undici.globalDispatcher.1')).writable)throw Error('UNLOCKED');try{guard.dispatch({origin:'https://evil.example',path:'/',method:'GET'},{});throw Error('HOST_ACCEPTED');}catch(e){if(e.message!=='UPLOAD_ORIGIN_REJECTED')throw e;}";
 const run=()=>spawnSync(process.execPath,['-e',script],{env,cwd:fixture,encoding:'utf8'});
 if(scenario==='accepted'||scenario==='accepted d1 baseline'||scenario==='repeated attempt'){const result=run();assert.equal(result.status,0,result.stderr);if(scenario==='repeated attempt')assert.notEqual(run().status,0);}else assert.notEqual(run().status,0);
 assert.equal(fs.existsSync(fixture+'/upload-request-audit.jsonl'),false);
 if(scenario==='accepted'||scenario==='accepted d1 baseline'||scenario==='repeated attempt'){
  const p=fixture+'/upload-request-rejections.jsonl',events=fs.readFileSync(p,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(events,[{method:'GET',path:'/',category:'UPLOAD_ORIGIN_REJECTED'}]);
  assert.equal(fs.statSync(p).mode&0o777,0o600);
 }
});
