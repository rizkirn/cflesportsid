import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const base=process.env.ADMIN_TEST_URL;
if(!base||!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)||process.env.ADMIN_TEST_LOCAL!=='1')throw new Error('Use an isolated seeded offline staging server.');
const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200,path);return r.text();};
const post=async(path,body,status=303)=>{const r=await fetch(base+path,{method:'POST',redirect:'manual',headers:{origin:base,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});assert.equal(r.status,status,await r.clone().text());return r;};
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'");
function fields(html) {
  const form=new URLSearchParams();
  for(const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const name=tag.match(/name="([^"]*)"/)?.[1];if(!name||/type="radio"/.test(tag)||/type="checkbox"/.test(tag)&&! /\bchecked(?:\s|>|=)/.test(tag))continue;
    form.set(name,decode(tag.match(/value="([^"]*)"/)?.[1]??''));
  }
  for(const [,attrs,body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const name=attrs.match(/name="([^"]*)"/)?.[1];if(!name)continue;
    const options=[...body.matchAll(/<option\b([^>]*)>/g)],chosen=options.find(([,a])=>/\bselected(?:\s|$|=)/.test(a))??options[0];
    if(chosen)form.set(name,decode(chosen[1].match(/value="([^"]*)"/)?.[1]??''));
  }return form;
}
const suffix=crypto.randomUUID();
const created=await post('/admin/tournaments/new',{name:`Phase B offline verification ${suffix}`,start_date:'2026-10-01',end_date:'2026-10-02'});
const root=created.headers.get('location').replace(/\/setup$/,'');
let form=fields(await get(root+'/setup'));form.set('bracket_size','4');await post(root+'/setup',form);
for(let i=0;i<4;i++) {
  form=fields(await get(root+'/participants'));form.set('intent','add-new');form.set('new_name',`Offline Details Team ${i} ${suffix}`);form.set('new_tag',`OD${i}`);form.set('new_region','ID');await post(root+'/participants',form);
}
const teams=[...fields(await get(root+'/participants'))].filter(([k])=>/^participants\.\d+\.id$/.test(k)).map(([,v])=>v);
form=fields(await get(root+'/roster'));form.set('intent','save');
teams.forEach((team,t)=>{for(let p=0;p<7;p++)for(const [key,value]of Object.entries({team_id:team,id:'',name:`Offline Details Player ${t}-${p}`,ign:`Screenshot IGN ${t}-${p}`,uid:`details-${suffix}-${t}-${p}`}))form.set(`entries.${t*7+p}.${key}`,value);});
await post(root+'/roster',form);
form=fields(await get(root+'/bracket'));form.set('intent','draw');form.set('draw_count','1');
const draw=await(await post(root+'/bracket',form,200)).text();await post(root+'/bracket',{intent:'confirm',revision:form.get('revision'),token:draw.match(/name="token" value="([^"]+)"/)[1]});
const liveForms=html=>[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(([,f])=>fields(f)).filter(f=>f.has('match_id'));
let bracket=await get(root+'/bracket');form=liveForms(bracket).find(f=>f.get('intent')==='save-score');const matchId=form.get('match_id');
const path=root+'/matches/'+matchId;
async function checkActions(action,status) {
  for(const page of ['/matches','/bracket']) {
    const html=await get(root+page);
    const card=[...html.matchAll(/<li\b[^>]*>([^]*?)<\/li>/g)].find(([,body])=>body.includes(`href="${path}"`))?.[1]??'';
    const link=`href="${path}">${action}</a>`;
    assert.ok(card.includes(link),`${page}: ${action}`);
    assert.ok(card.includes(status),`${page}: ${status}`);
    assert.ok(card.includes(`href="/matches/${matchId}">View public match</a>`));
    for(const other of ['Enter Match Details','Continue Match Details','View Match Details'].filter(label=>label!==action))assert.ok(!card.includes(other));
  }
}
for(const page of ['/matches','/bracket'])assert.ok(!(await get(root+page)).includes(`href="${path}"`),'unconfirmed match has no detail action');
assert.match(await get(path),/Confirm the series result/);
form.set('score1','2');form.set('score2','1');await post(root+'/bracket',form);
bracket=await get(root+'/bracket');await post(root+'/bracket',liveForms(bracket).find(f=>f.get('match_id')===matchId&&f.get('intent')==='confirm-result'));
await checkActions('Enter Match Details','Details not entered');
let editor=await get(path);assert.equal((editor.match(/data-map-result/g)??[]).length,3);assert.equal((editor.match(/data-player-row/g)??[]).length,42);assert.doesNotMatch(editor,/<input[^>]*type="checkbox"/);
form=fields(editor);form.set('maps.0.map_id','aztec');form.set('maps.0.players.0.kills','0');form.set('intent','save-draft');
await post(path,form);editor=await get(path);assert.match(editor,/Saved draft/);assert.equal(fields(editor).get('maps.0.players.0.kills'),'0');assert.equal(fields(editor).get('maps.0.players.0.deaths'),'');
await checkActions('Continue Match Details','Details draft');
let publicPage=await get('/matches/'+matchId);assert.match(publicPage,/2 - 1/);assert.match(publicPage,/Match details are not available yet\./);assert.doesNotMatch(publicPage,/Screenshot IGN/);
const publicBefore=await get('/players/');const mapsBefore=await get('/maps/');
await post(path,form,409);
form=fields(editor);form.set('intent','complete-details');await post(path,form,400);
form=fields(editor);
for(let i=0;i<3;i++) {
  form.set(`maps.${i}.map_id`,['aztec','ankara','power-supply'][i]);form.set(`maps.${i}.score1`,i===1?'2':'7');form.set(`maps.${i}.score2`,i===1?'7':'3');
  for(let p=0;p<14;p++)for(const key of ['kills','deaths','assists'])form.set(`maps.${i}.players.${p}.${key}`,p%7<5&&!(i===2&&p===4)||i===2&&p===6?key==='deaths'?'7':'0':'');
  form.set(`maps.${i}.mvp`,form.get(`maps.${i}.players.${i===2?6:0}.player_id`));
}
form.set('intent','save-draft');await post(path,form);editor=await get(path);assert.match(editor,/data-derived-score>2–1/s);
assert.equal(await get('/players/'),publicBefore);assert.equal(await get('/maps/'),mapsBefore);
assert.match(await get('/matches/'+matchId),/Match details are not available yet\./);
form.set('revision',fields(editor).get('revision'));form.set('intent','complete-details');
const partial=new URLSearchParams(form);partial.set('maps.0.players.0.assists','');assert.match(await(await post(path,partial,400)).text(),/enter all K\/D\/A/);
const six=new URLSearchParams(form);for(const k of ['kills','deaths','assists'])six.set(`maps.0.players.5.${k}`,'0');assert.match(await(await post(path,six,400)).text(),/exactly 5/);
const mvp=new URLSearchParams(form);mvp.set('maps.0.mvp',mvp.get('maps.0.players.5.player_id'));assert.match(await(await post(path,mvp,400)).text(),/participating player/);
const conflict=new URLSearchParams(form);conflict.set('maps.0.score1','0');assert.match(await(await post(path,conflict,400)).text(),/differs from confirmed/);
await post(path,form);editor=await get(path);assert.match(editor,/Completed details/);assert.doesNotMatch(editor,/>Save Draft<|>Complete Details</);
await checkActions('View Match Details','Details completed');
publicPage=await get('/matches/'+matchId);assert.doesNotMatch(publicPage,/Match details are not available yet\./);assert.match(publicPage,/2 - 1/);assert.match(publicPage,/Screenshot IGN/);assert.match(publicPage,/7–3/);assert.match(publicPage,/2–7/);assert.match(publicPage,/Round 3 MVP/);
assert.notEqual(await get('/maps/'),mapsBefore);
await post(path,{...Object.fromEntries(form),revision:fields(editor).get('revision')},409);
const cross=await fetch(base+path,{method:'POST',headers:{origin:'http://other','content-type':'application/x-www-form-urlencoded'},body:form});assert.equal(cross.status,403);
writeFileSync('.generated/phase-b-browser-url.txt',base+path);
console.log('Phase B HTTP PASS: fixed three maps, entire seven-player rosters, blank/zero and partial draft reload, stale save, draft absent from public match/player/map stats, strict completion errors, substitutions, ACE Gold participation, confirmed score reconciliation, complete lock and public D1 details without rebuild.');
for(const playedCount of [2,1]) {
  bracket=await get(root+'/bracket');form=liveForms(bracket).find(f=>f.get('intent')==='save-score');
  const mixedId=form.get('match_id');const mixedPath=root+'/matches/'+mixedId;
  form.set('score1','2');form.set('score2','1');await post(root+'/bracket',form);
  bracket=await get(root+'/bracket');await post(root+'/bracket',liveForms(bracket).find(f=>f.get('match_id')===mixedId&&f.get('intent')==='confirm-result'));
  editor=await get(mixedPath);form=fields(editor);
  for(let i=0;i<3;i++) {
    form.set(`maps.${i}.mode`,i<playedCount?'played':'walkover');
    form.set(`maps.${i}.map_id`,i<playedCount?['aztec','ankara','power-supply'][i]:'');
    form.set(`maps.${i}.winner_side`,i<playedCount?'':i===1?'2':'1');
    form.set(`maps.${i}.score1`,i===1?'2':'7');form.set(`maps.${i}.score2`,i===1?'7':'3');
    for(let p=0;p<14;p++)for(const k of ['kills','deaths','assists'])form.set(`maps.${i}.players.${p}.${k}`,p%7<5?'1':'');
    form.set(`maps.${i}.mvp`,form.get(`maps.${i}.players.0.player_id`));
  }
  form.set('intent','save-draft');await post(mixedPath,form);editor=await get(mixedPath);
  const saved=fields(editor);assert.equal(saved.get(`maps.${playedCount}.score1`),'');assert.equal(saved.get(`maps.${playedCount}.mvp`),'');
  form=saved;form.set('intent','complete-details');await post(mixedPath,form);
  publicPage=await get('/matches/'+mixedId);assert.match(publicPage,/2 - 1/);assert.match(publicPage,/W\/O · Winner:/);
  const woCards=[...publicPage.matchAll(/<article\b[^>]*>([^]*?)<\/article>/g)].map(([,body])=>body).filter(body=>body.includes('W/O'));
  assert.equal(woCards.length,3-playedCount);for(const card of woCards)assert.doesNotMatch(card,/No MVP|mvp-kda|7–0|7–3|2–7/);
  assert.match(publicPage,/7–3/);assert.match(publicPage,/Screenshot IGN/);
  writeFileSync('.generated/wo-verification/mixed-url.txt',base+mixedPath);
}
bracket=await get(root+'/bracket');form=liveForms(bracket).find(f=>f.get('intent')==='confirm-walkover');
const woId=form.get('match_id');
const winner=[...bracket.matchAll(/<form\b[^>]*>([^]*?)<\/form>/g)].map(([,body])=>body).find(body=>body.includes(`value="${woId}"`)&&body.includes('confirm-walkover')).match(/<option value="([^"]+)"/)[1];
form.set('walkover_winner',winner);await post(root+'/bracket',form);
publicPage=await get('/matches/'+woId);assert.match(publicPage,/W\/O · Winner:/);assert.doesNotMatch(publicPage,/Match details are not available yet|No MVP|class="mvp-kda"/);
assert.match(await get(root+'/matches'),/W\/O · Match Details not required/);
console.log('W/O HTTP PASS: 2 played + 1 W/O, 1 played + 2 W/O, stale combat discarded in drafts, authoritative reconciliation, mixed public cards without fake MVP/KDA, full-match W/O and no details action.');
