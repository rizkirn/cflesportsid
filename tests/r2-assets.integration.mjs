import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkData } from '../scripts/data-tools.mjs';
import { createHash } from 'node:crypto';

const root=process.cwd();
mkdirSync('.generated',{recursive:true});
const scratch=mkdtempSync(resolve('.generated/r2a-'));
const store=join(scratch,'store');
const env={...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(scratch,'logs')};
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
const run=args=>execFileSync(process.execPath,args,{cwd:root,env,stdio:'pipe',timeout:120000,maxBuffer:32*1024*1024}).toString();
const servers=[];
const built=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
const config={...built,name:'r2-assets-local-rehearsal',main:resolve('dist/server',built.main),
  assets:{...built.assets,directory:resolve('dist/client')},routes:[],
  d1_databases:[{binding:'DB',database_name:'r2-assets-local',database_id:'00000000-0000-0000-0000-000000000009',migrations_dir:resolve('migrations')}],
  r2_buckets:[{binding:'CFL_ASSETS',bucket_name:'r2-assets-local'}]};
delete config.configPath;delete config.userConfigPath;
const configPath=join(scratch,'local.json');
writeFileSync(configPath,JSON.stringify(config));
const backupPath=join(scratch,'fallback.json');
  writeFileSync(backupPath,JSON.stringify({...config,d1_databases:[],r2_buckets:[]}));
