import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicMarker,createShadowCollector,validateShadowRun} from '../scripts/phase2c/shadow-diagnostics.mjs';
import {UAT} from '../src/data-access/public-mode.mjs';
const versionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const routes=[{path:'/',shadowDiagnosticRequired:true},{path:'/players/',shadowDiagnosticRequired:true},{path:'/asset.svg',shadowDiagnosticRequired:false}];
function fixture(){return createShadowCollector({versionId,routes});}
function event(c,{path='/',phase='canary',marker=c.marker,host=UAT.hostname,version=versionId,worker=UAT.worker,diagnostics=[{contract:'database',mismatches:0}]}={}){
 return {scriptName:worker,scriptVersion:{id:version},event:{request:{url:'https://'+host+path+'?cfl_shadow_run='+marker+'&cfl_shadow_probe='+phase,headers:{cookie:'PRIVATE_COOKIE'}}},logs:[{message:['[public-shadow]',JSON.stringify(diagnostics)]}]};
}
async function start(c){return c.runMatrix({sendCanary:async()=>c.acceptEvent(event(c)),runMatrix:async()=>true});}
test('public marker avoids documented hex and base64 redaction heuristics',()=>{
 const markers=new Set();for(let i=0;i<100;i++){
  const m=createPublicMarker();markers.add(m);assert.match(m,/^cflshadowrun-[a-f0-9]{32}$/);
  assert.ok(!/^[a-f0-9+_-]+$/i.test(m));assert.equal((m.match(/[A-Z]/g)??[]).length,0);
 }assert.equal(markers.size,100);
});
test('UUID correlation rejected',()=>assert.throws(()=>createShadowCollector({versionId,routes,marker:versionId}),/SHADOW_MARKER_INVALID/));
test('missing version rejected',()=>assert.throws(()=>createShadowCollector({routes}),/SHADOW_VERSION_REQUIRED/));
for(const [name,changes,counter]of [['wrong host',{host:'cflesports.com'},'eventsRejectedByHost'],['wrong run',{marker:'another-public-run'},'eventsRejectedByMarker'],['redacted marker',{marker:'REDACTED'},'eventsRejectedByMarker']])test(name+' rejection counted',()=>{
 const c=fixture();c.acceptEvent(event(c,changes));assert.equal(c.summary()[counter],1);assert.equal(c.summary().comparisonsAccepted,0);assert.equal(c.summary().eventsReceived,1);
});
for(const changes of [{version:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},{worker:'cflesportsid'}])test('incorrect Worker/version fails closed '+JSON.stringify(changes),()=>{
 const c=fixture();assert.throws(()=>c.acceptEvent(event(c,changes)),/SHADOW_VERSION_REJECTED/);assert.equal(c.summary().eventsRejectedByVersion,1);
});
test('missing version fails closed',()=>{const c=fixture(),e=event(c);delete e.scriptVersion;assert.throws(()=>c.acceptEvent(e),/SHADOW_VERSION_REJECTED/);});
test('matrix URL inaccessible before canary',()=>assert.throws(()=>fixture().matrixURL('/'),/SHADOW_CANARY_REQUIRED/));
test('canary timeout blocks matrix permanently',async()=>{
 const c=fixture();let started=false;
 await assert.rejects(()=>c.runMatrix({sendCanary:async()=>{},runMatrix:async()=>{started=true;},timeoutMs:5}),/SHADOW_CANARY_TIMEOUT/);
 assert.equal(started,false);assert.throws(()=>c.acceptEvent(event(c)),/SHADOW_CANARY_TIMEOUT/);
});
test('canary request failure blocks matrix',async()=>{
 const c=fixture();let started=false;await assert.rejects(()=>c.runMatrix({sendCanary:async()=>{throw Error('PRIVATE');},runMatrix:async()=>{started=true;},timeoutMs:5}),/SHADOW_CANARY_REQUEST_FAILED/);assert.equal(started,false);
});
test('canary lacking diagnostics does not unlock matrix',async()=>{
 const c=fixture(),e=event(c);e.logs=[];await assert.rejects(()=>c.runMatrix({sendCanary:async()=>c.acceptEvent(e),runMatrix:async()=>assert.fail(),timeoutMs:5}),/SHADOW_CANARY_TIMEOUT/);assert.equal(c.summary().eventsWithoutDiagnostics,1);
});
test('successful canary unlocks matrix and complete coverage passes',async()=>{
 const c=fixture();await c.runMatrix({sendCanary:async()=>c.acceptEvent(event(c)),runMatrix:async()=>{
  for(const path of ['/','/players/']){assert.equal(c.matrixURL(path).hostname,UAT.hostname);c.acceptEvent(event(c,{path,phase:'matrix'}));}
 }});const report=c.finish();assert.equal(report.comparisonsAccepted,3);assert.equal(report.diagnosticRequests,2);assert.deepEqual(report.missingDiagnosticRoutes,[]);assert.equal(report.eventsReceived,3);assert.ok(!JSON.stringify(report).includes('PRIVATE_COOKIE'));
});
test('canary does not satisfy matrix route coverage',async()=>{const c=fixture();await start(c);assert.throws(()=>c.finish(),/SHADOW_DIAGNOSTICS_MISSING/);});
test('repeat matrix rejected',async()=>{const c=fixture();await start(c);await assert.rejects(()=>start(c),/SHADOW_MATRIX_ALREADY_STARTED/);});
test('duplicate diagnostic events rejected',async()=>{const c=fixture();await start(c);c.acceptEvent(event(c,{phase:'matrix'}));assert.throws(()=>c.acceptEvent(event(c,{phase:'matrix'})),/SHADOW_DUPLICATE_EVENT/);});
test('unexplained mismatches fail and remain counted',()=>{const c=fixture();assert.throws(()=>c.acceptEvent(event(c,{diagnostics:[{contract:'database',mismatches:1}]})),/SHADOW_COMPARISON_FAILED/);assert.equal(c.summary().mismatchCount,1);});
test('failed canary retains only validated contract metadata and cannot unlock the matrix',()=>{
 const c=fixture(),diagnostics=[{contract:'database',mismatches:0},{contract:'tournaments',mismatches:2,fields:['stages']}];
 assert.throws(()=>c.acceptEvent(event(c,{diagnostics})),/SHADOW_COMPARISON_FAILED/);
 const report=c.summary();
 assert.deepEqual(report.rejectedDiagnostics,[{index:0,phase:'canary',diagnostics}]);
 assert.equal(report.comparisonsAccepted,0);assert.equal(report.canaryCaptured,false);assert.equal(report.matrixStarted,false);
 assert.equal(report.mismatchCount,2);assert.ok(!JSON.stringify(report).includes('PRIVATE_COOKIE'));
 report.rejectedDiagnostics[0].diagnostics[1].fields.push('private_registration');
 assert.deepEqual(c.summary().rejectedDiagnostics[0].diagnostics[1].fields,['stages']);
 assert.throws(()=>c.matrixURL('/'),/SHADOW_COMPARISON_FAILED/);
});
test('failed matrix diagnostic retains approved route index and phase',async()=>{
 const c=fixture();await start(c);
 const diagnostics=[{contract:'database',mismatches:0},{contract:'players',mismatches:1,fields:['ign']}];
 assert.throws(()=>c.acceptEvent(event(c,{path:'/players/',phase:'matrix',diagnostics})),/SHADOW_COMPARISON_FAILED/);
 assert.deepEqual(c.summary().rejectedDiagnostics,[{index:1,phase:'matrix',diagnostics}]);
 assert.equal(c.summary().comparisonsAccepted,1);
});
test('valid prefix followed by private metadata is rejected without retaining any diagnostics',()=>{
 const c=fixture();
 assert.throws(()=>c.acceptEvent(event(c,{diagnostics:[{contract:'tournaments',mismatches:2,fields:['stages']},{contract:'players',mismatches:1,fields:['private_registration']}]})),/SHADOW_DIAGNOSTIC_PRIVATE_FIELD/);
 assert.deepEqual(c.summary().rejectedDiagnostics,[]);assert.equal(c.summary().mismatchCount,0);
 assert.ok(!JSON.stringify(c.summary()).includes('private_registration'));
});
for(const [name,diagnostics]of [['private value',[{contract:'database',mismatches:0,secret:'PRIVATE'}]],['private field',[{contract:'players',mismatches:0,fields:['private_registration']}]],['unknown contract',[{contract:'PRIVATE',mismatches:0}]],['negative mismatch',[{contract:'database',mismatches:-1}]],['empty',[]]])test('rejects '+name+' diagnostics without exposure',()=>{
 const c=fixture();assert.throws(()=>c.acceptEvent(event(c,{diagnostics})),/SHADOW_DIAGNOSTIC/);assert.equal(c.summary().malformedEvents,1);assert.ok(!JSON.stringify(c.summary().diagnostics).includes('PRIVATE'));assert.ok(!JSON.stringify(c.summary()).includes('private_registration'));assert.equal(c.summary().comparisonsAccepted,0);
});
for(const size of [1,7,64,10000])test('fragmented JSON size '+size,()=>{
 const c=fixture(),text=Buffer.from(JSON.stringify(event(c),null,2));for(let i=0;i<text.length;i+=size)c.feed(text.subarray(i,i+size));assert.equal(c.summary().canaryCaptured,true);assert.equal(c.summary().diagnosticsRecognized,1);
});
test('fragmented UTF8 unrelated message is not retained',()=>{
 const c=fixture(),e=event(c);e.logs.push({message:['PRIVATE-🔒']});const data=Buffer.from(JSON.stringify(e));for(const byte of data)c.feed(Buffer.from([byte]));assert.equal(c.summary().canaryCaptured,true);assert.ok(!JSON.stringify(c.summary()).includes('PRIVATE'));
});
test('concatenated events parsed',async()=>{const c=fixture();await start(c);c.feed(JSON.stringify(event(c,{phase:'matrix'}))+JSON.stringify(event(c,{phase:'matrix',path:'/players/'})));assert.equal(c.finish().diagnosticRequests,2);});
for(const text of ['not JSON','{"broken":}',JSON.stringify({unexpected:'PRIVATE'})])test('malformed stream fails without retained content '+text.slice(0,12),()=>{
 const c=fixture();assert.throws(()=>c.feed(text),/SHADOW_STREAM_INVALID|SHADOW_EVENT_INVALID/);assert.equal(c.summary().malformedEvents,1);assert.ok(!JSON.stringify(c.summary()).includes('PRIVATE'));
});
test('incomplete event rejected on finish',async()=>{const c=fixture();await start(c);c.feed('{');assert.throws(()=>c.finish(),/SHADOW_STREAM_INCOMPLETE/);});
test('unknown correlated route fails',()=>{const c=fixture();assert.throws(()=>c.acceptEvent(event(c,{path:'/admin/'})),/SHADOW_ROUTE_OR_PHASE_REJECTED/);});
test('duplicate marker parameter is counted as rejected',()=>{const c=fixture(),e=event(c);e.event.request.url+='&cfl_shadow_run='+c.marker;c.acceptEvent(e);assert.equal(c.summary().eventsRejectedByMarker,1);});

test('validation entry point cannot report success with missing matrix diagnostics',async()=>{
 const collector=fixture();await assert.rejects(()=>validateShadowRun({collector,sendCanary:async()=>collector.acceptEvent(event(collector)),runMatrix:async()=>{}}),/SHADOW_DIAGNOSTICS_MISSING/);
});
test('validation entry point returns sanitized complete report',async()=>{
 const collector=fixture();const report=await validateShadowRun({collector,sendCanary:async()=>collector.acceptEvent(event(collector)),runMatrix:async()=>{
  for(const path of ['/','/players/'])collector.acceptEvent(event(collector,{path,phase:'matrix'}));
 }});assert.equal(report.failure,null);assert.equal(report.diagnosticRequests,2);
});
