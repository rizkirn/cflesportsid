import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readSetup,setupForm,saveSetup } from '../src/admin/setup.mjs';
import { readParticipantState,participantForm,saveParticipants } from '../src/admin/participants.mjs';
import { readRosterState,rosterForm,editRosterForm,saveRoster,moveRosterPlayer,readRosterForm,workspaceRosterForm,editWorkspaceRoster,saveWorkspaceRoster,readWorkspaceRosterForm,rosterCopySource } from '../src/admin/roster.mjs';
import { readBracketState,officialDraw,confirmOfficialBracket } from '../src/admin/bracket.mjs';
const secret='a'.repeat(64);
test('current roster automatically prefills draft, saves reviewed IGN and survives reload without historical backfill',async()=>{
  const {sqlite,db}=await fixture();try {
    sqlite.exec("DELETE FROM players;DELETE FROM tournament_teams;INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('s1','S1','2026-01-01','2026-01-02','completed','single-elimination'),('s2','S2','2026-02-01','2026-02-02','completed','single-elimination')");
    for (const [teamId,count] of [['cha-tra-mue',5],['demigod-kage',7]]) {
      const team=JSON.parse(readFileSync(`src/data/teams/${teamId}.json`,'utf8'));
      sqlite.prepare('INSERT INTO teams(id,name,tag,region) VALUES(?,?,?,?)').run(teamId,team.name,team.tag,team.region);
      sqlite.prepare('INSERT INTO tournament_teams VALUES(?,?)').run('cup',teamId);
      for (const playerId of team.players) {
        const player=JSON.parse(readFileSync(`src/data/players/${playerId}.json`,'utf8'));
        assert.equal(player.team,teamId);
        sqlite.prepare('INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES(?,?,?,?,?)').run(playerId,player.uid??playerId,player.name,player.ign,player.team);
      }
      const state=await readRosterState(db,'cup');assert.equal(state.rows.length,0);
      assert.equal(workspaceRosterForm(state).entries.filter(row=>row.team_id===teamId).length,count);
      const source=rosterCopySource(state,teamId);assert.equal(source.kind,'current');assert.equal(source.entries.length,count);
    }
    let state=await readRosterState(db,'cup');let form=workspaceRosterForm(state);
    assert.equal(form.entries.length,12);
    form.copy_team='cha-tra-mue';assert.throws(()=>editWorkspaceRoster(form,state),/draft before copying/);delete form.copy_team;
    assert.equal((await readRosterState(db,'cup')).rows.length,0);assert.equal(state.roster.ready,false);
    form.entries[0].ign='Reviewed S3 IGN';await saveWorkspaceRoster(db,'cup',form);
    state=await readRosterState(db,'cup');assert.equal(state.rows.length,12);assert.equal(state.roster.ready,true);
    assert.equal(rosterCopySource(state,'cha-tra-mue'),null);
    const before=state.snapshot;form=workspaceRosterForm(state);form.entries=[];form.copy_team='cha-tra-mue';assert.throws(()=>editWorkspaceRoster(form,state),e=>e.status===409);
    sqlite.exec("UPDATE players SET current_ign='Later profile edit',current_team_id=NULL");
    state=await readRosterState(db,'cup');assert.equal(state.snapshot,before);assert.ok(state.rows.some(row=>row[2]==='Reviewed S3 IGN'));
    assert.equal(sqlite.prepare("SELECT count(*) n FROM tournament_rosters WHERE tournament_id IN ('s1','s2')").get().n,0);
  }finally{sqlite.close();}
});
test('copy prefers usable earlier snapshots, handles conflicts, rejects overflow, stale/locked requests and keeps other drafts',async()=>{
  const {sqlite,db}=await fixture();try {
    let state=await readRosterState(db,'cup');let form=workspaceRosterForm(state);form.copy_team='alpha';assert.throws(()=>editWorkspaceRoster(form,state),/no roster source/);
    sqlite.exec("UPDATE players SET current_team_id=NULL WHERE id NOT IN ('p1','p2','p3','p4','p5');INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('older','Older','2026-09-01','2026-09-02','completed','single-elimination');INSERT INTO tournament_teams VALUES('older','alpha');INSERT INTO tournament_rosters VALUES('older','alpha','p6','Historical IGN',1)");
    state=await readRosterState(db,'cup');assert.equal(rosterCopySource(state,'alpha').kind,'previous');form=workspaceRosterForm(state);assert.equal(form.entries[0].ign,'Historical IGN');assert.equal((await readRosterState(db,'cup')).rows.length,0);
    await save(db,'beta',[entry(6)]);state=await readRosterState(db,'cup');assert.equal(rosterCopySource(state,'alpha').kind,'previous');form=workspaceRosterForm(state);form.entries[0].ign='Other draft';assert.equal(form.entries[0].ign,'Other draft');assert.equal(form.entries.length,1);
    form.copy_team='missing';assert.throws(()=>editWorkspaceRoster(form,state),e=>e.status===409);
    form.copy_team='alpha';form.revision='stale';assert.throws(()=>editWorkspaceRoster(form,state),e=>e.status===409);
    form=workspaceRosterForm(state);form.copy_team='alpha';assert.throws(()=>editWorkspaceRoster(form,{...state,locked:true}),e=>e.status===409);
    sqlite.exec("UPDATE players SET current_team_id='alpha' WHERE id='p6'");state=await readRosterState(db,'cup');form=workspaceRosterForm(state);assert.equal(form.entries.filter(row=>row.id==='p6').length,1);
    assert.equal(sqlite.prepare("SELECT ign_snapshot FROM tournament_rosters WHERE tournament_id='older'").get().ign_snapshot,'Historical IGN');
  }finally{sqlite.close();}
});
async function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of ['0001_initial_schema.sql','0002_preserve_player_rounds.sql','0003_tournament_rosters.sql'])sqlite.exec(readFileSync('migrations/'+file,'utf8'));
  sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('cup','Cup','2026-10-01','2026-10-02','upcoming','single-elimination'),('next','Next Cup','2026-11-01','2026-11-02','upcoming','single-elimination');INSERT INTO teams(id,name,tag,region) VALUES('alpha','Alpha','ALP','ID'),('beta','Beta','BET','ID')");
  for(const id of ['cup','next'])sqlite.exec(`INSERT INTO tournament_teams VALUES('${id}','alpha'),('${id}','beta')`);
  for(let n=1;n<=15;n++)sqlite.prepare("INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES(?,?,?,?,'alpha')").run(`p${n}`,`uid-${n}`,`Player ${n}`,`Current ${n}`);
  const db={hook:null,prepare(sql){let values=[];return {sql,bind(...args){values=args;return this;},async all(){const args=/\?\d/.test(sql)?[Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]))]:values;return {success:true,results:sqlite.prepare(sql).all(...args)};}};},async batch(statements){if(statements.some(s=>s.sql.startsWith('UPDATE tournaments'))&&this.hook){const hook=this.hook;this.hook=null;hook();}sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.all());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const form=setupForm(await readSetup(db,'cup'));form.bracket_size='4';form.bronze_match='';await saveSetup(db,'cup',form);const next=setupForm(await readSetup(db,'next'));next.bracket_size='4';next.bronze_match='';await saveSetup(db,'next',next);
  return {sqlite,db};
}
const entry=(n,ign=`Snapshot ${n}`)=>({id:`p${n}`,ign,name:'',uid:''});
async function save(db,team,entries,tour='cup'){const state=await readRosterState(db,tour);const form=rosterForm(state,team);form.entries=entries;return saveRoster(db,tour,form);}
async function complete(db){await save(db,'alpha',Array.from({length:5},(_,i)=>entry(i+1)));await save(db,'beta',Array.from({length:5},(_,i)=>entry(i+6)));}
test('partial rosters save, 5–7 readiness is per participant, duplicate players/UID and 8th player reject; history snapshots do not edit globals',async()=>{
  const {sqlite,db}=await fixture();try{
    assert.equal((await readRosterState(db,'cup')).roster.ready,false);
    await save(db,'alpha',[entry(1)]);assert.equal((await readRosterState(db,'cup')).roster.teams[0].count,1);
    await assert.rejects(save(db,'beta',[entry(1)]),e=>e.status===409);
    await assert.rejects(save(db,'alpha',[entry(1),entry(1)]),/only once/);
    await complete(db);assert.equal((await readRosterState(db,'cup')).roster.ready,true);
    await save(db,'alpha',[...Array.from({length:5},(_,i)=>entry(i+1)),entry(11),entry(12)]);assert.equal((await readRosterState(db,'cup')).roster.teams[0].count,7);
    await assert.rejects(save(db,'alpha',Array.from({length:8},(_,i)=>entry(i+1))),/at most 7/);
    sqlite.exec("UPDATE players SET current_ign='Changed later',current_team_id='beta' WHERE id='p1'");
    assert.equal((await readRosterState(db,'cup')).rows.find(r=>r[1]==='p1')[2],'Snapshot 1');
    await save(db,'alpha',[entry(1,'Next season IGN')],'next');assert.equal((await readRosterState(db,'cup')).rows.find(r=>r[1]==='p1')[2],'Snapshot 1');
    assert.equal(sqlite.prepare("SELECT current_ign FROM players WHERE id='p1'").get().current_ign,'Changed later');
    await assert.rejects(save(db,'alpha',[{id:'',name:'Duplicate UID',ign:'Another',uid:'uid-1'}]),e=>e.status===409);
    await assert.rejects(save(db,'alpha',[entry(2,'\n')]),/Tournament IGN/);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{sqlite.close();}
});
test('draft add/remove has no writes; new player save is atomic, optional UID becomes NULL and current team stays unchanged',async()=>{
  const {sqlite,db}=await fixture();try{
    const state=await readRosterState(db,'cup');let form=rosterForm(state,'alpha');form.intent='add-existing';form.player_id='p1';form=editRosterForm(state,form);assert.equal(form.entries[0].ign,'Current 1');
    form.intent='add-new';form.new_name='New Player';form.new_ign='New IGN';form.new_uid='';form=editRosterForm(state,form);assert.equal(sqlite.prepare('SELECT count(*) n FROM players').get().n,15);assert.equal((await readRosterState(db,'cup')).rows.length,0);
    form.remove_player='0';form=editRosterForm(state,form);delete form.remove_player;await saveRoster(db,'cup',form);
    const created=sqlite.prepare("SELECT * FROM players WHERE name='New Player'").get();assert.equal(created.uid,null);assert.equal(created.current_team_id,null);assert.equal(created.current_ign,'New IGN');
    const before=(await readRosterState(db,'cup')).snapshot;
    const failing=rosterForm(await readRosterState(db,'cup'),'alpha');failing.entries.push({id:'',name:'Rollback Player',ign:'Rollback IGN',uid:'fresh-uid'});
    sqlite.exec("CREATE TRIGGER fail_roster BEFORE INSERT ON tournament_rosters WHEN NEW.ign_snapshot='Rollback IGN' BEGIN SELECT RAISE(ABORT,'test failure');END");
    await assert.rejects(saveRoster(db,'cup',failing));assert.equal((await readRosterState(db,'cup')).snapshot,before);assert.equal(sqlite.prepare("SELECT count(*) n FROM players WHERE uid='fresh-uid'").get().n,0);
  }finally{sqlite.close();}
});
test('saved players move atomically with IGN intact; unsaved edits and full targets reject and source readiness changes',async()=>{
  const {sqlite,db}=await fixture();try{
    await complete(db);let state=await readRosterState(db,'cup');let form=rosterForm(state,'alpha');form.move_player='0';form.move_team='beta';await moveRosterPlayer(db,'cup',form);
    state=await readRosterState(db,'cup');assert.equal(state.rows.find(r=>r[1]==='p1')[0],'beta');assert.equal(state.rows.find(r=>r[1]==='p1')[2],'Snapshot 1');assert.equal(state.roster.ready,false);
    form=rosterForm(state,'alpha');form.entries[0].ign='Unsaved';form.move_player='0';form.move_team='beta';await assert.rejects(moveRosterPlayer(db,'cup',form),/Save roster edits/);
    await save(db,'beta',[...state.rows.filter(r=>r[0]==='beta').map(r=>({id:r[1],ign:r[2],name:'',uid:''})),entry(11)]);state=await readRosterState(db,'cup');form=rosterForm(state,'alpha');form.move_player='0';form.move_team='beta';await assert.rejects(moveRosterPlayer(db,'cup',form),/already has 7/);
    form.move_team='missing';await assert.rejects(moveRosterPlayer(db,'cup',form));
  }finally{sqlite.close();}
});
test('Participants preserves retained rosters, removes departed-team registrations and detects concurrent roster saves',async()=>{
  const {sqlite,db}=await fixture();try{
    await complete(db);let state=await readParticipantState(db,'cup');let form=participantForm(state);await saveParticipants(db,'cup',form);assert.equal((await readRosterState(db,'cup')).rows.length,10);
    state=await readParticipantState(db,'cup');form=participantForm(state);form.participants[1]={id:'',name:'Gamma',tag:'GAM',region:'ID'};await saveParticipants(db,'cup',form);
    let roster=await readRosterState(db,'cup');assert.equal(roster.rows.length,5);assert.ok(roster.rows.every(r=>r[0]==='alpha'));assert.equal(roster.roster.ready,false);
    form=participantForm(await readParticipantState(db,'cup'));db.hook=()=>sqlite.exec("UPDATE tournament_rosters SET ign_snapshot='Concurrent' WHERE player_id='p1' AND tournament_id='cup'");await assert.rejects(saveParticipants(db,'cup',form),e=>e.status===409);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM players').get().n,15);
  }finally{sqlite.close();}
});
test('Official Draw and confirmation require complete unchanged rosters; confirmed/started/BYE lifecycle rejects all roster changes',async()=>{
  const {sqlite,db}=await fixture();try{
    let state=await readBracketState(db,'cup');await assert.rejects(officialDraw(state,{revision:state.revision,draw_count:'1'},secret),/5 to 7/);
    await complete(db);state=await readBracketState(db,'cup');const preview=await officialDraw(state,{revision:state.revision,draw_count:'1'},secret);
    await save(db,'alpha',Array.from({length:5},(_,i)=>entry(i+1,'New '+i)));
    await assert.rejects(confirmOfficialBracket(db,'cup',{revision:state.revision,token:preview.token},secret),e=>e.status===409);
    state=await readBracketState(db,'cup');const last=await officialDraw(state,{revision:state.revision,draw_count:'1'},secret);
    await confirmOfficialBracket(db,'cup',{revision:state.revision,token:last.token},secret);
    const roster=await readRosterState(db,'cup');assert.equal(roster.locked,true);const form=rosterForm(roster,'alpha');await assert.rejects(saveRoster(db,'cup',form),e=>e.status===409);form.intent='add-existing';form.player_id='p11';assert.throws(()=>editRosterForm(roster,form),e=>e.status===409);form.move_player='0';form.move_team='beta';await assert.rejects(moveRosterPlayer(db,'cup',form),e=>e.status===409);
    assert.equal((await readRosterState(db,'cup')).rows.length,10);
  }finally{sqlite.close();}
});
test('snapshot races, missing player references and strict POST parser fail safely',async()=>{
  const {sqlite,db}=await fixture();try{
    await complete(db);let state=await readRosterState(db,'cup');let form=rosterForm(state,'alpha');
    db.hook=()=>sqlite.exec("INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status) VALUES('concurrent','cup','playoffs','final',1,'2026-10-01','upcoming')");await assert.rejects(saveRoster(db,'cup',form),e=>e.status===409);sqlite.exec('DELETE FROM matches');
    form=rosterForm(await readRosterState(db,'cup'),'alpha');db.hook=()=>sqlite.exec("UPDATE tournaments SET status='ongoing' WHERE id='cup'");await assert.rejects(saveRoster(db,'cup',form),e=>e.status===409);sqlite.exec("UPDATE tournaments SET status='upcoming' WHERE id='cup'");
    sqlite.exec("PRAGMA foreign_keys=OFF;DELETE FROM players WHERE id='p1';PRAGMA foreign_keys=ON");assert.equal((await readBracketState(db,'cup')).roster.ready,false);
    const request=(body,origin='http://localhost:4321')=>new Request('http://localhost:4321/admin/tournaments/cup/roster',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body});
    for(const body of ['entries.7.id=x','entries.1.id=x','revision=a&revision=b','current_team_id=alpha','entries.0.id='+ 'x'.repeat(16384)])await assert.rejects(readRosterForm(request(body)));
    await assert.rejects(readRosterForm(request('intent=save','https://evil.example')),e=>e.status===403);
  }finally{sqlite.close();}
});

