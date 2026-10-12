import {UAT} from '../../src/data-access/public-mode.mjs';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const safe=error=>/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'TAIL_TRANSPORT_FAILED';
export const TAIL_TRANSPORT='cfl-trace-v1-readiness-v1';
export function tailFilters(versionId,disableServerVersionFilter=false){
 check(/^[a-f0-9-]{36}$/.test(versionId??'')&&typeof disableServerVersionFilter==='boolean','TAIL_FILTER_REJECTED');
 return {filters:[{method:['GET']},...(disableServerVersionFilter?[]:[{scriptVersion:versionId}])]};
}
export function validateTailURL(value){
 let url;try{url=new URL(value);}catch{throw Error('TAIL_URL_REJECTED');}
 check(url.protocol==='wss:'&&url.hostname==='tail.developers.workers.dev'&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname!=='/','TAIL_URL_REJECTED');
 return url.href;
}
export function createTailSession({token,collector,versionId,disableServerVersionFilter=false,fetcher=fetch,socketFactory,now=()=>new Date().toISOString(),timeoutMs=30000}){
 check(typeof token==='string'&&token.length>0&&typeof socketFactory==='function','TAIL_AUTH_OR_SOCKET_REQUIRED');
 check(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'TAIL_TIMEOUT_REJECTED');
 const filters=tailFilters(versionId,disableServerVersionFilter);
 const endpoint='https://api.cloudflare.com/client/v4/accounts/'+UAT.account+'/workers/scripts/'+UAT.worker+'/tails';
 const evidence={transport:TAIL_TRANSPORT,processStartedAt:new Date(Date.now()-process.uptime()*1000).toISOString(),sessionStartedAt:null,connectedAt:null,subscriptionSentAt:null,firstByteAt:null,bytesReceived:0,chunksReceived:0,closedAt:null,closeCode:null,error:null,cleanup:'NOT_STARTED'};
 let socket,id,started=false,stopping=false,ready=false,rejectReady,rejectFailure;
 const failure=new Promise((_,reject)=>{rejectFailure=reject;});void failure.catch(()=>{});
 function fail(error){const code=safe(error);evidence.error??=code;rejectReady?.(Error(code));rejectFailure(Error(code));}
 async function request(method,path,body){
  let response;try{response=await fetcher(path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});}catch{throw Error('TAIL_API_TRANSPORT_FAILED');}
  check(response.ok,'TAIL_API_HTTP_'+response.status);let data;try{data=await response.json();}catch{throw Error('TAIL_API_RESPONSE_INVALID');}check(data.success===true,'TAIL_API_FAILURE');return data.result;
 }
 async function start(){
  check(!started,'TAIL_ALREADY_STARTED');started=true;evidence.sessionStartedAt=now();
  try{
   const result=await request('POST',endpoint,filters);
   check(/^[a-f0-9]{32}$/.test(result?.id??''),'TAIL_SESSION_ID_INVALID');id=result.id;
   check(Date.parse(result.expires_at)>Date.now(),'TAIL_SESSION_EXPIRED');
   const url=validateTailURL(result.url);
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>fail(Error('TAIL_READINESS_TIMEOUT')),timeoutMs);
    rejectReady=error=>{clearTimeout(timer);reject(error);};
    try{socket=socketFactory(url,'trace-v1',{followRedirects:false,handshakeTimeout:timeoutMs,maxPayload:2000000,headers:{'User-Agent':'cfl-uat-tail-readiness/1'}});}catch{fail(Error('TAIL_SOCKET_START_FAILED'));return;}
    socket.on('error',()=>fail(Error('TAIL_SOCKET_ERROR')));
    socket.on('unexpected-response',(_request,response)=>{response?.destroy?.();fail(Error('TAIL_HANDSHAKE_REJECTED'));});
    socket.on('close',code=>{evidence.closedAt=now();evidence.closeCode=Number.isInteger(code)?code:null;ready=false;if(!stopping)fail(Error('TAIL_STREAM_CLOSED'));});
    socket.on('message',chunk=>{
     if(stopping||evidence.error)return;
     evidence.firstByteAt??=now();evidence.bytesReceived+=Buffer.byteLength(chunk);evidence.chunksReceived++;
     try{collector.feed(chunk);}catch(error){fail(error);}
    });
    socket.on('open',()=>{
     if(evidence.error||stopping)return;
     evidence.connectedAt=now();
     try{socket.send(JSON.stringify({debug:false}),{binary:false,compress:false,mask:false,fin:true},error=>{
      if(error){fail(Error('TAIL_SUBSCRIPTION_SEND_FAILED'));return;}
      if(evidence.error||stopping)return;
      evidence.subscriptionSentAt=now();ready=true;clearTimeout(timer);resolve();
     });}catch{fail(Error('TAIL_SUBSCRIPTION_SEND_FAILED'));}
    });
   });
   assertReady();
  }catch(error){fail(error);throw Error(evidence.error);}
 }
 function assertReady(){check(ready&&!evidence.error&&!stopping,'TAIL_NOT_READY');}
 async function stop(){
  if(stopping)return;stopping=true;ready=false;
  let localCloseFailed=false;
  if(socket&&!evidence.closedAt){
   await new Promise(resolve=>{
    const timer=setTimeout(()=>{localCloseFailed=true;resolve();},Math.min(timeoutMs,5000));
    socket.once('close',()=>{clearTimeout(timer);resolve();});
    try{socket.terminate();}catch{clearTimeout(timer);localCloseFailed=true;resolve();}
   });
  }
  if(!id){evidence.cleanup=started?'SESSION_ID_UNAVAILABLE':'NOT_NEEDED';return;}
  try{await request('DELETE',endpoint+'/'+id);evidence.cleanup='CONFIRMED';}
  catch{evidence.cleanup='UNCONFIRMED';throw Error('TAIL_CLEANUP_UNCONFIRMED');}
  if(localCloseFailed){evidence.error??='TAIL_LOCAL_CLOSE_UNCONFIRMED';throw Error('TAIL_LOCAL_CLOSE_UNCONFIRMED');}
 }
 return {start,stop,assertReady,failure,summary:()=>({...evidence,...collector.streamEvidence()})};
}
