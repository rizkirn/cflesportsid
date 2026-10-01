import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const base=process.env.ADMIN_TEST_URL;
if(!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || process.env.ADMIN_TEST_LOCAL!=='1') throw new Error('Use an isolated seeded offline staging server.');
const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200,path);return r.text();};
const post=async(path,body,status=303)=>{const r=await fetch(base+path,{method:'POST',redirect:'manual',headers:{origin:base,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});assert.equal(r.status,status,await r.clone().text());return r;};
function fields(html) {
  const values=new URLSearchParams();
  for(const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const name=tag.match(/name="([^"]*)"/)?.[1];if(!name)continue;
    if(/type="checkbox"/.test(tag)&&! /\bchecked(?:\s|>|=)/.test(tag))continue;
    values.set(name,(tag.match(/value="([^"]*)"/)?.[1]??'').replaceAll('&amp;','&').replaceAll('&quot;','"'));
  }
  for(const [,attrs,body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const name=attrs.match(/name="([^"]*)"/)?.[1];if(!name)continue;
    const options=[...body.matchAll(/<option\b([^>]*)>/g)];const chosen=options.find(([,a])=>/\bselected(?:\s|$|=)/.test(a))??options[0];
    if(chosen)values.set(name,chosen[1].match(/value="([^"]*)"/)?.[1]??'');
  }
  return values;
}
const suffix=crypto.randomUUID();
const created=await post('/admin/tournaments/new',{name:`Phase A offline verification ${suffix}`,start_date:'2026-10-01',end_date:'2026-10-02'});
const root=created.headers.get('location').replace(/\/setup$/,'');const tid=root.split('/').at(-1);
let form=fields(await get(root+'/setup'));form.set('bracket_size','4');await post(root+'/setup',form);
for(let i=0;i<4;i++) {
  form=fields(await get(root+'/participants'));form.set('intent','add-new');form.set('new_name',`Offline Live Team ${i} ${suffix}`);form.set('new_tag',`OL${i}`);form.set('new_region','ID');await post(root+'/participants',form);
}
const ids=[...fields(await get(root+'/participants'))].filter(([k])=>/^participants\.\d+\.id$/.test(k)).map(([,v])=>v);
form=fields(await get(root+'/roster'));form.set('intent','save');
ids.forEach((team,t)=>{for(let p=0;p<5;p++)for(const [key,value] of Object.entries({team_id:team,id:'',name:`Offline Player ${t}-${p}`,ign:`Offline IGN ${t}-${p}`,uid:`offline-${suffix}-${t}-${p}`}))form.set(`entries.${t*5+p}.${key}`,value);});
await post(root+'/roster',form);
form=fields(await get(root+'/bracket'));form.set('intent','draw');form.set('draw_count','1');
const draw=await (await post(root+'/bracket',form,200)).text();
await post(root+'/bracket',{intent:'confirm',revision:form.get('revision'),token:draw.match(/name="token" value="([^"]+)"/)[1]});
function matchForms(html) {
  return [...html.matchAll(/<li\b[^>]*data-live-match="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(([,id,body])=>({id,body,forms:[...body.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(([,f])=>fields(f))}));
}
let page=await get(root+'/bracket');assert.match(page,/Live bracket results/);assert.match(page,/Save Score/);
const first=matchForms(page).find(m=>m.forms.length);const before=await get(`/tournament/${tid}`);
const score=first.forms[0];score.set('score1','1');score.set('score2','0');await post(root+'/bracket',score);
page=await get(root+'/bracket');assert.match(matchForms(page).find(m=>m.id===first.id).body,/value="1"/);
assert.notEqual(await get(`/tournament/${tid}`),before,'live series score must reach public bracket without rebuilding');
let detail=await get(`/matches/${first.id}`);assert.match(detail,/1 - 0/);assert.match(detail,/Match details are not available yet\./);assert.doesNotMatch(detail,/class="mvp-card"|class="player-stats-table"/);
const listing=await get('/matches/');assert.ok(listing.includes(first.id));assert.match(listing,/Offline Live Team/);assert.ok((await get('/tournament/')).includes(tid));
await post(root+'/bracket',score,409);
form=matchForms(page).find(m=>m.id===first.id).forms[0];form.set('score1','2');form.set('score2','1');await post(root+'/bracket',form);
page=await get(root+'/bracket');const confirm=matchForms(page).find(m=>m.id===first.id).forms.find(f=>f.get('intent')==='confirm-result');assert.ok(confirm);
await post(root+'/bracket',confirm);
page=await get(root+'/bracket');assert.equal(matchForms(page).find(m=>m.id===first.id).forms.length,0);assert.match(matchForms(page).find(m=>m.id===first.id).body,/Result confirmed/);
detail=await get(`/matches/${first.id}`);assert.match(detail,/2 - 1/);assert.match(detail,/Match details are not available yet\./);
await post(root+'/bracket',{...Object.fromEntries(confirm),result_revision:fields(page).get('result_revision')},409);
const second=matchForms(page).find(m=>m.forms.length);
form=second.forms[0];form.set('score1','0');form.set('score2','3');await post(root+'/bracket',form);
page=await get(root+'/bracket');await post(root+'/bracket',matchForms(page).find(m=>m.id===second.id).forms.find(f=>f.get('intent')==='confirm-result'));
page=await get(root+'/bracket');assert.equal(matchForms(page).filter(m=>m.forms.length).length,2,'final and bronze must both resolve');
assert.match(await get(`/tournament/${tid}`),/Offline Live Team/);
writeFileSync('.generated/phase-a-browser-url.txt',base+root+'/bracket');
console.log('Phase A HTTP PASS: official 4-team bracket, persisted live score, stale rejection, public tournament/listing/match reads without build, detail-empty live/completed rendering, confirmed locking, final winner slots and bronze loser slots. Offline staging only.');
