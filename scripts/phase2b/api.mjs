import {readFileSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {check,TARGET,authorize,same} from './guards.mjs';
import {validateImportPayload,performIdentityImport} from './identity-import.mjs';

export function credential(env=process.env){
  if(env.CLOUDFLARE_API_TOKEN)return env.CLOUDFLARE_API_TOKEN;
  for(const path of [join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),join(homedir(),'.wrangler/config/default.toml')]){
    if(existsSync(path)){
      const text=readFileSync(path,'utf8');
      const token=text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
      const expires=text.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
      if(token){check(expires&&Date.parse(expires)>Date.now(),'AUTH_EXPIRED_REFRESH_MANUALLY');return token;}
    }
  }
  throw new Error('AUTH_UNAVAILABLE');
}
export function stagingAPI(token,fetcher=fetch,{sleep}={}){
  check(typeof token==='string'&&token.length>0,'AUTH_UNAVAILABLE');
  const prefix='https://api.cloudflare.com/client/v4/accounts/'+TARGET.account;
  const db='/d1/database/'+TARGET.database,worker='/workers/scripts/'+TARGET.worker;
  const gets=new Set(['',db,worker+'/settings',worker+'/deployments',db+'/time_travel/bookmark']);
  const importAttempts=new Set();
  const audit={get:0,queries:0,exports:0,rowsWritten:0,imports:0,importPolls:0,uploads:0};
  async function request(path,{sql,params=[],exportBody,importBody}={}){
    const version=new RegExp('^'+worker+'/versions/[0-9a-f-]{36}$');
    const readQuery=path===db+'/query'&&typeof sql==='string';
    const exportRequest=path===db+'/export'&&exportBody;
    const importRequest=path===db+'/import'&&importBody;
    check((!sql&&!exportBody&&!importBody&&(gets.has(path)||version.test(path)))||readQuery||exportRequest||importRequest,'ENDPOINT_REJECTED');
    if(readQuery)check(!sql.includes(';')&&(/^\s*SELECT\b/i.test(sql)||/^\s*PRAGMA (?:foreign_key_check|foreign_key_list\([a-z_]+\)|table_info\([a-z_]+\)|index_list\(tournament_rosters\))$/i.test(sql)),'READ_ONLY_QUERY_REQUIRED');
    if(exportRequest)check(exportBody.output_format==='polling'&&Object.keys(exportBody).every(k=>['output_format','current_bookmark'].includes(k)),'COMPLETE_EXPORT_REQUIRED');
    if(importRequest){
      const fields={init:['action','etag'],ingest:['action','etag','filename'],poll:['action','current_bookmark']};
      check(Object.hasOwn(fields,importBody.action),'IMPORT_ACTION_REJECTED');same(Object.keys(importBody).sort(),[...fields[importBody.action]].sort(),'IMPORT_BODY_REJECTED');
      if(importBody.action!=='poll')check(/^[a-f0-9]{32}$/.test(importBody.etag),'IMPORT_ETAG_REJECTED');
    }
    const method=readQuery||exportRequest||importRequest?'POST':'GET';
    const response=await fetcher(prefix+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(readQuery?{body:JSON.stringify({sql,params})}:(exportRequest||importRequest)?{body:JSON.stringify(exportBody??importBody)}:{}),signal:AbortSignal.timeout(30000)});
    if(readQuery)audit.queries++;else if(exportRequest)audit.exports++;else if(importRequest){if(importBody.action==='poll')audit.importPolls++;else audit.imports++;}else audit.get++;
    check(!response.redirected,'CLOUDFLARE_REDIRECT_REJECTED');
    let body;try{body=await response.json();}catch{throw new Error('CLOUDFLARE_RESPONSE_INVALID');}
    check(response.ok&&(importRequest?body.success===true:body.success!==false),'CLOUDFLARE_HTTP_'+response.status+'_CODES_'+(body.errors??[]).map(e=>e.code).join(','));
    if(readQuery){
      check(Array.isArray(body.result)&&body.result.every(r=>r.success===true&&Array.isArray(r.results)),'QUERY_RESULT_INVALID');
      const written=body.result.reduce((n,r)=>n+(r.meta?.rows_written??0),0);audit.rowsWritten+=written;
      if(readQuery)check(written===0,'UNEXPECTED_DATABASE_WRITE');
    }
    if(importRequest&&body.result?.status==='complete')audit.rowsWritten+=body.result.result?.meta?.rows_written??0;
    return body.result;
  }
  return {
    audit,
    get:path=>request(path),
    query:async(sql,params=[])=>(await request(db+'/query',{sql,params})).flatMap(r=>r.results),
    // The public read client intentionally exposes no export or database mutation method.
    identityBackfillClient:(approval,plan,verifyApproval=()=>{})=>{
      authorize(approval,plan);check(plan.operation==='identity-backfill','BACKFILL_AUTHORIZATION_REQUIRED');validateImportPayload(plan.payload);
      return {applyPinnedArtifact:()=>{
        authorize(approval,plan);validateImportPayload(plan.payload);check(!importAttempts.has(plan.payload.nonce),'IMPORT_ALREADY_ATTEMPTED');importAttempts.add(plan.payload.nonce);
        return performIdentityImport({approval,plan,verifyApproval,request:body=>request(db+'/import',{importBody:body}),fetcher:async(url,options)=>{audit.uploads++;return fetcher(url,options);},...(sleep?{sleep}:{})});
      }};
    },
    backupClient:(approval,plan)=>{
      authorize(approval,plan);check(plan.operation==='backup','BACKUP_AUTHORIZATION_REQUIRED');
      return {bookmark:()=>request(db+'/time_travel/bookmark'),export:current_bookmark=>request(db+'/export',{exportBody:{output_format:'polling',...(current_bookmark?{current_bookmark}:{})}})};
    }
  };
}
