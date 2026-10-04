import assert from 'node:assert/strict';
import {html,post,fields,create,createMaster,participantsForm} from './admin-http-fixture.mjs';
const suffix=crypto.randomUUID();
for(const [key,input,field,value]of [
 ['teams',{name:`CRUD HTTP Team ${suffix}`,tag:'CRUD',region:'ID',description:'Line one\nLine two',color:'#FF5A1F'},'tag','EDIT'],
 ['players',{uid:`crud-${suffix}`,current_ign:'Current HTTP IGN'},'current_ign','Edited HTTP IGN'],
 ['maps',{name:`CRUD HTTP Map ${suffix}`,active:'1'},'active','0']]){
 const id=await createMaster(key,input);const path=`/admin/${key}?selected=${encodeURIComponent(id)}`;let form=fields(await html(path));form.delete('q');if(key==='teams')form.set('description','Line one\nLine two');form.set(field,value);await post(path,form);await post(path,form,409);form=fields(await html(path));form.delete('q');assert.equal(form.get(field),value);
 if(key==='players'){form.set('uid','changed');await post(path,form,400);}
}
const root=await create(`Delete HTTP Test ${suffix}`);const id=root.split('/').at(-1);const path=`/admin/tournaments?selected=${id}`;
let form=fields(await html(path));form.delete('q');form.set('intent','metadata');form.delete('confirm_name');form.delete('confirmed');form.set('name',`Edited HTTP Test ${suffix}`);await post(path,form);assert.match(await html(root),/Edited HTTP Test/);
await post(path,{intent:'delete-test',confirmed:'yes',confirm_name:'wrong'},400);await post(path,{intent:'delete-test',confirmed:'yes',confirm_name:`Edited HTTP Test ${suffix}`});
assert.match(await html('/admin/teams'),/CRUD HTTP Team/);assert.match(await html('/admin/players'),/Edited HTTP IGN/);assert.match(await html('/admin/maps'),/CRUD HTTP Map/);
const full=await create(`Full Roster HTTP Test ${suffix}`);await post(full+'/participants',participantsForm(await html(full+'/participants'),['demigod-kage']));let roster=fields(await html(full+'/roster'));roster.set('intent','save');await post(full+'/roster',roster);roster=fields(await html(full+'/roster'));roster.set('intent','create-player');roster.set('team_id','demigod-kage');roster.set('new_uid',`full-${suffix}`);roster.set('new_ign','Unassigned Full Roster Player');await post(full+'/roster',roster,400);assert.equal([...fields(await html(full+'/roster')).keys()].filter(key=>/^entries\.\d+\.id$/.test(key)).length,7);assert.doesNotMatch(await html('/admin/players?q='+encodeURIComponent(`full-${suffix}`)),/Unassigned Full Roster Player/);
console.log('Master/lifecycle HTTP PASS: create + edit all entities, stale rejection, multiline description, immutable UID, tournament metadata and explicit-name test cleanup preserves masters.');
