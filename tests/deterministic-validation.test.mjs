import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {stagingPublicBinding,compareDeterministic,existingHybridContracts,rosterSQL,ledgerSQL} from '../scripts/phase2c/deterministic-parity.mjs';
import {readPublicData,publicReadQueries,publicColumns,publicErrorResponse} from '../src/data-access/public-d1.mjs';
import {initializePublicFixtures} from '../scripts/phase1a/phase1b.mjs';
import {seedFixture} from './helpers/seed-fixture.mjs';
import {UAT} from '../src/data-access/public-mode.mjs';
import {executeHTTPMatrix,validateHTTPPlan,acceptedTeamRosterReordering,teamRosterOrderPolicy} from '../scripts/phase2c/http-validation.mjs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {resolveAsset} from '../src/utils/assets.mjs';
import {matchPlayerProfile} from '../src/utils/player-continuity.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const response=(rows=[],written=0)=>({ok:true,json:async()=>({success:true,result:[{success:true,results:rows,meta:{rows_written:written}}]})});
test('adapter restricts requests to staging and only exact approved read statements',async()=>{
 let calls=0;const db=stagingPublicBinding({token:'TEST_ONLY',fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+UAT.account+'/d1/database/'+UAT.database+'/query');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),{sql:ledgerSQL,params:[]});return response();}});
 await db.query(ledgerSQL);for(const sql of ['DELETE FROM players','SELECT * FROM players',ledgerSQL+';DELETE FROM players','BEGIN','PRAGMA table_info(secret)'])assert.throws(()=>db.binding.prepare(sql),/STAGING_QUERY_REJECTED/);
 assert.equal(calls,1);assert.equal(db.audit.rowsWritten,0);assert.equal('run' in db.binding,false);
});
test('projection schema checks include official map assignments',()=>assert.doesNotThrow(()=>stagingPublicBinding({token:'TEST_ONLY'}).binding.prepare('PRAGMA table_info(official_map_assignments)')));
test('adapter rejects missing auth, writes, HTTP/API failures and changed replay results',async()=>{
 assert.throws(()=>stagingPublicBinding({}),/STAGING_AUTH_REQUIRED/);
 for(const [fetcher,code]of [[async()=>response([],1),'STAGING_READ_WRITE_DETECTED'],[async()=>({ok:false,status:401}),'STAGING_QUERY_HTTP_401'],[async()=>({ok:true,json:async()=>({success:false})}),'STAGING_QUERY_RESPONSE_INVALID'],[async()=>{throw Error('PRIVATE_VALUE');},'STAGING_QUERY_TRANSPORT_FAILED']])await assert.rejects(stagingPublicBinding({token:'TEST_ONLY',fetcher}).query(ledgerSQL),new RegExp(code));
 let n=0;const db=stagingPublicBinding({token:'TEST_ONLY',fetcher:async()=>response([{n:n++}])});await db.query(ledgerSQL);await assert.rejects(db.recheck(),/STAGING_DATA_CHANGED/);
});
test('all parsed historical contracts and nested statistics pass; pool order/private fields are detected',async()=>{
 const sql=new DatabaseSync(':memory:');try{
 sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>/^00(?:0[1-9]|1[01])_.*\.sql$/.test(n)).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 sql.exec(seedFixture());initializePublicFixtures(sql,JSON.parse(readFileSync(new URL('../scripts/phase2b/registrations.json',import.meta.url))));
 const binding={prepare:sql=>({sql}),batch:async ss=>ss.map(s=>({success:true,results:sql.prepare(s.sql).all()}))};
 const snapshot=await readPublicData(binding),rowsBySQL=new Map(publicReadQueries.map(query=>[query,sql.prepare(query).all()])),hybrid=existingHybridContracts((await import('../scripts/data-tools.mjs')).checkData().data,rowsBySQL),savedRows=sql.prepare(rosterSQL).all(),expectedRosterHash=sha(JSON.stringify(savedRows));
 assert.equal(compareDeterministic(snapshot,{savedRows,expectedRosterHash,hybrid}).mismatches,0);
 const order=snapshot.tournaments[0].data.stages[0].mapPool;order.reverse();assert.ok(compareDeterministic(snapshot).contracts.find(c=>c.contract==='tournaments').mismatches);order.reverse();
 snapshot.players[0].data.private_registration='PRIVATE';assert.equal(compareDeterministic(snapshot).contracts.find(c=>c.contract==='players.allowlist').mismatches,1);delete snapshot.players[0].data.private_registration;
 snapshot.rosters[0].position=7;assert.equal(compareDeterministic(snapshot,{savedRows,expectedRosterHash,hybrid}).contracts.find(c=>c.contract==='roster.positions-projected').mismatches,1);assert.ok(compareDeterministic(snapshot).contracts.filter(c=>c.contract.startsWith('statistics.')).every(c=>c.mismatches===0));
 }finally{sql.close();}
});
const headers=['content-type'];
function fixture(){const routes=Array.from({length:204},(_,i)=>({path:'/case-'+i+'/',expectedStatus:i===203?404:200})),baseline=routes.map((r,index)=>({index,status:r.expectedStatus,sha256:sha('PUBLIC'),headers:{'content-type':'text/html'}}));const expected={versionId:'version',deploymentId:'deployment',authenticationFingerprint:'auth',authenticationBindingCount:7,workerSettingsFingerprint:'settings'};return {routes,baseline,plan:{target:UAT,expected,headers,maxDurationMs:900000,requestTimeoutMs:30000,unverifiedContracts:[]},result:{target:UAT,mode:'d1',...expected,workerSettings:{fingerprint:'settings'}},authorize:()=>{},claim:()=>{}};}
test('Tail-free runner covers 204 requests including legitimate 404s with periodic verification',async()=>{const f=fixture();let calls=0,checks=0;const report=await executeHTTPMatrix({...f,verify:async()=>{checks++;return f.result;},fetcher:async()=>new Response('PUBLIC',{status:f.routes[calls++].expectedStatus,headers:{'content-type':'text/html'}})});assert.equal(report.status,'PASS');assert.equal(calls,204);assert.equal(report.tailUsed,false);assert.equal(checks,10);});
for(const [name,patch,code]of [['shadow mode',{mode:'shadow'},'HTTP_TARGET_CHANGED'],['wrong target',{target:{...UAT,database:'wrong'}},'HTTP_TARGET_CHANGED'],['concurrent deployment',{deploymentId:'different'},'HTTP_TARGET_CHANGED']])test('HTTP rejects '+name+' before public GET',async()=>{const f=fixture();let calls=0;const report=await executeHTTPMatrix({...f,verify:async()=>({...f.result,...patch}),fetcher:async()=>{calls++;return new Response('PUBLIC');}});assert.equal(report.code,code);assert.equal(calls,0);});
test('missing approval fails before any remote call',async()=>{const f=fixture();let calls=0;const report=await executeHTTPMatrix({...f,authorize:()=>{throw Error('HTTP_APPROVAL_REQUIRED');},verify:async()=>{calls++;return f.result;}});assert.equal(report.code,'HTTP_APPROVAL_REQUIRED');assert.equal(calls,0);});
test('HTTP mismatch stops at the first request with no retry',async()=>{const f=fixture();let calls=0;const report=await executeHTTPMatrix({...f,verify:async()=>f.result,fetcher:async()=>{calls++;return new Response('DIFFERENT');}});assert.equal(report.code,'HTTP_PARITY_FAILED');assert.equal(calls,1);});
test('HTTP timeout and ambiguous transport stop without retry',async()=>{const f=fixture();let calls=0;const report=await executeHTTPMatrix({...f,verify:async()=>f.result,fetcher:async()=>{calls++;throw Error('private error');}});assert.equal(report.code,'HTTP_EXECUTION_FAILED');assert.equal(calls,1);});
test('HTTP approval cannot authorize shadow mode or another operation',()=>{for(const operation of ['uat-shadow-validation','migration'])assert.throws(()=>validateHTTPPlan({operation,expected:{mode:'shadow'}},'wrong'),/HTTP_APPROVAL_REJECTED/);});

