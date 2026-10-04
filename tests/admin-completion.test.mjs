import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createTournamentWithSetup} from '../src/admin/tournaments.mjs';
import {readBracketState,officialDraw,confirmOfficialBracket} from '../src/admin/bracket.mjs';
import {readLiveResults} from '../src/admin/live-results.mjs';
import {saveEditedResult} from '../src/admin/result-editor.mjs';
import {readMatchDetails,saveMatchDetails} from '../src/admin/match-details.mjs';
import {readCompletion,completeTournament} from '../src/admin/completion.mjs';
import {readParticipantState,saveParticipants} from '../src/admin/participants.mjs';
import {readSetup,saveSetup,setupForm} from '../src/admin/setup.mjs';
import {readMapContext,confirmMaps} from '../src/admin/map-assignments.mjs';

async function fixture(bronze=true){
 const sql=new DatabaseSync(':memory:');for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
 const db={hook:null,prepare(query){let values=[];const args=()=>/\?\d/.test(query)?[Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]))]:values;return {query,bind(...v){values=v;return this;},async all(){return {success:true,results:sql.prepare(query).all(...args())};},async first(){return sql.prepare(query).get(...args())??null;}};},async batch(statements){if(/^UPDATE/.test(statements[0].query)&&this.hook){const hook=this.hook;this.hook=null;hook();}sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.all());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const id=await createTournamentWithSetup(db,{name:'Future Completion Cup',start_date:'2099-12-01',end_date:'2099-12-02',is_test:'1',bracket_size:'4',map_count:'3',action_seconds:'20',reserve_seconds:'90',bronze_match:bronze?'1':''});
 for(const team of ['a','b','c','d']){sql.prepare('INSERT INTO teams(id,name,tag,region) VALUES(?,?,?,?)').run(team,'Team '+team,team,'ID');sql.prepare('INSERT INTO tournament_teams VALUES(?,?)').run(id,team);for(let n=0;n<5;n++){sql.prepare('INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES(?,?,?,?,?)').run(team+n,team+n,team+n,team+n,team);sql.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run(id,team,team+n,team+n,n+1);}}
 for(const map of ['ankara','aztec','island'])sql.prepare('INSERT INTO maps(id,name) VALUES(?,?)').run(map,map);
 const draw=async()=>{const state=await readBracketState(db,id);const preview=await officialDraw(state,{revision:state.revision,draw_count:'1'},'x'.repeat(64),()=>.5);await confirmOfficialBracket(db,id,{revision:state.revision,token:preview.token},'x'.repeat(64));};
 const result=async(match,type='walkover')=>{const live=await readLiveResults(db,id);const m=live.matches.find(m=>m.id===match);if(type==='played')sql.prepare(`INSERT INTO official_map_assignments(id,tournament_id,stage_id,round_id,match_id,source,scope,team1_id,team2_id,maps,actions) VALUES(?,?,?,?,?,'veto','match',?,?,'["ankara","aztec","island"]','[]')`).run(match,id,m.stage_id,m.round_id,match,m.team1_id,m.team2_id);await saveEditedResult(db,id,{intent:'edit-result',match_id:match,result_revision:live.revision,result_type:type,walkover_winner:m.team1_id,score1:'2',score2:'1',confirmed:'yes'});};
 const resolve=async(playedFinal=false)=>{await draw();const live=await readLiveResults(db,id);for(const m of live.matches)await result(m.id,playedFinal&&m.round_id==='final'?'played':'walkover');};
 return {sql,db,id,draw,result,resolve};
}
const completionForm=async(db,id)=>({intent:'complete-tournament',confirmed:'yes',revision:(await readCompletion(db,id)).revision});
async function details(db,id,match){const state=await readMatchDetails(db,id,match);const payload=structuredClone(state.payload);payload.maps.forEach((m,i)=>{if(i){Object.assign(m,{mode:'walkover',winner_side:i===1?'2':'1'});return;}Object.assign(m,{score1:'7',score2:'2',mvp:state.rows[0].player_id});m.players.forEach(p=>Object.assign(p,{kills:'0',deaths:'1',assists:'0'}));});await saveMatchDetails(db,id,match,{intent:'complete-details',revision:state.revision,payload});return payload;}

