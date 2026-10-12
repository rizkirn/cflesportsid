import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as asyncHooks from 'node:async_hooks';
import * as mode from '../src/data-access/public-mode.mjs';
import * as shadow from '../src/data-access/shadow-contract.mjs';
import * as publicD1 from '../src/data-access/public-d1.mjs';
import * as continuity from '../src/utils/player-continuity.mjs';
function runtime(read) {
 const logs=[];
 const modules={'node:async_hooks':asyncHooks,'../utils/statistics':{},'../utils/player-continuity.mjs':continuity,'./public-d1.mjs':{...publicD1,readPublicData:read},'./public-mode.mjs':mode,'./shadow-contract.mjs':shadow};
 const context={exports:{},console:{info:(...values)=>logs.push(values.join(' '))},URL,Response,Promise,require:name=>{if(!modules[name])throw Error('Unexpected import '+name);return modules[name];}};
 const source=ts.transpileModule(readFileSync(new URL('../src/data-access/frontend-public.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,context);return {api:context.exports,logs};
}
const flags={CFL_PUBLIC_ENVIRONMENT:'uat',CFL_PUBLIC_HOSTNAME:mode.UAT.hostname,CFL_PUBLIC_WORKER:mode.UAT.worker,CFL_PUBLIC_DATABASE_ID:mode.UAT.database};
const url=new URL('https://'+mode.UAT.hostname);
test('shadow changes no response bytes status or headers and logs mismatch counts',async()=>{
 const projected=[{id:'a',data:{name:'D1 PRIVATE_VALUE'}}];const legacy=[{id:'a',data:{name:'Legacy'}}];
 const {api,logs}=runtime(async()=>({maps:projected}));const original=new Response('unchanged',{status:202,headers:{'X-Contract':'original'}});
 const response=await api.publicRequest({...flags,CFL_PUBLIC_MODE:'shadow'},false,url,async()=>{assert.equal(await api.selectPublicCollection('maps',async()=>legacy),legacy);return original;});
 assert.equal(response,original);assert.equal(response.status,202);assert.equal(await response.text(),'unchanged');assert.equal(response.headers.get('X-Contract'),'original');assert.ok(logs.some(line=>line.includes('"mismatches":1')));assert.ok(!logs.join().includes('PRIVATE_VALUE'));
});
test('shadow reports database failure even when page reads no collection',async()=>{
 const {api,logs}=runtime(async()=>{throw Error('PRIVATE_CREDENTIAL');});const response=await api.publicRequest({...flags,CFL_PUBLIC_MODE:'shadow'},false,url,async()=>new Response('unchanged'));
 assert.equal(await response.text(),'unchanged');assert.ok(logs.some(line=>line.includes('"contract":"database","mismatches":1')));assert.ok(!logs.join().includes('PRIVATE_CREDENTIAL'));
});
test('D1-only failure cannot call hybrid response or reader',async()=>{
 const {api}=runtime(publicD1.readPublicData);let nextCalled=false;await assert.rejects(()=>api.publicRequest({...flags,CFL_PUBLIC_MODE:'d1'},false,url,async()=>{nextCalled=true;return new Response('fallback');}),e=>e.code==='MISSING_BINDING');assert.equal(nextCalled,false);
});
test('production hybrid performs no D1 query',async()=>{
 const {api}=runtime(async()=>{throw Error('Query forbidden');});const response=await api.publicRequest({},false,new URL('https://cflesports.com'),async()=>new Response('hybrid'));assert.equal(await response.text(),'hybrid');
});
