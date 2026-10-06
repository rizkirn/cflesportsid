import {testAdminDatabase} from './helpers/admin-database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readMatchDetails, saveMatchDetails, validateDetails, mapResults, readDetailsForm } from '../src/admin/match-details.mjs';
import { readD1Matches } from '../src/data-access/matches.mjs';
import { loadLegacyStatistics, plain } from '../scripts/d1-parity.mjs';
import { readLiveResults } from '../src/admin/live-results.mjs';
import { saveResultCorrection, readCorrectionHistory } from '../src/admin/corrections.mjs';

function fixture() {
  const sql=new DatabaseSync(':memory:');

  for(const file of ['0001_initial_schema.sql','0002_preserve_player_rounds.sql','0003_tournament_rosters.sql','0004_match_detail_edits.sql','0005_walkovers.sql','0006_match_corrections.sql','0007_test_tournaments.sql','0008_official_map_assignments.sql'])sql.exec(readFileSync('migrations/'+file,'utf8'));
  sql.exec(`INSERT INTO teams(id,name,tag,region) VALUES('a','Alpha','A','ID'),('b','Beta','B','ID');
    INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('cup','Cup','2026-10-01','2026-10-02','ongoing','single-elimination');
    INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count) VALUES('cup','playoffs','Playoffs','single-elimination',4,'fixed-maps',3);
    INSERT INTO tournament_rounds VALUES('cup','playoffs','semi','Semi Final',1,NULL);
    INSERT INTO tournament_teams VALUES('cup','a'),('cup','b');
    INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id,team2_id,score1,score2,winner_id) VALUES('match','cup','playoffs','semi',1,'2026-10-01','completed','a','b',2,1,'a');
    INSERT INTO maps(id,name) VALUES('aztec','Aztec'),('ankara','Ankara'),('power','Power Supply');
    INSERT INTO stage_map_pool VALUES('cup','playoffs','aztec',1),('cup','playoffs','ankara',2),('cup','playoffs','power',3);`);
  for(const team of ['a','b'])for(let n=0;n<7;n++) {
    const id=team+n;
    sql.prepare('INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES(?,?,?,?,?)').run(id,n===6?null:'uid-'+id,id,'Global '+id,team);
    sql.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('cup',team,id,'Tournament '+id,n+1);
  }
  sql.exec(`INSERT INTO official_map_assignments(id,tournament_id,stage_id,round_id,match_id,source,scope,team1_id,team2_id,maps,actions) VALUES('fixture','cup','playoffs','semi','match','veto','match','a','b','["aztec","ankara","power"]','[]')`);
  const rawDb={hook:null,prepare(query){let values=[];return {query,bind(...args){values=args;return this;},async all(){return {success:true,results:sql.prepare(query).all(...(/\?\d/.test(query)?[Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]))]:values))};}};},async batch(statements){
    if(/^UPDATE (matches|tournaments)/.test(statements[0].query)&&this.hook){const hook=this.hook;this.hook=null;hook();}
    sql.exec('BEGIN');try {const result=[];for(const s of statements)result.push(await s.all());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}
  }};
