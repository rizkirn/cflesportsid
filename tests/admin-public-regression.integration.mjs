import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
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
 const sitemap=await html(d1,'/sitemap-0.xml');assert.equal(sitemap,await html(fallback,'/sitemap-0.xml'));
 const paths=[...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([,url])=>new URL(url).pathname);const assets=new Set();
 for(const path of paths){const live=await html(d1,path);const backup=await html(fallback,path);assert.equal(normalize(live),normalize(backup),`D1/fallback ${path}`);for(const [,asset]of live.matchAll(/(?:src|href)="(\/(?:_astro\/|_image\?)[^"]+)"/g))assets.add(asset.replaceAll('&amp;','&'));}
 for(const path of assets)assert.equal((await fetch(d1.url+path)).status,200,path);
 for(const collection of ['matches','teams','players','maps','tournament'])assert.match(await html(d1,`/${collection}/__missing__`,404),/Page not found/);
 for(const server of [d1,fallback])for(const path of ['/admin','/admin/tournaments','/admin/tournaments/new','/admin/teams','/admin/players','/admin/maps','/admin/brackets','/admin/matches','/admin/tournaments/test-cup','/admin/tournaments/test-cup/participants','/admin/tournaments/test-cup/roster','/admin/tournaments/test-cup/bracket','/admin/tournaments/test-cup/maps','/map-randomizer?adminTournament=test-cup&adminRound=top-8','/veto?adminTournament=test-cup&adminMatch=test-match','/admin/tournaments/test-cup/matches/test-match'])for(const method of ['GET','POST']){const response=await fetch(server.url+path,{method,redirect:'manual',...(method==='POST'?{headers:{origin:server.url,'content-type':'application/x-www-form-urlencoded'},body:'intent=create'}:{})});assert.equal(response.status,403,`${method} ${path}`);assert.equal(response.headers.get('cache-control'),'no-store');}
 assert.equal(await html(d1,'/robots.txt'),await html(fallback,'/robots.txt'));
 assert.doesNotMatch(d1.logs(),/JSON fallback/);assert.match(fallback.logs(),/JSON fallback/);
 env.BUILD_CHECK_URL=d1.url;
 console.log(run(['scripts/check-build.mjs']).toString().trim());
 const before=await html(d1,'/matches/');run([wrangler,'d1','execute','DB','--config',d1Config,'--local','--persist-to',store,'--command',"UPDATE matches SET date='2026-01-01T12:00:00Z'"]);assert.notEqual(await html(d1,'/matches/'),before);assert.equal(normalize(await html(fallback,'/matches/')),normalize(before));
 console.log(`Public regression PASS: ${paths.length} D1/fallback pages, ${assets.size} assets, sitemap/robots, missing routes, live D1 read, production admin GET/POST denied. No alternate checkout used.`);
}finally{for(const server of servers)if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}}
