import {testAdminDatabase} from './helpers/admin-database.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { readSetup, setupForm, saveSetup } from '../src/admin/setup.mjs';
import { readParticipantState, participantForm, validateParticipantRows, editParticipantForm, saveParticipants, readParticipantForm } from '../src/admin/participants.mjs';
async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
 sqlite.exec(readFileSync('migrations/0001_initial_schema.sql','utf8')); sqlite.exec(readFileSync('migrations/0003_tournament_rosters.sql','utf8'));
  sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('test-cup','Test Cup','2026-01-01','2026-01-01','upcoming','single-elimination'); INSERT INTO teams(id,name,tag,region) VALUES('alpha','Alpha','ALP','ID'),('beta','Beta','BET','ID')");
  const rawDb={ hook:null, prepare(sql) { let values=[]; return { sql, bind(...args) {values=args;return this;}, async all() { const args=/\?\d/.test(sql)?[Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]))]:values; return {success:true,results:sqlite.prepare(sql).all(...args)}; } }; }, async batch(statements) {
    if (statements.some(s=>s.sql.startsWith('UPDATE tournaments')) && this.hook) { const hook=this.hook; this.hook=null;hook(); }
    sqlite.exec('BEGIN'); try { const results=[]; for (const s of statements) results.push(await s.all()); sqlite.exec('COMMIT'); return results; } catch(error) {sqlite.exec('ROLLBACK');throw error;}
  }};