test('D1-only query failure is an explicit sanitized 503 after schema succeeds',async()=>{
 let batches=0;const db={prepare:sql=>({sql}),batch:async ss=>{if(++batches===2)throw Error('PRIVATE_FAILURE_SENTINEL');return ss.map(({sql})=>({success:true,results:(sql==='PRAGMA table_info(official_map_assignments)'?['tournament_id','maps']:[...publicColumns[sql.slice(18,-1)],...(sql==='PRAGMA table_info(tournaments)'?['is_test']:[])]).map(name=>({name}))}));}};
 await assert.rejects(()=>readPublicData(db),e=>e.code==='QUERY_FAILED'&&e.status===503);
 const response=publicErrorResponse(Error('PRIVATE_FAILURE_SENTINEL'));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('PRIVATE'));
});
test('HTTP execution rejects expired authorization and duration overruns before requests',async()=>{
 for(const [authorize,now,code]of [[()=>{throw Error('HTTP_APPROVAL_EXPIRED');},()=>0,'HTTP_APPROVAL_EXPIRED'],[()=>{},(()=>{let n=0;return ()=>n++?900001:0;})(),'HTTP_DURATION_EXCEEDED']]){const f=fixture();let calls=0;const report=await executeHTTPMatrix({...f,authorize,now,verify:async()=>f.result,fetcher:async()=>{calls++;return new Response('PUBLIC');}});assert.equal(report.code,code);assert.equal(calls,0);}
});