test('completion requires the generated bracket, required matches, Final and enabled Bronze',async()=>{
 const {sql,db,id,draw,result}=await fixture();try{
  assert.match((await readCompletion(db,id)).issues.join(' '),/bracket first/);await assert.rejects(completeTournament(db,id,await completionForm(db,id)),e=>e.status===409);
  await draw();let state=await readCompletion(db,id);assert.equal(state.ready,false);
  let live=await readLiveResults(db,id);for(const m of live.matches.filter(m=>m.round_id==='semi-final'))await result(m.id);
  live=await readLiveResults(db,id);const final=live.matches.find(m=>m.round_id==='final');await result(final.id);
  state=await readCompletion(db,id);assert.equal(state.ready,false);assert.equal(state.placements.champion,final.team1_id);assert.equal(state.placements.runnerUp,final.team2_id);assert.equal(state.placements.third,null);
  await result(live.matches.find(m=>m.round_id==='bronze').id);assert.equal((await readCompletion(db,id)).ready,true);
  sql.prepare('DELETE FROM match_sources WHERE match_id=? AND side=1').run(final.id);assert.match((await readCompletion(db,id)).issues.join(' '),/Progression conflict/);
 }finally{sql.close();}
});
for(const bronze of [false,true])test(`future dates permit explicit completion; full W/O needs no details; Bronze ${bronze?'enabled':'disabled'}`,async()=>{
 const {sql,db,id,resolve}=await fixture(bronze);try{
  await resolve();const state=await readCompletion(db,id);assert.equal(state.ready,true);assert.equal(!!state.placements.third,bronze);
  assert.equal(sql.prepare('SELECT status FROM tournaments WHERE id=?').get(id).status,'upcoming');
  await assert.rejects(completeTournament(db,id,{...await completionForm(db,id),confirmed:'no'}),/Confirm/);
  await completeTournament(db,id,await completionForm(db,id));assert.deepEqual({...sql.prepare('SELECT status,winner_team_id FROM tournaments WHERE id=?').get(id)},{status:'completed',winner_team_id:state.placements.champion});
  const setup=await readSetup(db,id);assert.equal(setup.locked,true);await assert.rejects(saveSetup(db,id,setupForm(setup)),/read-only/);
  const participants=await readParticipantState(db,id);assert.equal(participants.locked,true);await assert.rejects(saveParticipants(db,id,{revision:participants.revision,participants:[]}),/read-only/);
  const live=await readLiveResults(db,id);await assert.rejects(saveEditedResult(db,id,{intent:'edit-result',match_id:live.matches[0].id,result_revision:live.revision,result_type:'walkover',walkover_winner:live.matches[0].team2_id,confirmed:'yes',reason:'Winner correction'}),/completed and read-only/);
  const context=await readMapContext(db,id,{matchId:live.matches[0].id});assert.equal(context.locked,true);
  await assert.rejects(confirmMaps(db,id,{matchId:live.matches[0].id},{revision:context.revision}),/locked|read-only/);
  await assert.rejects(completeTournament(db,id,await completionForm(db,id)),/completed/);
 }finally{sql.close();}
});
test('Played final requires complete reconciled details; partial W/O remains valid; completed detail corrections retain reason/audit',async()=>{
 const {sql,db,id,resolve}=await fixture();try{
  await resolve(true);const final=(await readLiveResults(db,id)).matches.find(m=>m.round_id==='final');assert.match((await readCompletion(db,id)).issues.join(' '),/Details remain pending/);
  const payload=await details(db,id,final.id);assert.equal((await readCompletion(db,id)).ready,true);
  const before=await readMatchDetails(db,id,final.id,{correction:true});await completeTournament(db,id,await completionForm(db,id));
  const normal=await readMatchDetails(db,id,final.id);assert.match(normal.reason,/completed/);assert.notEqual(before.revision,normal.revision);
  await assert.rejects(saveMatchDetails(db,id,final.id,{intent:'save-draft',revision:normal.revision,payload}),/completed/);
  const correction=await readMatchDetails(db,id,final.id,{correction:true});assert.equal(correction.reason,'');assert.equal(correction.correctable,true);
  payload.maps[0].players[0].kills='8';await assert.rejects(saveMatchDetails(db,id,final.id,{intent:'correct-details',revision:correction.revision,payload}),/reason/);
  await saveMatchDetails(db,id,final.id,{intent:'correct-details',revision:correction.revision,payload,reason:'Screenshot verified KDA'});
  assert.equal(sql.prepare('SELECT count(*) n FROM match_correction_audit').get().n,1);assert.equal((await readCompletion(db,id)).ready,true);assert.equal((await readCompletion(db,id)).status,'completed');
 }finally{sql.close();}
});
test('stale completion and concurrent canonical edits cannot mark tournament completed',async()=>{
 for(const change of ["UPDATE matches SET status='live' WHERE round_id='final'","UPDATE tournament_rosters SET ign_snapshot='Changed'","DELETE FROM match_map_walkovers WHERE map_number=3","UPDATE match_detail_edits SET payload=json_set(payload,'$.correction_required',json('true'))"]){
  const {sql,db,id,resolve}=await fixture();try{await resolve(true);const final=(await readLiveResults(db,id)).matches.find(m=>m.round_id==='final');await details(db,id,final.id);const form=await completionForm(db,id);db.hook=()=>sql.exec(change);await assert.rejects(completeTournament(db,id,form),e=>e.status===409);assert.equal(sql.prepare('SELECT status FROM tournaments WHERE id=?').get(id).status,'upcoming');assert.equal(sql.prepare('SELECT winner_team_id FROM tournaments WHERE id=?').get(id).winner_team_id,null);}finally{sql.close();}
 }
});
test('completion never rewrites historical S1/S2 status or data',async()=>{
 const {sql,db}=await fixture();try{for(const id of ['clash-for-glory-s1','clash-for-glory-s2']){sql.prepare("INSERT INTO tournaments(id,name,start_date,end_date,status,format,winner_team_id) VALUES(?,?, '2026-01-01','2026-01-02','completed','single-elimination','a')").run(id,id);const before=sql.prepare('SELECT * FROM tournaments WHERE id=?').get(id);await assert.rejects(completeTournament(db,id,await completionForm(db,id)),/completed and read-only/);assert.deepEqual(sql.prepare('SELECT * FROM tournaments WHERE id=?').get(id),before);}}finally{sql.close();}
});
