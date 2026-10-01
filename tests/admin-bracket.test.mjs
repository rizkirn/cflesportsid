import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readSetup, setupForm, saveSetup } from '../src/admin/setup.mjs';
import { readParticipantState } from '../src/admin/participants.mjs';
import { readBracketState, officialDraw, confirmOfficialBracket, readBracketForm } from '../src/admin/bracket.mjs';
import { generateSharedBracket } from '../src/utils/bracket-engine.mjs';
import { readLiveResults, saveLiveResult, seriesWinner } from '../src/admin/live-results.mjs';
import { readD1Matches } from '../src/data-access/matches.mjs';
const secret='a'.repeat(64);
async function fixture(count=13) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/0001_initial_schema.sql','utf8')); sqlite.exec(readFileSync('migrations/0002_preserve_player_rounds.sql','utf8')); sqlite.exec(readFileSync('migrations/0003_tournament_rosters.sql','utf8'));
  sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('test-cup','Test Cup','2026-10-01','2026-10-02','upcoming','single-elimination')");
  const db={hook:null,prepare(sql){let values=[];return {bind(...args){values=args;return this;},async all(){const args=/\?\d/.test(sql)?[Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]))]:values;return {success:true,results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){if(statements.length>3&&this.hook){const hook=this.hook;this.hook=null;hook();}sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  await saveSetup(db,'test-cup',setupForm(await readSetup(db,'test-cup')));
  for(let i=1;i<=count;i++){sqlite.prepare('INSERT INTO teams(id,name,tag,region) VALUES(?,?,?,?)').run(`t${i}`,`Team ${i}`,`T${i}`,'ID');sqlite.prepare('INSERT INTO tournament_teams VALUES(?,?)').run('test-cup',`t${i}`);}
  for(let i=1;i<=count;i++)for(let n=1;n<=5;n++){const id=`p${i}-${n}`;sqlite.prepare('INSERT INTO players(id,name,current_ign) VALUES(?,?,?)').run(id,id,id);sqlite.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('test-cup',`t${i}`,id,id,n);}
  return {sqlite,db};
}
function validateOpening(b,count){const stage=b.tournament.data.stages[0];const opening=b.draw.filter(e=>e.roundId===stage.rounds[0].id);assert.equal(stage.byes.length,16-count);assert.equal(opening.length,8);const ids=opening.flatMap(e=>[e.team1,e.team2].filter(Boolean));assert.equal(ids.length,count);assert.equal(new Set(ids).size,count);assert.ok(opening.every(e=>e.team1&&(e.team2||e.kind==='bye')));}
test('shared engine covers 13/16,12/16,9/16 and 8/16 without BYE vs BYE, original input unchanged and renamed Bronze-before-Final progression',async()=>{
  for(const count of [13,12,9,8]){const {sqlite,db}=await fixture(count);try{const state=await readBracketState(db,'test-cup');const options=structuredClone(state.options);options.stage.rounds.forEach((r,i)=>r.id=`renamed-${i}`);const before=structuredClone(options);for(let n=0;n<20;n++){const b=generateSharedBracket(options);validateOpening(b,count);const bronze=b.matches.find(m=>m.data.roundId==='renamed-3');const final=b.matches.find(m=>m.data.roundId==='renamed-4');for(const side of [1,2]){assert.equal(bronze.data[`team${side}Source`].type,'loser');assert.equal(final.data[`team${side}Source`].type,'winner');assert.equal(bronze.data[`team${side}Source`].matchId,final.data[`team${side}Source`].matchId);}}assert.deepEqual(options,before);}finally{sqlite.close();}}
});
test('exactly five draws are shown, no pre-confirm writes, final candidate atomically saves BYEs/matches/sources and locks setup/participants',async()=>{
  const {sqlite,db}=await fixture();try{const state=await readBracketState(db,'test-cup');let randomCalls=0;const random=()=>{randomCalls++;return .33;};const once=generateSharedBracket(state.options,random);const perDraw=randomCalls;randomCalls=0;const preview=await officialDraw(state,{revision:state.revision,draw_count:'5'},secret,random,1000);assert.equal(preview.draws.length,5);assert.equal(randomCalls,5*perDraw);for(const b of preview.draws)validateOpening(b,13);assert.equal(sqlite.prepare('SELECT count(*) n FROM matches').get().n,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM tournament_byes').get().n,0);
    const result=await confirmOfficialBracket(db,'test-cup',{revision:state.revision,token:preview.token},secret,1001);assert.deepEqual(result,preview.draws[4]);assert.equal(result.matches.length,13);assert.equal(sqlite.prepare('SELECT count(*) n FROM matches').get().n,13);assert.equal(sqlite.prepare('SELECT count(*) n FROM tournament_byes').get().n,3);assert.equal(sqlite.prepare('SELECT count(*) n FROM match_sources').get().n,16);assert.equal((await readParticipantState(db,'test-cup')).locked,true);assert.equal((await readSetup(db,'test-cup')).locked,true);assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.ok(sqlite.prepare('SELECT date FROM matches').all().every(m=>m.date==='2026-10-01'));await assert.rejects(confirmOfficialBracket(db,'test-cup',{revision:state.revision,token:preview.token},secret,1002),e=>e.status===409);
  }finally{sqlite.close();}
});
test('signed candidates reject tampering, wrong tournament, expiry, wrong keys and changed participant/setup/date state',async()=>{
  const {sqlite,db}=await fixture();try{const state=await readBracketState(db,'test-cup');const preview=await officialDraw(state,{revision:state.revision,draw_count:'1'},secret,Math.random,1000);const form={revision:state.revision,token:preview.token};for(const token of [preview.token.replace(/^./,c=>c==='a'?'b':'a'),'bad',preview.token+'.extra'])await assert.rejects(confirmOfficialBracket(db,'test-cup',{...form,token},secret,1001),e=>e.status===409);await assert.rejects(confirmOfficialBracket(db,'different',form,secret,1001),e=>e.status===404);await assert.rejects(confirmOfficialBracket(db,'test-cup',form,'b'.repeat(64),1001),e=>e.status===409);await assert.rejects(confirmOfficialBracket(db,'test-cup',form,secret,1000+7200001),e=>e.status===409);sqlite.exec("UPDATE tournaments SET start_date='2026-10-02'");await assert.rejects(confirmOfficialBracket(db,'test-cup',form,secret,1001),e=>e.status===409);assert.equal(sqlite.prepare('SELECT count(*) n FROM matches').get().n,0);
  }finally{sqlite.close();}
});
test('snapshot races and insert failures roll back the entire official bracket',async()=>{
  for(const mode of ['race','failure']){const {sqlite,db}=await fixture();try{const state=await readBracketState(db,'test-cup');const preview=await officialDraw(state,{revision:state.revision,draw_count:'1'},secret);if(mode==='race')db.hook=()=>sqlite.exec("UPDATE tournament_stages SET map_count=5");else sqlite.exec("CREATE TRIGGER fail_source BEFORE INSERT ON match_sources BEGIN SELECT RAISE(ABORT,'test failure');END");await assert.rejects(confirmOfficialBracket(db,'test-cup',{revision:state.revision,token:preview.token},secret));for(const table of ['matches','tournament_byes','match_sources'])assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);}finally{sqlite.close();}}
});
test('underfilled brackets, stale revisions, draw count and request boundaries fail before any write',async()=>{
  const {sqlite,db}=await fixture(7);try{let state=await readBracketState(db,'test-cup');await assert.rejects(officialDraw(state,{revision:state.revision,draw_count:'1'},secret),/needs 8/);state={...state,participants:Array.from({length:13},(_,i)=>({id:`t${i}`,name:`Team ${i}`}))};for(const count of ['0','21','1.5','05',''])await assert.rejects(officialDraw(state,{revision:state.revision,draw_count:count},secret));await assert.rejects(officialDraw(state,{revision:'old',draw_count:'1'},secret),e=>e.status===409);
    const req=(body,origin='http://localhost:4321')=>new Request('http://localhost:4321/admin/tournaments/test-cup/bracket',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body});await assert.rejects(readBracketForm(req('intent=draw','https://evil.example')),e=>e.status===403);for(const body of ['intent=draw&intent=confirm','team1_id=t1','token='+ 'x'.repeat(1048576)])await assert.rejects(readBracketForm(req(body)));assert.equal(sqlite.prepare('SELECT count(*) n FROM matches').get().n,0);
  }finally{sqlite.close();}
});
test('shared engine handles two/four-slot brackets and rejects a third place without played semifinal losers',()=>{
  const options=(size,count,bronze=false)=>({tournamentId:'small',name:'Small Cup',startDate:'2026-10-01',endDate:'2026-10-02',teams:Array.from({length:count},(_,i)=>({id:`team-${i}`,name:`Team ${i}`})),stage:{id:'playoffs',name:'Playoffs',format:'single-elimination',bracketSize:size,series:{type:'fixed-maps',mapCount:3},rounds:[...(size===4?[{id:'opening',name:'Opening',order:1}]:[]),{id:'final',name:'Final',order:size===4?2:1,placement:1},...(bronze?[{id:'third',name:'Third',order:3,placement:3}]:[])],byes:[]}});
  for(const [size,count] of [[2,2],[4,2],[4,3],[4,4]]){const b=generateSharedBracket(options(size,count));assert.equal(b.matches.length,count-1);assert.equal(b.tournament.data.stages[0].byes.length,size-count);assert.ok(b.draw.filter(e=>e.roundId===b.tournament.data.stages[0].rounds[0].id).every(e=>e.team1&&(e.team2||e.kind==='bye')));}
  for(const count of [2,3])assert.throws(()=>generateSharedBracket(options(4,count,true)),/played semifinals/);
  assert.equal(generateSharedBracket(options(4,4,true)).matches.length,4);
});