const rosterPolicy=teamRosterOrderPolicy();
const card=uid=>`<a href="/players/${uid}" class="roster-card" data-astro-cid-test><img src="/avatar/${uid}.webp" alt="${uid} photo"><div class="roster-card-info"><strong>${uid}</strong><span>Player</span></div><span class="badge">Active</span></a>`;
const teamHTML=order=>`<html><h1>Unchanged</h1><section aria-labelledby="statistics"><div>Unchanged statistics</div></section><section class="detail-section" aria-labelledby="roster-title"><div class="detail-heading">Roster</div><div class="roster-detail-grid section-spacing" data-astro-cid-test> ${order.map(card).join(' ')} </div></section><footer>Unchanged</footer></html>`;
test('all 19 team pages accept only complete unchanged roster-card permutations',()=>{
 assert.equal(Object.keys(rosterPolicy.teams).length,19);
 for(const [team,order]of Object.entries(rosterPolicy.teams)){
  const baseline=teamHTML(order),actual=teamHTML([...order].reverse());
  const accepted=acceptedTeamRosterReordering({path:`/teams/${team}/`,body:actual,baselineSHA256:sha(baseline),policy:rosterPolicy});
  assert.equal(accepted.team,team);assert.equal(accepted.players,order.length);
  assert.equal(sha(actual)===sha(baseline),false);
 }
});
test('card contents, images, links, roles, status and all outside HTML remain byte-strict',()=>{
 const order=rosterPolicy.teams.anv,baseline=teamHTML(order),actual=teamHTML([...order].reverse());
 const compare=body=>acceptedTeamRosterReordering({path:'/teams/anv/',body,baselineSHA256:sha(baseline),policy:rosterPolicy});
 for(const body of [actual.replace('photo','changed photo'),actual.replace('.webp','.png'),actual.replace('Player','Captain'),actual.replace('Active','Inactive'),actual.replace('Unchanged','Changed'),actual.replace('class="roster-card"','class="roster-card extra"'),actual.replace('/players/','/private/'),actual.replace('> '+card(order.at(-1))+' ','> '),actual.replace(card(order[0]),card(order[1])),actual.replace('</section>','</section><p>New</p>'),actual.replace(' </div></section>','  </div></section>')])assert.equal(compare(body),null);
 assert.equal(compare(teamHTML(order)),null);
});
test('unknown teams, non-team routes, duplicate containers and unapproved policies reject',()=>{
 const order=rosterPolicy.teams.anv,baseline=teamHTML(order),actual=teamHTML([...order].reverse());
 for(const [path,body,policy]of [['/players/anv/',actual,rosterPolicy],['/teams/unknown/',actual,rosterPolicy],['/teams/anv/',actual,undefined],['/teams/anv/',actual,{...rosterPolicy,version:'unknown'}],['/teams/anv/',actual+actual,rosterPolicy],['/teams/anv/',actual.replace('roster-title','private-title'),rosterPolicy],['/teams/anv/',actual.replace('<strong>','<!-- private --><strong>'),rosterPolicy]])assert.equal(acceptedTeamRosterReordering({path,body,baselineSHA256:sha(baseline),policy}),null);
});
test('runner reports approved presentation difference without replacing baseline or weakening headers',async()=>{
 for(const approved of [true,false]){
  const f=fixture(),order=rosterPolicy.teams.anv,original=teamHTML(order),actual=teamHTML([...order].reverse());
  f.routes[0].path='/teams/anv/';f.baseline[0].sha256=sha(original);
  const saved=JSON.stringify(f.baseline);if(approved)f.plan.acceptedPresentationDifferences={teamRosterOrder:rosterPolicy};
  let calls=0;const report=await executeHTTPMatrix({...f,verify:async()=>f.result,fetcher:async()=>{const i=calls++;return new Response(i===0?actual:'PUBLIC',{status:f.routes[i].expectedStatus,headers:{'content-type':'text/html'}});}});
  assert.equal(report.status,approved?'PASS':'BLOCKED');assert.equal(calls,approved?204:1);assert.equal(JSON.stringify(f.baseline),saved);
  if(approved)assert.equal(report.responses[0].acceptedPresentationDifference.changedPositions,4);
 }
 const f=fixture(),order=rosterPolicy.teams.anv;f.routes[0].path='/teams/anv/';f.baseline[0].sha256=sha(teamHTML(order));f.plan.acceptedPresentationDifferences={teamRosterOrder:rosterPolicy};
 const report=await executeHTTPMatrix({...f,verify:async()=>f.result,fetcher:async()=>new Response(teamHTML([...order].reverse()),{status:200,headers:{'content-type':'text/plain'}})});
 assert.equal(report.code,'HTTP_PARITY_FAILED');assert.equal(report.matrixRequests,1);
});

