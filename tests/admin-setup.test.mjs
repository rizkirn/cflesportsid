import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cfgTemplate, readSetup, setupForm, validateSetup, saveSetup, readSetupForm, eliminationRounds } from '../src/admin/setup.mjs';
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0001_initial_schema.sql', 'utf8'));
  sqlite.exec("INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('test-cup','Test Cup','2026-01-01','2026-01-01','upcoming','single-elimination')");
  const db = { hook: null, prepare(sql) {
    let values = [];
    return { bind(...v) { values=v; return this; }, async all() {
      const args = /\?\d/.test(sql) ? [Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]))] : values;
      return { success:true, results: sqlite.prepare(sql).all(...args) };
    } };
  }, async batch(statements) {
    if (statements.length > 2 && this.hook) { const hook=this.hook; this.hook=null; hook(); }
    sqlite.exec('BEGIN');
    try { const result=[]; for (const stmt of statements) result.push(await stmt.all()); sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { sqlite, db };
}
test('Clash for Glory defaults and editable bracket validation match the lifecycle', () => {
  const v=validateSetup(structuredClone(cfgTemplate));
  assert.equal(v.bracket_size,16); assert.equal(v.action_seconds,20); assert.equal(v.reserve_seconds,90);
  assert.deepEqual(v.rounds.map(r=>[r.name,r.placement]), [['Top 16',null],['Quarter Final',null],['Semi Final',null],['Bronze Match',3],['Final',1]]);
  for (const patch of [{ bracket_size:'15' },{map_count:'2'},{action_seconds:'0'},{reserve_seconds:'Infinity'},{format:'double-elimination'},{series_type:'best-of'},{final_map_rule:'pick'},{stage_name:'Bad\nName'}]) assert.throws(()=>validateSetup({...structuredClone(cfgTemplate),...patch}));
  const tampered=structuredClone(cfgTemplate); tampered.rounds=[{id:'fake',name:'Fake',sort_order:'1',placement:'1'}]; assert.deepEqual(validateSetup(tampered).rounds,v.rounds);
  for (const [size,names] of [[4,['Semi Final','Final']],[8,['Quarter Final','Semi Final','Final']],[16,['Top 16','Quarter Final','Semi Final','Final']],[32,['Top 32','Top 16','Quarter Final','Semi Final','Final']],[64,['Top 64','Top 32','Top 16','Quarter Final','Semi Final','Final']]]) {
    assert.deepEqual(eliminationRounds(size).map(r=>r.name),names);
    assert.equal(validateSetup({...structuredClone(cfgTemplate),bracket_size:String(size),bronze_match:''}).rounds.length,names.length);
    assert.deepEqual(eliminationRounds(size,true).slice(-2).map(r=>r.placement),['3','1']);
  }
  for (const size of ['2','128','256']) assert.throws(()=>validateSetup({...structuredClone(cfgTemplate),bracket_size:size}));
  const smaller=structuredClone(cfgTemplate); smaller.bracket_size='8'; smaller.rounds.shift(); smaller.rounds.forEach((r,i)=>r.sort_order=String(i+1)); assert.equal(validateSetup(smaller).bracket_size,8);
});
test('atomic save, reload, stable round IDs and stale-tab protection use the real schema', async () => {
  const {sqlite,db}=fixture();
  try {
    const form=setupForm(await readSetup(db,'test-cup')); await saveSetup(db,'test-cup',form);
    let state=await readSetup(db,'test-cup'); assert.equal(state.state.rounds.length,5); assert.equal(state.state.stages[0][3],16);
    await assert.rejects(saveSetup(db,'test-cup',form),e=>e.status===409);
    const updated=setupForm(state); updated.stage_name='Championship'; updated.rounds[0].name='Opening round';
    await saveSetup(db,'test-cup',updated); state=await readSetup(db,'test-cup');
    assert.equal(state.state.rounds[0][1],'top-16'); assert.equal(state.state.rounds[0][2],'Top 16');
    assert.equal(state.state.stages[0][1],'Championship'); assert.equal(state.state.rounds.length,5);
    const concurrent=setupForm(state); db.hook=()=>sqlite.exec("UPDATE tournament_stages SET name='Another tab' WHERE tournament_id='test-cup'");
    await assert.rejects(saveSetup(db,'test-cup',concurrent),e=>e.status===409);
    assert.equal((await readSetup(db,'test-cup')).state.stages[0][1],'Another tab');
    const before=await readSetup(db,'test-cup');
    sqlite.exec("CREATE TRIGGER fail_round BEFORE INSERT ON tournament_rounds BEGIN SELECT RAISE(ABORT,'test round failure'); END");
    const fail=setupForm(before); fail.stage_name='Must roll back'; await assert.rejects(saveSetup(db,'test-cup',fail));
    assert.equal((await readSetup(db,'test-cup')).snapshot,before.snapshot);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { sqlite.close(); }
});
test('started and multiple-stage tournaments cannot be rewritten', async () => {
  const {sqlite,db}=fixture();
  try {
    await saveSetup(db,'test-cup',setupForm(await readSetup(db,'test-cup')));
    sqlite.exec("UPDATE tournaments SET status='ongoing' WHERE id='test-cup'");
    let state=await readSetup(db,'test-cup'); assert.equal(state.locked,true); await assert.rejects(saveSetup(db,'test-cup',setupForm(state)),e=>e.status===409);
    sqlite.exec("UPDATE tournaments SET status='upcoming'; INSERT INTO tournament_stages SELECT tournament_id,'other',name,format,bracket_size,series_type,map_count,final_map_rule,action_seconds,reserve_seconds FROM tournament_stages");
    state=await readSetup(db,'test-cup'); assert.equal(state.locked,true); await assert.rejects(saveSetup(db,'test-cup',setupForm(state)),e=>e.status===409);
  } finally { sqlite.close(); }
});
test('setup parser enforces CSRF, generated rounds and bounded fields', async () => {
  const req=(body,origin='http://localhost:4321')=>new Request('http://localhost:4321/admin/tournaments/test-cup/setup',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body});
  const params=new URLSearchParams({stage_id:'playoffs',revision:'test',bracket_size:'4',bronze_match:'1'});
  assert.equal((await readSetupForm(req(params))).bronze_match,'1');
  await assert.rejects(readSetupForm(req(params,'https://evil.example')),e=>e.status===403);
  for (const body of ['stage_id=a&stage_id=b','DB=production','rounds.0.name=bad','remove_round=0']) await assert.rejects(readSetupForm(req(body)));
  await assert.rejects(readSetupForm(req('x'.repeat(16385))),e=>e.status===413);
});
test('existing map pool and veto survive edits; matches and byes prevent destructive round replacement', async () => {
  const {sqlite,db}=fixture();
  try {
    await saveSetup(db,'test-cup',setupForm(await readSetup(db,'test-cup')));
    sqlite.exec("INSERT INTO maps(id,name) VALUES('map-a','Map A'); INSERT INTO stage_map_pool VALUES('test-cup','playoffs','map-a',1); INSERT INTO veto_steps VALUES('test-cup','playoffs',1,'A','ban')");
    let form=setupForm(await readSetup(db,'test-cup')); form.action_seconds='25'; await saveSetup(db,'test-cup',form);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM stage_map_pool').get().n,1);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM veto_steps').get().n,1);
    sqlite.exec("INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status) VALUES('match-a','test-cup','playoffs','top-16',1,'2026-01-01','upcoming')");
    let state=await readSetup(db,'test-cup'); assert.equal(state.locked,true);
    await assert.rejects(saveSetup(db,'test-cup',setupForm(state)),e=>e.status===409);
    sqlite.exec("DELETE FROM matches; INSERT INTO teams(id,name,tag,region) VALUES('team-a','Team A','A','ID'); INSERT INTO tournament_byes VALUES('test-cup','playoffs','bye-a','top-16',1,'team-a')");
    state=await readSetup(db,'test-cup'); assert.equal(state.locked,true);
    await assert.rejects(saveSetup(db,'test-cup',setupForm(state)),e=>e.status===409);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM tournament_byes').get().n,1);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { sqlite.close(); }
});