sqlite.exec(readFileSync('migrations/0010_admin_audit_log.sql','utf8'));
const db=testAdminDatabase(rawDb,sqlite);

  await saveSetup(db,'test-cup',setupForm(await readSetup(db,'test-cup')));
  return {sqlite,db};
}
const existing = id => ({id,name:'injected display',tag:'injected',region:'xx'});
const fresh = (name='Gamma') => ({id:'',name,tag:'GAM',region:'ID'});
test('existing/new participant drafts add and remove without DB writes, bounded by bracket size', async()=>{
  const {sqlite,db}=await fixture(); try {
    const state=await readParticipantState(db,'test-cup'); let form=participantForm(state);
    form.intent='add-existing'; form.team_id='alpha'; await editParticipantForm(form,state);
    assert.equal(form.participants[0].name,'Alpha'); form.intent='add-new';form.new_name='  Gamma  ';form.new_tag='GAM';
    await editParticipantForm(form,state); assert.equal(form.participants[1].name,'Gamma'); assert.equal(form.participants[1].id,'');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM teams').get().n,2); assert.equal((await readParticipantState(db,'test-cup')).participants.length,0);
    form.remove_participant='0'; await editParticipantForm(form,state);assert.equal(form.participants.length,1);
    const full={...state,stage:[...state.stage]}; full.stage[3]=2;
    await assert.rejects(validateParticipantRows([existing('alpha'),existing('beta'),fresh()],full),/bracket size/);
    await assert.rejects(validateParticipantRows([existing('alpha'),existing('alpha')],state),/only once/);
    await assert.rejects(validateParticipantRows([fresh(),fresh()],state),/only once/);
    await assert.rejects(validateParticipantRows([fresh('ALPHA')],state),e=>e.status===409);
    await assert.rejects(validateParticipantRows([fresh('Spaced Team')],{...state,teams:[...state.teams,{id:'legacy-team-id',name:'  Spaced   Team ',tag:'OLD',region:'ID'}]}),e=>e.status===409);
    await assert.rejects(validateParticipantRows([existing('missing')],state),/no longer exists/);
    for(const patch of [{name:'ab'},{name:'Bad\nName'},{tag:''},{tag:'x'.repeat(21)},{region:''}]) await assert.rejects(validateParticipantRows([{...fresh(),...patch}],state));
  }finally{sqlite.close();}
});
test('saving creates teams and memberships atomically; reload, removal, and partial brackets preserve global teams and omit BYEs/rosters',async()=>{
  const {sqlite,db}=await fixture();try {
    let form=participantForm(await readParticipantState(db,'test-cup'));form.participants=[existing('alpha'),fresh("Gamma ' Club")];
    assert.equal(await saveParticipants(db,'test-cup',form),2);
    let state=await readParticipantState(db,'test-cup');assert.deepEqual(state.participants.map(t=>t.id),['alpha','gamma-club']);assert.equal(state.participants[0].name,'Alpha');
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tournament_byes').get().n,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM matches').get().n,0);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM players').get().n,0);
    await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);
    form=participantForm(state);form.participants=[existing('beta'),existing('gamma-club')];await saveParticipants(db,'test-cup',form);
    state=await readParticipantState(db,'test-cup');assert.deepEqual(state.participants.map(t=>t.id),['beta','gamma-club']); assert.equal(sqlite.prepare("SELECT count(*) AS n FROM teams WHERE id='alpha'").get().n,1);
    const before=state.snapshot;const failure=participantForm(state);failure.participants=[existing('alpha'),fresh('Rollback Team')];
    sqlite.exec("CREATE TRIGGER fail_participant BEFORE INSERT ON tournament_teams WHEN NEW.team_id='rollback-team' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    await assert.rejects(saveParticipants(db,'test-cup',failure));assert.equal((await readParticipantState(db,'test-cup')).snapshot,before);assert.equal(sqlite.prepare("SELECT count(*) AS n FROM teams WHERE id='rollback-team'").get().n,0);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{sqlite.close();}
});
test('stale setup, concurrent changes and new-team collisions cannot overwrite saved membership',async()=>{
  const {sqlite,db}=await fixture();try {
    let form=participantForm(await readParticipantState(db,'test-cup'));form.participants=[existing('alpha'),existing('beta')];
    db.hook=()=>sqlite.exec("UPDATE tournament_stages SET bracket_size=8 WHERE tournament_id='test-cup'");
    await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);assert.equal((await readParticipantState(db,'test-cup')).participants.length,0);
    form=participantForm(await readParticipantState(db,'test-cup'));form.participants=[existing('alpha'),fresh('Concurrent Team')];
    db.hook=()=>sqlite.exec("INSERT INTO teams(id,name,tag,region) VALUES('concurrent-team','Concurrent Team','OTH','ID')");
    await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);assert.equal((await readParticipantState(db,'test-cup')).participants.length,0);
    form=participantForm(await readParticipantState(db,'test-cup'));form.participants=[existing('alpha'),existing('beta')];
    sqlite.exec("UPDATE tournament_stages SET action_seconds=25");await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);
  }finally{sqlite.close();}
});
test('unprepared, started, matched, and BYE brackets reject all participant writes',async()=>{
  const {sqlite,db}=await fixture();try {
    let state=await readParticipantState(db,'test-cup');let form=participantForm(state);form.participants=[existing('alpha'),existing('beta')];
    await saveParticipants(db,'test-cup',{...form,participants:[]});
    state=await readParticipantState(db,'test-cup'); assert.equal(state.participants.length,0); form=participantForm(state);
    sqlite.exec("INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status) VALUES('m','test-cup','playoffs','top-16',1,'2026-01-01','upcoming')");
    assert.equal((await readParticipantState(db,'test-cup')).locked,true);await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);
    sqlite.exec("DELETE FROM matches; INSERT INTO tournament_byes VALUES('test-cup','playoffs','bye','top-16',1,'alpha')");await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);
    sqlite.exec("DELETE FROM tournament_byes; UPDATE tournaments SET status='ongoing'");await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);
    sqlite.exec("UPDATE tournaments SET status='upcoming';DELETE FROM tournament_stages");state=await readParticipantState(db,'test-cup');assert.equal(state.ready,false);await assert.rejects(saveParticipants(db,'test-cup',form),e=>e.status===409);
  }finally{sqlite.close();}
});
test('participant POSTs enforce Origin, exact fields, indices, duplicate keys and body limits',async()=>{
  const req=(body,headers={})=>new Request('http://localhost:4321/admin/tournaments/test-cup/participants',{method:'POST',headers:{origin:'http://localhost:4321','content-type':'application/x-www-form-urlencoded',...headers},body});
  assert.equal((await readParticipantForm(req('participants.0.id=alpha&revision=abc'))).participants[0].id,'alpha');
  for(const body of ['participants.1.id=alpha','participants.256.id=alpha','revision=a&revision=b','winner_team_id=alpha','players.0.id=alpha'])await assert.rejects(readParticipantForm(req(body)));
  await assert.rejects(readParticipantForm(req('revision=abc',{origin:'https://evil.example'})),e=>e.status===403);
  await assert.rejects(readParticipantForm(req('revision=abc',{'content-type':'application/json'})),e=>e.status===415);
  await assert.rejects(readParticipantForm(req('x'.repeat(524289))),e=>e.status===413);
});
