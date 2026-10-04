import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {remainingVetoMaps} from '../src/utils/veto-engine.mjs';
const base=process.env.ADMIN_TEST_URL;
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base??'')||process.env.ADMIN_TEST_STAGING!=='1')throw new Error('Use the verified staging-only admin launcher and ADMIN_TEST_STAGING=1.');
const statePath='.generated/official-maps-validation.json';
const decode=value=>value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'");
function fields(html){const form=new URLSearchParams();for(const [tag]of html.matchAll(/<input\b[^>]*>/g)){const name=tag.match(/name="([^"]*)"/)?.[1];if(!name||/type="radio"/.test(tag))continue;form.set(name,decode(tag.match(/value="([^"]*)"/)?.[1]??''));}for(const [,attrs,body]of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)){const name=attrs.match(/name="([^"]*)"/)?.[1];if(!name)continue;const options=[...body.matchAll(/<option\b([^>]*)>/g)];const chosen=options.find(([,attrs])=>/\bselected(?:\s|$|=)/.test(attrs))??options[0];if(chosen)form.set(name,decode(chosen[1].match(/value="([^"]*)"/)?.[1]??''));}return form;}
async function html(path){const response=await fetch(base+path);const text=await response.text();assert.equal(response.status,200,text.match(/role="alert"[^>]*>(.*?)<\/p>/s)?.[1]??path);return text;}
async function post(path,form,status=303,json=false){const response=await fetch(base+path,{method:'POST',redirect:'manual',headers:{origin:base,'content-type':'application/x-www-form-urlencoded',...(json?{accept:'application/json'}:{})},body:form});if(response.status!==status){const body=await response.text();throw Error(`${path}: ${response.status} ${body.match(/role="alert"[^>]*>(.*?)<\/p>/s)?.[1]??body.slice(0,300)}`);}return response;}
const data=(page,key)=>JSON.parse(page.match(new RegExp(`${key}[^>]*>([\\s\\S]*?)<\\/script>`))[1]);
let state;
if(process.argv.includes('--prepare')){
 const name=`Official Maps TEST ${new Date().toISOString().replace(/[:.]/g,'-')}`;
 const created=await post('/admin/tournaments/new',new URLSearchParams({name,start_date:'2026-10-02',end_date:'2026-10-03',is_test:'1',bracket_size:'8',map_count:'3',action_seconds:'20',reserve_seconds:'90',bronze_match:'1'}));
 const root=created.headers.get('location');assert.match(root,/^\/admin\/tournaments\//);state={name,root};writeFileSync(statePath,JSON.stringify(state));
 const teams=['familia-nova','cha-tra-mue','demigod-kage','fearless','g2c-prmx','garuda-force','howl-tvj','k2-evolve'];
 let form=fields(await html(root+'/participants'));form.set('intent','save');teams.forEach((id,i)=>{for(const key of ['id','name','tag','region'])form.set(`participants.${i}.${key}`,key==='id'?id:'');});await post(root+'/participants',form);
 const page=await html(root+'/roster');form=fields(page);const fnov=page.match(/<section[^>]*data-search="familia nova fnov"[^>]*>([\s\S]*?)<\/section>/)?.[1];assert.ok(fnov);assert.equal([...fnov.matchAll(/name="entries\.\d+\.id"/g)].length,5);assert.match(fnov,/1314377026/);assert.doesNotMatch(fnov,/1826951529/);form.set('intent','save');await post(root+'/roster',form);
 console.log(JSON.stringify({...state,phase:'prepared',fnovSnapshotPlayers:5}));
}else{
 state=JSON.parse(readFileSync(statePath));const {root}=state;
 if(process.argv.includes('--draw')){
 const mapsPage=await html(root+'/maps?round=quarter-final');assert.match(mapsPage,/Official:/);
 let form=fields(await html(root+'/bracket'));const revision=form.get('revision');form.set('intent','draw');form.set('draw_count','1');const preview=await(await post(root+'/bracket',form,200)).text();form=new URLSearchParams({intent:'confirm',revision,token:preview.match(/name="token" value="([^"]+)"/)[1]});await post(root+'/bracket',form);
 const page=await html(root+'/bracket');state.matches=[...new Set([...page.matchAll(/href="[^"]*\/bracket\?match=([^"]+)"/g)].map(([,id])=>decodeURIComponent(decode(id))))];assert.equal(state.matches.length,8);
 state.early=state.matches.slice(0,4);state.semi=state.matches[4];state.detailMatch=state.early[0];
 for(let i=0;i<4;i++){const path=root+'/bracket?match='+state.early[i];form=fields(await html(path));form.set('intent','edit-result');form.set('result_type',i===1?'walkover':'played');form.set('score1','2');form.set('score2','1');form.set('confirmed','yes');if(i===1){const page=await html(path);const option=page.match(/name="walkover_winner"[^>]*>[\s\S]*?<option value="[^"]*"[^>]*>[^<]*<\/option>\s*<option value="([^"]+)"/);form.set('walkover_winner',option[1]);}await post(path,form);}
 state.lateTool=root+'/maps?match='+state.semi;writeFileSync(statePath,JSON.stringify(state));console.log(JSON.stringify({...state,phase:'drawn-and-early-results'}));
 }else if(process.argv.includes('--details')){
 assert.match(await html(root+'/maps?match='+state.semi),/Official:/);
 for(const match of [state.detailMatch,state.semi]){
 if(match===state.semi){const result=root+'/bracket?match='+match;const page=await html(result);if(!page.includes('data-confirmed="true"')){let form=fields(page);form.set('intent','edit-result');form.set('result_type','played');form.set('score1','2');form.set('score2','1');form.set('confirmed','yes');await post(result,form);}}
 const path=root+'/matches/'+match;let page=await html(path);if(!page.includes('data-validation-state'))continue;let form=fields(page);const validation=data(page,'data-validation-state');assert.equal(validation.assignments.length,3);assert.doesNotMatch(page,/Select map/);
 form.set('intent','save-draft');form.set('maps.0.score1','7');form.set('maps.0.score2','2');form.set('maps.0.mvp',validation.rows[0].player_id);const counts=new Map();validation.rows.forEach((row,j)=>{const count=(counts.get(row.team_id)??0)+1;counts.set(row.team_id,count);for(const key of ['kills','deaths','assists'])form.set(`maps.0.players.${j}.${key}`,count<=5?'0':'');});form.set('maps.1.mode','walkover');form.set('maps.1.winner_side','2');form.set('maps.2.mode','walkover');form.set('maps.2.winner_side','1');await post(path,form,200,true);
 page=await html(path);form.set('revision',fields(page).get('revision'));form.set('intent','complete-details');await post(path,form);page=await html(path);assert.doesNotMatch(page,/<input/);assert.match(page,/W\/O/);
 const publicPage=await html('/matches/'+match);assert.match(publicPage,/W\/O/);state.assignedWONames=validation.assignments.slice(1);
 page=await html(path+'?edit=details');form=fields(page);form.set('intent','correct-details');form.set('reason','Official-map validation: correct KDA');form.set('maps.0.players.0.kills','3');await post(path+'?edit=details',form);assert.match(await html(path),/Official-map validation: correct KDA/);
 }
 const result=root+'/bracket?match='+state.detailMatch;let form=fields(await html(result));form.set('intent','edit-result');form.set('result_type','played');form.set('score1','3');form.set('score2','0');form.set('reason','Official-map validation: correct same winner');form.set('confirmed','yes');await post(result,form);
 const path=root+'/matches/'+state.detailMatch;form=fields(await html(path));form.set('intent','complete-details');form.set('maps.1.winner_side','1');form.set('reason','Official-map validation: reconcile fixed three slots');await post(path,form);
 assert.match(await html(root+'/bracket?match='+state.detailMatch),/Result History \(1\)/);state.phase='details-and-corrections-passed';writeFileSync(statePath,JSON.stringify(state));console.log(JSON.stringify(state));
 }else if(process.argv.includes('--progression')){
 const target=root+'/bracket?match='+state.early[2];const before=await html(root+'/bracket');let form=fields(await html(target));form.set('intent','edit-result');form.set('result_type','played');form.set('score1','1');form.set('score2','2');form.set('reason','Official-map validation: correct winner and progression');form.set('confirmed','yes');await post(target,form);assert.notEqual(await html(root+'/bracket'),before);
 const blocked=root+'/bracket?match='+state.detailMatch;form=fields(await html(blocked));form.set('intent','edit-result');form.set('result_type','played');form.set('score1','0');form.set('score2','3');form.set('reason','Official-map validation: downstream conflict');form.set('confirmed','yes');await post(blocked,form,409);
 assert.match(await html(root+'/matches/'+state.matches[5]),/Maps not assigned yet/);state.phase='progression-and-conflict-passed';writeFileSync(statePath,JSON.stringify(state));console.log(JSON.stringify(state));
 }else if(process.argv.includes('--delete')){
 await post('/admin/tournaments?selected='+root.split('/').at(-1),new URLSearchParams({intent:'delete-test',confirmed:'yes',confirm_name:state.name}));state.phase='deleted';writeFileSync(statePath,JSON.stringify(state));console.log(JSON.stringify(state));
 }else throw Error('Select --prepare, --draw, --details or --delete.');
}
