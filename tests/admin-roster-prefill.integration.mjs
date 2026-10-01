import assert from 'node:assert/strict';
const base=process.env.ADMIN_TEST_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base) || process.env.ADMIN_TEST_LOCAL!=='1') throw new Error('Use an isolated seeded local admin server.');
const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200);return r.text();};
const post=async(path,body,status)=>{const r=await fetch(base+path,{method:'POST',redirect:'manual',headers:{origin:base,'content-type':'application/x-www-form-urlencoded'},body});assert.equal(r.status,status,await r.clone().text());return r;};
const decode=value=>value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'");
function fields(html) {
  const data=new URLSearchParams();
  for(const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const name=tag.match(/name="([^"]*)"/)?.[1];if(!name)continue;
    if(/type="checkbox"/.test(tag)&&! /\bchecked(?:\s|>|=)/.test(tag))continue;
    data.set(name,decode(tag.match(/value="([^"]*)"/)?.[1]??''));
  }
  for(const [,attrs,body] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const name=attrs.match(/name="([^"]*)"/)?.[1];if(!name)continue;
    const options=[...body.matchAll(/<option\b([^>]*)>/g)];const chosen=options.find(([,a])=>/\bselected(?:\s|$|=)/.test(a))??options[0];
    if(chosen)data.set(name,decode(chosen[1].match(/value="([^"]*)"/)?.[1]??''));
  }
  return data;
}
const created=await post('/admin/tournaments/new',new URLSearchParams({name:`Prefill verification ${crypto.randomUUID()}`,start_date:'2026-12-01',end_date:'2026-12-02'}),303);
const root=created.headers.get('location').replace(/\/setup$/,'');
let data=fields(await get(root+'/setup'));data.set('bracket_size','4');await post(root+'/setup',data,303);
data=fields(await get(root+'/participants'));data.set('intent','add-selected');
for(const id of ['cha-tra-mue','demigod-kage'])data.set(`selected.${id}`,'1');
await post(root+'/participants',data,303);
const initial=await get(root+'/roster');assert.equal((initial.match(/Copy Current Team Roster/g)??[]).length,2);assert.match(initial,/0 \/ 7 players/);
assert.equal([...fields(initial).keys()].filter(key=>/^entries\.\d+\.id$/.test(key)).length,0);
data=fields(initial);data.set('copy_team','cha-tra-mue');
let response=await post(root+'/roster',data,200);let draft=await response.text();assert.match(draft,/5 \/ 7 players · Unsaved/);assert.match(draft,/not a historical roster/);
assert.equal([...fields(await get(root+'/roster')).keys()].filter(key=>/^entries\.\d+\.id$/.test(key)).length,0);
data=fields(draft);data.set('entries.0.ign','Reviewed CTM S3');data.set('copy_team','demigod-kage');
response=await post(root+'/roster',data,200);draft=await response.text();assert.match(draft,/7 \/ 7 players · Unsaved/);assert.match(draft,/Reviewed CTM S3/);assert.match(draft,/0 \/ 2 teams ready/);
data=fields(draft);data.set('intent','save');await post(root+'/roster',data,303);
const saved=await get(root+'/roster');assert.match(saved,/2 \/ 2 teams ready/);assert.match(saved,/Reviewed CTM S3/);assert.doesNotMatch(saved,/Copy Current Team Roster/);
data=fields(saved);data.set('copy_team','cha-tra-mue');await post(root+'/roster',data,409);assert.match(await get(root+'/roster'),/Reviewed CTM S3/);
await (await import('node:fs/promises')).writeFile('.generated/prefill/browser-url.txt',base+root+'/roster');
console.log('Current-roster HTTP: ChaTraMue 5, DEMIGOD KAGE 7, draft/no-write, editable IGN, Save/readiness, reload and saved-copy rejection passed.');
