import assert from 'node:assert/strict';
import {html,post,fields,create,participantsForm,draw,assignVeto} from './admin-http-fixture.mjs';
const suffix=crypto.randomUUID();
const root=await create(`Functional UAT ${suffix}`,16);
const participantPath=root+'/participants';
let page=await html(participantPath),form=fields(page);
form.set('intent','create-team');form.set('new_name',`Context Team ${suffix}`);form.set('new_tag','CTX');form.set('new_region','ID');
const team=await(await post(participantPath,form,200,{headers:{accept:'application/json'}})).json();
assert.ok(team.id);assert.match(await html(root),/0\/16/);
const ids=['familia-nova','paman','cha-tra-mue','demigod-kage','fearless','g2c-prmx','garuda-force','howl-tvj','prmx-community',team.id];
let saved=await post(participantPath,participantsForm(await html(participantPath),ids));assert.equal(saved.headers.get('location'),root+'/roster');
// Participants remain editable until the confirmed draw.
await post(participantPath,participantsForm(await html(participantPath),ids.slice(0,-1)));
await post(participantPath,participantsForm(await html(participantPath),ids));
page=await html(root+'/roster');form=fields(page);
const counts=id=>[...form.keys()].filter(key=>/^entries\.\d+\.team_id$/.test(key)&&form.get(key)===id).length;
assert.equal(counts('familia-nova'),6);assert.equal(counts('paman'),6);assert.match(page,/roster-team/);
form.set('intent','create-player');form.set('team_id',team.id);form.set('active_team',team.id);form.set('new_uid',`uat-${suffix}`);form.set('new_ign','Context Player');form.set('new_name','');
page=await(await post(root+'/roster',form,200)).text();assert.match(page,/Context Player/);assert.match(page,new RegExp(`open[^>]*data-team-id="${team.id}"`));assert.match(await html(root),/0\/10/);
form=fields(page);assert.ok([...form.entries()].some(([key,value])=>/^entries\.\d+\.ign$/.test(key)&&value==='Context Player'));form.set('intent','save');
saved=await post(root+'/roster',form);assert.equal(saved.headers.get('location'),root+'/maps');
for(const [index,round] of ['top-16','quarter-final'].entries()){
 const path=root+'/maps?round='+round;page=await html(path);assert.doesNotMatch(page,/<iframe|data-official-preview|<header[^>]*class="site-header/);assert.match(page,/data-official="true"/);assert.match(page,index===0?/Confirm &amp; Next/:/Confirm Maps/);
 const data=JSON.parse(page.match(/data-maps="([^"]+)"/)[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));const maps=data.slice(0,3).map(map=>map.id);
 const confirmation=fields(page);confirmation.set('maps',JSON.stringify(maps));confirmation.set('actions','[]');
 const response=await post(path,confirmation);assert.equal(response.headers.get('location'),index===0?root+'/maps?round=quarter-final':root+'/maps?tm=complete');
}
page=await html(root+'/maps?tm=complete');assert.match(page,/All Technical Meeting maps confirmed/);assert.match(page,/Continue to Bracket/);assert.doesNotMatch(page,/\[object Promise\]/);
// Remove the deliberately incomplete new team before draw; preserve its master record.
await post(participantPath,participantsForm(await html(participantPath),ids.slice(0,-1)));
const matches=await draw(root,1);
for(const id of matches){const path=root+'/bracket?match='+id;page=await html(path);if(!/data-result-editor/.test(page)||/Waiting for feeder results/.test(page))continue;
 form=fields(page);if(!form.has('score1'))continue;
 if(/data-maps-assigned="false"/.test(page)){
  form.set('score1','3');form.set('score2','0');await post(path,form,409);break;
 }
 form.set('score1','3');form.set('score2','0');await post(path,form);
 assert.match(await html(path),/Enter Match Details/);assert.doesNotMatch(await html(path),/data-result-editor/);break;
}
console.log(`Functional UAT HTTP PASS: contextual master creation is separate from participant/roster saving, accordion retained, FNOV/Paman six, redirect chain, native TM before draw, sequential confirmation and direct details. ${root}`);
