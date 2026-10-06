import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
// Uses only this checkout's build and fresh local fixture databases.
const root=process.cwd();mkdirSync('.generated',{recursive:true});const scratch=mkdtempSync(resolve('.generated/admin-public-'));
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');const servers=[];
const env={...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(scratch,'logs')};
const run=args=>execFileSync(process.execPath,args,{cwd:root,env,stdio:'pipe',timeout:120000});
const built=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
const config={...built,main:resolve('dist/server',built.main),assets:{...built.assets,directory:resolve('dist/client')},d1_databases:[{binding:'DB',database_name:'admin-public-fixture',database_id:'00000000-0000-0000-0000-000000000022',migrations_dir:resolve('migrations'),remote:false}]};
delete config.configPath;delete config.userConfigPath;
const d1Config=join(scratch,'d1.json');const fallbackConfig=join(scratch,'fallback.json');const store=join(scratch,'fresh');
writeFileSync(d1Config,JSON.stringify(config));writeFileSync(fallbackConfig,JSON.stringify({...config,d1_databases:[]}));
run([wrangler,'d1','migrations','apply','DB','--config',d1Config,'--local','--persist-to',store]);
run([wrangler,'d1','execute','DB','--config',d1Config,'--local','--persist-to',store,'--file=.generated/seed-s1-s2.sql']);
async function start(path,port){const child=spawn(process.execPath,[wrangler,'dev','--config',path,'--persist-to',store,'--port',String(port),'--ip','127.0.0.1','--local'],{cwd:root,env,stdio:['ignore','pipe','pipe']});servers.push(child);let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);const url=`http://127.0.0.1:${port}`;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(url+'/robots.txt')).ok)return {url,logs:()=>logs};}catch{}await delay(100);}throw Error(logs);}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const normalize=html=>html.replace(/(<script\b[^>]*type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/g,(_,open,json,close)=>open+JSON.stringify(canonical(JSON.parse(json)))+close);
async function html(server,path,status=200){const response=await fetch(server.url+path);assert.equal(response.status,status,path);return response.text();}
try{
 const d1=await start(d1Config,44324);const fallback=await start(fallbackConfig,44325);
 const historicalId='1345266890--before-clash-for-glory-s2';
 for(const server of [d1,fallback]){
  const previous=await html(server,`/players/${historicalId}/`),current=await html(server,'/players/1345266890/');
  assert.match(previous,/<h1\b[^>]*>KangDedy<\/h1>/);assert.match(current,/<h1\b[^>]*>KucayyPRMX<\/h1>/);
  assert.match(previous,/>Historical<\/span>/);assert.ok(!previous.includes('Teammates'));
  for(const id of ['m06','m10','m13']){assert.ok(previous.includes(`/matches/${id}`));assert.ok(!current.includes(`/matches/${id}`));}
  for(const id of ['s2-m04','s2-m08']){assert.ok(current.includes(`/matches/${id}`));assert.ok(!previous.includes(`/matches/${id}`));}
  assert.ok(previous.includes('/players/1345266890/'));assert.ok(current.includes(`/players/${historicalId}/`));
  const board=await html(server,'/players/');
  writeFileSync(join(scratch,'continuity-leaderboard.html'),board);
  const rows=[...board.matchAll(/<tr\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)].filter(r=>r[0].includes('data-kills')).map(r=>[r[0],...['kills','deaths','assists'].map(key=>r[0].match(new RegExp(`data-${key}="(\\d+)"`))[1])]);
  assert.equal(rows.length,128);assert.deepEqual([1,2,3].map(i=>rows.reduce((n,r)=>n+Number(r[i]),0)),[5019,5010,2318]);
  assert.match(board,/data-ign="kangdedy"[^>]*data-kills="70"[^>]*data-deaths="40"[^>]*data-assists="42"/);
  assert.match(board,/data-ign="kucayyprmx"[^>]*data-kills="50"[^>]*data-deaths="16"[^>]*data-assists="24"/);
  const oldMatch=await html(server,'/matches/m06/');assert.ok(oldMatch.includes('KangDedy'));assert.ok(oldMatch.includes(`/players/${historicalId}`));
 }
 if(process.env.CONTINUITY_BASELINE_DIR){
  const baselineDir=resolve(process.env.CONTINUITY_BASELINE_DIR);
  const original=JSON.parse(readFileSync(join(baselineDir,'server/wrangler.json'),'utf8'));
  const baselineConfig=join(scratch,'baseline.json');
  delete original.configPath;delete original.userConfigPath;delete original.previews;
  writeFileSync(baselineConfig,JSON.stringify({...original,main:join(baselineDir,'server/entry.mjs'),assets:{...original.assets,directory:join(baselineDir,'client')},d1_databases:[]}));
  const baseline=await start(baselineConfig,44329);
  for(const file of readdirSync('src/data/teams').filter(f=>f.endsWith('.json'))){
   const path=`/teams/${file.slice(0,-5)}/`;
   assert.equal(await html(d1,path),await html(baseline,path),`Team Details must be byte-identical: ${path}`);
  }
  for(const file of readdirSync('src/data/tournaments').filter(f=>f.endsWith('.json'))){
   const path=`/tournament/${file.slice(0,-5)}/`;
   assert.equal(await html(d1,path),await html(baseline,path),`Tournament page must be byte-identical: ${path}`);
  }
  console.log('Continuity regression PASS: 19 Team Details and 2 tournament pages byte-identical to pre-change artifact.');
 }
 const sitemap=await html(d1,'/sitemap-0.xml');assert.equal(sitemap,await html(fallback,'/sitemap-0.xml'));
 const paths=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([,url])=>new URL(url).pathname);const assets=new Set();
 for(const path of paths){const live=await html(d1,path);const backup=await html(fallback,path);assert.equal(normalize(live),normalize(backup),`D1/fallback ${path}`);for(const [,asset]of live.matchAll(/(?:src|href)="(\/(?:_astro\/|_image\?)[^"]+)"/g))assets.add(asset.replaceAll('&amp;','&'));}
 for(const path of assets)assert.equal((await fetch(d1.url+path)).status,200,path);
 for(const collection of ['matches','teams','players','maps','tournament'])assert.match(await html(d1,`/${collection}/__missing__`,404),/Page not found/);
 for(const server of [d1,fallback])for(const path of ['/admin','/admin/tournaments','/admin/tournaments/new','/admin/teams','/admin/players','/admin/maps','/admin/brackets','/admin/matches','/admin/tournaments/test-cup','/admin/tournaments/test-cup/participants','/admin/tournaments/test-cup/roster','/admin/tournaments/test-cup/bracket','/admin/tournaments/test-cup/maps','/map-randomizer?adminTournament=test-cup&adminRound=top-8','/veto?adminTournament=test-cup&adminMatch=test-match','/admin/tournaments/test-cup/matches/test-match'])for(const method of ['GET','POST']){const response=await fetch(server.url+path,{method,redirect:'manual',...(method==='POST'?{headers:{origin:server.url,'content-type':'application/x-www-form-urlencoded'},body:'intent=create'}:{})});if(path.includes('adminTournament=')){assert.equal(response.status,303,`${method} ${path}`);const target=response.headers.get('location');assert.match(target,/^\/admin\/tournaments\//);assert.equal((await fetch(server.url+target)).status,403);}else assert.equal(response.status,403,`${method} ${path}`);assert.equal(response.headers.get('cache-control'),'no-store');}
 assert.equal(await html(d1,'/robots.txt'),await html(fallback,'/robots.txt'));
 assert.doesNotMatch(d1.logs(),/JSON fallback/);assert.match(fallback.logs(),/JSON fallback/);
 env.BUILD_CHECK_URL=d1.url;
 console.log(run(['scripts/check-build.mjs']).toString().trim());
 const before=await html(d1,'/matches/');run([wrangler,'d1','execute','DB','--config',d1Config,'--local','--persist-to',store,'--command',"UPDATE matches SET date='2026-01-01T12:00:00Z'"]);assert.notEqual(await html(d1,'/matches/'),before);assert.equal(normalize(await html(fallback,'/matches/')),normalize(before));
 console.log(`Public regression PASS: ${paths.length} D1/fallback pages, ${assets.size} assets, sitemap/robots, missing routes, live D1 read, production admin GET/POST denied. No alternate checkout used.`);
}finally{for(const server of servers)if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}}
