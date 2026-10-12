import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createTailSession,tailFilters,validateTailURL} from '../scripts/phase2c/tail-session.mjs';
import {createShadowCollector} from '../scripts/phase2c/shadow-diagnostics.mjs';
import {prepareDiagnosticPlan,validateDiagnosticApproval,planDigest,runDiagnostic,rejectEnvironmentOverrides,verifyVersionPreservation} from '../scripts/phase2c/tail-diagnostic.mjs';
import {UAT} from '../src/data-access/public-mode.mjs';
const version='7c776a53-7832-4753-aad5-ef2e191a8687',marker='cflshadowrun-'+ 'a'.repeat(32),id='a'.repeat(32);
const makeCollector=()=>createShadowCollector({versionId:version,marker,routes:[{path:'/',shadowDiagnosticRequired:true}]});
const event=(collector,change={})=>({scriptName:UAT.worker,scriptVersion:{id:version},event:{request:{url:collector.canaryURL().href}},logs:[{message:['[public-shadow]',JSON.stringify(['database','teams','players','maps','matches','tournaments','statistics'].map(contract=>({contract,mismatches:0})))]}],...change});
class Socket extends EventEmitter {send(value,options,done){this.sent={value,options};done(this.sendError);}terminate(){this.emit('close',1006);}}
function fixture({delay=0,neverOpen=false,sendError=false,url='wss://tail.developers.workers.dev/'+id,cleanupError=false,timeoutMs=50}={}){
 const collector=makeCollector(),calls=[],socket=new Socket();socket.sendError=sendError?Error('private'):null;let options;
 const session=createTailSession({token:'TEST_ONLY',collector,versionId:version,timeoutMs,
 fetcher:async(path,init)=>{calls.push({path,...init});if(init.method==='DELETE'&&cleanupError)throw Error('private token');return {ok:true,json:async()=>({success:true,result:{id,url,expires_at:new Date(Date.now()+60000).toISOString()}})};},
 socketFactory:(_url,protocol,opts)=>{options={protocol,...opts};if(!neverOpen)setTimeout(()=>socket.emit('open'),delay);return socket;}});
 return {session,collector,calls,socket,options:()=>options};
}
test('delayed open does not release readiness until subscription send completes',async()=>{const f=fixture({delay:20});let resolved=false;const start=f.session.start().then(()=>{resolved=true;});await new Promise(r=>setTimeout(r,5));assert.equal(resolved,false);assert.throws(()=>f.session.assertReady());await start;assert.ok(f.session.summary().connectedAt);assert.ok(f.session.summary().subscriptionSentAt);assert.equal(f.options().protocol,'trace-v1');assert.equal(f.options().followRedirects,false);assert.equal(f.options().headers.Authorization,undefined);await f.session.stop();assert.equal(f.session.summary().cleanup,'CONFIRMED');});
test('no open causes readiness timeout and cleanup',async()=>{const f=fixture({neverOpen:true,timeoutMs:5});await assert.rejects(f.session.start(),/TAIL_READINESS_TIMEOUT/);await f.session.stop();assert.equal(f.calls.filter(r=>r.method==='POST').length,1);});
test('connection errors sanitized and block readiness',async()=>{const f=fixture({neverOpen:true});const start=f.session.start();await new Promise(r=>setTimeout(r,0));f.socket.emit('error',Error('secret URL'));await assert.rejects(start,/TAIL_SOCKET_ERROR/);assert.ok(!JSON.stringify(f.session.summary()).includes('secret'));await f.session.stop();});
test('subscription failure is not ready',async()=>{const f=fixture({sendError:true});await assert.rejects(f.session.start(),/TAIL_SUBSCRIPTION_SEND_FAILED/);await f.session.stop();});
test('redirect handshake is rejected',async()=>{const f=fixture({neverOpen:true});const p=f.session.start();await new Promise(r=>setTimeout(r,0));f.socket.emit('unexpected-response',{}, {destroy(){}});await assert.rejects(p,/TAIL_HANDSHAKE_REJECTED/);await f.session.stop();});
test('incomplete JSON tracks bytes and buffer without completed events',async()=>{const f=fixture();await f.session.start();f.socket.emit('message',Buffer.from('{"event":'));const s=f.session.summary();assert.equal(s.bytesReceived,9);assert.equal(s.bufferedBytes,9);assert.equal(s.completeEvents,0);assert.ok(s.firstByteAt);await f.session.stop();});
test('fragmented JSON completes and counters contain no raw values',async()=>{const f=fixture();await f.session.start();const raw=JSON.stringify(event(f.collector));f.socket.emit('message',Buffer.from(raw.slice(0,20)));f.socket.emit('message',Buffer.from(raw.slice(20)));assert.equal(f.session.summary().completeEvents,1);assert.equal(f.session.summary().bufferedBytes,0);assert.equal(f.session.summary().chunksReceived,2);await f.session.stop();});
test('stream interruption fails closed without reconnect',async()=>{const f=fixture();await f.session.start();f.socket.emit('close',1001);await assert.rejects(f.session.failure,/TAIL_STREAM_CLOSED/);assert.throws(()=>f.session.assertReady());await f.session.stop();assert.equal(f.calls.filter(r=>r.method==='POST').length,1);});
test('wrong Worker version never accepted even without server filter',async()=>{const f=fixture();await f.session.start();f.socket.emit('message',Buffer.from(JSON.stringify(event(f.collector,{scriptVersion:{id:'a473a4df-9aeb-4b7e-bd70-9260ea5477b4'}}))));await assert.rejects(f.session.failure,/SHADOW_VERSION_REJECTED/);assert.equal(f.collector.summary().comparisonsAccepted,0);await f.session.stop();});
test('canary timeout retains zero events and stops',async()=>{const f=fixture();await f.session.start();await assert.rejects(f.collector.waitForCanary(5),/SHADOW_CANARY_TIMEOUT/);assert.equal(f.collector.summary().eventsReceived,0);await f.session.stop();});
test('event without diagnostics cannot pass canary',async()=>{const f=fixture();await f.session.start();f.socket.emit('message',Buffer.from(JSON.stringify(event(f.collector,{logs:[]}))));await assert.rejects(f.collector.waitForCanary(5),/SHADOW_CANARY_TIMEOUT/);assert.equal(f.collector.summary().eventsWithoutDiagnostics,1);await f.session.stop();});
test('untrusted socket URL rejected and known session deleted',async()=>{const f=fixture({url:'wss://evil.example/private'});await assert.rejects(f.session.start(),/TAIL_URL_REJECTED/);await f.session.stop();assert.equal(f.calls.at(-1).method,'DELETE');});
for(const url of ['https://tail.developers.workers.dev/x','wss://user:token@tail.developers.workers.dev/x','wss://tail.developers.workers.dev.evil/x','wss://tail.developers.workers.dev:444/x'])test('URL fail closed '+url,()=>assert.throws(()=>validateTailURL(url),/TAIL_URL_REJECTED/));
test('only server version filter can be removed',()=>{assert.deepEqual(tailFilters(version,true),{filters:[{method:['GET']}]});assert.deepEqual(tailFilters(version),{filters:[{method:['GET']},{scriptVersion:version}]});assert.throws(()=>tailFilters(version,'true'));});
test('cleanup failure reported without retry',async()=>{const f=fixture({cleanupError:true});await f.session.start();await assert.rejects(f.session.stop(),/TAIL_CLEANUP_UNCONFIRMED/);assert.equal(f.session.summary().cleanup,'UNCONFIRMED');assert.equal(f.calls.filter(r=>r.method==='DELETE').length,1);});
const plan=()=>prepareDiagnosticPlan('/private/tmp/cfl-tail-diagnostic-tests');
test('fresh digest approval valid locally',()=>{const p=plan();validateDiagnosticApproval(p,planDigest(p));});
for(const change of ['digest','expired','target','operation','transport','source','mode','scope'])test('approval rejects '+change,()=>{const p=plan();let digest;if(change==='expired')p.expiresAt=new Date(Date.now()-1000).toISOString();if(change==='target')p.target={...p.target,worker:'cflesportsid'};if(change==='operation')p.operation='deploy';if(change==='transport')p.transport='wrangler-fixed-delay';if(change==='source')p.sources={};if(change==='mode')p.mode='d1';if(change==='scope')p.homepageRequests=204;digest=change==='digest'?'0'.repeat(64):planDigest(p);assert.throws(()=>validateDiagnosticApproval(p,digest));});
test('ambiguous environment rejected',()=>{assert.throws(()=>rejectEnvironmentOverrides({WRANGLER_ENV:'production'}));assert.throws(()=>rejectEnvironmentOverrides({HTTPS_PROXY:'private'}));rejectEnvironmentOverrides({CLOUDFLARE_API_TOKEN:'TEST_ONLY'});});
async function runFixture({badVersion=false,badAuth=false,interrupt=false,missing=false,claimError=false,approvalError=false}={}){
 const p=plan();p.canaryTimeoutMs=10;const body='OK';p.baseline.row={index:0,status:200,sha256:createHash('sha256').update(body).digest('hex'),headers:{}};
 let posts=0,home=0,deletes=0,verifies=0;const socket=new Socket();
 const result=await runDiagnostic({preserve:async()=>{},plan:p,approvedDigest:'TEST_ONLY',token:'TEST_ONLY',validateApproval:()=>{if(approvalError)throw Error('DIAGNOSTIC_APPROVAL_EXPIRED');},claim:()=>{if(claimError)throw Error('OPERATION_ALREADY_ATTEMPTED');},
 verify:async()=>{verifies++;return {status:'PASS',target:UAT,mode:'shadow',...p.expected,workerSettings:{fingerprint:p.expected.workerSettingsFingerprint},...(badAuth?{authenticationFingerprint:'wrong'}:{})};},
 socketFactory:()=>{setTimeout(()=>socket.emit('open'),0);return socket;},
 fetcher:async(url,options)=>{
  if(options.method==='POST'){posts++;return {ok:true,json:async()=>({success:true,result:{id,url:'wss://tail.developers.workers.dev/'+id,expires_at:new Date(Date.now()+60000).toISOString()}})};}
  if(options.method==='DELETE'){deletes++;return {ok:true,json:async()=>({success:true})};}
  home++;assert.ok(socket.sent);assert.equal(url.hostname,UAT.hostname);assert.equal(url.pathname,'/');assert.equal(options.method,'GET');
  if(interrupt)socket.emit('close',1001);else{
   const c=createShadowCollector({versionId:version,marker:p.marker,routes:[{path:'/',shadowDiagnosticRequired:true}]});
   socket.emit('message',Buffer.from(JSON.stringify(event(c,{...(badVersion?{scriptVersion:{id:'a473a4df-9aeb-4b7e-bd70-9260ea5477b4'}}:{}),...(missing?{logs:[]}:{})}))));
  }
  return {status:200,text:async()=>body,headers:{get:()=>null}};
 }});return {result,posts,home,deletes,verifies};
}
test('runner waits for ready, performs one GET, verifies and cleans up without matrix',async()=>{const f=await runFixture();assert.equal(f.result.status,'PASS');assert.equal(f.posts,1);assert.equal(f.home,1);assert.equal(f.deletes,1);assert.equal(f.verifies,3);assert.equal(f.result.matrixRequests,0);assert.equal(f.result.collector.matrixStarted,false);});
for(const kind of ['badVersion','interrupt','missing'])test('runner stops and cleans up '+kind,async()=>{const f=await runFixture({[kind]:true});assert.equal(f.result.status,'BLOCKED');assert.equal(f.home,1);assert.equal(f.deletes,1);assert.equal(f.result.matrixRequests,0);});
for(const kind of ['badAuth','claimError','approvalError'])test('runner rejects before initialization '+kind,async()=>{const f=await runFixture({[kind]:true});assert.equal(f.result.status,'BLOCKED');assert.equal(f.posts,0);assert.equal(f.home,0);});

test('preservation reads only exact pinned UAT version and rejects changed resources',async()=>{
 await assert.rejects(verifyVersionPreservation({token:'TEST_ONLY',fetcher:async(url,init)=>{assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+UAT.account+'/workers/scripts/'+UAT.worker+'/versions/'+version);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');return {ok:true,json:async()=>({success:true,result:{id:version,resources:{bindings:[]}}})};}}),/DIAGNOSTIC_BINDINGS_CHANGED/);
});
test('version preservation HTTP failures are sanitized',async()=>{
 await assert.rejects(verifyVersionPreservation({token:'TEST_ONLY',fetcher:async()=>({ok:false,status:403})}),/DIAGNOSTIC_VERSION_HTTP_403/);
});