test('one workspace saves inline IGN and moves together, leaves globals/history unchanged, rolls back conflicts and stale saves',async()=>{
  const {sqlite,db}=await fixture();try {
    await complete(db);const state=await readRosterState(db,'cup');let form=workspaceRosterForm(state);
    const alpha=form.entries.find(row=>row.id==='p1');const beta=form.entries.find(row=>row.id==='p6');alpha.team_id='beta';beta.team_id='alpha';alpha.ign='Tournament edit';
    await saveWorkspaceRoster(db,'cup',form);const updated=await readRosterState(db,'cup');assert.equal(updated.roster.ready,true);
    assert.deepEqual(updated.rows.find(row=>row[1]==='p1').slice(0,3),['beta','p1','Tournament edit']);
    assert.equal(sqlite.prepare("SELECT current_ign FROM players WHERE id='p1'").get().current_ign,'Current 1');
    await assert.rejects(saveWorkspaceRoster(db,'cup',form),e=>e.status===409);
    form=workspaceRosterForm(updated);form.entries.push({...form.entries[0],team_id:'beta'});await assert.rejects(saveWorkspaceRoster(db,'cup',form),/only once/);
    assert.equal((await readRosterState(db,'cup')).snapshot,updated.snapshot);
    form=workspaceRosterForm(updated);form.new_name='Workspace new';form.new_ign='Workspace IGN';form.new_uid='workspace-uid';form.team_id='alpha';form.intent='add-new';form=editWorkspaceRoster(form,updated);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM players WHERE uid='workspace-uid'").get().n,0);
    sqlite.exec("CREATE TRIGGER fail_workspace BEFORE INSERT ON tournament_rosters WHEN NEW.ign_snapshot='Workspace IGN' BEGIN SELECT RAISE(ABORT,'workspace failure');END");
    await assert.rejects(saveWorkspaceRoster(db,'cup',form));assert.equal((await readRosterState(db,'cup')).snapshot,updated.snapshot);assert.equal(sqlite.prepare("SELECT count(*) n FROM players WHERE uid='workspace-uid'").get().n,0);
    sqlite.exec('DROP TRIGGER fail_workspace');await saveWorkspaceRoster(db,'cup',form);
    const current=await readRosterState(db,'cup');form=workspaceRosterForm(current);form.remove_entry='0';form=editWorkspaceRoster(form,current);assert.equal(form.entries.length,current.rows.length-1);assert.equal((await readRosterState(db,'cup')).rows.length,current.rows.length);
  }finally{sqlite.close();}
});

