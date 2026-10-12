import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {validateEnvironment,inventory} from './safety.mjs';

const root=process.env.CFL_PHASE1A_ROOT;
assert.ok(root);
const marker=JSON.parse(readFileSync(join(root,'ownership.json'),'utf8'));
const baseConfig=JSON.parse(readFileSync(join(root,'wrangler.json'),'utf8'));
validateEnvironment(root,marker.repo,marker,baseConfig);assert.equal(marker.phase,'1C');
execFileSync(process.execPath,[join(root,'probe.mjs')],{cwd:root,env:process.env,stdio:'pipe'});
const project=join(root,'project');mkdirSync(project);
for(const name of ['src','public','package.json','tsconfig.json','astro.config.mjs'])cpSync(join(marker.repo,name),join(project,name),{recursive:true});
cpSync(join(root,'migrations'),join(project,'migrations'),{recursive:true});
symlinkSync(join(marker.repo,'node_modules'),join(project,'node_modules'),'dir');
let source=readFileSync(join(project,'astro.config.mjs'),'utf8')
 .replace("prerenderEnvironment: 'node',", "prerenderEnvironment: 'node', remoteBindings:false, persistState:{path:process.env.CFL_PHASE1C_STATE},")
 .replace('  session: false,',`  vite: {cacheDir:${JSON.stringify(join(root,'tmp/vite'))}},\n  session: false,`);
writeFileSync(join(project,'astro.config.mjs'),source);
// Only the disposable test copy contains this database fault injector.
const middleware=join(project,'src/middleware.ts');
source=readFileSync(middleware,'utf8').replace('const bindings = env as unknown as Record<string, unknown>;',`const bindings = env as unknown as Record<string, unknown>;
    if (bindings.CFL_PHASE1C_FAULT === 'query') bindings.DB = {prepare(){return {};},async batch(){throw new Error('PRIVATE_FAILURE_SENTINEL');}};`);