const sql=command=>run([wrangler,'d1','execute','r2-assets-local','--config',configPath,'--local','--persist-to',store,'--command',command]);
async function start(path,port){
  const logPath=join(scratch,`worker-${port}.log`);
  const logFd=openSync(logPath,'a');
  const child=spawn(process.execPath,[wrangler,'dev','--config',path,'--local','--persist-to',store,'--ip','127.0.0.1','--port',String(port)],{cwd:root,env,stdio:['ignore',logFd,logFd]});
  servers.push(child);
  const logs=()=>readFileSync(logPath,'utf8');
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw Error(logs());
    try{if((await fetch(base+'/robots.txt')).ok)return base;}catch{}
    await delay(100);
  }
  throw Error(logs());
}
async function html(base,path,status=200){const response=await fetch(base+path);assert.equal(response.status,status,path);return response.text();}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
const normalized=page=>page.replace(/(<script\b[^>]*type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/g,(_,open,data,close)=>open+JSON.stringify(canonical(JSON.parse(data)))+close);
function equalPages(actual,expected,label){
  if(normalized(actual)===normalized(expected))return;
  writeFileSync(join(scratch,'actual.html'),actual);writeFileSync(join(scratch,'expected.html'),expected);
  assert.fail(`${label}; HTML evidence in ${scratch}`);
}

try {
  run(['scripts/generate-d1-seed.mjs']);
  run([wrangler,'d1','migrations','apply','r2-assets-local','--config',configPath,'--local','--persist-to',store]);
  run([wrangler,'d1','execute','r2-assets-local','--config',configPath,'--local','--persist-to',store,'--file=.generated/seed-s1-s2.sql']);
  const live=await start(configPath,44331),fallback=await start(backupPath,44332);
  const {data}=checkData();
  const paths=['/','/teams/','/players/','/maps/','/matches/','/tournament/','/bracket-generator/','/map-randomizer/','/veto/',
    '/players/1345266890--before-clash-for-glory-s2/',
    ...['teams','players','maps','matches','tournaments'].flatMap(collection=>[...data[collection].keys()].map(id=>`/${collection==='tournaments'?'tournament':collection}/${id}/`))];
  const original=new Map();
  const assets=new Set();
  for(const path of paths){
    const page=await html(live,path);
    equalPages(page,await html(fallback,path),`D1/JSON fallback ${path}`);
    assert.doesNotMatch(page,/src="\/media\//,path);
    original.set(path,page);
    for(const [,asset] of page.matchAll(/(?:src|href)="(\/(?:_astro\/|_image\?)[^"]+)"/g))assets.add(asset.replaceAll('&amp;','&'));
  }
  for(const asset of assets)assert.equal((await fetch(live+asset)).status,200,asset);
  for(const asset of ['/logos/CTM.webp','/logos/default.webp','/players/default.webp','/maps/island.webp','/maps/placeholder.svg','/tournaments/clash-for-glory-s1.webp','/tournaments/clash-for-glory-s2.webp'])assert.equal((await fetch(live+asset)).status,200,asset);
  const historical=original.get('/players/1345266890--before-clash-for-glory-s2/');
  assert.match(historical,/KangDedy/);assert.match(historical,/src="\/players\/default.webp"/);assert.doesNotMatch(historical,/src="\/players\/1345266890\.webp"/);
  assert.match(original.get('/players/1345266890/'),/KucayyPRMX/);
  assert.match(original.get('/players/1083796629/'),/HWL,DANILTVJ/);
  for(const match of data.matches.values()){
    if(match.data.tournamentId==='clash-for-glory-s1'&&match.data.playerStats.some(p=>p.uid==='1345266890')){
      const page=original.get(`/matches/${match.id}/`);
      assert.match(page,/KangDedy/);assert.doesNotMatch(page,/src="\/players\/1345266890\.webp"/);
      const insights=[...page.matchAll(/<script[^>]*data-comparison-data[^>]*>([\s\S]*?)<\/script>/g)].map(([,json])=>JSON.parse(json));
      assert.ok(insights.length,'Match comparison payload exists');
      assert.doesNotMatch(JSON.stringify(insights),/\/players\/1345266890\.webp/);
    }
  }
  for(const method of ['GET','POST'])assert.equal((await fetch(live+'/admin',{method})).status,403);
  assert.match(original.get('/'),/https:\/\/cflesports\.com/);
  assert.match(await html(live,'/robots.txt'),/https:\/\/cflesports\.com/);
  assert.match(await html(live,'/sitemap-0.xml'),/https:\/\/cflesports\.com/);
  sql("UPDATE teams SET logo_asset_key='teams/'||id||'/logo/future.webp'; UPDATE players SET photo_asset_key='players/'||uid||'/avatar/future.webp'; UPDATE maps SET image_asset_key='maps/'||id||'/cover/future.webp'; UPDATE tournaments SET poster_asset_key='tournaments/'||id||'/poster/future.webp';");
  for(const [path,page] of original)assert.equal(await html(live,path),page,`Populated key changed R2-A presentation: ${path}`);
  sql('ALTER TABLE teams DROP COLUMN logo_asset_key; ALTER TABLE players DROP COLUMN photo_asset_key; ALTER TABLE maps DROP COLUMN image_asset_key; ALTER TABLE tournaments DROP COLUMN poster_asset_key;');
  for(const [path,page] of original)assert.equal(await html(live,path),page,`Pre-0009 fallback changed: ${path}`);
  sql(readFileSync('migrations/0009_r2_asset_references.sql','utf8'));
  const images=[
    {table:'teams',id:'familia-nova',kind:'logo',field:'logo_asset_key',file:'public/logos/FNOV.webp',page:'/teams/familia-nova/'},
    {table:'players',id:'1347741365',kind:'avatar',field:'photo_asset_key',file:'public/players/1347741365.webp',page:'/players/1347741365/'},
    {table:'maps',id:'island',kind:'cover',field:'image_asset_key',file:'public/maps/island.webp',page:'/maps/island/'},
    {table:'tournaments',id:'clash-for-glory-s2',kind:'poster',field:'poster_asset_key',file:'public/tournaments/clash-for-glory-s2.webp',page:'/tournament/'},
  ];
  for(const image of images){
    const bytes=readFileSync(image.file),hash=createHash('sha256').update(bytes).digest('hex');
    image.key=`${image.table}/${image.id}/${image.kind}/${hash}.webp`;
    run([wrangler,'r2','object','put',`r2-assets-local/${image.key}`,'--config',configPath,'--local','--persist-to',store,'--file',image.file,'--content-type','image/webp']);
    sql(`UPDATE ${image.table} SET ${image.field}='${image.key}' WHERE ${image.table==='players'?'uid':'id'}='${image.id}'`);
    const response=await fetch(live+'/media/'+image.key);
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.ok(response.headers.get('etag'));assert.match(response.headers.get('cache-control'),/max-age=31536000, immutable/);
    assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'),hash);
    const head=await fetch(live+'/media/'+image.key,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.ok((await html(live,image.page)).includes('/media/'+image.key),image.page);
  }
  const missingKey=`maps/island/cover/${'0'.repeat(64)}.webp`;
  const missing=await fetch(live+'/media/'+missingKey);assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store');
  for(const path of ['/media/random/path.webp','/media/teams//logo/file.webp','/media/teams/x/logo/file.svg','/media/teams/x/logo/file.html','/media/%252e%252e/x','/media/../__invalid__','/media/%2e%2e/__invalid__']){
    const response=await fetch(live+path);assert.ok(response.status>=400&&response.status<500,path);assert.doesNotMatch(response.headers.get('cache-control')??'',/immutable/);
  }
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch(live+'/media/'+images[0].key,{method,headers:{origin:live}})).status,405);
  assert.ok((await html(live,'/map-randomizer/')).includes('/media/'+images[2].key));
  assert.ok((await html(live,'/veto/')).includes('/media/'+images[2].key));
  assert.ok((await html(live,'/tournament/')).includes('/tournaments/clash-for-glory-s1.webp'));
  assert.doesNotMatch(await html(live,'/players/1345266890--before-clash-for-glory-s2/'),/\/media\/players\/1345266890/);
  const tables=['players','teams','maps','tournaments','matches','match_maps','player_match_entries','player_round_stats'];
  const response=JSON.parse(run([wrangler,'d1','execute','r2-assets-local','--config',configPath,'--local','--persist-to',store,'--json','--command',tables.map(table=>`SELECT * FROM ${table}`).join(';')]));
  const {compareStatistics}=await import('../scripts/d1-parity.mjs');
  const report=compareStatistics(data,Object.fromEntries(tables.map((table,index)=>[table,response[index].results])));
  assert.deepEqual(report.mismatches,[]);
  writeFileSync(join(scratch,'report.json'),JSON.stringify({pages:paths.length,assets:assets.size,parity:report},null,2));
  console.log(`R2 public regression passed: ${paths.length} pages with NULL/invalid keys, pre-0009 schema and missing DB binding; all 19 team pages and S1/S2 unchanged across fallback states; four real local R2 images/GET/HEAD/MIME/hash/cache/ETag plus security and official tools passed; ${assets.size} optimized assets; admin 403; canonical unchanged; D1 parity zero mismatches. ${scratch}`);
} finally {
  for(const child of servers)child.kill('SIGTERM');
}
