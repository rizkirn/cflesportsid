import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {ROOT,TARGET,check,same,sha} from './guards.mjs';

export function pinnedIdentity(){
  const bytes=readFileSync(join(ROOT,'scripts/phase2b/identity-backfill.json'));
  const pinned=JSON.parse(readFileSync(join(ROOT,'scripts/phase2b/baseline.json'),'utf8')).backfillHash;
  check(sha(bytes)===pinned,'BACKFILL_HASH_REJECTED');
  const artifact=JSON.parse(bytes);
  same(artifact.identity,{uid:'1345266890',segment:'1345266890--before-clash-for-glory-s2',historical:'clash-for-glory-s1',boundary:'clash-for-glory-s2',ign:'KangDedy',team:'cha-tra-mue'},'IDENTITY_ARTIFACT_REJECTED');
  check(artifact.atomicBatchRequired===true&&artifact.statements.length===2,'IDENTITY_BATCH_REJECTED');
  return {artifact,hash:pinned};
}
export function backupEvidence(path){
  check(typeof path==='string'&&isAbsolute(path)&&!path.startsWith(ROOT+'/')&&realpathSync(path)===path,'BACKUP_PATH_REJECTED');
  const stat=lstatSync(path);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'PRIVATE_BACKUP_REQUIRED');
  const bytes=readFileSync(path),manifest=JSON.parse(bytes);same(manifest.target,TARGET,'BACKUP_TARGET_REJECTED');check(manifest.kind==='cfl-phase2b-backup-v1','BACKUP_MANIFEST_REJECTED');
  const file=join(path.slice(0,path.lastIndexOf('/')),'staging.sql');check(realpathSync(file)===file,'BACKUP_SQL_PATH_REJECTED');
  const fileStat=lstatSync(file);check(fileStat.isFile()&&!fileStat.isSymbolicLink()&&fileStat.uid===process.getuid()&&(fileStat.mode&0o077)===0,'PRIVATE_BACKUP_REQUIRED');
  const sql=readFileSync(file);check(sql.length===manifest.bytes&&sha(sql)===manifest.exportSHA256,'EXPORT_CHECKSUM_REJECTED');
  return {manifestPath:path,manifestHash:sha(bytes),exportSHA256:manifest.exportSHA256,rosterHash:manifest.preflight.rosters.savedRowsHash};
}
export async function identitySnapshot(api,playerId,state){
  check(['empty','exact'].includes(state),'IDENTITY_STATE_REJECTED');
  const {artifact,hash}=pinnedIdentity(),i=artifact.identity;
  const players=await api.query('SELECT * FROM players WHERE id=?',[playerId]);check(players.length===1,'IDENTITY_PLAYER_REJECTED');
  check(players[0].uid===i.uid&&players[0].current_ign==='KucayyPRMX'&&players[0].current_team_id==='g2c-prmx','MASTER_IDENTITY_REJECTED');
  const segments=await api.query('SELECT id,player_id,uid_snapshot,boundary_tournament_id,ign_snapshot,team_id FROM player_identity_segments ORDER BY id');
  const tournaments=await api.query('SELECT player_id,tournament_id,segment_id FROM player_identity_tournaments ORDER BY player_id,tournament_id');
  const expectedSegment={id:i.segment,player_id:playerId,uid_snapshot:i.uid,boundary_tournament_id:i.boundary,ign_snapshot:i.ign,team_id:i.team};
  const expectedTournament={player_id:playerId,tournament_id:i.historical,segment_id:i.segment};
  same(segments,state==='empty'?[]:[expectedSegment],'IDENTITY_SEGMENTS_REJECTED');same(tournaments,state==='empty'?[]:[expectedTournament],'IDENTITY_TOURNAMENTS_REJECTED');
  const rows=await api.query('SELECT tournament_id,team_id,ign_snapshot FROM tournament_rosters WHERE player_id=? ORDER BY tournament_id',[playerId]);
  check(rows.some(r=>r.tournament_id===i.historical&&r.team_id===i.team&&r.ign_snapshot===i.ign)&&rows.some(r=>r.tournament_id===i.boundary&&r.team_id==='g2c-prmx'&&r.ign_snapshot==='KucayyPRMX'),'HISTORICAL_IDENTITY_REJECTED');
  const entries=await api.query('SELECT * FROM player_match_entries ORDER BY match_id,entry_index');
  const rounds=await api.query('SELECT * FROM player_round_stats ORDER BY match_id,entry_index,round_index');
  const combat=await api.query('SELECT m.tournament_id,e.uid_snapshot,e.team_id,r.map_number,COUNT(*) entries,SUM(r.kills) kills,SUM(r.deaths) deaths,SUM(r.assists) assists FROM player_round_stats r JOIN player_match_entries e ON e.match_id=r.match_id AND e.entry_index=r.entry_index JOIN matches m ON m.id=r.match_id GROUP BY m.tournament_id,e.uid_snapshot,e.team_id,r.map_number ORDER BY m.tournament_id,e.uid_snapshot,e.team_id,r.map_number');
  const matches=await api.query('SELECT id,tournament_id,status,team1_id,team2_id,score1,score2,winner_id,result_type FROM matches ORDER BY id');
  const maps=await api.query('SELECT * FROM match_maps ORDER BY match_id,map_number');
  const walkovers=await api.query('SELECT * FROM match_map_walkovers ORDER BY match_id,map_number');
  return {state,segments:segments.length,tournaments:tournaments.length,artifactHash:hash,masterHash:sha(JSON.stringify(players[0])),entriesHash:sha(JSON.stringify(entries)),roundsHash:sha(JSON.stringify(rounds)),combatHash:sha(JSON.stringify(combat)),matchesHash:sha(JSON.stringify(matches)),mapsHash:sha(JSON.stringify(maps)),walkoversHash:sha(JSON.stringify(walkovers))};
}
