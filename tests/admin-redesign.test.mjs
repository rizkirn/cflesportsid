import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { readLiveResults } from '../src/admin/live-results.mjs';
import { saveEditedResult } from '../src/admin/result-editor.mjs';
import { createTournament,createTournamentWithSetup,deleteTestTournament,metadataRevision,saveTournamentMetadata,getTournament } from '../src/admin/tournaments.mjs';
import {saveMaster,masterRevision} from '../src/admin/master-data.mjs';

function fixture() {
  const sql=new DatabaseSync(':memory:');
  for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort())sql.exec(readFileSync('migrations/'+file,'utf8'));
  const db={prepare(query){let values=[];const args=()=>/\?\d/.test(query)?[Object.fromEntries(values.map((value,index)=>['?'+(index+1),value]))]:values;return {
    bind(...args){values=args;return this;},
    async all(){return {success:true,results:sql.prepare(query).all(...args())};},
    async first(){return sql.prepare(query).get(...args())??null;},
    async run(){return {success:true,meta:{changes:Number(sql.prepare(query).run(...args()).changes)}};},
  };},async batch(statements){sql.exec('BEGIN');try {const results=[];for(const statement of statements)results.push(await statement.all());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  sql.exec(`INSERT INTO teams(id,name,tag,region) VALUES('a','Alpha','A','ID'),('b','Beta','B','ID');
    INSERT INTO players(id,name,current_ign,current_team_id) VALUES('p','Player','IGN','a');
    INSERT INTO maps(id,name) VALUES('map','Map');
    INSERT INTO tournaments(id,name,start_date,end_date,status,format,is_test) VALUES('cup','Test Cup','2026-10-01','2026-10-02','ongoing','single-elimination',1),('official','Official Cup','2026-10-01','2026-10-02','upcoming','single-elimination',0);
    INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count) VALUES('cup','stage','Stage','single-elimination',4,'fixed-maps',3);
    INSERT INTO tournament_rounds VALUES('cup','stage','semi','Semi Final',1,NULL),('cup','stage','final','Final',2,NULL);
    INSERT INTO tournament_teams VALUES('cup','a'),('cup','b');
    INSERT INTO tournament_rosters VALUES('cup','a','p','Tournament IGN',1);
    INSERT INTO stage_map_pool VALUES('cup','stage','map',1);
    INSERT INTO veto_steps VALUES('cup','stage',1,'A','pick');
    INSERT INTO tournament_byes VALUES('cup','stage','bye','semi',2,'b');
    INSERT INTO team_penalties(tournament_id,team_id,points,reason) VALUES('cup','a',1,'Penalty');
    INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id,team2_id) VALUES('semi','cup','stage','semi',1,'2026-10-01','upcoming','a','b'),('final','cup','stage','final',1,'2026-10-02','upcoming',NULL,'b');
    INSERT INTO match_sources VALUES('final',1,'winner','semi',NULL);`);
  sql.exec(`INSERT INTO official_map_assignments(id,tournament_id,stage_id,round_id,match_id,source,scope,maps,actions) VALUES('fixture-maps','cup','stage','semi',NULL,'randomizer','round','["map","map2","map3"]','[]');`);
  return {sql,db};
}
const form=async(db,values={})=>({intent:'edit-result',match_id:'semi',result_revision:(await readLiveResults(db,'cup')).revision,result_type:'played',score1:'2',score2:'1',confirmed:'yes',...values});

test('Edit Result confirms score and progression once, then automatically audits same-winner corrections',async()=>{
  const {sql,db}=fixture();try {
    await assert.rejects(saveEditedResult(db,'cup',await form(db,{score1:'2',score2:'0'})),/all three/);
    await saveEditedResult(db,'cup',await form(db));
    assert.equal(sql.prepare("SELECT status FROM matches WHERE id='semi'").get().status,'completed');
    assert.equal(sql.prepare("SELECT team1_id FROM matches WHERE id='final'").get().team1_id,'a');
    assert.equal(sql.prepare('SELECT count(*) n FROM match_correction_audit').get().n,0);
    await assert.rejects(saveEditedResult(db,'cup',await form(db,{score1:'3',score2:'0'})),/reason/);
    await saveEditedResult(db,'cup',await form(db,{score1:'3',score2:'0',reason:'Screenshot correction'}));
    assert.equal(sql.prepare("SELECT team1_id FROM matches WHERE id='final'").get().team1_id,'a');
    assert.equal(sql.prepare('SELECT correction_type FROM match_correction_audit').get().correction_type,'series-result');
    sql.exec("UPDATE matches SET status='live' WHERE id='final'");
    await assert.rejects(saveEditedResult(db,'cup',await form(db,{score1:'1',score2:'2',reason:'Winner correction'})),/downstream match final/);
    assert.equal(sql.prepare("SELECT winner_id FROM matches WHERE id='semi'").get().winner_id,'a');
  }finally{sql.close();}
});
test('Edit Result W/O shares the editor and preserves initial downstream/detail guards and atomicity',async()=>{
  const {sql,db}=fixture();try {
    sql.exec("CREATE TRIGGER reject_final BEFORE UPDATE ON matches WHEN OLD.id='final' BEGIN SELECT RAISE(ABORT,'failed progression'); END;");
    await assert.rejects(saveEditedResult(db,'cup',await form(db)),/failed progression/);
    assert.equal(sql.prepare("SELECT status FROM matches WHERE id='semi'").get().status,'upcoming');
    sql.exec('DROP TRIGGER reject_final');
    await saveEditedResult(db,'cup',await form(db,{result_type:'walkover',walkover_winner:'a'}));
    assert.deepEqual({...sql.prepare("SELECT result_type,score1,score2,winner_id FROM matches WHERE id='semi'").get()},{result_type:'walkover',score1:0,score2:0,winner_id:'a'});
    assert.equal(sql.prepare('SELECT count(*) n FROM player_round_stats').get().n,0);
  }finally{sql.close();}
});
test('test lifecycle is immutable, official deletion is denied, explicit test cleanup preserves every master',async()=>{
  const {sql,db}=fixture();try {
    assert.throws(()=>sql.exec("UPDATE tournaments SET is_test=1 WHERE id='official'"),/immutable/);
    assert.throws(()=>sql.exec("DELETE FROM tournaments WHERE id='official'"),/cannot be deleted/);
    await assert.rejects(deleteTestTournament(db,'official',{confirmed:'yes',confirm_name:'Official Cup'}),/Official/);
    await assert.rejects(deleteTestTournament(db,'cup',{confirmed:'yes',confirm_name:'Wrong'}),/exact tournament name/);
    sql.exec(`INSERT INTO match_maps VALUES('semi',1,'map','a',7,2,'p',NULL);
      INSERT INTO player_match_entries VALUES('semi',0,'p','a',NULL,'IGN');
      INSERT INTO player_round_stats VALUES('semi',0,0,1,4,2,1);
      INSERT INTO match_map_walkovers VALUES('semi',2,'map','a');
      INSERT INTO match_detail_edits VALUES('semi','draft','{}',1);
      INSERT INTO match_correction_audit(match_id,tournament_id,correction_type,reason,old_state,new_state) VALUES('semi','cup','details','Test audit','{}','{}');`);
    await deleteTestTournament(db,'cup',{confirmed:'yes',confirm_name:'Test Cup'});
    for(const table of ['tournament_stages','tournament_rounds','tournament_teams','tournament_rosters','stage_map_pool','veto_steps','tournament_byes','matches','match_sources','match_maps','match_map_walkovers','player_match_entries','player_round_stats','match_detail_edits','match_correction_audit','team_penalties'])assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
    for(const [table,count] of [['teams',2],['players',1],['maps',1],['tournaments',1]])assert.equal(sql.prepare(`SELECT count(*) n FROM ${table}`).get().n,count,table);
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
    const id=await createTournament(db,{name:'New Test',start_date:'2026-10-01',end_date:'2026-10-02',is_test:'1'});
    assert.equal(sql.prepare('SELECT is_test FROM tournaments WHERE id=?').get(id).is_test,1);
  }finally{sql.close();}
});
test('test cleanup rolls every deletion back if an outside match references its bracket',async()=>{
  const {sql,db}=fixture();try {
    sql.exec(`INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count) VALUES('official','stage','Stage','single-elimination',4,'fixed-maps',3);
      INSERT INTO tournament_rounds VALUES('official','stage','semi','Semi',1,NULL);
      INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status) VALUES('outside','official','stage','semi',1,'2026-10-01','upcoming');
      INSERT INTO match_sources VALUES('outside',1,'winner','semi',NULL);`);
    await assert.rejects(deleteTestTournament(db,'cup',{confirmed:'yes',confirm_name:'Test Cup'}),/Nothing was deleted/);
    assert.equal(sql.prepare("SELECT count(*) n FROM matches WHERE tournament_id='cup'").get().n,2);
    assert.equal(sql.prepare('SELECT count(*) n FROM tournament_rosters').get().n,1);
  }finally{sql.close();}
});
test('inspector metadata preserves classification and URL, rejects stale updates and locks after bracket creation',async()=>{
  const {sql,db}=fixture();try {
    const tournament=await getTournament(db,'official');
    const form={name:'Renamed Official',start_date:'2026-11-01',end_date:'2026-11-02',revision:metadataRevision(tournament)};
    await saveTournamentMetadata(db,'official',form);
    const saved=await getTournament(db,'official');assert.equal(saved.name,form.name);assert.equal(saved.is_test,0);assert.equal(saved.id,'official');
    await assert.rejects(saveTournamentMetadata(db,'official',form),/changed/);
    const locked=await getTournament(db,'cup');
    await assert.rejects(saveTournamentMetadata(db,'cup',{...form,revision:metadataRevision(locked)}),/locked/);
  }finally{sql.close();}
});

test('identity and generated setup create atomically, with internal defaults and immutable classification',async()=>{
 const {sql,db}=fixture();try{
 const input={name:'Coherent Test',start_date:'2026-10-02',end_date:'2026-10-03',is_test:'1',bracket_size:'8',map_count:'3',action_seconds:'20',reserve_seconds:'90',bronze_match:'1'};
 const id=await createTournamentWithSetup(db,input);
 const tournament=await getTournament(db,id);assert.equal(tournament.game,'crossfire-legends');assert.equal(tournament.region,'ID');assert.equal(tournament.status,'upcoming');assert.equal(tournament.is_test,1);
 const stage=sql.prepare('SELECT * FROM tournament_stages WHERE tournament_id=?').get(id);assert.equal(stage.name,'Playoffs');assert.equal(stage.series_type,'fixed-maps');assert.equal(stage.bracket_size,8);assert.equal(stage.map_count,3);
 assert.equal(sql.prepare('SELECT count(*) n FROM tournament_rounds WHERE tournament_id=?').get(id).n,4);
 await assert.rejects(createTournamentWithSetup(db,input),e=>e.status===409);
 await assert.rejects(createTournamentWithSetup(db,{...input,name:'Invalid Setup',map_count:'2'}));assert.equal(await getTournament(db,'invalid-setup'),null);
 sql.exec("CREATE TRIGGER refuse_setup BEFORE INSERT ON tournament_stages BEGIN SELECT RAISE(ABORT,'setup failure'); END;");
 await assert.rejects(createTournamentWithSetup(db,{...input,name:'Failed Setup'}),/setup failure/);assert.equal(await getTournament(db,'failed-setup'),null);
 }finally{sql.close();}
});
test('master CRUD persists supported fields, leaves tournament snapshots intact and rejects stale/duplicate/invalid edits',async()=>{
 const {sql,db}=fixture();try{
 const teamId=await saveMaster(db,'teams',null,{intent:'create',name:'New Team',tag:'NT',region:'Indonesia',description:'Team description',color:'#FF5A1F',logo:'/logos/default.webp'});
 let team=sql.prepare('SELECT * FROM teams WHERE id=?').get(teamId);assert.equal(team.color,'#FF5A1F');
 const playerId=await saveMaster(db,'players',null,{intent:'create',uid:'unique-uid',current_ign:'New IGN',name:'',current_team_id:teamId});
 let player=sql.prepare('SELECT * FROM players WHERE id=?').get(playerId);assert.equal(player.name,'New IGN');assert.equal(player.current_team_id,teamId);
 await assert.rejects(saveMaster(db,'players',null,{intent:'create',uid:'unique-uid',current_ign:'Duplicate'}),e=>e.status===409);
 const snapshot=sql.prepare("SELECT ign_snapshot FROM tournament_rosters WHERE player_id='p'").get().ign_snapshot;let existing=sql.prepare("SELECT * FROM players WHERE id='p'").get();
 await saveMaster(db,'players','p',{intent:'edit',revision:masterRevision('players',existing),uid:'',current_ign:'Global Rename',name:'',current_team_id:teamId});assert.equal(sql.prepare("SELECT ign_snapshot FROM tournament_rosters WHERE player_id='p'").get().ign_snapshot,snapshot);
 const edit={intent:'edit',revision:masterRevision('players',player),uid:player.uid,current_ign:'Renamed',name:'',current_team_id:''};await saveMaster(db,'players',playerId,edit);await assert.rejects(saveMaster(db,'players',playerId,edit),e=>e.status===409);
 player=sql.prepare('SELECT * FROM players WHERE id=?').get(playerId);await assert.rejects(saveMaster(db,'players',playerId,{...edit,revision:masterRevision('players',player),uid:'different'}),/immutable/);
 const mapId=await saveMaster(db,'maps',null,{intent:'create',name:'New Map',active:'1',thumbnail:'https://example.com/map.webp'});const map=sql.prepare('SELECT * FROM maps WHERE id=?').get(mapId);assert.equal(map.game,'crossfire-legends');await saveMaster(db,'maps',mapId,{intent:'edit',revision:masterRevision('maps',map),name:'Renamed Map',active:'0',thumbnail:''});assert.equal(sql.prepare('SELECT active FROM maps WHERE id=?').get(mapId).active,0);
 await assert.rejects(saveMaster(db,'teams',teamId,{intent:'edit',revision:masterRevision('teams',team),...team,logo:'javascript:alert(1)'}),/HTTPS/);
 assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{sql.close();}
});

test('configured fixed-map counts retain initial result semantics while CFG remains fixed three',async()=>{
 const {sql,db}=fixture();try{
 sql.exec("UPDATE tournament_stages SET map_count=5 WHERE tournament_id='cup'");
 await assert.rejects(saveEditedResult(db,'cup',await form(db,{score1:'3',score2:'0'})),/all 5/);
 await saveEditedResult(db,'cup',await form(db,{score1:'5',score2:'0'}));
 assert.equal(sql.prepare("SELECT score1 FROM matches WHERE id='semi'").get().score1,5);
 assert.equal(sql.prepare("SELECT team1_id FROM matches WHERE id='final'").get().team1_id,'a');
 }finally{sql.close();}
});