sql.exec(readFileSync('migrations/0010_admin_audit_log.sql','utf8'));
const db=testAdminDatabase(rawDb,sql);

  return {sql,db};
}
function completePayload(state) {
  const payload=structuredClone(state.payload);
  payload.maps.forEach((m,i)=>{
    Object.assign(m,{map_id:['aztec','ankara','power'][i],score1:i===1?'2':'7',score2:i===1?'7':'3',mvp:i===2?'a6':'a0'});
    m.players.forEach(p=>{const n=Number(p.player_id.slice(1));if(n<5&&!(i===2&&p.player_id==='a4')||i===2&&p.player_id==='a6')Object.assign(p,{kills:'0',deaths:'7',assists:'0'});});
  });return payload;
}
const counts=sql=>['match_maps','player_match_entries','player_round_stats'].map(t=>sql.prepare(`SELECT count(*) n FROM ${t}`).get().n);
for(const playedCount of [1,2])test(`${playedCount} played + ${3-playedCount} W/O completes with genuine statistics only`,async()=>{
  const {sql,db}=fixture();try {
    const state=await readMatchDetails(db,'cup','match');const payload=completePayload(state);
    for(let i=playedCount;i<3;i++)Object.assign(payload.maps[i],{mode:'walkover',winner_side:i===1?'2':'1'});
    assert.deepEqual(mapResults(payload,state.pool).map(r=>r.side),[1,2,1]);
    validateDetails(payload,state,true);
    const conflict=structuredClone(payload);conflict.maps[2].winner_side='2';
    assert.throws(()=>validateDetails(conflict,state,true),/differs from confirmed/);
    const missing=structuredClone(payload);missing.maps[2].winner_side='';assert.throws(()=>validateDetails(missing,state,true),/W\/O winner/);
    await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'complete-details',payload});
    assert.equal(sql.prepare('SELECT count(*) n FROM match_maps').get().n,playedCount);
    assert.equal(sql.prepare('SELECT count(*) n FROM match_map_walkovers').get().n,3-playedCount);
    assert.equal(sql.prepare('SELECT count(*) n FROM player_round_stats').get().n,10*playedCount);
    assert.equal(sql.prepare('SELECT count(*) n FROM player_round_stats WHERE map_number>?').get(playedCount).n,0);
    assert.equal(sql.prepare('SELECT count(*) n FROM player_map_stats WHERE map_number>?').get(playedCount).n,0);
    const match=(await readD1Matches(db,[]))[0];assert.equal(match.data.roundDetails.length,3);
    for(const map of match.data.roundDetails.slice(playedCount)){assert.equal(map.mode,'walkover');assert.ok(!('score1'in map));assert.ok(!('mvp'in map));}
    const stats=loadLegacyStatistics().calculateStatistics([match]);
    assert.equal(stats.totals.mapsPlayed,playedCount);assert.equal(stats.totals.deaths,70*playedCount);assert.equal(stats.totals.mvpCount,playedCount);
    assert.equal(stats.teams.get('a').mapsPlayed,playedCount);assert.equal(stats.teams.get('a').wins,1);assert.equal(stats.totals.matchesPlayed,1);
    assert.equal(stats.maps.has('power'),false);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.throws(()=>sql.prepare('INSERT INTO player_round_stats(match_id,entry_index,round_index,map_number,kills,deaths,assists) VALUES(?,?,?,?,?,?,?)').run('match',0,99,3,7,0,0),/W\/O cannot contain combat/);
    assert.throws(()=>sql.prepare('INSERT INTO match_maps(match_id,map_number,map_id) VALUES(?,?,?)').run('match',3,'power'),/Invalid played slot/);
  }finally{sql.close();}
});
test('draft mode transitions discard combat and W/O winner, incomplete mixed drafts remain private',async()=>{
  const {sql,db}=fixture();try {
    let state=await readMatchDetails(db,'cup','match');const payload=completePayload(state);
    Object.assign(payload.maps[2],{mode:'walkover',winner_side:''});
    await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'save-draft',payload});
    state=await readMatchDetails(db,'cup','match');const map=state.payload.maps[2];
    assert.equal(map.score1,'');assert.equal(map.score2,'');assert.equal(map.mvp,'');assert.ok(map.players.every(p=>p.kills===''&&p.deaths===''&&p.assists===''));
    assert.deepEqual(counts(sql),[0,0,0]);
    Object.assign(map,{mode:'played',winner_side:'1'});
    await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'save-draft',payload:state.payload});
    state=await readMatchDetails(db,'cup','match');assert.equal(state.payload.maps[2].winner_side,'');
    await assert.rejects(saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'complete-details',payload:state.payload}),/required/);
    assert.deepEqual(counts(sql),[0,0,0]);
  }finally{sql.close();}
});
test('match cards read persisted detail state without changing the Phase A result revision',async()=>{
  const {sql,db}=fixture();try {
    const initial=await readLiveResults(db,'cup');
    assert.equal(initial.matches[0].detail_status,null);
    const state=await readMatchDetails(db,'cup','match');
    await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'save-draft',payload:state.payload});
    const draft=await readLiveResults(db,'cup');
    assert.equal(draft.matches[0].detail_status,'draft');
    assert.equal(draft.revision,initial.revision);
    assert.equal(draft.matches[0].detail_maps,0);
    const reloaded=await readMatchDetails(db,'cup','match');
    await saveMatchDetails(db,'cup','match',{revision:reloaded.revision,intent:'complete-details',payload:completePayload(reloaded)});
    const complete=(await readLiveResults(db,'cup')).matches[0];
    assert.equal(complete.detail_status,'complete');
    assert.equal(complete.detail_maps,3);assert.equal(complete.detail_entries,11);assert.equal(complete.detail_rounds,30);
    assert.deepEqual([complete.score1,complete.score2,complete.winner_id],[2,1,'a']);
  }finally{sql.close();}
});
test('draft saves partial maps/KDA including blank vs zero, reloads, and never creates public stat rows',async()=>{
  const {sql,db}=fixture();try {
    const state=await readMatchDetails(db,'cup','match');assert.equal(state.reason,'');
    const payload=structuredClone(state.payload);payload.maps[0].map_id='aztec';payload.maps[0].players[0].kills='0';
    const before=plain(loadLegacyStatistics().calculateStatistics(await readD1Matches(db,[])));
    await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'save-draft',payload});
    const reloaded=await readMatchDetails(db,'cup','match');assert.equal(reloaded.status,'draft');assert.deepEqual(reloaded.payload,payload);
    assert.equal(reloaded.payload.maps[0].players[0].kills,'0');assert.equal(reloaded.payload.maps[0].players[0].deaths,'');
    assert.deepEqual(counts(sql),[0,0,0]);assert.deepEqual(plain(loadLegacyStatistics().calculateStatistics(await readD1Matches(db,[]))),before);
    await assert.rejects(saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'save-draft',payload}),e=>e.status===409);
  }finally{sql.close();}
});
test('completion validates 3 maps, round ties, partial KDA, exactly five per side, ACE Gold participation and reconciliation',async()=>{
  const {sql,db}=fixture();try {
    const state=await readMatchDetails(db,'cup','match');const payload=completePayload(state);
    validateDetails(payload,state,true);assert.equal(mapResults(payload,state.pool).length,3);
    const cases=[
      [p=>p.maps.pop(),/All 3 maps/],
      [p=>p.maps[2].map_id='',/confirmed official map/],
      [p=>p.maps[2].score1='',/required/],
      [p=>p.maps[2].score1=p.maps[2].score2,/cannot tie/],
      [p=>p.maps[0].players[0].assists='',/all K\/D\/A/],
      [p=>Object.assign(p.maps[0].players[4],{kills:'',deaths:'',assists:''}),/exactly 5/],
      [p=>Object.assign(p.maps[0].players[5],{kills:'0',deaths:'0',assists:'0'}),/exactly 5/],
      [p=>p.maps[0].mvp='',/exactly one/],
      [p=>p.maps[0].mvp='a5',/participating/],
      [p=>p.maps[0].mvp=['a0','a1'],/select a roster player/],
      [p=>p.maps[0].score1='0',/differs from confirmed/],
      [p=>p.maps[0].players[0].kills='-1',/non-negative/],
      [p=>p.maps[0].players[0].player_id='b0',/saved tournament roster/],
    ];
    for(const [edit,pattern]of cases){const p=structuredClone(payload);edit(p);assert.throws(()=>validateDetails(p,state,true),pattern);}
    await assert.rejects(saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'complete-details',payload:{maps:payload.maps.slice(0,2)}}),/All 3 maps/);
    assert.deepEqual(counts(sql),[0,0,0]);
    sql.exec('UPDATE matches SET score1=3,score2=0');const sweep=await readMatchDetails(db,'cup','match');
    const p=completePayload(sweep);p.maps[1].score1='7';p.maps[1].score2='2';validateDetails(p,sweep,true);
    p.maps[2].map_id='';assert.throws(()=>validateDetails(p,sweep,true),/Map 3/);
  }finally{sql.close();}
});
test('completion atomically persists existing tables with substitutions, identity snapshots, map numbers and compatible public statistics',async()=>{
  const {sql,db}=fixture();try {
    let state=await readMatchDetails(db,'cup','match');const payload=completePayload(state);
    await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'save-draft',payload});
    state=await readMatchDetails(db,'cup','match');await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'complete-details',payload});
    assert.deepEqual(counts(sql),[3,11,30]);assert.equal((await readMatchDetails(db,'cup','match')).status,'complete');
    const maps=sql.prepare('SELECT * FROM match_maps ORDER BY map_number').all();assert.deepEqual(maps.map(m=>m.winner_team_id),['a','b','a']);
    assert.deepEqual(maps.map(m=>m.mvp_player_id),['a0','a0','a6']);
    const substitute=sql.prepare("SELECT r.* FROM player_round_stats r JOIN player_match_entries e USING(match_id,entry_index) WHERE e.player_id='a6'").all();
    assert.equal(substitute.length,1);assert.equal(substitute[0].map_number,3);assert.equal(substitute[0].round_index,0);
    assert.equal(sql.prepare("SELECT current_ign FROM players WHERE id='a0'").get().current_ign,'Global a0');
    const match=(await readD1Matches(db,[]))[0];assert.equal(match.data.roundDetails.length,3);assert.equal(match.data.roundDetails[0].score1,7);
    assert.equal(match.data.roundDetails[0].mvp,'uid-a0');assert.equal(match.data.roundDetails[2].mvp,'a6');
    assert.equal(match.data.playerStats.find(p=>p.playerId==='a0').ign,'Tournament a0');
    const stats=loadLegacyStatistics().calculateStatistics([match]);assert.equal(stats.totals.mapsPlayed,3);assert.equal(stats.totals.deaths,210);assert.equal(stats.totals.mvpCount,3);
    assert.equal(stats.players.get('uid-a0').mvpCount,2);assert.equal(stats.players.get('a6').mapsPlayed,1);assert.equal(stats.players.get('uid-a4').mapsPlayed,2);
    assert.equal(stats.maps.get('power').playerRounds,10);assert.equal(stats.teams.get('a').wins,1);
    assert.deepEqual({...sql.prepare('SELECT score1,score2,winner_id FROM matches').get()},{score1:2,score2:1,winner_id:'a'});
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
    await assert.rejects(saveMatchDetails(db,'cup','match',{revision:(await readMatchDetails(db,'cup','match')).revision,intent:'save-draft',payload}),e=>e.status===409);
  }finally{sql.close();}
});
test('atomic snapshot guard rolls back concurrent result, roster, pool and edit changes',async()=>{
  for(const change of ["UPDATE matches SET score1=3,score2=0", "UPDATE tournament_rosters SET ign_snapshot='Changed' WHERE player_id='a0'", "DELETE FROM stage_map_pool WHERE map_id='aztec'", `INSERT INTO match_detail_edits VALUES('match','draft','{"maps":[]}',1)`]) {
    const {sql,db}=fixture();try {
      const state=await readMatchDetails(db,'cup','match');db.hook=()=>sql.exec(change);
      await assert.rejects(saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'complete-details',payload:completePayload(state)}),e=>e.status===409);
      assert.deepEqual(counts(sql),[0,0,0]);
    }finally{sql.close();}
  }
});
test('unconfirmed, unsupported, missing snapshot roster and historical matches are read-only',async()=>{
  const {sql,db}=fixture();try {
    for(const statement of ["UPDATE matches SET status='live'", "UPDATE matches SET status='completed';UPDATE tournament_stages SET series_type='best-of'", "UPDATE tournament_stages SET series_type='fixed-maps';DELETE FROM tournament_rosters WHERE team_id='a'"]) {
      sql.exec(statement);const state=await readMatchDetails(db,'cup','match');assert.ok(state.reason);
      await assert.rejects(saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'save-draft',payload:state.payload}),e=>e.status===409);
    }
    assert.equal(await readMatchDetails(db,'wrong','match'),null);
  }finally{sql.close();}
});
test('form parsing is bounded, same-origin, rejects duplicate MVP fields, and preserves zero',async()=>{
  const body=new URLSearchParams({revision:'r',intent:'save-draft','maps.0.players.0.player_id':'a0','maps.0.players.0.kills':'0'});
  const request=(b=body,origin='http://localhost')=>new Request('http://localhost/editor',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:b});
  const form=await readDetailsForm(request());assert.equal(form.payload.maps[0].players[0].kills,'0');assert.equal(form.payload.maps[0].players[0].deaths,'');
  body.append('maps.0.mvp','a0');body.append('maps.0.mvp','a1');await assert.rejects(readDetailsForm(request()),/repeated/);
  await assert.rejects(readDetailsForm(request('','http://other')),e=>e.status===403);
  await assert.rejects(readDetailsForm(request('x'.repeat(32769))),e=>e.status===413);
});
test('stage map pools are authoritative; an empty pool uses only active maps in the tournament game',async()=>{
  const {sql,db}=fixture();try {
    sql.exec("INSERT INTO maps(id,name,game,active) VALUES('outside','Outside','crossfire-legends',1),('inactive','Inactive','crossfire-legends',0),('other','Other Game','another-game',1)");
    let state=await readMatchDetails(db,'cup','match');assert.deepEqual(state.pool.map(p=>p.id),['ankara','aztec','power']);
    sql.exec('DELETE FROM stage_map_pool');state=await readMatchDetails(db,'cup','match');assert.equal(state.pool.length,4);assert.ok(state.pool.some(p=>p.id==='outside'));
    assert.ok(!state.pool.some(p=>['inactive','other'].includes(p.id)));
  }finally{sql.close();}
});
test('S1/S2 remain read-only after migration 0004',async()=>{
  const {sql,db}=fixture();try {
    sql.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('clash-for-glory-s1','S1','2026-01-01','2026-01-02','completed','single-elimination');INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count) VALUES('clash-for-glory-s1','playoffs','Playoffs','single-elimination',4,'fixed-maps',3);INSERT INTO tournament_rounds VALUES('clash-for-glory-s1','playoffs','semi','Semi Final',1,NULL);UPDATE matches SET tournament_id='clash-for-glory-s1'");
    const state=await readMatchDetails(db,'clash-for-glory-s1','match');assert.match(state.reason,/Historical S1\/S2/);
    await assert.rejects(saveMatchDetails(db,'clash-for-glory-s1','match',{revision:state.revision,intent:'save-draft',payload:state.payload}),e=>e.status===409);
  }finally{sql.close();}
});

