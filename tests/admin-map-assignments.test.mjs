import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createTournamentWithSetup,deleteTestTournament} from '../src/admin/tournaments.mjs';
import {readMapContext,confirmMaps} from '../src/admin/map-assignments.mjs';
import {readBracketState,officialDraw,confirmOfficialBracket} from '../src/admin/bracket.mjs';
import {readLiveResults,saveLiveResult} from '../src/admin/live-results.mjs';
import {readMatchDetails,saveMatchDetails} from '../src/admin/match-details.mjs';
import {readD1Matches} from '../src/data-access/matches.mjs';
import {remainingVetoMaps} from '../src/utils/veto-engine.mjs';
import {saveResultCorrection} from '../src/admin/corrections.mjs';

function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync(`migrations/${file}`,'utf8'));
 const db={hook:null,prepare(query){let args=[];return {query,bind(...values){args=values;return this;},async first(){return (await this.all()).results[0]??null;},async all(){const values=/\?\d/.test(query)?[Object.fromEntries(args.map((v,i)=>['?'+(i+1),v]))]:args;return {success:true,results:sql.prepare(query).all(...values)};}};},async batch(statements){if(this.hook&&statements[0].query.startsWith('UPDATE')){const hook=this.hook;this.hook=null;hook();}sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
 for(let i=0;i<11;i++)sql.prepare('INSERT INTO maps(id,name) VALUES(?,?)').run(`map${i}`,`Map ${i}`);
 for(let i=0;i<8;i++){sql.prepare('INSERT INTO teams(id,name,tag,region) VALUES(?,?,?,?)').run(`t${i}`,`Team ${i}`,`T${i}`,'ID');for(let j=0;j<5;j++)sql.prepare('INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES(?,?,?,?,?)').run(`p${i}-${j}`,`uid${i}-${j}`,`Player ${i}-${j}`,`IGN ${i}-${j}`,`t${i}`);}
 return {sql,db};
}
const confirmation=(state,maps,actions=[])=>({revision:state.revision,confirmed:'yes',maps:JSON.stringify(maps),actions:JSON.stringify(actions)});
test('confirmed round views and cancelled redo preserve official data; replacement is explicit and atomic',async()=>{
 const {sql,db}=fixture();try{
 const id=await createTournamentWithSetup(db,{name:'Confirmed Round',start_date:'2026-10-02',end_date:'2026-10-03',is_test:'1',bracket_size:'8',map_count:'3',action_seconds:'20',reserve_seconds:'90'});
 const target={roundId:'quarter-final'};
 await confirmMaps(db,id,target,confirmation(await readMapContext(db,id,target),['map0','map1','map2']));
 const before=sql.prepare('SELECT * FROM official_map_assignments WHERE tournament_id=?').get(id);
 const view=await readMapContext(db,id,target);assert.deepEqual(view.assignment,['map0','map1','map2']);assert.deepEqual(view.assignmentActions,[]);assert.ok(view.confirmedAt);
 await readMapContext(db,id,target);assert.deepEqual(sql.prepare('SELECT * FROM official_map_assignments WHERE tournament_id=?').get(id),before);
 await assert.rejects(confirmMaps(db,id,target,confirmation(view,['map3','map3','map5'])),/distinct/);
 assert.deepEqual(sql.prepare('SELECT * FROM official_map_assignments WHERE tournament_id=?').get(id),before);
 await confirmMaps(db,id,target,confirmation(view,['map3','map4','map5']));
 assert.deepEqual((await readMapContext(db,id,target)).assignment,['map3','map4','map5']);
 await assert.rejects(confirmMaps(db,id,target,confirmation(view,['map0','map1','map2'])),/changed/);
 }finally{sql.close();}
});
async function result(db,id,match,wo=false){const state=await readLiveResults(db,id);await saveLiveResult(db,id,{intent:wo?'confirm-walkover':'edit-initial-result',match_id:match.id,result_revision:state.revision,score1:'2',score2:'1',walkover_winner:match.team1_id});}
async function veto(db,id,matchId){const state=await readMapContext(db,id,{matchId});const actions=[];for(const step of state.steps){actions.push({...step,map:remainingVetoMaps(state.pool.map(map=>map.id),actions)[0],voided:false});}const maps=['A','B'].map(team=>actions.find(action=>action.team===team&&action.action==='pick').map);maps.push(remainingVetoMaps(state.pool.map(map=>map.id),actions)[0]);await confirmMaps(db,id,{matchId},confirmation(state,maps,actions));return {maps,actions,state};}

test('official maps: round before draw, shared matches, veto replay, detail map enforcement/W/O, stale guards, correction and safe deletion',async()=>{
 const {sql,db}=fixture();try{
 const masters=JSON.stringify(['teams','players','maps'].map(table=>sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));
 const id=await createTournamentWithSetup(db,{name:'Official Maps Test',start_date:'2026-10-02',end_date:'2026-10-03',is_test:'1',bracket_size:'8',map_count:'3',action_seconds:'20',reserve_seconds:'90',bronze_match:'1'});
 for(let i=0;i<8;i++){sql.prepare('INSERT INTO tournament_teams VALUES(?,?)').run(id,`t${i}`);for(let j=0;j<5;j++)sql.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run(id,`t${i}`,`p${i}-${j}`,`IGN ${i}-${j}`,j+1);}
 const target={roundId:'quarter-final'};let context=await readMapContext(db,id,target);
 assert.equal(sql.prepare('SELECT count(*) n FROM official_map_assignments').get().n,0);
 await assert.rejects(confirmMaps(db,id,target,confirmation(context,['map0','map0','map1'])),/distinct/);
 await assert.rejects(confirmMaps(db,id,target,{...confirmation(context,['map0','map1','map2']),confirmed:'no'}),/Confirm/);
 await confirmMaps(db,id,target,confirmation(context,['map0','map1','map2']));
 await assert.rejects(confirmMaps(db,id,target,confirmation(context,['map3','map4','map5'])),/changed/);
 const bracket=await readBracketState(db,id);const secret='k'.repeat(64);const draw=await officialDraw(bracket,{revision:bracket.revision,draw_count:'1'},secret,()=>.4);await confirmOfficialBracket(db,id,{revision:bracket.revision,token:draw.token},secret);
 let live=await readLiveResults(db,id);const early=live.matches.filter(match=>match.round_id==='quarter-final');assert.equal(early.length,4);
 for(const match of early){const detail=await readMatchDetails(db,id,match.id);assert.deepEqual(detail.assignments,['map0','map1','map2']);}
 for(const match of early)await result(db,id,match,match===early[1]);
 context=await readMapContext(db,id,target);assert.equal(context.locked,true);await assert.rejects(confirmMaps(db,id,target,confirmation(context,['map3','map4','map5'])),/locked/);
 live=await readLiveResults(db,id);const semi=live.matches.find(match=>match.round_id==='semi-final');
 await assert.rejects(readMapContext(db,id,{roundId:'semi-final'}),/match Veto/);
 const missing=await readMatchDetails(db,id,early[0].id);assert.equal(missing.reason,'');
 const lateBefore=await readMatchDetails(db,id,semi.id);assert.deepEqual(lateBefore.assignments,[]);
 const v=await veto(db,id,semi.id);assert.equal(v.maps.length,3);
 const persisted=sql.prepare('SELECT * FROM official_map_assignments WHERE match_id=?').get(semi.id);
 const view=await readMapContext(db,id,{matchId:semi.id});assert.deepEqual(view.assignmentActions,v.actions);assert.deepEqual(view.assignment,v.maps);
 await readMapContext(db,id,{matchId:semi.id});assert.deepEqual(sql.prepare('SELECT * FROM official_map_assignments WHERE match_id=?').get(semi.id),persisted);
 let ctx=await readMapContext(db,id,{matchId:semi.id});const bad=structuredClone(v.actions);bad[0].map='not-in-pool';await assert.rejects(confirmMaps(db,id,{matchId:semi.id},confirmation(ctx,v.maps,bad)),/available/);
 db.hook=()=>sql.prepare('UPDATE matches SET team1_id=? WHERE id=?').run('t7',semi.id);await assert.rejects(confirmMaps(db,id,{matchId:semi.id},confirmation(ctx,v.maps,v.actions)),/changed/);
 sql.prepare('UPDATE matches SET team1_id=? WHERE id=?').run(semi.team1_id,semi.id);
 await result(db,id,semi);
 assert.equal((await readMapContext(db,id,{matchId:semi.id})).locked,true);
 await assert.rejects(confirmMaps(db,id,{matchId:semi.id},confirmation(await readMapContext(db,id,{matchId:semi.id}),v.maps,v.actions)),/locked/);
 let state=await readMatchDetails(db,id,semi.id);const payload=structuredClone(state.payload);
 payload.maps.forEach((map,index)=>{if(index>0)Object.assign(map,{mode:'walkover',winner_side:index===1?'2':'1'});else{Object.assign(map,{score1:'7',score2:'2',mvp:state.rows[0].player_id});map.players.forEach(player=>Object.assign(player,{kills:'0',deaths:'2',assists:'0'}));}});
 const tampered=structuredClone(payload);tampered.maps[2].map_id='map0';await assert.rejects(saveMatchDetails(db,id,semi.id,{intent:'save-draft',revision:state.revision,payload:tampered}),/official map/);
 await saveMatchDetails(db,id,semi.id,{intent:'save-draft',revision:state.revision,payload});state=await readMatchDetails(db,id,semi.id);assert.deepEqual(state.payload.maps.map(map=>map.map_id),v.maps);
 await saveMatchDetails(db,id,semi.id,{intent:'complete-details',revision:state.revision,payload});
 const publicMatch=(await readD1Matches(db,[])).find(match=>match.id===semi.id);assert.equal(publicMatch.data.roundDetails[2].mapId,v.maps[2]);assert.equal(publicMatch.data.roundDetails[2].mode,'walkover');assert.equal(publicMatch.data.playerStats.length,10);
 state=await readMatchDetails(db,id,semi.id,{correction:true});payload.maps[0].players[0].kills='9';await saveMatchDetails(db,id,semi.id,{intent:'correct-details',revision:state.revision,payload,reason:'Correct KDA'});
 live=await readLiveResults(db,id);await saveResultCorrection(db,id,early[2].id,{intent:'correct-result',confirmed:'yes',result_revision:live.revision,result_type:'played',score1:'1',score2:'2',reason:'Correct early winner'});
 await deleteTestTournament(db,id,{confirmed:'yes',confirm_name:'Official Maps Test'});
 assert.equal(sql.prepare('SELECT count(*) n FROM official_map_assignments').get().n,0);assert.equal(sql.prepare('SELECT count(*) n FROM matches').get().n,0);assert.equal(JSON.stringify(['teams','players','maps'].map(table=>sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all())),masters);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{sql.close();}
});

test('TM preassigns every early round for sizes 4–64, permits repetition across rounds and retains unique slots',async()=>{
 for(const size of [4,8,16,32,64]){
  const {sql,db}=fixture();try{
   const id=await createTournamentWithSetup(db,{name:`TM ${size}`,start_date:'2026-10-02',end_date:'2026-10-03',is_test:'1',bracket_size:String(size),map_count:'3',action_seconds:'20',reserve_seconds:'90',bronze_match:'1'});
   const rounds=sql.prepare("SELECT id FROM tournament_rounds WHERE tournament_id=? AND placement IS NULL AND id!='semi-final' ORDER BY sort_order").all(id);
   assert.equal(rounds.length,Math.log2(size)-2);
   for(const round of rounds){const target={roundId:round.id};const ctx=await readMapContext(db,id,target);assert.equal(ctx.locked,false);await confirmMaps(db,id,target,confirmation(ctx,['map0','map1','map2']));}
   assert.equal(sql.prepare('SELECT count(*) n FROM matches WHERE tournament_id=?').get(id).n,0);
   assert.equal(sql.prepare('SELECT count(*) n FROM official_map_assignments WHERE tournament_id=?').get(id).n,rounds.length);
  }finally{sql.close();}
 }
});

test('unconfirmed maps block Played, full W/O remains valid, correction to Played and concurrent map changes are guarded atomically',async()=>{
 const {sql,db}=fixture();try{
  const id=await createTournamentWithSetup(db,{name:'Map Gate',start_date:'2026-10-02',end_date:'2026-10-03',is_test:'1',bracket_size:'4',map_count:'3',action_seconds:'20',reserve_seconds:'90',bronze_match:'1'});
  for(let i=0;i<4;i++){sql.prepare('INSERT INTO tournament_teams VALUES(?,?)').run(id,`t${i}`);for(let j=0;j<5;j++)sql.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run(id,`t${i}`,`p${i}-${j}`,`IGN ${i}-${j}`,j+1);}
  const bracket=await readBracketState(db,id),secret='k'.repeat(64);const draw=await officialDraw(bracket,{revision:bracket.revision,draw_count:'1'},secret,()=>.4);await confirmOfficialBracket(db,id,{revision:bracket.revision,token:draw.token},secret);
  const semi=(await readLiveResults(db,id)).matches.filter(m=>m.round_id==='semi-final');
  await assert.rejects(result(db,id,semi[0]),/map veto/);assert.equal(sql.prepare('SELECT status FROM matches WHERE id=?').get(semi[0].id).status,'upcoming');
  await result(db,id,semi[0],true);
  await assert.rejects(saveResultCorrection(db,id,semi[0].id,{intent:'correct-result',confirmed:'yes',result_revision:(await readLiveResults(db,id)).revision,result_type:'played',score1:'2',score2:'1',reason:'Played correction'}),/map veto/);
  await veto(db,id,semi[0].id);
  await saveResultCorrection(db,id,semi[0].id,{intent:'correct-result',confirmed:'yes',result_revision:(await readLiveResults(db,id)).revision,result_type:'played',score1:'2',score2:'1',reason:'Played correction'});
  assert.equal(sql.prepare('SELECT result_type FROM matches WHERE id=?').get(semi[0].id).result_type,'played');
  await veto(db,id,semi[1].id);
  db.hook=()=>sql.prepare("UPDATE official_map_assignments SET maps='[\"map8\",\"map9\",\"map10\"]' WHERE match_id=?").run(semi[1].id);
  await assert.rejects(result(db,id,semi[1]),/bracket changed/);
  assert.equal(sql.prepare('SELECT status FROM matches WHERE id=?').get(semi[1].id).status,'upcoming');
  assert.equal(sql.prepare('SELECT count(*) n FROM match_correction_audit').get().n,1);
 }finally{sql.close();}
});
