import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWorkerMetadata,createMetadataTransport,requireCompleteMetadata,sanitizedMetadataError} from '../scripts/production/metadata-collector.mjs';
import {PRODUCTION} from '../scripts/production/metadata-helpers.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const worker=`/accounts/${PRODUCTION.account}/workers/scripts/${PRODUCTION.worker}`;
const response=result=>Response.json({success:true,result});
function fixture(){
 const values={};
 values[worker+'/deployments']={deployments:[{id:'deployment',versions:[{version_id:id,percentage:100}]}]};
 values[worker+'/versions/'+id]={id,resources:{bindings:[{name:'KEY',type:'secret_text'}]}};
 values[worker+'/versions']={items:[{id}]};
 return async path=>structuredClone(values[path]??{});
}
for(const [name,info]of [['pages',{total_pages:2}],['later page',{page:2}],['total count',{total_count:2}],['cursor',{cursor:'private'}],['after cursor',{cursors:{after:'private'}}],['next page',{next_page:2}]])
 test('rejects incomplete '+name,()=>assert.throws(()=>requireCompleteMetadata({result:[],result_info:info}),/PAGINATION_INCOMPLETE/));
for(const info of [{total_pages:-1},{page:0},{total_count:'2'},null,{count:2}])
 test('rejects malformed pagination '+JSON.stringify(info),()=>assert.throws(()=>requireCompleteMetadata({result:[],result_info:info}),/PAGINATION_INVALID/));
test('accepts complete array and item-list pagination',()=>{
 assert.deepEqual(requireCompleteMetadata({result:[],result_info:{page:1,total_pages:0,total_count:0,count:0}}),[]);
 assert.deepEqual(requireCompleteMetadata({result:{items:[{id}]},result_info:{page:1,total_pages:1,total_count:1}}),{items:[{id}]});
});
test('transport is GET-only, scoped, bounded and does not forward credentials elsewhere',async()=>{
 const calls=[],get=createMetadataTransport({expectedVersion:id,token:'fixture',maxRequests:1,fetcher:async(url,init)=>{calls.push([url,init]);return response({});}});
 await assert.rejects(()=>get('/accounts/other/d1/query'),/SCOPE_REJECTED/);
 assert.equal(calls.length,0);await get(worker+'/settings');
 await assert.rejects(()=>get(worker+'/settings'),/SCOPE_REJECTED/);
 assert.equal(calls.length,1);assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].redirect,'error');
});
test('transport only learns the latest version from its allowlisted version list',async()=>{
 const get=createMetadataTransport({expectedVersion:id,token:'fixture',fetcher:async()=>response({items:[{id:other}]})});
 await assert.rejects(()=>get(worker+'/versions/'+other),/SCOPE_REJECTED/);
 await get(worker+'/versions');await get(worker+'/versions/'+other);
});
for(const failure of ['network','json','http','redirect'])test('transport sanitizes '+failure+' failures',async()=>{
 const get=createMetadataTransport({expectedVersion:id,token:'fixture',fetcher:async()=>{
  if(failure==='network')throw Error('TOKEN_PRIVATE_SENTINEL');
  if(failure==='json')return {ok:true,json:async()=>{throw Error('TOKEN_PRIVATE_SENTINEL');}};
  if(failure==='redirect')return {redirected:true};
  return Response.json({success:false,errors:[{message:'TOKEN_PRIVATE_SENTINEL'}]},{status:403});
 }});
 await assert.rejects(()=>get(worker+'/settings'),e=>!e.message.includes('SENTINEL')&&sanitizedMetadataError(e)===e.message);
});
test('unknown and uppercase private errors are never printed as diagnostic codes',()=>{
 for(const message of ['TOKEN_PRIVATE_SENTINEL','JSON error: secret','token=value'])assert.equal(sanitizedMetadataError(Error(message)),'LOCAL_METADATA_VALIDATION_FAILED');
});
test('transport rejects secret values rather than collecting them',async()=>{
 const get=createMetadataTransport({expectedVersion:id,token:'fixture',fetcher:async()=>response({bindings:[{name:'KEY',type:'secret_text',text:'PRIVATE_SENTINEL'}]})});
 await assert.rejects(()=>get(worker+'/settings'),/^Error: SECRET_VALUE_PRESENT_IN_METADATA$/);
});
test('collector independently enforces request and elapsed-time bounds for injected clients',async()=>{
 let calls=0;const get=async p=>{calls++;return fixture()(p);};
 await assert.rejects(()=>collectWorkerMetadata({get,expectedVersion:id,maxRequests:1}),/SCOPE_REJECTED/);assert.equal(calls,1);
 let time=0;await assert.rejects(()=>collectWorkerMetadata({get:fixture(),expectedVersion:id,now:()=>time++===0?0:240001}),/SCOPE_REJECTED/);
});
test('collector checks all snapshots and never authorizes deployment',async()=>{
 const result=await collectWorkerMetadata({get:fixture(),expectedVersion:id,includeLatest:true});
 assert.equal(result.version.id,id);assert.equal(result.latestVersion.id,id);
 assert.equal(result.uploadAuthorized,undefined);assert.equal(result.approvalCreated,undefined);
});
test('collector detects metadata drift',async()=>{
 const get=fixture();let n=0;
 await assert.rejects(()=>collectWorkerMetadata({expectedVersion:id,get:async p=>{n++;return n>7&&p.endsWith('/settings')?{changed:true}:get(p);}}),/METADATA_CHANGED/);
});
test('collector handles a different latest upload with exactly eighteen reads',async()=>{
 const get=fixture();let calls=0;
 const result=await collectWorkerMetadata({expectedVersion:id,includeLatest:true,get:async p=>{calls++;if(p.endsWith('/versions'))return {items:[{id:other}]};if(p.endsWith('/versions/'+other))return {id:other};return get(p);}});
 assert.equal(calls,18);assert.equal(result.latestVersion.id,other);
});

test('collector sanitizes failures from injected clients',async()=>{
 await assert.rejects(()=>collectWorkerMetadata({expectedVersion:id,get:async()=>{throw Error('TOKEN_PRIVATE_SENTINEL');}}),/^Error: LOCAL_METADATA_VALIDATION_FAILED$/);
});
test('transport rejects pagination before returning metadata',async()=>{
 const get=createMetadataTransport({expectedVersion:id,token:'fixture',fetcher:async()=>Response.json({success:true,result:[],result_info:{total_pages:2}})});
 await assert.rejects(()=>get(worker+'/settings'),/PAGINATION_INCOMPLETE/);
});