async function finish(db) {
  const state=await readMatchDetails(db,'cup','match');
  await saveMatchDetails(db,'cup','match',{revision:state.revision,intent:'complete-details',payload:completePayload(state)});
}
async function resultForm(db,extra={}) {
  return {intent:'correct-result',confirmed:'yes',reason:'Admin input error',result_type:'played',score1:'3',score2:'0',
    result_revision:(await readLiveResults(db,'cup')).revision,...extra};
}
function downstream(sql) {
  sql.exec(`INSERT INTO tournament_rounds VALUES('cup','playoffs','final','Final',2,1);
    INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id) VALUES('final','cup','playoffs','final',1,'2026-10-02','upcoming','a');
    INSERT INTO match_sources(match_id,side,source_type,source_match_id) VALUES('final',1,'winner','match');`);
}
test('detail correction replaces canonical KDA/MVP once, requires reason, rejects partial values and keeps edits private',async()=>{
  const {sql,db}=fixture();try {
    await finish(db);
    const before=await readD1Matches(db,[]);
    const state=await readMatchDetails(db,'cup','match',{correction:true});
    assert.equal(state.reason,'');
    assert.ok((await readMatchDetails(db,'cup','match')).reason);
    const payload=structuredClone(state.payload);
    payload.maps[0].players[0].kills='9';payload.maps[0].mvp='b0';
    const form={intent:'correct-details',revision:state.revision,payload,reason:'Correct screenshot entry'};
    await assert.rejects(saveMatchDetails(db,'cup','match',{...form,reason:'  '}),/reason/);
    const invalid=structuredClone(payload);invalid.maps[0].players[0].assists='';
    await assert.rejects(saveMatchDetails(db,'cup','match',{...form,payload:invalid}),/all K\/D\/A/);
    await assert.rejects(saveMatchDetails(db,'cup','match',{...form,intent:'save-draft'}),e=>e.status===409);
    assert.deepEqual(await readD1Matches(db,[]),before);
    await saveMatchDetails(db,'cup','match',form);
    assert.deepEqual(counts(sql),[3,11,30]);
    const publicMatches=await readD1Matches(db,[]);
    const stats=loadLegacyStatistics().calculateStatistics(publicMatches);
    assert.equal(stats.totals.kills,9);assert.equal(stats.totals.mvpCount,3);
    assert.equal(stats.players.get('uid-b0').mvpCount,1);
    assert.equal(stats.players.get('uid-a0').mvpCount,1);
    assert.ok(!JSON.stringify(publicMatches).includes('Correct screenshot entry'));
    const audit=await readCorrectionHistory(db,'cup','match');
    assert.equal(audit.length,1);assert.equal(audit[0].correction_type,'details');assert.match(audit[0].created_at,/Z$/);
    assert.equal(JSON.parse(audit[0].old_state).details.maps[0].players[0].kills,'0');
    assert.equal(JSON.parse(audit[0].new_state).details.maps[0].players[0].kills,'9');
    assert.throws(()=>sql.exec('DELETE FROM match_correction_audit'),/append-only/);
  }finally{sql.close();}
});
test('same-winner correction leaves downstream unchanged, deactivates inconsistent details, and requires reconciliation',async()=>{
  const {sql,db}=fixture();try {
    downstream(sql);await finish(db);
    const target={...sql.prepare("SELECT * FROM matches WHERE id='final'").get()};
    await saveResultCorrection(db,'cup','match',await resultForm(db));
    assert.deepEqual({...sql.prepare("SELECT * FROM matches WHERE id='final'").get()},target);
    assert.deepEqual(counts(sql),[0,0,0]);
    const current=(await readD1Matches(db,[])).find(m=>m.id==='match');
    assert.deepEqual(current.data.roundDetails,[]);assert.deepEqual(current.data.playerStats,[]);
    let state=await readMatchDetails(db,'cup','match');assert.equal(state.payload.correction_required,true);
    await assert.rejects(saveMatchDetails(db,'cup','match',{intent:'complete-details',revision:state.revision,payload:state.payload,reason:'Fix maps'}),/differs from confirmed/);
    state.payload.maps[1].score1='7';state.payload.maps[1].score2='2';
    await assert.rejects(saveMatchDetails(db,'cup','match',{intent:'complete-details',revision:state.revision,payload:state.payload}),/reason/);
    await saveMatchDetails(db,'cup','match',{intent:'complete-details',revision:state.revision,payload:state.payload,reason:'Reconcile corrected score'});
    assert.deepEqual(counts(sql),[3,11,30]);
    assert.deepEqual((await readCorrectionHistory(db,'cup','match')).map(a=>a.correction_type),['details','series-result']);
  }finally{sql.close();}
});
test('winner correction rewires winner and loser sources atomically; downstream confirmed, W/O, live and conflicts block all changes',async()=>{
  for(const blocked of [null,"UPDATE matches SET status='completed',winner_id='a' WHERE id='final'",
    "UPDATE matches SET status='completed',winner_id='a',result_type='walkover' WHERE id='final'",
    "UPDATE matches SET status='live' WHERE id='final'","UPDATE matches SET team1_id='b' WHERE id='final'"]) {
    const {sql,db}=fixture();try {
      downstream(sql);
      sql.exec(`INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id) VALUES('bronze','cup','playoffs','final',2,'2026-10-02','upcoming','b');
        INSERT INTO match_sources(match_id,side,source_type,source_match_id) VALUES('bronze',1,'loser','match');`);
      await finish(db);
      if(blocked)sql.exec(blocked);
      const before=sql.prepare('SELECT * FROM matches ORDER BY id').all();
      const form=await resultForm(db,{score1:'1',score2:'2'});
      if(blocked) {
        await assert.rejects(saveResultCorrection(db,'cup','match',form),/downstream match final/);
        assert.deepEqual(sql.prepare('SELECT * FROM matches ORDER BY id').all(),before);
        assert.deepEqual(counts(sql),[3,11,30]);assert.equal((await readCorrectionHistory(db,'cup','match')).length,0);
      }else {
        await saveResultCorrection(db,'cup','match',form);
        assert.equal(sql.prepare("SELECT team1_id FROM matches WHERE id='final'").get().team1_id,'b');
        assert.equal(sql.prepare("SELECT team1_id FROM matches WHERE id='bronze'").get().team1_id,'a');
        assert.deepEqual(counts(sql),[0,0,0]);
        assert.equal((await readCorrectionHistory(db,'cup','match'))[0].correction_type,'winner');
      }
    }finally{sql.close();}
  }
});
test('result correction requires reason, confirmation and fresh revision; W/O removes combat and mixed detail corrections retain real stats only',async()=>{
  const {sql,db}=fixture();try {
    await finish(db);
    const form=await resultForm(db);
    await assert.rejects(saveResultCorrection(db,'cup','match',{...form,reason:''}),/reason/);
    await assert.rejects(saveResultCorrection(db,'cup','match',{...form,confirmed:''}),/Confirm/);
    await assert.rejects(saveResultCorrection(db,'cup','match',{...form,result_revision:'stale'}),/changed/);
    let state=await readMatchDetails(db,'cup','match',{correction:true});
    const payload=structuredClone(state.payload);Object.assign(payload.maps[2],{mode:'walkover',winner_side:'1'});
    await saveMatchDetails(db,'cup','match',{intent:'correct-details',revision:state.revision,payload,reason:'Map 3 was unplayed'});
    assert.deepEqual(counts(sql),[2,10,20]);
    let stats=loadLegacyStatistics().calculateStatistics(await readD1Matches(db,[]));assert.equal(stats.totals.mapsPlayed,2);assert.equal(stats.totals.mvpCount,2);
    await saveResultCorrection(db,'cup','match',await resultForm(db,{result_type:'walkover',walkover_winner:'b'}));
    assert.deepEqual(counts(sql),[0,0,0]);assert.equal(sql.prepare('SELECT count(*) n FROM match_map_walkovers').get().n,0);
    stats=loadLegacyStatistics().calculateStatistics(await readD1Matches(db,[]));assert.equal(stats.totals.mapsPlayed,0);assert.equal(stats.totals.kills,0);
    await saveResultCorrection(db,'cup','match',await resultForm(db,{score1:'1',score2:'2'}));
    assert.deepEqual(counts(sql),[0,0,0]);
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{sql.close();}
});
test('correction snapshot races and audit failures roll back result, details and every advancement',async()=>{
  for(const change of ["UPDATE matches SET score1=1 WHERE id='final'",
    "UPDATE match_detail_edits SET revision=revision+1 WHERE match_id='match'",
    "UPDATE player_round_stats SET kills=8 WHERE match_id='match'",
    "CREATE TRIGGER reject_audit BEFORE INSERT ON match_correction_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;"]) {
    const {sql,db}=fixture();try {
      downstream(sql);await finish(db);
      const form=await resultForm(db,{score1:'1',score2:'2'});
      db.hook=()=>sql.exec(change);
      await assert.rejects(saveResultCorrection(db,'cup','match',form));
      assert.equal(sql.prepare("SELECT winner_id FROM matches WHERE id='match'").get().winner_id,'a');
      assert.equal(sql.prepare("SELECT team1_id FROM matches WHERE id='final'").get().team1_id,'a');
      assert.deepEqual(counts(sql),[3,11,30]);assert.equal((await readCorrectionHistory(db,'cup','match')).length,0);
    }finally{sql.close();}
  }
});