async function liveFixture(count=13) {
  const f=await fixture(count);
  const state=await readBracketState(f.db,'test-cup');
  const preview=await officialDraw(state,{revision:state.revision,draw_count:'1'},secret,()=>.33);
  await confirmOfficialBracket(f.db,'test-cup',{revision:state.revision,token:preview.token},secret);
  return f;
}
async function result(db,mid,intent='save-score',score1='2',score2='1') {
  const state=await readLiveResults(db,'test-cup');
  return saveLiveResult(db,'test-cup',{match_id:mid,result_revision:state.revision,intent,score1,score2});
}
function noDetails(sqlite) {
  for(const table of ['match_maps','player_match_entries','player_round_stats','player_map_stats']) assert.equal(sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
}
test('live score persists/reloads through the public D1 reader without children or progression',async()=>{
  const {sqlite,db}=await liveFixture();try{
    const m=(await readLiveResults(db,'test-cup')).matches.find(m=>m.team1_id&&m.team2_id);
    const before=sqlite.prepare('SELECT id,team1_id,team2_id FROM matches ORDER BY id').all();
    await result(db,m.id,'save-score','1','0');
    const saved=(await readLiveResults(db,'test-cup')).matches.find(row=>row.id===m.id);
    assert.equal(saved.score1,1);assert.equal(saved.score2,0);assert.equal(saved.status,'live');assert.equal(saved.winner_id,null);
    assert.deepEqual(sqlite.prepare('SELECT id,team1_id,team2_id FROM matches ORDER BY id').all(),before);
    const publicMatch=(await readD1Matches(db,[])).find(row=>row.id===m.id);
    assert.equal(publicMatch.data.score1,1);assert.equal(publicMatch.data.status,'live');
    assert.deepEqual(publicMatch.data.roundDetails,[]);assert.deepEqual(publicMatch.data.playerStats,[]);
    assert.equal('stats1' in publicMatch.data,false);noDetails(sqlite);
  }finally{sqlite.close();}
});
test('fixed-map rules reject unfinished/tied/invalid scores and stale edits before confirmation',async()=>{
  const {sqlite,db}=await liveFixture();try{
    const m=(await readLiveResults(db,'test-cup')).matches.find(m=>m.team1_id&&m.team2_id);
    for(const pair of [['-1','0'],['1.5','0'],['4','0'],['2','2'],['01','0'],['','0']]) await assert.rejects(result(db,m.id,'save-score',...pair),e=>e.status===400);
    for(const pair of [['0','0'],['1','0'],['1','1']]) {await result(db,m.id,'save-score',...pair);await assert.rejects(result(db,m.id,'confirm-result'),e=>e.status===400);}
    assert.equal(seriesWinner(2,0,'fixed-maps',3),null);assert.equal(seriesWinner(2,1,'fixed-maps',3),1);assert.equal(seriesWinner(0,3,'fixed-maps',3),2);assert.equal(seriesWinner(1,1,'fixed-maps',2),null);
    const stale=(await readLiveResults(db,'test-cup')).revision;await result(db,m.id,'save-score','2','1');
    await assert.rejects(saveLiveResult(db,'test-cup',{intent:'save-score',match_id:m.id,result_revision:stale,score1:'0',score2:'1'}),e=>e.status===409);
    const unresolved=(await readLiveResults(db,'test-cup')).matches.find(m=>!m.team1_id||!m.team2_id);
    await assert.rejects(result(db,unresolved.id),e=>e.status===409);noDetails(sqlite);
  }finally{sqlite.close();}
});
test('confirmation progresses winner and semifinal loser sources, locks results, and completes without details',async()=>{
  const {sqlite,db}=await liveFixture();try{
    let matches=(await readLiveResults(db,'test-cup')).matches;
    for(const m of matches){
      const current=(await readLiveResults(db,'test-cup')).matches.find(row=>row.id===m.id);
      assert.ok(current.team1_id&&current.team2_id,'BYEs and feeder results resolve every match');
      await result(db,m.id);await result(db,m.id,'confirm-result');
      const saved=sqlite.prepare('SELECT * FROM matches WHERE id=?').get(m.id);assert.equal(saved.status,'completed');assert.equal(saved.winner_id,current.team1_id);
      for(const s of sqlite.prepare('SELECT * FROM match_sources WHERE source_match_id=?').all(m.id)) {
        const target=sqlite.prepare('SELECT * FROM matches WHERE id=?').get(s.match_id);
        assert.equal(target[`team${s.side}_id`],s.source_type==='winner'?current.team1_id:current.team2_id);
      }
      await assert.rejects(result(db,m.id,'save-score','0','3'),e=>e.status===409);
      await assert.rejects(result(db,m.id,'confirm-result'),e=>e.status===409);
    }
    assert.ok(sqlite.prepare("SELECT count(*) n FROM match_sources WHERE source_type='loser'").get().n===2);
    noDetails(sqlite);
  }finally{sqlite.close();}
});
test('BYEs resolve slots without fake match rows or results, including an all-BYE opening round',async()=>{
  const {sqlite,db}=await liveFixture(8);try{
    assert.equal(sqlite.prepare('SELECT count(*) n FROM tournament_byes').get().n,8);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM matches').get().n,8);
    const opening=(await readLiveResults(db,'test-cup')).matches.filter(m=>m.sort_order===2);
    assert.equal(opening.length,4);assert.ok(opening.every(m=>m.team1_id&&m.team2_id&&m.status==='upcoming'&&!m.winner_id));
    for(const s of sqlite.prepare("SELECT * FROM match_sources WHERE source_type='bye'").all()) {
      const team=sqlite.prepare('SELECT team_id FROM tournament_byes WHERE id=?').get(s.source_bye_id).team_id;
      assert.equal(sqlite.prepare('SELECT * FROM matches WHERE id=?').get(s.match_id)[`team${s.side}_id`],team);
    }noDetails(sqlite);
  }finally{sqlite.close();}
});
test('conflicting/manual downstream slots and started matches fail safely without overwriting any result',async()=>{
  for(const mode of ['team','live','score','completed']) {
    const {sqlite,db}=await liveFixture();try{
      const m=(await readLiveResults(db,'test-cup')).matches.find(m=>m.team1_id&&m.team2_id);
      await result(db,m.id);
      const s=sqlite.prepare('SELECT * FROM match_sources WHERE source_match_id=?').get(m.id);
      if(mode==='team') sqlite.prepare(`UPDATE matches SET team${s.side}_id='t13' WHERE id=?`).run(s.match_id);
      if(mode==='live') sqlite.prepare("UPDATE matches SET status='live' WHERE id=?").run(s.match_id);
      if(mode==='score') sqlite.prepare('UPDATE matches SET score1=1 WHERE id=?').run(s.match_id);
      if(mode==='completed') sqlite.prepare("UPDATE matches SET status='completed',winner_id='t13' WHERE id=?").run(s.match_id);
      const before=sqlite.prepare('SELECT * FROM matches ORDER BY id').all();
      await assert.rejects(result(db,m.id,'confirm-result'),e=>e.status===409);
      assert.deepEqual(sqlite.prepare('SELECT * FROM matches ORDER BY id').all(),before);
    }finally{sqlite.close();}
  }
});
test('concurrent source changes and failing advancement writes roll back confirmation atomically',async()=>{
  for(const mode of ['race','failure']) {
    const {sqlite,db}=await liveFixture();try{
      for(const m of (await readLiveResults(db,'test-cup')).matches.filter(m=>m.sort_order<3)) {await result(db,m.id);await result(db,m.id,'confirm-result');}
      const semi=(await readLiveResults(db,'test-cup')).matches.find(m=>m.sort_order===3);await result(db,semi.id);
      if(mode==='race') db.hook=()=>sqlite.exec("UPDATE matches SET team1_id='t13' WHERE round_id='final'");
      else sqlite.exec("CREATE TRIGGER fail_advancement BEFORE UPDATE OF team1_id ON matches BEGIN SELECT RAISE(ABORT,'test advancement failure');END");
      await assert.rejects(result(db,semi.id,'confirm-result'));
      const saved=sqlite.prepare('SELECT * FROM matches WHERE id=?').get(semi.id);assert.equal(saved.status,'live');assert.equal(saved.winner_id,null);noDetails(sqlite);
    }finally{sqlite.close();}
  }
});

test('historical results and inconsistent sources stay read-only',async()=>{
  const {sqlite,db}=await liveFixture();try {
    const m=(await readLiveResults(db,'test-cup')).matches.find(m=>m.team1_id&&m.team2_id);
    await result(db,m.id);await result(db,m.id,'confirm-result');
    const s=sqlite.prepare('SELECT * FROM match_sources WHERE source_match_id=?').get(m.id);
    sqlite.prepare(`UPDATE matches SET team${s.side}_id='t13' WHERE id=?`).run(s.match_id);
    await assert.rejects(result(db,s.match_id),e=>e.status===409);
    sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('clash-for-glory-s1','S1','2026-01-01','2026-01-02','upcoming','single-elimination')");
    await assert.rejects(saveLiveResult(db,'clash-for-glory-s1',{intent:'save-score'}),e=>e.status===409&&/Historical/.test(e.message));
  }finally{sqlite.close();}
});
test('later genuine details use the same D1 match, while empty player entries do not create zero statistics',async()=>{
  const {sqlite,db}=await liveFixture();try {
    const m=(await readLiveResults(db,'test-cup')).matches.find(m=>m.team1_id&&m.team2_id);
    await result(db,m.id);await result(db,m.id,'confirm-result');
    sqlite.exec("INSERT INTO maps(id,name) VALUES('real-map','Recorded Map')");
    sqlite.prepare('INSERT INTO match_maps(match_id,map_number,map_id,winner_team_id) VALUES(?,1,?,?)').run(m.id,'real-map',m.team1_id);
    sqlite.prepare('INSERT INTO player_match_entries(match_id,entry_index,uid_snapshot,ign_snapshot,team_id) VALUES(?,0,?,?,?)').run(m.id,'uid-real','Recorded IGN',m.team1_id);
    let shaped=(await readD1Matches(db,[])).find(row=>row.id===m.id);
    assert.equal(shaped.data.roundDetails.length,1);assert.equal(shaped.data.playerStats.length,0);
    sqlite.prepare('INSERT INTO player_round_stats(match_id,entry_index,round_index,map_number,kills,deaths,assists) VALUES(?,0,0,1,10,4,2)').run(m.id);
    shaped=(await readD1Matches(db,[])).find(row=>row.id===m.id);
    assert.equal(shaped.data.score1,2);assert.equal(shaped.data.roundDetails[0].mapId,'real-map');assert.equal(shaped.data.playerStats[0].rounds[0].kills,10);
  }finally{sqlite.close();}
});
