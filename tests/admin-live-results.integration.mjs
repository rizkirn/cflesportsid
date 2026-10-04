import assert from 'node:assert/strict';
import {html,post,fields,smallFixture} from './admin-http-fixture.mjs';
const {root,matches}=await smallFixture();const tid=root.split('/').at(-1);
const path=root+'/bracket?match='+matches[0];let form=fields(await html(path));form.set('score1','2');form.set('score2','0');await post(path,form,400);form.set('score2','1');const before=await html('/tournament/'+tid);await post(path,form);assert.notEqual(await html('/tournament/'+tid),before);await post(path,form,409);
assert.match(await html('/matches/'+matches[0]),/2 - 1/);assert.match(await html(root+'/matches'),new RegExp(`href="${root}/matches/${matches[0]}"`));
assert.match(await html(root+'/bracket'),new RegExp(`href="${root}/matches/${matches[0]}"`));
assert.doesNotMatch(await html(path),/data-result-editor/);
form=fields(await html(path+'&edit=result'));form.set('score1','3');form.set('score2','0');form.set('reason','');await post(path,form,400);form.set('reason','Correct fixture score');await post(path,form);assert.match(await html(path),/Correct fixture score/);
const woPath=root+'/bracket?match='+matches[1];form=fields(await html(woPath));form.set('result_type','walkover');const winner=form.get('walkover_winner')||form.get('match_id');const options=(await html(woPath)).match(/name="walkover_winner"[\s\S]*?<\/select>/)[0];form.set('walkover_winner',[...options.matchAll(/value="([^"]+)"/g)][0][1]);await post(woPath,form);assert.match(await html(root+'/matches'),/Full-match W\/O/);assert.match(await html(root+'/matches/'+matches[1]),/No Match Details required/);
const confirmedWO=await html(woPath);const woDialog=confirmedWO.match(/<dialog[^>]*data-result-dialog[\s\S]*?<\/dialog>/)[0];
assert.equal([...woDialog.matchAll(/>Close<\/a>/g)].length,1);
assert.doesNotMatch(woDialog,/Enter Match Details|Existing details prevent/);assert.match(woDialog,/Edit Result/);
for(const id of matches.slice(2)){
 const pending=root+'/bracket?match='+id;const page=await html(pending);assert.match(page,/data-result-editor/);assert.match(page,/Complete the map veto before entering the result/);
 const form=fields(page);form.set('score1','3');form.set('score2','0');await post(pending,form,409);
}
console.log('Result HTTP PASS: all-three score validation, atomic initial progression, stale rejection, public D1 reads, reason-required audited correction, full-match W/O without details, final/bronze source resolution.');
