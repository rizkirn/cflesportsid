import {readFileSync,writeFileSync,mkdtempSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import {UAT} from '../../src/data-access/public-mode.mjs';
import {readPublicData,publicReadQueries,publicColumns,publicFields,restorePublicStatisticsKeys} from '../../src/data-access/public-d1.mjs';
import {comparePublicContracts} from '../../src/data-access/shadow-contract.mjs';
import {checkData} from '../data-tools.mjs';
import {loadLegacyStatistics,plain} from '../d1-parity.mjs';
import {statisticalProfiles,playerContinuitySplits} from '../../src/utils/player-continuity.mjs';
import {validateRemoteUAT,validateUATConfig,rejectEnvironmentOverrides} from './uat-validator.mjs';
import {verifyVersionPreservation} from './tail-diagnostic.mjs';
import {credential} from '../phase2b/api.mjs';
import {shapeD1Matches} from '../../src/data-access/matches.mjs';
import {overlayAssetReferences,assetFields} from '../../src/utils/assets.mjs';
const check=(ok,code)=>{if(!ok)throw Error(code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
export const rosterSQL='SELECT r.tournament_id,r.team_id,r.player_id,p.uid,r.ign_snapshot,r.position FROM tournament_rosters r JOIN players p ON p.id=r.player_id ORDER BY r.tournament_id,r.player_id';
export const ledgerSQL='SELECT id,name FROM d1_migrations ORDER BY id';
const readOnlyQueries=new Set([...publicReadQueries,'PRAGMA table_info(official_map_assignments)',...Object.keys(publicColumns).map(table=>'PRAGMA table_info('+table+')'),rosterSQL,ledgerSQL,'PRAGMA foreign_key_check']);
export function stagingPublicBinding({token,fetcher=fetch}){
 check(typeof token==='string'&&token.length>0,'STAGING_AUTH_REQUIRED');
 const audit={queries:0,rowsWritten:0},hashes=new Map(),rowsBySQL=new Map();
 async function query(sql){
  check(readOnlyQueries.has(sql),'STAGING_QUERY_REJECTED');
  let response;try{response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+UAT.account+'/d1/database/'+UAT.database+'/query',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params:[]}),signal:AbortSignal.timeout(30000)});}catch{throw Error('STAGING_QUERY_TRANSPORT_FAILED');}
  check(response.ok,'STAGING_QUERY_HTTP_'+response.status);
  let body;try{body=await response.json();}catch{throw Error('STAGING_QUERY_RESPONSE_INVALID');}
  check(body.success===true&&Array.isArray(body.result)&&body.result.length===1&&body.result[0].success===true&&Array.isArray(body.result[0].results),'STAGING_QUERY_RESPONSE_INVALID');
  const result=body.result[0];check(Number.isSafeInteger(result.meta?.rows_written)&&result.meta.rows_written===0,'STAGING_READ_WRITE_DETECTED');audit.queries++;audit.rowsWritten+=result.meta.rows_written;
  const digest=sha(JSON.stringify(result.results));check(!hashes.has(sql)||hashes.get(sql)===digest,'STAGING_DATA_CHANGED_DURING_COMPARISON');hashes.set(sql,digest);rowsBySQL.set(sql,result.results);
  return result.results;
 }
 const binding={prepare(sql){check(readOnlyQueries.has(sql),'STAGING_QUERY_REJECTED');return Object.freeze({sql});},async batch(statements){
  check(Array.isArray(statements)&&statements.every(statement=>readOnlyQueries.has(statement.sql)),'STAGING_BATCH_REJECTED');
  const results=[];for(const statement of statements)results.push({success:true,results:await query(statement.sql)});return results;
 }};
 return {binding,query,audit,rowsBySQL,recheck:async()=>{for(const sql of [...hashes.keys()])await query(sql);},fingerprint:()=>sha(JSON.stringify([...hashes]))};
}
export function existingHybridContracts(data,rowsBySQL){
 const table=name=>{const sql=publicReadQueries[Object.keys(publicColumns).indexOf(name)];check(sql&&rowsBySQL.has(sql),'HYBRID_PUBLIC_QUERY_MISSING');return rowsBySQL.get(sql);};
 const hybrid={};for(const name of Object.keys(assetFields))hybrid[name]=overlayAssetReferences([...data[name].values()],name,table(name));
 const maps=[...table('match_maps').map(row=>({...row,mode:'played'})),...table('match_map_walkovers').map(row=>({...row,mode:'walkover',mvp_player_id:null,score_team1:null,score_team2:null,result_note:null}))].sort((a,b)=>a.match_id.localeCompare(b.match_id)||a.map_number-b.map_number);
 hybrid.matches=shapeD1Matches([table('matches'),maps,table('match_sources'),table('player_match_entries'),table('player_round_stats')],[...data.matches.values()]);
 return hybrid;
}
function publicStatistics(engine,snapshot,tid){
 const context={exports:{},require:name=>{if(name==='../utils/statistics')return engine;if(name==='./public-d1.mjs')return {restorePublicStatisticsKeys};throw Error('STATISTICS_IMPORT_REJECTED');}};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../src/data-access/public-statistics.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return context.exports.calculatePublicStatistics(snapshot,tid);
}
export function compareDeterministic(snapshot,{data=checkData().data,registrations=JSON.parse(readFileSync(new URL('../phase2b/registrations.json',import.meta.url))),savedRows,expectedRosterHash,hybrid}={}){
 const rawContracts=[],reports=[],record=(contract,expected,actual)=>{const same=JSON.stringify(plain(expected))===JSON.stringify(plain(actual));reports.push({contract,mismatches:same?0:1});};
 for(const name of Object.keys(publicFields)){
  const entries=[...data[name].values()];rawContracts.push(comparePublicContracts(name,entries,snapshot[name]));reports.push(comparePublicContracts(name,hybrid?.[name]??entries,snapshot[name]));
  const profiles=name==='players'?statisticalProfiles(entries):entries;record(name+'.ids',profiles.map(p=>p.id).sort(),snapshot[name].map(p=>p.id).sort());
  record(name+'.allowlist',0,snapshot[name].filter(entry=>Object.keys(entry.data).some(key=>!publicFields[name].includes(key))).length);
 }
 record('counts',{players:128,teams:19,maps:11,tournaments:2,matches:26,rosters:168},Object.fromEntries(['players','teams','maps','tournaments','matches','rosters'].map(key=>[key,snapshot[key].length])));
 const engine=loadLegacyStatistics();
 for(const tid of ['clash-for-glory-s1','clash-for-glory-s2',undefined]){
  const expected=engine.calculateStatistics([...data.matches.values()].filter(match=>!tid||match.data.tournamentId===tid));
  for(const player of statisticalProfiles([...data.players.values()]))if(!expected.players.has(player.id))expected.players.set(player.id,engine.emptyStats());
  for(const team of data.teams.values())if(!expected.teams.has(team.id))expected.teams.set(team.id,engine.emptyStats());
  for(const map of data.maps.values())if(!expected.maps.has(map.id))expected.maps.set(map.id,engine.emptyMapStats());
  const actual=publicStatistics(engine,snapshot,tid);
  for(const category of ['players','teams','maps','totals'])record('statistics.'+(tid??'overall')+'.'+category,expected[category],actual[category]);
 }
 record('identity.segments',playerContinuitySplits,snapshot.identitySegments);
 record('identity.historical','1345266890--before-clash-for-glory-s2',snapshot.profileIdentity('1345266890','clash-for-glory-s1'));
 record('identity.current','1345266890',snapshot.profileIdentity('1345266890','clash-for-glory-s2'));
 const historical=snapshot.players.find(p=>p.id==='1345266890--before-clash-for-glory-s2'),current=snapshot.players.find(p=>p.id==='1345266890');
 record('identity.historical-values',['KangDedy','cha-tra-mue'],[historical?.data.ign,historical?.data.team]);record('identity.current-values',['KucayyPRMX','g2c-prmx'],[current?.data.ign,current?.data.team]);
 const membership=row=>JSON.stringify([row.tournament_id,row.team_id,row.uid,row.ign_snapshot??row.ign]);
 record('roster.membership',registrations.map(membership).sort(),snapshot.rosters.map(row=>membership({tournament_id:row.tournamentId,team_id:row.teamId,uid:row.uid,ign:row.ign})).sort());
 if(savedRows){
  record('roster.saved-positions-hash',expectedRosterHash,sha(JSON.stringify(savedRows)));
  record('roster.positions-projected',savedRows.map(row=>JSON.stringify([row.tournament_id,row.team_id,row.uid,row.ign_snapshot,row.position])).sort(),snapshot.rosters.map(row=>JSON.stringify([row.tournamentId,row.teamId,row.uid,row.ign,row.position])).sort());
 }
 return {status:reports.every(r=>r.mismatches===0)?'PASS':'BLOCKED',contracts:reports,parsedJSONComparison:rawContracts,mismatches:reports.reduce((sum,r)=>sum+r.mismatches,0),counts:Object.fromEntries(['players','teams','maps','tournaments','matches','rosters'].map(key=>[key,snapshot[key].length])),coverage:['Astro content schemas plus unchanged hybrid asset/match projections','public field allowlists','historical identity segments','S1/S2/overall full nested player/team/map statistics and MVPs','zero-activity profiles','tournament stages/map-pool order/veto','match sources/BYEs/walkovers','roster membership independent of ordering','saved D1 roster positions'],limitations:['No synthetic records or database faults injected remotely','Read consistency checked by replaying exact queries; this is not a transactional snapshot','Saved roster ordering is checked against approved D1 backup, not registration arrays','HTTP rendering and D1-only runtime activation are separate gates']};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 let audit,report;
 try{
  check(process.argv.length===2,'ARGUMENT_REJECTED');rejectEnvironmentOverrides();validateUATConfig(JSON.parse(readFileSync(new URL('../../wrangler.uat.jsonc',import.meta.url))));
  const parsed=checkData();check(parsed.errors.length===0,'CONTENT_SCHEMA_INVALID');
  const token=credential(),preflight=await validateRemoteUAT({token,mode:'shadow'});await verifyVersionPreservation({token});
  const db=stagingPublicBinding({token});audit=db.audit;
  const ledger=await db.query(ledgerSQL);const expectedLedger=(await import('node:fs')).readdirSync(new URL('../../migrations/',import.meta.url)).filter(name=>/^00(?:0[1-9]|1[01])_.*\.sql$/.test(name)).sort();check(JSON.stringify(ledger.map(row=>row.name))===JSON.stringify(expectedLedger),'STAGING_LEDGER_REJECTED');
  check((await db.query('PRAGMA foreign_key_check')).length===0,'STAGING_FOREIGN_KEY_VIOLATION');
  const savedRows=await db.query(rosterSQL);
  const manifest=JSON.parse(readFileSync('/Users/rizkirn/CFL-Private-Backups/staging/cfl-phase2b-backup-7bfd4111-56ca-4c16-9890-452b93b3e0de/manifest.json'));
  check(manifest.target.database===UAT.database&&manifest.target.account===UAT.account,'ROSTER_BASELINE_TARGET_REJECTED');
  const snapshot=await readPublicData(db.binding);
  report=compareDeterministic(snapshot,{data:parsed.data,savedRows,hybrid:existingHybridContracts(parsed.data,db.rowsBySQL),expectedRosterHash:manifest.preflight.rosters.savedRowsHash});
  await db.recheck();const postflight=await validateRemoteUAT({token,mode:'shadow'});await verifyVersionPreservation({token});
  check(preflight.versionId===postflight.versionId&&preflight.deploymentId===postflight.deploymentId&&preflight.authenticationFingerprint===postflight.authenticationFingerprint&&preflight.workerSettings.fingerprint===postflight.workerSettings.fingerprint,'STAGING_UAT_CHANGED');
  report={...report,preflight,postflight,audit,queryFingerprint:db.fingerprint(),checkedAt:new Date().toISOString()};
 }catch(error){report={...(report??{}),status:'BLOCKED',code:/^[A-Z0-9_]+$/.test(error?.code??error?.message??'')?(error.code??error.message):'DETERMINISTIC_VALIDATION_FAILED',audit};}
 const directory=mkdtempSync('/private/tmp/cfl-deterministic-');writeFileSync(directory+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({status:report.status,code:report.code??null,mismatches:report.mismatches??null,report:directory+'/report.json'}));if(report.status!=='PASS')process.exitCode=1;
}
