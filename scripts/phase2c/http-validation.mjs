import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {UAT} from '../../src/data-access/public-mode.mjs';
import {validateRemoteUAT,validateUATConfig,rejectEnvironmentOverrides} from './uat-validator.mjs';
import {credential} from '../phase2b/api.mjs';
import {inventory} from '../phase1a/safety.mjs';
import {checkData} from '../data-tools.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha=value=>createHash('sha256').update(value).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),check=(ok,code)=>{if(!ok)throw Error(code);};
export const digestOf=p=>sha(JSON.stringify(p));
export function teamRosterOrderPolicy(){
 const {data,errors}=checkData();check(!errors.length,'HTTP_CONTENT_INVALID');
 return {version:'team-roster-card-permutation-v1',teams:Object.fromEntries([...data.teams].map(([id,t])=>[id,[...t.data.players]]))};
}
export function acceptedTeamRosterReordering({path,body,baselineSHA256,policy}){
 if(policy?.version!=='team-roster-card-permutation-v1')return null;
 const team=/^\/teams\/([a-z0-9-]+)\/$/.exec(path)?.[1],order=policy.teams?.[team];
 if(!Array.isArray(order)||!order.length||order.some(uid=>typeof uid!=='string'||!/^\d+$/.test(uid))||new Set(order).size!==order.length)return null;
 const openings=[...body.matchAll(/<div\b[^>]*\bclass="[^"]*\broster-detail-grid\b[^"]*"[^>]*>/g)];
 if(openings.length!==1)return null;
 const opening=openings[0],start=opening.index+opening[0].length;
 const prefix=body.slice(0,opening.index),sectionOpening=[...prefix.matchAll(/<section\b[^>]*>/g)].at(-1);
 const section=sectionOpening?prefix.slice(sectionOpening.index):null;
 if(!section||!/^<section\b[^>]*\baria-labelledby="roster-title"[^>]*>/.test(section)||section.includes('</section>'))return null;
 let depth=1,end=-1;
 for(const tag of body.slice(start).matchAll(/<\/?div\b[^>]*>/g)){
  depth+=tag[0].startsWith('</')?-1:1;
  if(depth===0){end=start+tag.index;break;}
 }
 if(end<0)return null;
 const contents=body.slice(start,end);
 if(/<!--|<script\b|<style\b/i.test(contents))return null;
 const cards=[...contents.matchAll(/<a\b[^>]*>[^]*?<\/a>/g)],byUID=new Map(),actual=[];
 if(cards.length!==order.length||contents.replace(/<a\b[^>]*>[^]*?<\/a>/g,'').trim())return null;
 for(const card of cards){
  const opener=card[0].slice(0,card[0].indexOf('>')+1);
  const hrefs=[...opener.matchAll(/\bhref="([^"]*)"/g)],classes=[...opener.matchAll(/\bclass="([^"]*)"/g)];
  const uid=hrefs.length===1?/^\/players\/(\d+)\/?$/.exec(hrefs[0][1])?.[1]:null;
  if(!uid||classes.length!==1||!classes[0][1].split(/\s+/).includes('roster-card')||(card[0].match(/<a\b/g)||[]).length!==1||byUID.has(uid)||!order.includes(uid))return null;
  byUID.set(uid,card[0]);actual.push(uid);
 }
 if(equal(actual,order))return null;
 let index=0;
 const restored=contents.replace(/<a\b[^>]*>[^]*?<\/a>/g,()=>byUID.get(order[index++]));
 if(sha(body.slice(0,start)+restored+body.slice(end))!==baselineSHA256)return null;
 return {kind:policy.version,team,players:order.length,changedPositions:actual.filter((uid,i)=>uid!==order[i]).length};
}