function matchPageInputs(catalog,match,profile){
 const source=readFileSync(new URL('../src/pages/matches/[id].astro',import.meta.url),'utf8').split('---')[1];
 const content={getMatchTeam1Id:m=>m.data.team1Id,getMatchTeam2Id:m=>m.data.team2Id,getMatchWinnerId:m=>m.data.winnerId,getMatchTournamentId:m=>m.data.tournamentId,getRoundMapId:r=>r.mapId};
 const imports={
  '../../data-access/frontend-matches':{getFrontendMatches:async()=>[match]},
  '../../data-access/frontend-bracket':{getFrontendTeams:async()=>catalog.teams,getFrontendTournaments:async()=>catalog.tournaments},
  '../../data-access/frontend-assets':{getAssetCollection:async name=>catalog[name]},
  '../../data-access/frontend-public':{matchPlayerProfile:profile},
  '../../utils/assets.mjs':{resolveAsset},'../../utils/content':content,
  '../../utils/tournament':{},
 };
 const context={exports:{},Astro:{params:{id:match.id}},require:name=>{assert.ok(name in imports,name);return imports[name];}};
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 return vm.runInNewContext('(async()=>{'+code+';return {playerStats,roundMVPs,team1Players,team2Players,roundMapNames,numRounds};})()',context).then(value=>JSON.parse(JSON.stringify(value)));
}
test('match page rendering inputs preserve all 26 hybrid projections including missing S1 IGN snapshots',async()=>{
 const sql=new DatabaseSync(':memory:');try{
 sql.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>/^00(?:0[1-9]|1[01])_.*\.sql$/.test(n)).sort())sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 sql.exec(seedFixture());initializePublicFixtures(sql,JSON.parse(readFileSync(new URL('../scripts/phase2b/registrations.json',import.meta.url))));
 const binding={prepare:sql=>({sql}),batch:async ss=>ss.map(s=>({success:true,results:sql.prepare(s.sql).all()}))};
 const snapshot=await readPublicData(binding),rowsBySQL=new Map(publicReadQueries.map(q=>[q,sql.prepare(q).all()])),hybrid=existingHybridContracts((await import('../scripts/data-tools.mjs')).checkData().data,rowsBySQL);
 const profile=(players,uid,tid)=>players.find(p=>p.id===snapshot.profileIdentity(uid,tid));
 assert.equal(snapshot.matches.length,26);
 for(const m of snapshot.matches){const h=hybrid.matches.find(x=>x.id===m.id);assert.deepEqual(await matchPageInputs(snapshot,m,profile),await matchPageInputs(hybrid,h,matchPlayerProfile),m.id);}
 const s1=snapshot.matches.find(m=>m.id==='m13'),inputs=await matchPageInputs(snapshot,s1,profile);
 assert.equal(inputs.playerStats.find(p=>p.uid==='1345266890').ign,'KangDedy');
 const m=structuredClone(snapshot.matches.find(m=>m.id==='m01')),p=m.data.playerStats.find(p=>p.uid),uid=p.uid;
 p.ign='Verified Match-time IGN';const named=await matchPageInputs(snapshot,m,profile);assert.equal(named.playerStats.find(p=>p.uid===uid).ign,'Verified Match-time IGN');
 m.data.roundDetails[0].mvp=uid;assert.equal((await matchPageInputs(snapshot,m,profile)).roundMVPs[0].ign,'Verified Match-time IGN');
 delete p.ign;const unknown={...snapshot,players:snapshot.players.filter(p=>p.data.uid!==uid)};
 assert.equal((await matchPageInputs(unknown,m,()=>undefined)).playerStats.find(p=>p.uid===uid).ign,uid);
 assert.equal((await matchPageInputs(unknown,m,()=>undefined)).roundMVPs[0].ign,uid);
 p.uid=null;assert.ok(!(await matchPageInputs(snapshot,m,profile)).playerStats.some(p=>p.uid===null));
 assert.equal(compareDeterministic(snapshot,{hybrid}).mismatches,0);
 }finally{sql.close();}
});
