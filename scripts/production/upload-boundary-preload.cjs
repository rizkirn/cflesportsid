'use strict';
const fs=require('node:fs'),root=process.cwd(),repo=require('node:path').resolve(__dirname,'../..');
const plan=JSON.parse(fs.readFileSync(root+'/production-deployment-plan.json'));
require(repo+'/node_modules/undici');
const symbol=Symbol.for('undici.globalDispatcher.1'),delegate=globalThis[symbol];
const count=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)).filter(x=>x.method==='GET').length:0;
const initial=JSON.parse(fs.readFileSync(root+'/deployment-preflight.json')).audit.length;
globalThis[symbol]={dispatch(options,handler){
 const start=Date.parse(JSON.parse(fs.readFileSync(root+'/execution-start.json')).startedAt);
 if(Date.now()-start>=plan.limits.durationMs)throw Error('TOTAL_EXECUTION_DURATION_EXCEEDED');
 const uploadRequests=fs.existsSync(root+'/upload-request-audit.jsonl')?fs.readFileSync(root+'/upload-request-audit.jsonl','utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
 if(options.method==='GET'&&initial+count(root+'/execution-api-audit.jsonl')+uploadRequests.filter(x=>x.method==='GET').length>plan.limits.metadataGETs)throw Error('TOTAL_METADATA_LIMIT');
 return delegate.dispatch(options,handler);
},close:(...a)=>delegate.close(...a),destroy:(...a)=>delegate.destroy(...a)};
