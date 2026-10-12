import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {check,same,sha,TARGET,authorize} from './guards.mjs';
import {pinnedIdentity} from './identity.mjs';
import {writePrivateFile,syncDirectory} from './storage.mjs';

export const IMPORT_TRANSPORT='d1-sql-file-import-v1';
export const SQL_RENDERER_VERSION='identity-numbered-sql-v1';
export const rendererSHA256=()=>sha(readFileSync(fileURLToPath(import.meta.url)));
export const md5=bytes=>createHash('md5').update(bytes).digest('hex');
const noncePattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function sqlLiteral(value){
  if(value===null)return 'NULL';
  if(typeof value==='number'){check(Number.isFinite(value),'SQL_LITERAL_REJECTED');return String(value);}
  check(typeof value==='string'&&!value.includes('\0'),'SQL_LITERAL_REJECTED');
  return "'"+value.replaceAll("'","''")+"'";
}
function scanSQL(sql,replace){
  check(typeof sql==='string'&&!sql.includes('\0'),'SQL_TEXT_REJECTED');
  let output='',code='';
  for(let i=0;i<sql.length;){
    const c=sql[i];
    if(c==="'"||c==='"'||c==='`'||c==='['){
      const end=c==='['?']':c,start=i++;let closed=false;
      while(i<sql.length){if(sql[i++]===end){if(c!=='['&&sql[i]===end){i++;continue;}closed=true;break;}}
      check(closed,'SQL_QUOTE_REJECTED');output+=sql.slice(start,i);code+=' ';
    }else if(sql.startsWith('--',i)){
      const end=sql.indexOf('\n',i),stop=end===-1?sql.length:end+1;output+=sql.slice(i,stop);i=stop;code+=' ';
    }else if(sql.startsWith('/*',i)){
      const end=sql.indexOf('*/',i+2);check(end!==-1,'SQL_COMMENT_REJECTED');output+=sql.slice(i,end+2);i=end+2;code+=' ';
    }else if(c==='?'&&replace){
      const match=sql.slice(i).match(/^\?([1-9][0-9]*)/);check(match,'NUMBERED_PARAMETER_REQUIRED');
      check(!/[a-zA-Z_]/.test(sql[i+match[0].length]??''),'PARAMETER_TOKEN_REJECTED');
      output+=replace(Number(match[1]));i+=match[0].length;code+=' ';
    }else{output+=c;code+=c;i++;}
  }
  return {output,code};
}
export function renderParameters(sql,params){
  check(Array.isArray(params),'SQL_PARAMETERS_REJECTED');
  const used=new Set();
  const rendered=scanSQL(sql,index=>{check(Number.isSafeInteger(index)&&index<=params.length,'SQL_PARAMETER_RANGE_REJECTED');used.add(index);return sqlLiteral(params[index-1]);}).output;
  check(params.every((_,i)=>used.has(i+1)),'SQL_UNUSED_PARAMETER_REJECTED');
  check(!/[?@$]|:[a-zA-Z_]/.test(scanSQL(rendered).code),'UNSUPPORTED_SQL_PARAMETER');
  return rendered;
}
export function renderIdentityImport(nonce){
  check(noncePattern.test(nonce??''),'IMPORT_NONCE_REJECTED');
  const {artifact,hash}=pinnedIdentity();
  const names=['player_identity_segments','player_identity_tournaments'];
  const statements=artifact.statements.map((s,index)=>{
    const code=scanSQL(s.sql).code;
    check(!code.includes(';')&&!/\b(?:CREATE|ALTER|DROP|UPDATE|DELETE|REPLACE|PRAGMA|BEGIN|COMMIT|ROLLBACK|ATTACH|DETACH|VACUUM|SAVEPOINT|RELEASE)\b/i.test(code),'IMPORT_STATEMENTS_REJECTED');
    check((code.match(/\bINSERT\b/gi)??[]).length===1&&new RegExp('\\bINSERT\\s+INTO\\s+'+names[index]+'\\s*\\(','i').test(code),'IMPORT_INSERT_TARGET_REJECTED');
    const sql=renderParameters(s.sql,s.params);check(!scanSQL(sql).code.includes(';'),'IMPORT_STATEMENTS_REJECTED');return sql;
  });
  check(statements.length===2,'IMPORT_STATEMENTS_REJECTED');
  const bytes=Buffer.from('-- cfl-identity-import '+nonce+'\n'+statements.join(';\n')+';\n');
  return {bytes,statements,sqlSHA256:sha(bytes),artifactHash:hash,rendererSHA256:rendererSHA256(),rendererVersion:SQL_RENDERER_VERSION,transport:IMPORT_TRANSPORT,nonce};
}
export function identityImportPayload(approvalExpiresAt,nonce=randomUUID()){
  const r=renderIdentityImport(nonce);validateExpiration(approvalExpiresAt);
  return {artifactHash:r.artifactHash,transport:r.transport,rendererVersion:r.rendererVersion,rendererSHA256:r.rendererSHA256,sqlSHA256:r.sqlSHA256,nonce,approvalExpiresAt};
}
function validateExpiration(expires){check(typeof expires==='string'&&Number.isFinite(Date.parse(expires))&&new Date(expires).toISOString()===expires,'IMPORT_EXPIRATION_REJECTED');}
export function validateImportPayload(payload){
  same(Object.keys(payload).sort(),['artifactHash','transport','rendererVersion','rendererSHA256','sqlSHA256','nonce','approvalExpiresAt'].sort(),'IMPORT_PAYLOAD_REJECTED');
  validateExpiration(payload.approvalExpiresAt);
  const rendered=renderIdentityImport(payload.nonce);
  for(const field of ['artifactHash','transport','rendererVersion','rendererSHA256','sqlSHA256'])check(payload[field]===rendered[field],'IMPORT_PAYLOAD_REJECTED:'+field);
  return rendered;
}
export function importPaths(plan){
  validateImportPayload(plan.payload);same(plan.target,TARGET,'IMPORT_TARGET_REJECTED');check(plan.operation==='identity-backfill','IMPORT_OPERATION_REJECTED');
  const root='/private/tmp/cfl-phase2b-identity-import-'+plan.payload.nonce;return {root,file:join(root,'identity.sql'),marker:join(root,'ownership.json')};
}
export function prepareImportFile(plan){
  const rendered=validateImportPayload(plan.payload),paths=importPaths(plan);
  mkdirSync(paths.root,{mode:0o700});
  writePrivateFile(paths.marker,JSON.stringify({kind:'cfl-phase2b-identity-import-v1',root:paths.root,owner:process.getuid(),nonce:plan.payload.nonce,planDigest:plan.digest}));
  writePrivateFile(paths.file,rendered.bytes);syncDirectory(paths.root);
  return paths;
}
export function approvedImportBytes(plan){
  const paths=importPaths(plan);
  for(const [path,isDirectory]of [[paths.root,true],[paths.file,false],[paths.marker,false]]){
    const stat=lstatSync(path);check(!stat.isSymbolicLink()&&realpathSync(path)===path&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&(isDirectory?stat.isDirectory():stat.isFile()),'PRIVATE_IMPORT_FILE_REQUIRED');
  }
  same(JSON.parse(readFileSync(paths.marker)),{kind:'cfl-phase2b-identity-import-v1',root:paths.root,owner:process.getuid(),nonce:plan.payload.nonce,planDigest:plan.digest},'IMPORT_OWNERSHIP_REJECTED');
  const bytes=readFileSync(paths.file),rendered=validateImportPayload(plan.payload);
  check(sha(bytes)===plan.payload.sqlSHA256&&bytes.equals(rendered.bytes),'APPROVED_SQL_CHANGED');return bytes;
}
export function validateUploadURL(value){
  check(typeof value==='string','IMPORT_UPLOAD_HOST_REJECTED');let url;try{url=new URL(value);}catch{throw new Error('IMPORT_UPLOAD_HOST_REJECTED');}
  check(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname)&&url.searchParams.get('X-Amz-Algorithm')==='AWS4-HMAC-SHA256'&&url.searchParams.has('X-Amz-Signature'),'IMPORT_UPLOAD_HOST_REJECTED');
  return url.href;
}
export async function performIdentityImport({approval,plan,request,fetcher,verifyApproval=()=>{},sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const checkWrite=()=>{authorize(approval,plan);verifyApproval();return approvedImportBytes(plan);};
  return performIdentityImportProtocol({checkWrite,request,fetcher,sleep});
}
export async function performIdentityImportProtocol({checkWrite,request,fetcher,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  checkWrite();
  const initialBytes=checkWrite(),digest=md5(initialBytes),sqlSHA256=sha(initialBytes);let started=false,phase='INIT';
  const deadline=Date.now()+120000;
  try{
    checkWrite();started=true;
    let state=await request({action:'init',etag:digest});
    if(state?.upload_url!==undefined){
      check((state.success===undefined||state.success===true)&&typeof state.filename==='string'&&state.filename.length>0&&state.filename.length<=2048&&!/[\x00-\x1f]/.test(state.filename),'IMPORT_INIT_REJECTED');
      const url=validateUploadURL(state.upload_url);phase='UPLOAD';const bytes=checkWrite();
      const upload=await fetcher(url,{method:'PUT',redirect:'error',headers:{'Content-Length':String(bytes.length)},body:bytes,signal:AbortSignal.timeout(30000)});
      check(upload.ok&&upload.status===200&&!upload.redirected,'IMPORT_UPLOAD_REJECTED');
      check(upload.headers?.get('etag')?.replace(/^"|"$/g,'')===digest,'IMPORT_UPLOAD_CHECKSUM_REJECTED');
      phase='INGEST';checkWrite();state=await request({action:'ingest',etag:digest,filename:state.filename});
    }
    let bookmark;
    for(let polls=0;;polls++){
      check(state?.success===true,'IMPORT_STATUS_REJECTED');
      if(state.at_bookmark!==undefined){check(typeof state.at_bookmark==='string'&&state.at_bookmark.length>0,'IMPORT_BOOKMARK_REJECTED');if(bookmark)check(state.at_bookmark===bookmark,'IMPORT_BOOKMARK_CHANGED');bookmark=state.at_bookmark;}
      if(state.status==='error')throw new Error('IMPORT_FAILED_READ_ONLY_INVESTIGATION_REQUIRED');
      if(state.status==='complete'){
        check(state.result?.num_queries===2&&typeof state.result.final_bookmark==='string'&&state.result.final_bookmark.length>0,'IMPORT_COMPLETION_REJECTED');
        return {status:'complete',numQueries:2,finalBookmark:state.result.final_bookmark,sqlSHA256};
      }
      check((state.status===undefined||state.status==='active')&&bookmark,'IMPORT_STATUS_REJECTED');
      check(polls<120&&Date.now()<deadline,'IMPORT_POLL_LIMIT_REJECTED');
      phase='POLL';await sleep(1000);state=await request({action:'poll',current_bookmark:bookmark});
    }
  }catch(error){
    if(!started)throw error;
    if(error?.message==='IMPORT_FAILED_READ_ONLY_INVESTIGATION_REQUIRED')throw error;
    const codes=['IMPORT_INIT_REJECTED','IMPORT_UPLOAD_HOST_REJECTED','IMPORT_UPLOAD_REJECTED','IMPORT_UPLOAD_CHECKSUM_REJECTED','IMPORT_STATUS_REJECTED','IMPORT_BOOKMARK_REJECTED','IMPORT_BOOKMARK_CHANGED','IMPORT_COMPLETION_REJECTED','IMPORT_POLL_LIMIT_REJECTED','APPROVED_SQL_CHANGED','PRIVATE_IMPORT_FILE_REQUIRED','IMPORT_OWNERSHIP_REJECTED','APPROVAL_EXPIRED','STALE_PREFLIGHT'];
    const detail=codes.includes(error?.message)||/^CLOUDFLARE_HTTP_[0-9]{3}_CODES_[0-9,]*$/.test(error?.message??'')?':'+error.message:'';
    throw new Error('IMPORT_OUTCOME_AMBIGUOUS_'+phase+detail+'_READ_ONLY_INVESTIGATION_REQUIRED');
  }
}
