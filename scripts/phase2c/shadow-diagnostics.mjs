import {randomBytes} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {UAT} from '../../src/data-access/public-mode.mjs';
import {publicFields} from '../../src/data-access/public-d1.mjs';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const markerPattern=/^cflshadowrun-[a-f0-9]{32}$/;
const contracts=new Set([...Object.keys(publicFields),'statistics','database']);
export const createPublicMarker=()=> 'cflshadowrun-'+randomBytes(16).toString('hex');
export function createShadowCollector({versionId,marker=createPublicMarker(),routes,canaryPath='/'}) {
 check(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(versionId??''),'SHADOW_VERSION_REQUIRED');
 check(markerPattern.test(marker),'SHADOW_MARKER_INVALID');
 check(Array.isArray(routes)&&routes.length>0&&routes.every(r=>r&&typeof r.path==='string'&&r.path.startsWith('/')&&!r.path.startsWith('//')&&!/[?#]/.test(r.path)&&typeof r.shadowDiagnosticRequired==='boolean')&&new Set(routes.map(r=>r.path)).size===routes.length,'SHADOW_ROUTES_INVALID');
 check(routes.some(r=>r.path===canaryPath&&r.shadowDiagnosticRequired),'SHADOW_CANARY_ROUTE_INVALID');
 const approvedRoutes=routes.map(r=>({...r}));
 const counts={eventsReceived:0,eventsRejectedByMarker:0,diagnosticsRecognized:0,comparisonsAccepted:0,malformedEvents:0,mismatchCount:0,eventsRejectedByHost:0,eventsRejectedByVersion:0,eventsWithoutDiagnostics:0};
 const accepted=new Map(),rejectedDiagnostics=[],decoder=new StringDecoder('utf8');
 let canary=false,matrixStarted=false,failure,buffer='',waiters=[];
 function fail(code){failure=code;for(const w of waiters)w.reject(Error(code));waiters=[];throw Error(code);}
 function healthy(){if(failure)throw Error(failure);}
 function malformed(code){counts.malformedEvents++;return fail(code);}
 function requestURL(path,phase){
  check(approvedRoutes.some(r=>r.path===path),'SHADOW_ROUTE_REJECTED');
  const url=new URL(path,'https://'+UAT.hostname);
  check(url.origin==='https://'+UAT.hostname,'SHADOW_HOST_REJECTED');
  url.searchParams.set('cfl_shadow_run',marker);url.searchParams.set('cfl_shadow_probe',phase);return url;
 }
 function acceptEvent(event){
  healthy();counts.eventsReceived++;
  if(!event||typeof event!=='object'||!event.event?.request?.url)return malformed('SHADOW_EVENT_INVALID');
  let url;try{url=new URL(event.event.request.url);}catch{return malformed('SHADOW_EVENT_INVALID');}
  if(url.origin!=='https://'+UAT.hostname){counts.eventsRejectedByHost++;return;}
  if(url.searchParams.getAll('cfl_shadow_run').length!==1||url.searchParams.get('cfl_shadow_run')!==marker){counts.eventsRejectedByMarker++;return;}
  if(event.scriptName!==UAT.worker||event.scriptVersion?.id!==versionId){counts.eventsRejectedByVersion++;return fail('SHADOW_VERSION_REJECTED');}
  const index=approvedRoutes.findIndex(r=>r.path===url.pathname),phase=url.searchParams.get('cfl_shadow_probe');
  if(index<0||url.searchParams.getAll('cfl_shadow_probe').length!==1||!['canary','matrix'].includes(phase)||phase==='canary'&&url.pathname!==canaryPath||phase==='matrix'&&!matrixStarted)return malformed('SHADOW_ROUTE_OR_PHASE_REJECTED');
  if(!Array.isArray(event.logs))return malformed('SHADOW_LOGS_INVALID');
  const diagnostics=[];
  for(const log of event.logs){
   if(!Array.isArray(log?.message)||log.message[0]!=='[public-shadow]')continue;
   counts.diagnosticsRecognized++;
   if(log.message.length!==2||typeof log.message[1]!=='string')return malformed('SHADOW_DIAGNOSTIC_INVALID');
   let list;try{list=JSON.parse(log.message[1]);}catch{return malformed('SHADOW_DIAGNOSTIC_INVALID');}
   if(!Array.isArray(list)||!list.length)return malformed('SHADOW_DIAGNOSTIC_INVALID');
   for(const d of list){
    if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['contract','mismatches','fields'].includes(k))||!contracts.has(d.contract)||!Number.isSafeInteger(d.mismatches)||d.mismatches<0)return malformed('SHADOW_DIAGNOSTIC_INVALID');
    if(d.fields!==undefined&&(!Array.isArray(d.fields)||!d.fields.every(k=>k==='entity'||(publicFields[d.contract]??[]).includes(k))))return malformed('SHADOW_DIAGNOSTIC_PRIVATE_FIELD');
    diagnostics.push({contract:d.contract,mismatches:d.mismatches,...(d.fields===undefined?{}:{fields:[...d.fields]})});
   }
  }
  if(!diagnostics.length){counts.eventsWithoutDiagnostics++;return;}
  counts.mismatchCount+=diagnostics.reduce((n,d)=>n+d.mismatches,0);
  if(!diagnostics.some(d=>d.contract==='database')||diagnostics.some(d=>d.mismatches!==0)){
   rejectedDiagnostics.push({index,phase,diagnostics});
   return fail('SHADOW_COMPARISON_FAILED');
  }
  if(phase==='canary'){
   if(canary)return fail('SHADOW_DUPLICATE_EVENT');
   canary=true;
  }else{
   if(accepted.has(index))return fail('SHADOW_DUPLICATE_EVENT');
   accepted.set(index,{index,diagnostics});
  }
  counts.comparisonsAccepted+=diagnostics.length;
  if(canary){for(const w of waiters)w.resolve();waiters=[];}
 }
 function feed(chunk){
  healthy();buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);
  if(buffer.length>2000000)return malformed('SHADOW_BUFFER_LIMIT');
  let start=-1,depth=0,inString=false,escape=false;
  for(let i=0;i<buffer.length;i++){
   const c=buffer[i];
   if(start<0){if(c==='{'){start=i;depth=1;}else if(!/\s/.test(c))return malformed('SHADOW_STREAM_INVALID');continue;}
   if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;continue;}
   if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){
    let event;try{event=JSON.parse(buffer.slice(start,i+1));}catch{return malformed('SHADOW_STREAM_INVALID');}
    buffer=buffer.slice(i+1);i=-1;start=-1;acceptEvent(event);
   }
  }
  if(start>=0)buffer=buffer.slice(start);else buffer='';
 }
 function waitForCanary(timeoutMs=10000){
  healthy();check(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'SHADOW_TIMEOUT_INVALID');
  if(canary)return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const entry={resolve:()=>{clearTimeout(timer);resolve();},reject:e=>{clearTimeout(timer);reject(e);}};
   const timer=setTimeout(()=>{failure='SHADOW_CANARY_TIMEOUT';for(const w of waiters)w.reject(Error(failure));waiters=[];},timeoutMs);waiters.push(entry);
  });
 }
 function streamEvidence(){return {bufferedBytes:Buffer.byteLength(buffer)+(decoder.lastNeed?decoder.lastTotal-decoder.lastNeed:0),completeEvents:counts.eventsReceived};}
 function summary(){return {marker,versionId,canaryCaptured:canary,matrixStarted,...counts,failure:failure??null,diagnosticRequests:accepted.size,diagnostics:[...accepted.values()].sort((a,b)=>a.index-b.index),rejectedDiagnostics:rejectedDiagnostics.map(entry=>({index:entry.index,phase:entry.phase,diagnostics:entry.diagnostics.map(d=>({...d,...(d.fields?{fields:[...d.fields]}:{})}))})),missingDiagnosticRoutes:approvedRoutes.flatMap((r,i)=>r.shadowDiagnosticRequired&&!accepted.has(i)?[i]:[])};}
 return {marker,acceptEvent,feed,summary,streamEvidence,waitForCanary,
  canaryURL:()=>requestURL(canaryPath,'canary'),
  matrixURL:path=>{healthy();check(canary&&matrixStarted,'SHADOW_CANARY_REQUIRED');return requestURL(path,'matrix');},
  runMatrix:async({sendCanary,runMatrix,timeoutMs=10000})=>{
   healthy();check(!matrixStarted,'SHADOW_MATRIX_ALREADY_STARTED');
   const gate=waitForCanary(timeoutMs);void gate.catch(()=>{});
   try{await sendCanary(requestURL(canaryPath,'canary'));await gate;healthy();matrixStarted=true;return await runMatrix();}
   catch{if(!failure){try{fail(matrixStarted?'SHADOW_MATRIX_FAILED':'SHADOW_CANARY_REQUEST_FAILED');}catch{}}throw Error(failure);}
  },
  finish:()=>{healthy();buffer+=decoder.end();if(buffer.trim())return malformed('SHADOW_STREAM_INCOMPLETE');check(canary&&matrixStarted,'SHADOW_CANARY_REQUIRED');if(summary().missingDiagnosticRoutes.length)return fail('SHADOW_DIAGNOSTICS_MISSING');return summary();}
 };
}

export async function validateShadowRun({collector,sendCanary,runMatrix,timeoutMs=10000}) {
 await collector.runMatrix({sendCanary,runMatrix,timeoutMs});
 return collector.finish();
}
