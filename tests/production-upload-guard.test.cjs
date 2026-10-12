'use strict';
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {createUploadGuard,prefix,workerPath,servicePath,previewMetadataPath}=require('../scripts/production/upload-request-guard.cjs');
function setup() { let calls=0, handler; const guard=createUploadGuard({dispatch(o,h){calls++;handler=h;return true;},close(){},destroy(){}},{checkApproval(){},deadline:100,now:()=>1}); return {guard,get calls(){return calls;},get handler(){return handler;}}; }
const handlers={onHeaders(){return true;},onError(){}};
const options=(path,method='GET')=>({origin:'https://api.cloudflare.com',path,method});
for(const path of [workerPath+'/settings',workerPath+'/script-settings',workerPath+'/deployments',workerPath+'/versions',workerPath+'/subdomain']) test('allow metadata '+path.split('/').pop(),()=>{const s=setup();assert.equal(s.guard.dispatch(options(path),handlers),true);});
for(const [name,path,method] of [['configuration write',workerPath+'/script-settings','PATCH'],['activation',workerPath+'/deployments','POST'],['D1',prefix+'/d1/database/efded3c4-1cf9-46a9-823e-d0f2d17c683a/query','POST'],['R2',prefix+'/r2/buckets','GET'],['wrong worker',workerPath+'-uat/settings','GET'],['wrong account',workerPath.replace('bf6ed4ccd73133871881b47ea58dae3d','other')+'/settings','GET'],['auth refresh','/oauth2/token','POST'],['loose inheritance',workerPath+'/versions','POST']]) test('reject '+name,()=>{const s=setup();assert.throws(()=>s.guard.dispatch(options(path,method),handlers));assert.equal(s.calls,0);});
test('exactly one version upload',()=>{const s=setup(),o=options(workerPath+'/versions?bindings_inherit=strict','POST');s.guard.dispatch(o,handlers);assert.throws(()=>s.guard.dispatch(o,handlers),/REPLAY/);assert.equal(s.calls,1);});
test('exactly one asset session',()=>{const s=setup(),o=options(workerPath+'/assets-upload-session','POST');s.guard.dispatch(o,handlers);assert.throws(()=>s.guard.dispatch(o,handlers),/REPLAY/);assert.equal(s.calls,1);});
test('asset upload needs session',()=>{const s=setup();assert.throws(()=>s.guard.dispatch(options(prefix+'/workers/assets/upload?base64=true','POST'),handlers));assert.equal(s.calls,0);});
test('asset upload after session',()=>{const s=setup();s.guard.dispatch(options(workerPath+'/assets-upload-session','POST'),handlers);s.guard.dispatch(options(prefix+'/workers/assets/upload?base64=true','POST'),handlers);assert.equal(s.calls,2);});
for(const status of [302,401,429,500]) test('HTTP '+status+' blocks all subsequent transport',()=>{const s=setup();s.guard.dispatch(options(workerPath+'/settings'),handlers);s.handler.onHeaders(status,[],()=>{});assert.throws(()=>s.guard.dispatch(options(workerPath+'/settings'),handlers),/NO_RETRY/);assert.equal(s.calls,1);});
test('transport error blocks retries',()=>{const s=setup();s.guard.dispatch(options(workerPath+'/settings'),handlers);s.handler.onError(new Error('mock'));assert.throws(()=>s.guard.dispatch(options(workerPath+'/settings'),handlers),/NO_RETRY/);});
test('wrong host rejected',()=>{const s=setup();assert.throws(()=>s.guard.dispatch({...options(workerPath+'/settings'),origin:'https://evil.example'},handlers));assert.equal(s.calls,0);});
test('expired approval rejected before dispatch',()=>{let called=false;const g=createUploadGuard({dispatch(){called=true;}},{checkApproval(){throw Error('expired');},deadline:100,now:()=>1});assert.throws(()=>g.dispatch(options(workerPath+'/settings'),handlers),/APPROVAL/);assert.equal(called,false);});
test('duration bound rejected',()=>{const g=createUploadGuard({dispatch(){throw Error('should not call');}},{checkApproval(){},deadline:1,now:()=>1});assert.throws(()=>g.dispatch(options(workerPath+'/settings'),handlers),/BOUND/);});
test('exact production service metadata GET allowed',()=>{const s=setup();s.guard.dispatch(options(servicePath),handlers);assert.equal(s.calls,1);});
test('exact production secrets metadata GET allowed',()=>{const s=setup();s.guard.dispatch(options(workerPath+'/secrets'),handlers);assert.equal(s.calls,1);});
for(const [name,path,method] of [
 ...['HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].map(m=>[m,workerPath+'/secrets',m]),
 ['query',workerPath+'/secrets?token=PRIVATE_QUERY','GET'],['child',workerPath+'/secrets/PRIVATE_NAME','GET'],
 ['trailing slash',workerPath+'/secrets/','GET'],['catalog',prefix+'/workers/scripts/secrets','GET'],
 ['staging',workerPath+'-uat/secrets','GET'],['other worker',prefix+'/workers/scripts/other/secrets','GET'],
 ['other account',workerPath.replace('bf6ed4ccd73133871881b47ea58dae3d','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')+'/secrets','GET']
])test('secrets metadata rejects '+name,()=>{const s=setup();assert.throws(()=>s.guard.dispatch(options(path,method),handlers));assert.equal(s.calls,0);});
test('exact production preview metadata GET allowed',()=>{const s=setup();s.guard.dispatch(options(previewMetadataPath),handlers);assert.equal(s.calls,1);});
for(const [name,path,method] of [
 ...['HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].map(m=>[m,previewMetadataPath,m]),
 ['query',previewMetadataPath+'?token=PRIVATE_QUERY','GET'],['child',previewMetadataPath+'/settings','GET'],
 ['trailing slash',previewMetadataPath+'/','GET'],['catalog',prefix+'/workers/workers','GET'],
 ['staging',previewMetadataPath+'-uat','GET'],['other worker',prefix+'/workers/workers/other','GET'],
 ['other account',previewMetadataPath.replace('bf6ed4ccd73133871881b47ea58dae3d','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),'GET']
])test('preview metadata rejects '+name,()=>{const s=setup();assert.throws(()=>s.guard.dispatch(options(path,method),handlers));assert.equal(s.calls,0);});
for(const path of [servicePath,workerPath+'/secrets',previewMetadataPath])test('metadata URL fragment rejected '+path.split('/').pop(),()=>{const s=setup();assert.throws(()=>s.guard.dispatch(options(path+'#PRIVATE_FRAGMENT'),handlers));assert.equal(s.calls,0);});
for(const [name,path,method] of [
 ['staging service',servicePath+'-uat','GET'],['other service',prefix+'/workers/services/other','GET'],
 ['service catalog',prefix+'/workers/services','GET'],['service descendants',servicePath+'/environments/production','GET'],
 ['wrong account service',servicePath.replace('bf6ed4ccd73133871881b47ea58dae3d','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),'GET'],
 ['service query',servicePath+'?token=SECRET_QUERY','GET'],
 ...['POST','PUT','PATCH','DELETE','HEAD'].map(m=>['service '+m,servicePath,m]),
 ['staging upload',workerPath+'-uat/versions?bindings_inherit=strict','POST'],
 ['staging D1',prefix+'/d1/database/4ba57de7-5fda-4703-a956-b1936546986a/query','POST']
])test('narrow correction rejects '+name,()=>{const s=setup();assert.throws(()=>s.guard.dispatch(options(path,method),handlers));assert.equal(s.calls,0);});
test('rejection logs only sanitized method path category',()=>{
 const events=[];let calls=0;
 const g=createUploadGuard({dispatch(){calls++;}},{checkApproval(){},now:()=>1,deadline:100,reject:e=>events.push(e)});
 assert.throws(()=>g.dispatch({...options(servicePath+'?token=SECRET_QUERY','PATCH'),headers:{authorization:'Bearer SECRET_HEADER'},body:'SECRET_BODY'},handlers));
 assert.deepEqual(events,[{method:'PATCH',path:servicePath,category:'UPLOAD_ENDPOINT_REJECTED'}]);assert.equal(calls,0);
 assert.doesNotMatch(JSON.stringify(events),/SECRET|headers|body|token=/);
 assert.throws(()=>g.dispatch(options(servicePath),handlers),/NO_RETRY/);
 assert.equal(events[1].category,'UPLOAD_STOPPED_NO_RETRY');
});
test('unknown path segments and URL credentials redacted',()=>{
 const events=[];const g=createUploadGuard({dispatch(){throw Error('NEVER');}},{checkApproval(){},now:()=>1,deadline:100,reject:e=>events.push(e)});
 assert.throws(()=>g.dispatch({...options('/client/v4/SECRET_PATH/abcdef0123456789abcdef0123456789?secret=SECRET_QUERY'),origin:'https://SECRET_USER:SECRET_PASSWORD@api.cloudflare.com'},handlers));
 assert.deepEqual(Object.keys(events[0]).sort(),['category','method','path']);assert.doesNotMatch(JSON.stringify(events),/SECRET|abcdef0123456789|password|https/);
});
test('malformed URL logged and stops subsequent transport',()=>{
 const events=[];const g=createUploadGuard({dispatch(){throw Error('NEVER');}},{checkApproval(){},now:()=>1,deadline:100,reject:e=>events.push(e)});
 assert.throws(()=>g.dispatch({origin:'INVALID_SECRET',path:'SECRET'},handlers),/URL_REJECTED/);assert.equal(events[0].path,'[invalid-path]');
 assert.throws(()=>g.dispatch(options(servicePath),handlers),/NO_RETRY/);
});
test('rejection log failure remains fail closed',()=>{
 const g=createUploadGuard({dispatch(){throw Error('NEVER');}},{checkApproval(){},now:()=>1,deadline:100,reject(){throw Error('PRIVATE_FILESYSTEM_DETAIL');}});
 assert.throws(()=>g.dispatch(options(servicePath,'POST'),handlers),/UPLOAD_REJECTION_LOG_FAILED/);
});
