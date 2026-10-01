import assert from 'node:assert/strict';
const base=process.env.ADMIN_TEST_URL;
if(!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || process.env.ADMIN_TEST_LOCAL!=='1')throw new Error('Use ADMIN_TEST_URL and ADMIN_TEST_LOCAL=1 for an isolated offline staging server.');
const get=path=>fetch(base+path,{redirect:'manual'});
const post=(path,body,origin=base)=>fetch(base+path,{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
const decode=value=>value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'");
function fields(html){
  const data=new URLSearchParams();
  for(const [tag] of html.matchAll(/<input\b[^>]*>/g)){
    const name=tag.match(/name="([^"]*)"/)?.[1];if(!name)continue;
    if(/type="checkbox"/.test(tag)&&! /\bchecked(?:\s|>|=)/.test(tag))continue;
    data.set(name,decode(tag.match(/value="([^"]*)"/)?.[1]??''));
  }
  for(const [,attrs,body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){
    const name=attrs.match(/name="([^"]*)"/)?.[1];if(!name)continue;
    const options=[...body.matchAll(/<option\b([^>]*)>/g)];const chosen=options.find(([,a])=>/\bselected(?:\s|$|=)/.test(a))??options[0];if(chosen)data.set(name,decode(chosen[1].match(/value="([^"]*)"/)?.[1]??''));
  }
  return data;
}
const html=async path=>{const response=await get(path);assert.equal(response.status,200,path);return response.text();};
const send=async(path,data,status=303)=>{const response=await post(path,data);if(response.status!==status)throw new Error(`${path}: expected ${status}, got ${response.status}: ${(await response.text()).slice(-5000)}`);return response;};
const suffix=crypto.randomUUID();
async function create(name,date){const response=await send('/admin/tournaments/new',{name,start_date:date,end_date:date});return response.headers.get('location').replace(/\/setup$/,'');}
const source=await create(`HTTP workspace source ${suffix}`,'2026-10-01');
assert.equal((await get('/admin')).headers.get('cache-control'),'no-store');
assert.equal((await post('/admin/tournaments/new',{name:'Forbidden',start_date:'2026-01-01',end_date:'2026-01-01'},'https://evil.example')).status,403);
assert.equal((await post('/admin/tournaments/new',{name:'Invalid',start_date:'2026-02-30',end_date:'2026-02-30'})).status,400);
let setup=fields(await html(source+'/setup'));setup.set('bracket_size','32');
await send(source+'/setup',setup);
assert.equal((await post(source+'/setup',setup)).status,409);
assert.match(await html(source+'/setup'),/Top 32/);
let participants;
for(let i=0;i<32;i++){
  participants=fields(await html(source+'/participants'));participants.set('intent','add-new');participants.set('new_name',`HTTP Team ${i} ${suffix}`);participants.set('new_tag',`HT${i}`);participants.set('new_region','ID');await send(source+'/participants',participants);
}
const participantHTML=await html(source+'/participants');assert.match(participantHTML,/32 \/ 32 teams/);
const ids=[...fields(participantHTML)].filter(([key])=>/^participants\.\d+\.id$/.test(key)).map(([,value])=>value);assert.equal(ids.length,32);
const over=fields(participantHTML);over.set('intent','add-new');over.set('new_name',`HTTP Over Capacity ${suffix}`);over.set('new_tag','OVER');over.set('new_region','ID');await send(source+'/participants',over,400);
const shrink=fields(await html(source+'/setup'));shrink.set('bracket_size','16');await send(source+'/setup',shrink,409);
let roster=fields(await html(source+'/roster'));roster.set('intent','save');
ids.forEach((team,t)=>{for(let p=0;p<5;p++){const index=t*5+p;for(const [key,value] of Object.entries({team_id:team,id:'',name:`HTTP Player ${t}-${p}`,ign:`HTTP IGN ${t}-${p}`,uid:`http-${suffix}-${t}-${p}`}))roster.set(`entries.${index}.${key}`,value);}});
await send(source+'/roster',roster);
assert.match(await html(source+'/roster'),/32 \/ 32 teams ready/);
const next=await create(`HTTP workspace copy ${suffix}`,'2026-11-01');
setup=fields(await html(next+'/setup'));setup.set('bracket_size','32');await send(next+'/setup',setup);
participants=fields(await html(next+'/participants'));participants.set('intent','add-selected');ids.forEach(id=>participants.set(`selected.${id}`,'1'));await send(next+'/participants',participants);
const copiedHTML=await html(next+'/roster');assert.match(copiedHTML,/32 \/ 32 teams ready/);
roster=fields(copiedHTML);assert.equal([...roster.keys()].filter(key=>/^entries\.\d+\.id$/.test(key)).length,160);
const originalIGN=roster.get('entries.0.ign');const team0=roster.get('entries.0.team_id');const team1=roster.get('entries.5.team_id');
roster.set('entries.0.ign','HTTP copied inline edit');roster.set('entries.0.team_id',team1);roster.set('entries.5.team_id',team0);roster.set('intent','save');await send(next+'/roster',roster);
assert.match(await html(next+'/roster'),/HTTP copied inline edit/);assert.ok(!(await html(source+'/roster')).includes('HTTP copied inline edit'));assert.ok((await html(source+'/roster')).includes(originalIGN));
await send(next+'/roster',roster,409);
participants=fields(await html(next+'/participants'));participants.set('intent','add-selected');participants.set(`selected.${ids[0]}`,'1');await send(next+'/participants',participants,400);
participants=fields(await html(next+'/participants'));participants.set('intent','remove-selected');participants.set(`selected.${ids[0]}`,'1');await send(next+'/participants',participants);assert.match(await html(next+'/participants'),/31 \/ 32 teams/);
participants=fields(await html(next+'/participants'));participants.set('intent','add-selected');participants.set(`selected.${ids[0]}`,'1');await send(next+'/participants',participants);
// Moving between teams before removal can leave a copied roster incomplete. Restore the saved original assignments explicitly.
roster=fields(await html(next+'/roster'));const originals=fields(await html(source+'/roster'));const teamByPlayer=new Map();for(let i=0;i<160;i++)teamByPlayer.set(originals.get(`entries.${i}.id`),originals.get(`entries.${i}.team_id`));
for(const [key,id] of [...roster])if(/^entries\.\d+\.id$/.test(key))roster.set(key.replace(/\.id$/,'.team_id'),teamByPlayer.get(id));
const registered=new Set([...roster].filter(([key])=>/^entries\.\d+\.id$/.test(key)).map(([,id])=>id));let count=registered.size;
for(let i=0;i<160;i++){const id=originals.get(`entries.${i}.id`);if(registered.has(id))continue;for(const key of ['team_id','id','ign','name','uid'])roster.set(`entries.${count}.${key}`,originals.get(`entries.${i}.${key}`));count++;}
roster.set('intent','save');await send(next+'/roster',roster);
for(const section of ['', '/setup','/participants','/roster','/bracket','/matches']){const page=await html(next+section);assert.match(page,/aria-label="Tournament workspace"/);for(const label of ['Overview','Setup','Participants','Roster','Bracket','Matches'])assert.ok(page.includes(`<strong>${label}</strong>`));}
const bracketHTML=await html(next+'/bracket');let draw=fields(bracketHTML);draw.set('intent','draw');draw.set('draw_count','20');
assert.equal((await post(next+'/bracket',draw,'https://evil.example')).status,403);
const drawn=await send(next+'/bracket',draw,200);const preview=await drawn.text();
assert.equal([...preview.matchAll(/name="official-draw-history"/g)].length,20);
assert.equal([...preview.matchAll(/<details[^>]*name="official-draw-history"[^>]*\bopen(?:\s|>|=)/g)].length,1);
assert.match(preview,/Draw 20 of 20: Final candidate/);assert.match(await html(next+'/matches'),/No matches yet/);
const token=preview.match(/name="token" value="([^"]+)"/)[1];const confirmation={intent:'confirm',revision:draw.get('revision'),token};
await send(next+'/bracket',{...confirmation,token:token+'.bad'},409);
await send(next+'/bracket',confirmation);
assert.match(await html(next+'/matches'),/Official bracket saved/);
for(const section of ['/setup','/participants','/roster','/bracket'])assert.match(await html(next+section),/read-only/);
await send(next+'/setup',fields(await html(next+'/setup')),409);
participants=fields(await html(next+'/participants'));participants.set('intent','remove-selected');participants.set(`selected.${ids[0]}`,'1');await send(next+'/participants',participants,409);
roster=fields(await html(next+'/roster'));roster.set('intent','save');await send(next+'/roster',roster,409);
await send(next+'/bracket',confirmation,409);
console.log(`Admin HTTP PASS: 32 teams, bulk registration/removal, independent previous-roster copy, 160 players, inline IGN/move, capacity/stale validation, six sidebar destinations, 20 draws with one open bracket, signed final confirmation and all preparation locks. Offline local simulation. Browser fixture: ${source}`);
