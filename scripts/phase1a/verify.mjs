import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkData } from '../data-tools.mjs';
import { compareStatistics, loadLegacyStatistics, plain } from '../d1-parity.mjs';
import { compareReadMatches } from '../d1-read-parity.mjs';
import { matchReadQueries, shapeD1Matches } from '../../src/data-access/matches.mjs';
import { statisticalProfiles } from '../../src/utils/player-continuity.mjs';
import { validateDetails } from '../../src/admin/match-details.mjs';
import { readLiveResults, saveLiveResult } from '../../src/admin/live-results.mjs';
import { testAdminDatabase } from '../../tests/helpers/admin-database.mjs';
import ts from 'typescript';
import vm from 'node:vm';
import { inventory, sha, validateEnvironment } from './safety.mjs';
import {initializePublicFixtures,verifyPublicHistorical,verifyPublicEdges} from './phase1b.mjs';

const root = process.env.CFL_PHASE1A_ROOT;
assert.ok(root, 'Only the isolated controller may launch this verifier');
const marker = JSON.parse(readFileSync(join(root,'ownership.json'),'utf8'));
validateEnvironment(root,marker.repo,marker,JSON.parse(readFileSync(join(root,'wrangler.json'),'utf8')));
for(const key of Object.keys(process.env)) assert.ok(!/^(CLOUDFLARE|CF_API|CF_ACCOUNT|CF_EMAIL|WRANGLER_API)/.test(key),'Credential/environment override forbidden');
assert.ok(!existsSync(join(root,'state')), 'Initialization requires a fresh persistence directory');
execFileSync(process.execPath,[join(root,'probe.mjs')],{cwd:root,env:process.env,stdio:'pipe'});
const report={phase:marker.phase??'1A', status:'running', root, sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:marker.repo,encoding:'utf8'}).trim(), checks:[], limitations:[]};
function check(name,fn){fn();report.checks.push({name,status:'PASS'});}
function save(){writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));}
const sqliteFiles=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sqliteFiles(join(path,e.name)):e.name.endsWith('.sqlite')&&e.name!=='metadata.sqlite'?[join(path,e.name)]:[]);
let sql;
try {
  for(const [name,hash] of Object.entries(marker.migrations)) assert.equal(sha(readFileSync(join(root,'migrations',name))),hash);
  execFileSync(process.execPath,[join(marker.repo,'node_modules/wrangler/bin/wrangler.js'),'d1','migrations','apply','cfl-phase1a-disposable','--local','--config',join(root,'wrangler.json'),'--persist-to',join(root,'state')],{cwd:root,env:process.env,encoding:'utf8',input:'y\n',maxBuffer:8*1024*1024});
  const files=sqliteFiles(join(root,'state'));assert.equal(files.length,1);
  sql=new DatabaseSync(files[0]);sql.exec('PRAGMA foreign_keys=ON');
  const migrations=Object.keys(marker.migrations);
  check('migration ledger 0001–'+(['1B','1C'].includes(marker.phase)?'0011':'0010'),()=>assert.deepEqual(sql.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(r=>r.name),migrations));
  const expected=new DatabaseSync(':memory:');for(const name of migrations)expected.exec(readFileSync(join(root,'migrations',name),'utf8'));
  check('schema definitions, indexes, triggers and views',()=>{
    const objects=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN('_cf_KV','_cf_METADATA','d1_migrations') ORDER BY type,name").all().map(r=>({...r,sql:r.sql?.replace(/\s+/g,' ').trim()}));
    assert.deepEqual(objects(sql),objects(expected));
    for(const {name} of expected.prepare("SELECT name FROM sqlite_master WHERE type='table'").all())assert.deepEqual(sql.prepare(`PRAGMA table_info(${name})`).all(),expected.prepare(`PRAGMA table_info(${name})`).all());
  });expected.close();
  const generator=join(root,'fixture-generator');mkdirSync(join(generator,'scripts'),{recursive:true});mkdirSync(join(generator,'src'));
  cpSync(join(marker.repo,'src/data'),join(generator,'src/data'),{recursive:true});
  cpSync(join(marker.repo,'scripts/generate-d1-seed.mjs'),join(generator,'scripts/generate-d1-seed.mjs'));
  execFileSync(process.execPath,[join(generator,'scripts/generate-d1-seed.mjs')],{cwd:generator,env:process.env,stdio:'pipe'});
  sql.exec(readFileSync(join(generator,'.generated/seed-s1-s2.sql'),'utf8'));
  const {data,errors,warnings}=checkData(join(generator,'src/data'));assert.equal(errors.length,0);assert.equal(warnings.length,0);
  const legacy=loadLegacyStatistics(), legacyMatches=[...data.matches.values()];
  const tables=['teams','players','maps','tournaments','matches','match_maps','match_sources','player_match_entries','player_round_stats','tournament_byes','tournament_stages','tournament_rounds','tournament_teams','stage_map_pool','veto_steps','team_penalties','tournament_rosters'];
  const read=()=>Object.fromEntries(tables.map(t=>[t,sql.prepare('SELECT * FROM '+t).all()]));
  const historical=read();
  const counts={teams:19,players:127,maps:11,tournaments:2,matches:26,match_maps:78,player_match_entries:258,player_round_stats:712,match_sources:32,tournament_byes:6,tournament_stages:2,tournament_rounds:10,tournament_teams:26,stage_map_pool:21,veto_steps:16,team_penalties:1};
  check('historical entity and child counts',()=>{for(const [t,n] of Object.entries(counts))assert.equal(historical[t].length,n,t);});
  check('historical foreign key integrity',()=>assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]));
  const parity=compareStatistics(data,historical);
  check('historical import and independent D1 statistics parity',()=>assert.deepEqual(parity.mismatches,[]));
  const hybrid=shapeD1Matches(matchReadQueries.map(q=>sql.prepare(q).all()),legacyMatches);
  check('historical match projection',()=>assert.deepEqual(compareReadMatches(legacyMatches,hybrid),[]));
  const standalone=()=>shapeD1Matches(matchReadQueries.map(q=>sql.prepare(q).all()),[]);
  function expanded(matches,tid){const result=legacy.calculateStatistics(matches.filter(m=>!tid||m.data.tournamentId===tid));for(const p of statisticalProfiles([...data.players.values()]))if(!result.players.has(p.id))result.players.set(p.id,legacy.emptyStats());for(const kind of ['teams','maps'])for(const id of data[kind].keys())if(!result[kind].has(id))result[kind].set(id,kind==='maps'?legacy.emptyMapStats():legacy.emptyStats());return plain(result);}
  for(const tid of [...data.tournaments.keys(),null])check(`D1-only projection statistics including zero profiles: ${tid??'overall'}`,()=>assert.deepEqual(expanded(standalone(),tid),expanded(legacyMatches,tid)));
  check('historical BYEs and feeder relationships',()=>{
    const byes=[...data.tournaments.values()].flatMap(t=>t.data.stages.flatMap(s=>s.byes.map(b=>({tournament_id:t.id,stage_id:s.id,id:b.id,round_id:b.roundId,slot:b.slot,team_id:b.teamId}))));
    const sorted=rows=>rows.map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).sort()))).sort();assert.deepEqual(sorted(historical.tournament_byes),sorted(byes));
    const sources=legacyMatches.flatMap(m=>[1,2].flatMap(side=>{const s=m.data[`team${side}Source`];return s?[{match_id:m.id,side,source_type:s.type,source_match_id:s.matchId??null,source_bye_id:s.byeId??null}]:[]}));assert.deepEqual(sorted(historical.match_sources),sorted(sources));
    assert.equal(sql.prepare("SELECT count(*) n FROM match_sources s JOIN matches m ON m.id=s.match_id JOIN matches p ON p.id=s.source_match_id WHERE m.tournament_id<>p.tournament_id OR m.stage_id<>p.stage_id").get().n,0);
  });
  const registrations=[];
  for(const [tid,rev] of [['clash-for-glory-s1','b126ef03babd172fc0465f737453a483eae76634'],['clash-for-glory-s2',report.sourceCommit]]){
    const gitJSON=path=>JSON.parse(execFileSync('git',['show',rev+':'+path],{cwd:marker.repo,encoding:'utf8'}));
    for(const team of gitJSON('src/data/tournaments/'+tid+'.json').teams)for(const uid of gitJSON('src/data/teams/'+team+'.json').players){const player=gitJSON('src/data/players/'+uid+'.json');registrations.push({tournament_id:tid,team_id:team,uid,ign:player.ign,sourceRevision:rev});}
  }
  writeFileSync(join(root,'fixtures/registrations.json'),JSON.stringify(registrations,null,2));
  check('registration membership evidence without assumed positions',()=>{
    assert.equal(registrations.filter(r=>r.tournament_id.endsWith('s1')).length,85);assert.equal(registrations.filter(r=>r.tournament_id.endsWith('s2')).length,83);
    for(const e of historical.player_match_entries){const match=historical.matches.find(m=>m.id===e.match_id);const registration=registrations.find(r=>r.tournament_id===match.tournament_id&&r.uid===e.uid_snapshot&&r.team_id===e.team_id);assert.ok(registration);if(e.ign_snapshot!==null)assert.equal(registration.ign,e.ign_snapshot);}
    assert.ok(registrations.every(r=>!('position' in r)));
  });
  if(['1B','1C'].includes(marker.phase)){initializePublicFixtures(sql,registrations);historical.tournament_rosters=sql.prepare('SELECT * FROM tournament_rosters').all();}
  report.rosterOrdering={status:'UNVERIFIED',historicalDatabaseRows:historical.tournament_rosters.length,reason:'No approved offline authoritative D1 positions supplied. Registration membership evidence is retained separately; no historical positions invented.'};
  report.limitations.push(['1B','1C'].includes(marker.phase)?'Historical roster positions remain NULL; membership is stored in D1 and ordering is explicitly unverified.':'Historical tournament_rosters are not loaded; authoritative D1 positions need an approved offline fixture before snapshot-order parity can pass.');
  report.historical={counts,scopes:parity.scopes,publicProfiles:128,registrationMemberships:168,hybridProjectionMismatches:0};
  writeFileSync(join(root,'baseline.json'),JSON.stringify({sourceCommit:report.sourceCommit,migrations:marker.migrations,historical:report.historical,rosterOrdering:report.rosterOrdering},null,2));
  if(['1B','1C'].includes(marker.phase))report.publicHistorical=await verifyPublicHistorical(sql,data,legacy,registrations);
  sql.exec('SAVEPOINT synthetic');
  sql.exec(`INSERT INTO teams(id,name,tag,region) VALUES('fx-a','Fixture Alpha','FXA','ID'),('fx-b','Fixture Beta','FXB','ID');
    INSERT INTO maps(id,name) VALUES('fx-map1','Fixture map 1'),('fx-map2','Fixture map 2');
    INSERT INTO tournaments(id,name,start_date,end_date,status,format,is_test) VALUES('fx-official','Fixture official','2027-01-01','2027-01-02','ongoing','single-elimination',0),('fx-test','Fixture test','2027-01-01','2027-01-02','ongoing','single-elimination',1);`);
  for(const tid of ['fx-official','fx-test']){
    sql.prepare("INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count) VALUES(?,'stage','Fixture stage','single-elimination',4,'fixed-maps',3)").run(tid);
    sql.prepare("INSERT INTO tournament_rounds VALUES(?,'stage','semi','Fixture semi',1,NULL)").run(tid);sql.prepare("INSERT INTO tournament_rounds VALUES(?,'stage','final','Fixture final',2,1)").run(tid);
    for(const team of ['fx-a','fx-b'])sql.prepare('INSERT INTO tournament_teams VALUES(?,?)').run(tid,team);
    for(const map of ['fx-map1','fx-map2'])sql.prepare("INSERT INTO stage_map_pool VALUES(?,'stage',?,?)").run(tid,map,map.endsWith('1')?1:2);
  }
  for(const team of ['a','b'])for(let i=1;i<=6;i++){
    const id=`fx-${team}${i}`;sql.prepare('INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES(?,?,?,?,?)').run(id,`fixture-uid-${team}${i}`,id,`Fixture ${team}${i}`,`fx-${team}`);
    sql.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('fx-official',`fx-${team}`,id,`Snapshot ${team}${i}`,i);
  }
  const insertMatch=(id,tid,round,slot,status,winner,result='played')=>sql.prepare("INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id,team2_id,score1,score2,winner_id,result_type) VALUES(?,?,'stage',?,?,'2027-01-01',?,'fx-a','fx-b',?,?,?,?)").run(id,tid,round,slot,status,result==='walkover'?0:status==='completed'?2:0,result==='walkover'?0:status==='completed'?1:0,winner,result);
  insertMatch('fx-full','fx-official','semi',1,'completed','fx-a','walkover');
  insertMatch('fx-mixed','fx-official','semi',2,'completed','fx-a');
  insertMatch('fx-next','fx-official','final',1,'upcoming',null);
  insertMatch('fx-private','fx-test','semi',1,'completed','fx-a');
  sql.exec("INSERT INTO tournament_byes VALUES('fx-official','stage','fx-bye','semi',3,'fx-b');INSERT INTO match_sources VALUES('fx-next',1,'winner','fx-full',NULL),('fx-next',2,'loser','fx-mixed',NULL)");
  const rows=()=>sql.prepare("SELECT r.*,p.uid FROM tournament_rosters r JOIN players p ON p.id=r.player_id WHERE tournament_id='fx-official' ORDER BY team_id,position").all();
  let roster=rows();
  const payload={maps:[0,1,2].map(i=>({mode:i===1?'walkover':'played',winner_side:i===1?'2':'',map_id:i===1?'fx-map2':'fx-map1',score1:i===1?'':'7',score2:i===1?'':'2',mvp:i===1?'':'fx-a6',players:roster.map(r=>({player_id:r.player_id,kills:i===1||r.player_id==='fx-a1'||r.player_id==='fx-b6'?'':'3',deaths:i===1||r.player_id==='fx-a1'||r.player_id==='fx-b6'?'':'2',assists:i===1||r.player_id==='fx-a1'||r.player_id==='fx-b6'?'':'1'}))}))};
  check('explicit participation includes position 6 and excludes position 1',()=>validateDetails(payload,{match:{team1_id:'fx-a',team2_id:'fx-b',score1:2,score2:1},rows:roster,pool:[{id:'fx-map1'},{id:'fx-map2'}]},true));
  sql.exec("INSERT INTO match_maps(match_id,map_number,map_id,winner_team_id,mvp_player_id) VALUES('fx-mixed',1,'fx-map1','fx-a','fx-a6'),('fx-mixed',3,'fx-map1','fx-a','fx-a6');INSERT INTO match_map_walkovers VALUES('fx-mixed',2,'fx-map2','fx-b')");
  for(const [index,r] of roster.entries())if(!['fx-a1','fx-b6'].includes(r.player_id)){
    sql.prepare('INSERT INTO player_match_entries VALUES(?,?,?,?,?,?)').run('fx-mixed',index,r.player_id,r.team_id,r.uid,r.ign_snapshot);
    for(const [ri,map] of [1,3].entries())sql.prepare('INSERT INTO player_round_stats VALUES(?,?,?,?,?,?,?)').run('fx-mixed',index,ri,map,3,2,1);
  }
  sql.exec("INSERT INTO player_match_entries VALUES('fx-mixed',20,NULL,'fx-a',NULL,'Anonymous fixture'),('fx-mixed',21,NULL,NULL,NULL,NULL);INSERT INTO player_round_stats VALUES('fx-mixed',20,0,NULL,4,2,1)");
  const fixtureStats=()=>legacy.calculateStatistics(standalone().filter(m=>m.id.startsWith('fx-')));
  check('full-match and map walkovers have no invented combat or MVPs',()=>{const stats=fixtureStats();assert.equal(stats.totals.matchesPlayed,3);assert.equal(stats.totals.mapsPlayed,2);assert.equal(stats.totals.kills,64);assert.equal(stats.totals.mvpCount,2);assert.equal(stats.totals.unassignedPlayerRounds,1);assert.equal(stats.players.get('fixture-uid-a6').mvpCount,2);assert.throws(()=>sql.exec("INSERT INTO player_match_entries VALUES('fx-full',0,NULL,NULL,NULL,NULL)"));assert.throws(()=>sql.exec("INSERT INTO player_round_stats VALUES('fx-mixed',0,3,2,1,1,1)"));});
  check('D1-only catalog and UID/primary-key mapping',()=>{assert.ok(!data.players.has('fx-a6'));const m=standalone().find(m=>m.id==='fx-mixed');assert.equal(m.data.roundDetails[0].mvp,'fixture-uid-a6');assert.ok(m.data.playerStats.some(p=>p.playerId==='fx-a6'&&p.uid==='fixture-uid-a6'));assert.ok(m.data.playerStats.some(p=>p.uid===null));assert.ok(sql.prepare("SELECT id FROM maps WHERE id='fx-map1'").get());});
  check('BYE and winner/loser source projections',()=>{const m=standalone().find(m=>m.id==='fx-next');assert.deepEqual(m.data.team1Source,{type:'winner',matchId:'fx-full'});assert.deepEqual(m.data.team2Source,{type:'loser',matchId:'fx-mixed'});assert.equal(sql.prepare("SELECT team_id FROM tournament_byes WHERE id='fx-bye'").get().team_id,'fx-b');});
  check('application BYE and feeder resolution',()=>{
    const context={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(join(marker.repo,'src/utils/tournament.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
    const matches=standalone(), target=matches.find(m=>m.id==='fx-next');
    const tournament={data:{stages:[{id:'stage',byes:[{id:'fx-bye',teamId:'fx-b'}]}]}};
    assert.equal(context.exports.resolveSourceTeam(target,1,tournament,matches),'fx-a');assert.equal(context.exports.resolveSourceTeam(target,2,tournament,matches),'fx-b');
    const byeTarget=structuredClone(target);byeTarget.data.team1Source={type:'bye',byeId:'fx-bye'};assert.equal(context.exports.resolveSourceTeam(byeTarget,1,tournament,matches),'fx-b');
  });
  check('test-tournament verification selector excludes synthetic test matches',()=>{const allowed=new Set(sql.prepare('SELECT id FROM tournaments WHERE is_test=0').all().map(t=>t.id));const publicMatches=standalone().filter(m=>allowed.has(m.data.tournamentId));assert.ok(!publicMatches.some(m=>m.id==='fx-private'));assert.equal(standalone().filter(m=>m.id==='fx-private').length,1);});
  const savedOrder=roster.map(r=>r.player_id), beforeStats=plain(fixtureStats());
  check('saved synthetic D1 ordering is read unchanged',()=>assert.deepEqual(rows().map(r=>r.player_id),savedOrder));
  check('roster permutation preserves identity, participation, statistics and MVPs',()=>{
    for(const team of ['fx-a','fx-b']){const entries=roster.filter(r=>r.team_id===team);sql.prepare('DELETE FROM tournament_rosters WHERE tournament_id=? AND team_id=?').run('fx-official',team);entries.reverse().forEach((r,i)=>sql.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run('fx-official',team,r.player_id,r.ign_snapshot,i+1));}
    assert.notDeepEqual(rows().map(r=>r.player_id),savedOrder);assert.deepEqual(plain(fixtureStats()),beforeStats);
    validateDetails(payload,{match:{team1_id:'fx-a',team2_id:'fx-b',score1:2,score2:1},rows:rows(),pool:[{id:'fx-map1'},{id:'fx-map2'}]},true);
    const membership=rs=>rs.map(r=>[r.team_id,r.player_id,r.ign_snapshot].join('|')).sort();assert.deepEqual(membership(rows()),membership(roster));
  });
  check('historical transfer segmentation uses tournament and match-time team',()=>{
    const match=(tid,team)=>({id:tid,data:{tournamentId:tid,status:'completed',team1Id:team,team2Id:'fx-b',winnerId:team,score1:3,score2:0,roundDetails:[{round_number:1,mapId:'fx-map1',mvp:'1345266890'}],playerStats:[{uid:'1345266890',teamId:team,rounds:[{round_number:1,kills:5,deaths:2,assists:1}]}]}});
    const stats=legacy.calculateStatistics([match('clash-for-glory-s1','fx-a'),match('clash-for-glory-s2','fx-b')]);assert.equal(stats.players.get('1345266890--before-clash-for-glory-s2').kills,5);assert.equal(stats.players.get('1345266890').mvpCount,1);assert.equal(stats.teams.get('fx-a').kills,5);assert.equal(stats.teams.get('fx-b').kills,5);
  });
  insertMatch('fx-progress','fx-official','semi',4,'upcoming',null);
  insertMatch('fx-progress-final','fx-official','final',2,'upcoming',null);
  sql.exec("INSERT INTO tournament_rounds VALUES('fx-official','stage','bronze','Fixture bronze',2,3)");
  insertMatch('fx-progress-bronze','fx-official','bronze',1,'upcoming',null);
  sql.exec("UPDATE matches SET team1_id=NULL,team2_id=NULL WHERE id IN ('fx-progress-final','fx-progress-bronze');INSERT INTO match_sources VALUES('fx-progress-final',1,'winner','fx-progress',NULL),('fx-progress-bronze',2,'loser','fx-progress',NULL)");
  const raw={batch:async items=>{sql.exec('SAVEPOINT operation');try{const results=[];for(const item of items)results.push(await item.all());sql.exec('RELEASE operation');return results;}catch(error){sql.exec('ROLLBACK TO operation; RELEASE operation');throw error;}}};
  const db=testAdminDatabase(raw,sql);
  const state=await readLiveResults(db,'fx-official');
  await saveLiveResult(db,'fx-official',{intent:'confirm-walkover',match_id:'fx-progress',walkover_winner:'fx-a',result_revision:state.revision});
  check('actual application result writes advance winner and loser atomically',()=>{
    assert.equal(sql.prepare("SELECT team1_id FROM matches WHERE id='fx-progress-final'").get().team1_id,'fx-a');assert.equal(sql.prepare("SELECT team2_id FROM matches WHERE id='fx-progress-bronze'").get().team2_id,'fx-b');assert.equal(sql.prepare("SELECT result_type FROM matches WHERE id='fx-progress'").get().result_type,'walkover');
  });
  if(['1B','1C'].includes(marker.phase))report.publicEdges=await verifyPublicEdges(sql,data,legacy);
  check('synthetic foreign keys',()=>assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]));
  sql.exec('ROLLBACK TO synthetic; RELEASE synthetic');
  check('synthetic fixtures leave the historical baseline intact',()=>assert.deepEqual(read(),historical));
  report.limitations.push(['1B','1C'].includes(marker.phase)?'New D1 public projections filter test data; existing hybrid public readers remain unchanged pending Phase 1C integration.':'Test filtering is a verification selector, not a change to existing public readers; current public test-data exposure remains a Phase 1B gate.');
  report.databaseFiles=Object.keys(inventory(root)).filter(name=>/\.sqlite(?:-wal|-shm)?$/.test(name)).map(name=>join(root,name));
  check('all generated database files remain in the disposable directory',()=>{for(const path of report.databaseFiles)assert.ok(path.startsWith(root+'/'));assert.deepEqual(inventory(join(marker.repo,'.wrangler/state/v3/d1')),marker.protectedStores);});
  report.status='PASS_WITH_LIMITATIONS';
}catch(error){report.status='FAIL';report.failure=String(error.message);throw error;}finally{sql?.close();save();}
console.log(JSON.stringify({status:report.status,checks:report.checks.length,historical:report.historical.counts,rosterOrdering:report.rosterOrdering.status,report:join(root,'report.json')},null,2));