writeFileSync(middleware,source);
const publicModule=join(project,'src/data-access/public-d1.mjs');
source=readFileSync(publicModule,'utf8').replaceAll("catch {\n        throw new PublicDataError('QUERY_FAILED');","catch(error) {\n        console.error('[disposable-sql-error]', String(error.message).slice(0,350));\n        throw new PublicDataError('QUERY_FAILED');");writeFileSync(publicModule,source);
const report={phase:'1C',status:'running',routes:[],shadow:[],failures:[]};
let server,serverLogs='';const htmlByMode={};const state=join(root,'state');
const sqlite=Object.keys(inventory(state)).find(p=>p.endsWith('.sqlite')&&!p.endsWith('metadata.sqlite'));assert.ok(sqlite);
const dbPath=join(state,sqlite);const db=new DatabaseSync(dbPath,{readOnly:true});
const routes=['/','/teams/','/players/','/maps/','/matches/','/tournament/','/veto/','/map-randomizer/','/bracket-generator/'];
for(const [table,route,identity] of [['teams','teams','id'],['players','players','COALESCE(uid,id)'],['maps','maps','id'],['matches','matches','id'],['tournaments','tournament','id']])routes.push(...db.prepare(`SELECT ${identity} id FROM ${table} ORDER BY id`).all().map(r=>`/${route}/${encodeURIComponent(r.id)}/`));
routes.push(...db.prepare('SELECT id FROM player_identity_segments').all().map(r=>'/players/'+r.id+'/'));db.close();
function save(){writeFileSync(join(root,'http-report.json'),JSON.stringify(report,null,2));}
async function stop(){if(!server)return;const child=server;server=undefined;child.kill('SIGTERM');for(let i=0;i<50&&child.exitCode===null;i++)await delay(100);if(child.exitCode===null)child.kill('SIGKILL');}
async function start(mode,{missing=false,empty=false,fault=false}={}){
 await stop();serverLogs='';
 const config={...baseConfig,main:'@astrojs/cloudflare/entrypoints/server',compatibility_flags:['nodejs_compat'],vars:{CFL_PUBLIC_MODE:mode,CFL_PUBLIC_LOCAL:'phase1c-disposable',CFL_PUBLIC_DATABASE_ID:marker.databaseId,...(fault?{CFL_PHASE1C_FAULT:'query'}:{})}};
 validateEnvironment(root,marker.repo,marker,config);if(missing)config.d1_databases=[];
 const configPath=join(project,'wrangler.json');writeFileSync(configPath,JSON.stringify(config));
 const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});});
 server=spawn(process.execPath,[join(marker.repo,'node_modules/astro/bin/astro.mjs'),'dev','--host','127.0.0.1','--port',String(port)],{cwd:project,env:{...process.env,CFL_ADMIN_CONFIG:configPath,CFL_PHASE1C_STATE:empty?join(root,'empty-state'):state},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',data=>{serverLogs+=data;writeFileSync(join(root,'logs/http-live.log'),serverLogs);});server.stderr.on('data',data=>{serverLogs+=data;writeFileSync(join(root,'logs/http-live.log'),serverLogs);});const url='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){
  if(server.exitCode!==null){writeFileSync(join(root,'logs/http-startup.log'),serverLogs);throw Error('Isolated HTTP server exited; inspect local startup log');}
  try{const response=await fetch(url+'/robots.txt',{signal:AbortSignal.timeout(5000)});if(response.status===200||response.status===503)return url;}catch{}await delay(100);
 }
 writeFileSync(join(root,'logs/http-startup.log'),serverLogs);throw Error('Isolated HTTP startup timed out');
}
function normalized(html){return html.replace(/http:\/\/127\.0\.0\.1:\d+/g,'http://LOCAL').replace(/\?t=\d+/g,'').replace(/data-astro-cid-[a-z0-9]+/g,'data-astro-cid');}
async function page(url,path,status=200){const response=await fetch(url+path,{signal:AbortSignal.timeout(30000)});const body=await response.text();if(response.status!==status){writeFileSync(join(root,'logs/http-response.txt'),body);writeFileSync(join(root,'logs/http-server.log'),serverLogs);}assert.equal(response.status,status,path+' status');assert.ok(!body.includes('PRIVATE_FAILURE_SENTINEL')&&!body.includes('actor_email')&&!body.includes('audit_payload'));return body;}
async function parallel(items,fn){let index=0;await Promise.all(Array.from({length:4},async()=>{while(index<items.length)await fn(items[index++]);}));}
try{
 for(const mode of ['hybrid','shadow','d1']){
  report.currentMode=mode;save();const url=await start(mode);const pages=new Map();htmlByMode[mode]=pages;
  await parallel(routes,async path=>{pages.set(path,normalized(await page(url,path)));report.routes.push({mode,path,status:200});});
  for(const collection of ['teams','players','maps','matches','tournament'])await page(url,'/'+collection+'/does-not-exist/',404);
  if(mode==='shadow'){
   for(const path of routes)assert.equal(pages.get(path),htmlByMode.hybrid.get(path),'Shadow response changed: '+path);
   report.shadow=serverLogs.split('\n').filter(line=>line.includes('[public-shadow]')).map(line=>JSON.parse(line.slice(line.indexOf('[public-shadow]')+'[public-shadow]'.length).trim()));assert.ok(report.shadow.length>0);
  }
  if(mode==='d1'){
   const sitemap=await page(url,'/local-verification/sitemap.xml');for(const path of routes.filter(path=>/^\/(teams|players|maps|matches|tournament)\/.+/.test(path)))assert.ok(sitemap.includes('https://cflesports.com'+path),path+' sitemap');report.sitemap={status:'PASS',historicalProfiles:128};
   const internal=new Set();
   for(const html of pages.values())for(const match of html.matchAll(/href="([^"]+)"/g)){
    const href=match[1].replaceAll('&amp;','&');if(!href.startsWith('/'))continue;
    const path=new URL(href,url).pathname;
    if(/^\/(teams|players|maps|matches|tournament)\/.+/.test(path))internal.add(path.endsWith('/')?path:path+'/');
   }
   for(const path of internal)assert.ok(pages.has(path),'Unverified internal entity link: '+path);
   for(const path of ['/logos/default.webp','/players/default.webp','/maps/placeholder.svg'])await page(url,path);
   report.links={status:'PASS',entityLinks:internal.size,staticAssets:3};
   const historical=pages.get('/players/1345266890--before-clash-for-glory-s2/');assert.ok(historical.includes('KangDedy')&&historical.includes('cha-tra-mue'));
   for(const path of routes)assert.ok(pages.get(path).includes('<main')||pages.get(path).includes('<body'),path+' rendered');
  }
  await stop();save();
 }
 const fixture=new DatabaseSync(dbPath);fixture.exec('PRAGMA foreign_keys=ON');
 fixture.exec(`INSERT INTO teams(id,name,tag,region) VALUES('http-official-team','HTTP Official Team','HTTP','ID'),('http-secret-team','HTTP Test Team','SECRET','ID');
 INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES('http-official-player','http-official-uid','HTTP Player','HTTP Historical IGN','http-official-team'),('http-secret-player','http-secret-uid','HTTP Private Player','HTTP Private IGN','http-secret-team');
 INSERT INTO maps(id,name) VALUES('http-official-map','HTTP Official Map'),('http-secret-map','HTTP Test Map');
 INSERT INTO tournaments(id,name,start_date,end_date,status,format,is_test,winner_team_id) VALUES('http-official','HTTP Official Tournament','2027-01-01','2027-01-02','completed','single-elimination',0,'http-official-team'),('http-test','HTTP Test Tournament','2027-01-01','2027-01-02','upcoming','single-elimination',1,NULL);`);
 for(const [tid,team,map] of [['http-official','http-official-team','http-official-map'],['http-test','http-secret-team','http-secret-map']]){
  fixture.prepare("INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count) VALUES(?,'stage','HTTP Final','single-elimination',2,'fixed-maps',3)").run(tid);fixture.prepare("INSERT INTO tournament_rounds VALUES(?,'stage','final','Final',1,1)").run(tid);fixture.prepare('INSERT INTO tournament_teams VALUES(?,?)').run(tid,team);fixture.prepare('INSERT INTO tournament_teams VALUES(?,?)').run(tid,'cha-tra-mue');fixture.prepare("INSERT INTO stage_map_pool VALUES(?,'stage',?,1)").run(tid,map);
 }
 fixture.exec("INSERT INTO tournament_rosters VALUES('http-official','http-official-team','http-official-player','Saved HTTP IGN',3),('http-test','http-secret-team','http-secret-player','Private snapshot',2);INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id,team2_id,score1,score2,winner_id,result_type) VALUES('http-walkover','http-official','stage','final',1,'2027-01-01','completed','http-official-team','cha-tra-mue',0,0,'http-official-team','walkover')");assert.deepEqual(fixture.prepare('PRAGMA foreign_key_check').all(),[]);fixture.close();
 const url=await start('d1');
 for(const [path,text] of [['/teams/http-official-team/','HTTP Official Team'],['/players/http-official-uid/','HTTP Historical IGN'],['/maps/http-official-map/','HTTP Official Map'],['/matches/http-walkover/','W/O'],['/tournament/http-official/','HTTP Official Tournament']]){assert.ok((await page(url,path)).includes(text),path);report.routes.push({mode:'d1-fixture',path,status:200});}
 for(const path of ['/teams/http-secret-team/','/players/http-secret-uid/','/maps/http-secret-map/','/tournament/http-test/']){await page(url,path,404);report.routes.push({mode:'d1-test-only',path,status:404});}
 for(const path of ['/teams/','/players/','/maps/','/tournament/','/local-verification/sitemap.xml']){const body=await page(url,path);assert.ok(!body.includes('http-secret')&&!body.includes('/tournament/http-test/'));}
 await stop();
 for(const [options,code] of [[{missing:true},'MISSING_BINDING'],[{empty:true},'SCHEMA_REQUIRED'],[{fault:true},'QUERY_FAILED']]){
  const url=await start('d1',options);const response=await fetch(url+'/players/does-not-exist/');assert.equal(response.status,503);const body=await response.json();assert.equal(body.error,code);assert.ok(!JSON.stringify(body).includes('PRIVATE_FAILURE_SENTINEL'));report.failures.push({code,status:503});await stop();
 }
 assert.deepEqual(inventory(join(marker.repo,'.wrangler/state/v3/d1')),marker.protectedStores);report.status='PASS';
}catch(error){report.status='FAIL';report.failure=error.message;throw error;}finally{await stop();save();}
console.log(JSON.stringify({http:report.status,routes:report.routes.length,shadowRequests:report.shadow.length,failures:report.failures,sitemap:report.sitemap,report:join(root,'http-report.json')},null,2));