test('participants do not persist prefill; latest usable roster drafts preserve reviewed snapshots and avoid conflicts',async()=>{
  const {sqlite,db}=await fixture();try {
    await complete(db);
    sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('older','Older','2026-09-01','2026-09-02','completed','single-elimination'),('future','Future','2026-12-01','2026-12-02','upcoming','single-elimination'); INSERT INTO tournament_teams VALUES('older','alpha'),('future','alpha'); INSERT INTO tournament_rosters VALUES('older','alpha','p11','Older IGN',1),('future','alpha','p12','Future IGN',1)");
    let state=await readParticipantState(db,'next');let form=participantForm(state);form.participants=[];await saveParticipants(db,'next',form);
    state=await readParticipantState(db,'next');form=participantForm(state);form.participants=[{id:'alpha'},{id:'beta'}];await saveParticipants(db,'next',form);
    let roster=await readRosterState(db,'next');assert.equal(roster.rows.length,0);const prefilling=workspaceRosterForm(roster);assert.equal(prefilling.entries.length,10);assert.equal(prefilling.entries.find(row=>row.id==='p1').ign,'Snapshot 1');assert.ok(!prefilling.entries.some(row=>['p11','p12'].includes(row.id)));
    let edit=workspaceRosterForm(roster);edit.entries[0].ign='Copied edit';await saveWorkspaceRoster(db,'next',edit);
    state=await readParticipantState(db,'next');await saveParticipants(db,'next',participantForm(state));assert.equal((await readRosterState(db,'next')).rows[0][2],'Copied edit');assert.equal((await readRosterState(db,'cup')).rows[0][2],'Snapshot 1');
    await save(db,'alpha',Array.from({length:5},(_,i)=>entry(i+1,'Source changed')));assert.equal((await readRosterState(db,'next')).rows[0][2],'Copied edit');
    state=await readParticipantState(db,'next');form=participantForm(state);form.participants=[{id:'beta'}];await saveParticipants(db,'next',form);
    roster=await readRosterState(db,'next');edit=workspaceRosterForm(roster);edit.entries.push({team_id:'beta',id:'p1',ign:'Retained',name:'',uid:''});await saveWorkspaceRoster(db,'next',edit);
    state=await readParticipantState(db,'next');form=participantForm(state);form.participants=[{id:'alpha'},{id:'beta'}];await saveParticipants(db,'next',form);
    roster=await readRosterState(db,'next');assert.equal(roster.rows.filter(row=>row[0]==='alpha').length,0);assert.equal(workspaceRosterForm(roster).entries.filter(row=>row.team_id==='alpha').length,4);assert.equal(roster.rows.find(row=>row[1]==='p1')[0],'beta');assert.equal(roster.roster.ready,false);
    sqlite.exec("INSERT INTO teams(id,name,tag,region) VALUES('legacy','Legacy','LEG','ID')");state=await readParticipantState(db,'next');form=participantForm(state);form.participants.push({id:'legacy'});await saveParticipants(db,'next',form);assert.equal((await readRosterState(db,'next')).rows.filter(row=>row[0]==='legacy').length,0);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{sqlite.close();}
});

for(const size of [32,64])test(`workspace parses all ${size} seven-player rosters and saves atomically; eighth player and invalid team/duplicate UID reject`,async()=>{
  const {sqlite,db}=await fixture();try {
    const setup=setupForm(await readSetup(db,'cup'));setup.bracket_size=String(size);await saveSetup(db,'cup',setup);
    for(let i=2;i<size;i++){sqlite.prepare('INSERT INTO teams(id,name,tag,region) VALUES(?,?,?,?)').run(`team-${i}`,`Team ${i}`,`T${i}`,'ID');sqlite.prepare('INSERT INTO tournament_teams VALUES(?,?)').run('cup',`team-${i}`);}
    let state=await readRosterState(db,'cup');let form=workspaceRosterForm(state);form.entries=state.participants.flatMap((team,t)=>Array.from({length:7},(_,p)=>({team_id:team.id,id:'',name:`Verification ${t}-${p}`,ign:`IGN ${t}-${p}`,uid:`unique-${t}-${p}`})));
    const body=new URLSearchParams({revision:form.revision,intent:'save'});form.entries.forEach((row,index)=>Object.entries(row).forEach(([key,value])=>body.set(`entries.${index}.${key}`,value)));
    const request=body=>new Request('http://localhost:4321/admin/tournaments/cup/roster',{method:'POST',headers:{origin:'http://localhost:4321','content-type':'application/x-www-form-urlencoded'},body});
    const parsed=await readWorkspaceRosterForm(request(body));assert.equal(parsed.entries.length,size*7);await saveWorkspaceRoster(db,'cup',parsed);state=await readRosterState(db,'cup');assert.equal(state.rows.length,size*7);assert.equal(state.roster.ready,true);
    form=workspaceRosterForm(state);form.entries[7].team_id=form.entries[0].team_id;await assert.rejects(saveWorkspaceRoster(db,'cup',form),/7 players/);
    form=workspaceRosterForm(state);form.entries[0].team_id='missing';await assert.rejects(saveWorkspaceRoster(db,'cup',form),/registered team/);
    for(const invalid of ['entries.448.id=x','entries.1.id=x','revision=a&revision=b','current_ign=global'])await assert.rejects(readWorkspaceRosterForm(request(invalid)));
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{sqlite.close();}
});

test('automatic prefill skips an unusable latest snapshot and chooses the earlier usable team roster without writes',async()=>{
 const {sqlite,db}=await fixture();try{
 sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('older','Older','2026-08-01','2026-08-02','completed','single-elimination'),('latest','Latest','2026-09-01','2026-09-02','completed','single-elimination');INSERT INTO tournament_teams VALUES('older','alpha'),('latest','alpha');");
 for(const id of ['older','latest'])for(let n=1;n<=5;n++)sqlite.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run(id,'alpha',`p${n}`,id==='latest'&&n===1?'\u200b':`Usable ${id} ${n}`,n);
 const state=await readRosterState(db,'cup');const draft=workspaceRosterForm(state);
 assert.equal(draft.entries.length,5);assert.equal(draft.entries[0].ign,'Usable older 1');assert.equal(state.rows.length,0);
 }finally{sqlite.close();}
});

test('mixed S1/S2 prefill uses latest team history and gives transferred players to the newer source independent of display order',async()=>{
 const {sqlite,db}=await fixture();try{
 sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('s1','S1','2026-08-01','2026-08-02','completed','single-elimination'),('s2','S2','2026-09-01','2026-09-02','completed','single-elimination');INSERT INTO tournament_teams VALUES('s1','alpha'),('s1','beta'),('s2','beta');");
 for(let n=1;n<=6;n++)sqlite.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('s1','alpha',`p${n}`,`S1 Alpha ${n}`,n);
 for(let n=11;n<=15;n++)sqlite.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('s1','beta',`p${n}`,`S1 Beta ${n}`,n-10);
 for(let n=5;n<=9;n++)sqlite.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('s2','beta',`p${n}`,`S2 Beta ${n}`,n-4);
 const state=await readRosterState(db,'cup');const draft=workspaceRosterForm(state);
 assert.equal(rosterCopySource(state,'alpha').entries.length,4);assert.equal(rosterCopySource(state,'beta').entries[0].ign,'S2 Beta 5');
 assert.deepEqual(draft.entries.filter(row=>row.team_id==='alpha').map(row=>row.id),['p1','p2','p3','p4']);
 assert.equal(draft.entries.filter(row=>row.team_id==='beta').length,5);assert.equal(new Set(draft.entries.map(row=>row.id)).size,9);
 assert.deepEqual(workspaceRosterForm({...state,participants:[...state.participants].reverse()}).entries,draft.entries);
 assert.equal(state.rows.length,0);assert.equal(state.roster.ready,false);
 sqlite.exec("DELETE FROM tournament_teams WHERE tournament_id='cup' AND team_id='beta'");
 const alone=workspaceRosterForm(await readRosterState(db,'cup'));assert.deepEqual(alone.entries.map(row=>row.id),['p1','p2','p3','p4']);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM tournament_rosters WHERE tournament_id='s1' AND team_id='alpha'").get().n,6);
 }finally{sqlite.close();}
});

test('partial current and latest historical rosters prefill without becoming ready or reverting to older larger rosters',async()=>{
 const {sqlite,db}=await fixture();try{
 sqlite.exec("UPDATE players SET current_team_id=NULL WHERE id NOT IN ('p1','p2','p3','p4')");
 let state=await readRosterState(db,'cup');assert.equal(workspaceRosterForm(state).entries.length,4);assert.equal(state.roster.ready,false);
 sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('s1','S1','2026-08-01','2026-08-02','completed','single-elimination'),('s2','S2','2026-09-01','2026-09-02','completed','single-elimination');INSERT INTO tournament_teams VALUES('s1','alpha'),('s2','alpha');");
 for(let n=1;n<=6;n++)sqlite.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('s1','alpha',`p${n}`,`S1 ${n}`,n);
 for(let n=1;n<=3;n++)sqlite.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('s2','alpha',`p${n}`,`S2 ${n}`,n);
 state=await readRosterState(db,'cup');const draft=workspaceRosterForm(state);assert.equal(draft.entries.length,3);assert.ok(draft.entries.every(row=>row.ign.startsWith('S2 ')));assert.equal(state.rows.length,0);assert.equal(state.roster.ready,false);
 }finally{sqlite.close();}
});