export function validateHTTPPlan(plan,digest){
 const directory=plan.destination;
 check(plan.operation==='uat-d1-http-validation'&&digest===digestOf(plan)&&equal(plan.target,UAT)&&plan.expected.mode==='d1'&&uuid.test(plan.expected.versionId)&&uuid.test(plan.expected.deploymentId),'HTTP_APPROVAL_REJECTED');
 check(Date.parse(plan.createdAt)<=Date.now()&&Date.parse(plan.expiresAt)>Date.now(),'HTTP_APPROVAL_EXPIRED');
 check(plan.maximumMatrixRequests===204&&plan.maximumPublicRequests===204&&plan.maxDurationMs===900000&&plan.requestTimeoutMs===30000,'HTTP_SCOPE_REJECTED');
 check(/^\/private\/tmp\/cfl-d1-http-[A-Za-z0-9]+$/.test(directory)&&fs.realpathSync(directory)===directory&&(fs.statSync(directory).mode&0o777)===0o700,'HTTP_PRIVATE_STORAGE_REQUIRED');
 const owner=JSON.parse(fs.readFileSync(directory+'/ownership.json'));check(owner.root===directory&&owner.owner===process.getuid()&&owner.operation===plan.operation,'HTTP_OWNERSHIP_REJECTED');
 for(const [path,sum]of Object.entries(plan.pinnedFiles))check(sha(fs.readFileSync(path))===sum,'HTTP_PINNED_FILE_CHANGED');
 check(equal(plan.runtime,{path:process.execPath,version:process.version,sha256:sha(fs.readFileSync(process.execPath))}),'HTTP_RUNTIME_CHANGED');
 check(sha(JSON.stringify(inventory(plan.artifact.directory)))===plan.artifact.sha256,'HTTP_ARTIFACT_CHANGED');
 const source=JSON.parse(fs.readFileSync(plan.sourceManifest));check(equal(inventory(repo+'/src'),source.src)&&equal(inventory(repo+'/public'),source.public),'HTTP_SOURCE_CHANGED');
 const routes=JSON.parse(fs.readFileSync(plan.routesPath)),baseline=JSON.parse(fs.readFileSync(plan.baselinePath));
 check(routes.length===204&&new Set(routes.map(r=>r.path)).size===204&&baseline.length===204&&baseline.every((r,i)=>r.index===i&&r.status===routes[i].expectedStatus),'HTTP_BASELINE_REJECTED');
 if(plan.acceptedPresentationDifferences!==undefined)check(equal(plan.acceptedPresentationDifferences,{teamRosterOrder:teamRosterOrderPolicy()}),'HTTP_PRESENTATION_POLICY_REJECTED');
 return {routes,baseline};
}
export async function verifyD1Runtime({plan,token,fetcher=fetch}){
 const result=await validateRemoteUAT({token,mode:'d1',fetcher});
 const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+UAT.account+'/workers/scripts/'+UAT.worker+'/versions/'+plan.expected.versionId,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 check(response.ok,'HTTP_VERSION_LOOKUP_FAILED');const body=await response.json();check(body.success===true&&body.result?.id===plan.expected.versionId,'HTTP_VERSION_REJECTED');
 const bindings=body.result.resources.bindings.filter(b=>!b.name.startsWith('ADMIN_')).sort((a,b)=>a.name.localeCompare(b.name));
 check(sha(JSON.stringify(bindings))===plan.expected.publicBindingsFingerprint&&sha(JSON.stringify(body.result.resources.script_runtime))===plan.expected.scriptRuntimeFingerprint,'HTTP_BINDINGS_OR_RUNTIME_CHANGED');
 check(body.result.annotations?.['workers/tag']===plan.expected.versionTag,'HTTP_ARTIFACT_TAG_CHANGED');
 return result;
}
export async function executeHTTPMatrix({plan,routes,baseline,authorize,verify,fetcher,claim,now=Date.now}){
 let code=null,matrixRequests=0,phase='preflight',preflight=null,postflight=null;const responses=[],responseDifferences=[];
 const deadline=now()+plan.maxDurationMs;
 function bounded(){check(now()<deadline,'HTTP_DURATION_EXCEEDED');authorize();}
 async function target(){bounded();const result=await verify();check(result.mode==='d1'&&equal(result.target,UAT)&&result.versionId===plan.expected.versionId&&result.deploymentId===plan.expected.deploymentId&&result.authenticationFingerprint===plan.expected.authenticationFingerprint&&result.authenticationBindingCount===plan.expected.authenticationBindingCount&&result.workerSettings.fingerprint===plan.expected.workerSettingsFingerprint,'HTTP_TARGET_CHANGED');bounded();return result;}
 try{
  preflight=await target();claim();phase='matrix';
  for(let index=0;index<routes.length;index++){
   bounded();if(index&&index%25===0)await target();
   const url=new URL(routes[index].path,'https://'+UAT.hostname);check(url.origin==='https://'+UAT.hostname&&!url.search&&!url.hash,'HTTP_TARGET_REJECTED');
   check(matrixRequests===index&&matrixRequests<204,'HTTP_REQUEST_REPEATED');matrixRequests++;
   const dispatchAt=new Date().toISOString(),response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(plan.requestTimeoutMs)}),body=await response.text();bounded();
   const row={index,status:response.status,sha256:sha(body),headers:Object.fromEntries(plan.headers.map(key=>[key,response.headers.get(key)]))};
   responses.push({index,status:row.status,sha256:row.sha256,headersMatch:equal(row.headers,baseline[index].headers),dispatchAt,completedAt:new Date().toISOString()});
   if(!equal(row,baseline[index])){
    const accepted=row.index===baseline[index].index&&row.status===baseline[index].status&&equal(row.headers,baseline[index].headers)
     ?acceptedTeamRosterReordering({path:routes[index].path,body,baselineSHA256:baseline[index].sha256,policy:plan.acceptedPresentationDifferences?.teamRosterOrder}):null;
    if(!accepted){responseDifferences.push(index);throw Error('HTTP_PARITY_FAILED');}
    responses.at(-1).acceptedPresentationDifference=accepted;
   }
   if(routes[index].path==='/players/1345266890--before-clash-for-glory-s2/')check(body.includes('KangDedy')&&body.includes('cha-tra-mue')&&body.includes('clash-for-glory-s1'),'HTTP_HISTORICAL_IDENTITY_FAILED');
   if(routes[index].path==='/players/1345266890/')check(body.includes('KucayyPRMX')&&body.includes('g2c-prmx')&&body.includes('clash-for-glory-s2'),'HTTP_CURRENT_IDENTITY_FAILED');
   check(!body.includes('PRIVATE_FAILURE_SENTINEL')&&!body.includes('private_registration')&&!body.includes('ADMIN_DRAW_KEY'),'HTTP_PRIVATE_DATA_EXPOSURE');
  }
  check(matrixRequests===204,'HTTP_COVERAGE_INCOMPLETE');phase='postflight';postflight=await target();bounded();
 }catch(error){code=/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'HTTP_EXECUTION_FAILED';}
 return {status:code?'BLOCKED':'PASS',code,phase,matrixRequests,httpChecksCompleted:responses.length,responses,responseDifferences,preflight,postflight,tailUsed:false,unverifiedContracts:plan.unverifiedContracts};
}
if(process.argv[1]&&pathToFileURL(fs.realpathSync(process.argv[1])).href===import.meta.url){
 try{
  check(process.argv.length===6&&process.argv[2]==='--plan'&&process.argv[4]==='--approve','HTTP_APPROVAL_REQUIRED');const digest=process.argv[5],plan=JSON.parse(fs.readFileSync(process.argv[3]));
  check(process.argv[3]===plan.destination+'/plan.json'&&!fs.lstatSync(process.argv[3]).isSymbolicLink(),'HTTP_PLAN_PATH_REJECTED');
  const {routes,baseline}=validateHTTPPlan(plan,digest);rejectEnvironmentOverrides();validateUATConfig(JSON.parse(fs.readFileSync(repo+'/wrangler.uat.jsonc')));const token=credential();
  const report=await executeHTTPMatrix({plan,routes,baseline,authorize:()=>validateHTTPPlan(plan,digest),verify:()=>verifyD1Runtime({plan,token}),fetcher:fetch,claim:()=>fs.writeFileSync(plan.destination+'/execution.claim',digest,{mode:0o600,flag:'wx'})});
  fs.writeFileSync(plan.destination+'/report.json',JSON.stringify({...report,digest},null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({status:report.status,code:report.code,matrixRequests:report.matrixRequests,report:plan.destination+'/report.json'}));if(report.status!=='PASS')process.exitCode=1;
 }catch(error){console.error(JSON.stringify({status:'BLOCKED',code:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'HTTP_PREPARATION_FAILED'}));process.exitCode=1;}
}
