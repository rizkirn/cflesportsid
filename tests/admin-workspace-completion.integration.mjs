import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {base,html,post,fields,create,participantsForm,draw,assignVeto} from './admin-http-fixture.mjs';

const name=`Workspace Completion UAT ${crypto.randomUUID().slice(0,8)}`;
const root=await create(name,4,'2099-12-01');
const other=await create(`Scoped Empty UAT ${crypto.randomUUID().slice(0,8)}`,4,'2026-11-01');
const sidebar=page=>page.match(/<nav aria-label="Admin"[\s\S]*?<\/nav>/)[0];
let page=await html(root);assert.doesNotMatch(sidebar(page),/>Bracket|>Matches/);const tabs=page.match(/<nav class="tournament-tabs"[\s\S]*?<\/nav>/)[0];assert.match(tabs,new RegExp(`href="${root}/bracket"`));assert.match(tabs,new RegExp(`href="${root}/matches"`));assert.doesNotMatch(page,/Open Bracket|Open Matches/);
for(const path of ['/admin/brackets','/admin/matches']){const r=await fetch(base+path,{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/admin/tournaments');}
const old=await fetch(base+'/admin/matches?tournament='+root.split('/').at(-1),{redirect:'manual'});assert.equal(old.headers.get('location'),root+'/matches');
const premature={intent:'complete-tournament',confirmed:'yes',revision:'invalid'};await post(root+'?action=complete',premature,409);
await post(root+'/participants',participantsForm(await html(root+'/participants'),['familia-nova','paman','k2-evolve','prmx-community']));let form=fields(await html(root+'/roster'));form.set('intent','save');await post(root+'/roster',form);
const matches=await draw(root,1);assert.equal(matches.length,4);
assert.doesNotMatch(await html(other+'/matches?tournament='+root.split('/').at(-1)),new RegExp(matches[0]));assert.doesNotMatch(await html(other+'/bracket?match='+matches[0]),new RegExp(matches[0]));assert.equal((await fetch(base+other+'/matches/'+matches[0])).status,404);
async function result(match,type){const path=root+'/bracket?match='+match;const f=fields(await html(path));f.set('intent','edit-result');f.set('confirmed','yes');f.set('result_type',type);f.set('score1','2');f.set('score2','1');if(type==='walkover'){const p=await html(path);const option=p.match(/<select name="walkover_winner"[^>]*>[\s\S]*?<option value="([^" ]+)"[^>]*>/)[1];f.set('walkover_winner',option);}await post(path,f);}
for(const match of matches.slice(0,2))await result(match,'walkover');
page=await html(root+'/bracket');const bronzeId=page.match(/<section class="operations-bronze"[\s\S]*?href="[^\"]*match=([^"&]+)/)[1];const finalId=matches.find(id=>!matches.slice(0,2).includes(id)&&id!==bronzeId);
await assignVeto(root,finalId);await result(finalId,'played');
page=await html(root);assert.match(page,/Completion pending/);assert.doesNotMatch(page,/data-open-completion/);await post(root+'?action=complete',premature,409);
const detailPath=root+'/matches/'+finalId;page=await html(detailPath);const validation=JSON.parse(page.match(/data-validation-state[^>]*>([\s\S]*?)<\/script>/)[1]);form=fields(page);form.set('intent','complete-details');form.set('maps.0.score1','7');form.set('maps.0.score2','2');let mvp;for(const side of [1,2]){const rows=validation.rows.map((row,index)=>({row,index})).filter(({row})=>row.team_id===validation.match[`team${side}_id`]).slice(0,5);if(side===1)mvp=rows[0];for(const {index}of rows)for(const key of ['kills','deaths','assists'])form.set(`maps.0.players.${index}.${key}`,'0');}form.set('maps.0.mvp',mvp.row.player_id);for(const [i,winner]of [[1,'2'],[2,'1']]){form.set(`maps.${i}.mode`,'walkover');form.set(`maps.${i}.winner_side`,winner);}await post(detailPath,form);
assert.doesNotMatch(await html(root),/data-open-completion/);await result(bronzeId,'walkover');
page=await html(root+'/bracket');const bronze=page.match(/<section class="operations-bronze"[\s\S]*?<\/section>/)[0];assert.equal([...bronze.matchAll(/<img /g)].length,2);assert.equal([...bronze.matchAll(/--team-color:#[a-fA-F0-9]{6}/g)].length,2);assert.match(bronze,/class="operations-team winner"/);assert.match(bronze,/>W\/O<\/b>/);
page=await html(root);assert.match(page,/All matches completed/);assert.match(page,/Champion/);assert.match(page,/Runner-up/);assert.match(page,/Third Place/);assert.match(page,/data-open-completion/);
assert.match(await html('/admin'),/Ready to complete tournament/);
const completionForm=fields(page.slice(page.indexOf('<dialog class="admin-dialog"')));await post(root+'?action=complete',{...Object.fromEntries(completionForm),revision:'stale'},409);
const retainedDetails=await html(detailPath);const retainedBracket=await html(root+'/bracket');writeFileSync('/private/tmp/cfl-workspace-completion-fixture.json',JSON.stringify({name,root,other,bronzeId,finalId,completionForm:Object.fromEntries(completionForm)}));
if(process.env.ADMIN_TEST_LEAVE_READY==='1'){console.log(`Workspace/Bronze/readiness HTTP PASS; ready future TEST retained for browser confirmation: ${root}`);process.exit(0);}
await post(root+'?action=complete',completionForm);
page=await html(root);assert.match(page,/Tournament completed/);assert.doesNotMatch(page,/data-open-completion|Review bracket and matches/);assert.match(page,/Champion/);
const active=(await html('/admin')).match(/<section class="operations-section" aria-labelledby="active-title"[\s\S]*?<\/section>/)[0];assert.doesNotMatch(active,new RegExp(root));
for(const route of ['/participants','/roster']){const f=fields(await html(root+route));f.set('intent','save');await post(root+route,f,409);}
form=fields(await html(detailPath));form.set('intent','save-draft');await post(detailPath,form,409);
assert.doesNotMatch(await html(detailPath),/>Edit Result<\/a>/);assert.match(await html(detailPath),/>Edit Details<\/a>/);
form=fields(await html(detailPath+'?edit=details'));form.set('intent','correct-details');form.set(`maps.0.players.${mvp.index}.kills`,'8');form.set('reason','');await post(detailPath+'?edit=details',form,400);form.set('reason','Completed tournament screenshot correction');await post(detailPath+'?edit=details',form);assert.match(await html(detailPath),/Completed tournament screenshot correction/);
assert.match(await html(root+'/bracket'),/operations-team winner/);assert.match(retainedBracket,/W\/O/);assert.match(retainedDetails,/Gold ACE/);
console.log(`Workspace/completion HTTP PASS: isolated scope, six tabs, legacy redirects, Bronze logos/colors/winner/W\/O, future TEST, pending guards, explicit completion, locks and reason-required completed detail correction. ${root}`);
