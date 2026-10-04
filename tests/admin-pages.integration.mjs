import assert from 'node:assert/strict';
import {base,html,post,fields,create,createMaster,participantsForm,draw} from './admin-http-fixture.mjs';
const suffix=crypto.randomUUID();const source=await create(`HTTP 32-team Source ${suffix}`,32,'2026-10-02','0');const ids=[];
const invalidDraft=fields(await html(source+'/participants'));for(let i=0;i<2;i++)for(const [key,value]of Object.entries({id:'',name:'Duplicate Draft Team',tag:'DDT',region:'ID'}))invalidDraft.set(`participants.${i}.${key}`,value);const rejectedDraft=await(await post(source+'/participants',invalidDraft,400)).text();assert.match(rejectedDraft,/data-key="draft-0"/);assert.match(rejectedDraft,/data-key="draft-1"/);assert.match(await html(source),/0\/32/);
for(let i=0;i<32;i++)ids.push(await createMaster('teams',{name:`HTTP 32 Team ${i} ${suffix}`,tag:`HT${i}`,region:'ID'}));
const pending=participantsForm(await html(source+'/participants'),ids);assert.match(await html(source),/0\/32/);await post(source+'/participants',pending);await post(source+'/participants',pending,409);
await post(source+'/participants',participantsForm(await html(source+'/participants'),[...ids,ids[0]]),400);
let setup=fields(await html(source));setup.set('bracket_size','16');await post(source,setup,409);
let roster=fields(await html(source+'/roster'));roster.set('intent','save');ids.forEach((team,t)=>{for(let p=0;p<5;p++)for(const [key,value]of Object.entries({team_id:team,id:'',name:`HTTP Player ${t}-${p}`,ign:`HTTP IGN ${t}-${p}`,uid:`http32-${suffix}-${t}-${p}`}))roster.set(`entries.${t*5+p}.${key}`,value);});await post(source+'/roster',roster);
const next=await create(`HTTP 32-team Next Test ${suffix}`,32,'2026-11-01');await post(next+'/participants',participantsForm(await html(next+'/participants'),ids));
let page=await html(next+'/roster');assert.match(page,/Draft roster/);assert.equal([...fields(page).keys()].filter(key=>/^entries\.\d+\.id$/.test(key)).length,160);assert.match(await html(next),/0\/32/);
roster=fields(page);roster.set('intent','save');roster.set('entries.0.ign','Reviewed Snapshot');await post(next+'/roster',roster);assert.match(await html(next+'/roster'),/Reviewed Snapshot/);assert.doesNotMatch(await html(source+'/roster'),/Reviewed Snapshot/);
await post(next+'/participants',participantsForm(await html(next+'/participants'),ids.slice(1)));await post(next+'/participants',participantsForm(await html(next+'/participants'),ids));roster=fields(await html(next+'/roster'));roster.set('intent','save');await post(next+'/roster',roster);
for(const route of ['', '/participants','/roster','/bracket','/matches']){page=await html(next+route);assert.equal((page.match(/aria-label="Tournament workspace"[\s\S]*?<\/nav>/)?.[0].match(/<a /g)??[]).length,6);assert.match(page,/aria-label="Admin"/);}
const redirect=await fetch(base+next+'/setup',{redirect:'manual'});assert.equal(redirect.status,303);assert.equal(redirect.headers.get('location'),next);
const matches=await draw(next);assert.equal(matches.length,32);for(const route of ['', '/participants','/roster'])assert.match(await html(next+route),/read-only/);
await post(next+'/participants',participantsForm(await html(next+'/participants'),ids),409);roster=fields(await html(next+'/roster'));roster.set('intent','save');await post(next+'/roster',roster,409);
console.log('Workspace HTTP PASS: coherent creation, 32 teams/160 players, capacity/duplicate/stale checks, draft-only previous roster prefill, reviewed IGN preservation, six tabs, setup redirect, 20 draws and official preparation locks.');
