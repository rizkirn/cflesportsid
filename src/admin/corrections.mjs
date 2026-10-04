import { AdminError, readAdminForm } from './tournaments.mjs';
import { playedMapGuard } from './map-assignments.mjs';
import { readLiveResults, resultSnapshotSQL, seriesWinner } from './live-results.mjs';

export function correctionReason(value) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>1000)
    throw new AdminError('A correction reason of 1–1000 characters is required.');
  return value.trim();
}
export function auditStatement(db,tournamentId,matchId,type,reason,oldState,newState) {
  return db.prepare(`INSERT INTO match_correction_audit(tournament_id,match_id,correction_type,reason,old_state,new_state)
    VALUES(?,?,?,?,?,?)`).bind(tournamentId,matchId,type,reason,JSON.stringify(oldState),JSON.stringify(newState));
}
export function clearDetailStatements(db,matchId) {
  return ['player_round_stats','player_match_entries','match_maps','match_map_walkovers']
    .map(table=>db.prepare(`DELETE FROM ${table} WHERE match_id=?`).bind(matchId));
}
export async function readCorrectionHistory(db,tournamentId,matchId) {
  const [result]=await db.batch([db.prepare(`SELECT created_at,correction_type,reason,old_state,new_state
    FROM match_correction_audit WHERE tournament_id=? AND match_id=? ORDER BY id DESC`).bind(tournamentId,matchId)]);
  if(!result.success)throw new Error('Correction history unavailable');
  return result.results;
}
export async function readResultCorrectionForm(request) {
  return readAdminForm(request,{maxBytes:4096,allowedField:key=>
    ['intent','result_revision','score1','score2','result_type','walkover_winner','reason','confirmed'].includes(key)});
}
export async function saveResultCorrection(db,tournamentId,matchId,form) {
  const reason=correctionReason(form.reason);
  if(form.intent!=='correct-result'||form.confirmed!=='yes')throw new AdminError('Confirm the result correction before saving.');
  const state=await readLiveResults(db,tournamentId);
  if(state.historical)throw new AdminError('Historical S1/S2 results are read-only.',409);
  if(form.result_revision!==state.revision)throw new AdminError('The bracket changed. Reload before correcting.',409);
  const match=state.matches.find(m=>m.id===matchId);
  if(!match)throw new AdminError('Match not found.',404);
  if(match.status!=='completed'||![match.team1_id,match.team2_id].includes(match.winner_id)
    ||!match.team1_id||!match.team2_id||match.team1_id===match.team2_id)
    throw new AdminError('A confirmed result with resolved teams is required.',409);
  const data=JSON.parse(state.snapshot);
  if(!data.tournament||data.tournament[0]==='completed'||data.tournament[1])
    throw new AdminError('Tournament is completed and read-only.',409);
  for(const [,side,type,parentId,byeId] of data.sources.filter(s=>s[0]===matchId)) {
    const parent=state.matches.find(m=>m.id===parentId);
    const bye=data.byes.find(b=>b[0]===match.stage_id&&b[1]===byeId);
    const valid=parent&&parent.stage_id===match.stage_id&&parent.sort_order<match.sort_order
      &&parent.status==='completed'&&parent.team1_id&&parent.team2_id&&[parent.team1_id,parent.team2_id].includes(parent.winner_id);
    const expected=type==='bye'?bye?.[2]:valid?
      type==='winner'?parent.winner_id:type==='loser'?parent.winner_id===parent.team1_id?parent.team2_id:parent.team1_id:null:null;
    if(!expected||expected!==match[`team${side}_id`])throw new AdminError('Match teams disagree with their bracket sources.',409);
  }
  if(!['played','walkover'].includes(form.result_type))throw new AdminError('Select Played or W/O.');
  const walkover=form.result_type==='walkover';
  const mapsGuard=walkover?null:await playedMapGuard(db,tournamentId,match);
  let score1=0,score2=0,winner;
  if(walkover) {
    if(![match.team1_id,match.team2_id].includes(form.walkover_winner))throw new AdminError('Select the W/O winner.');
    winner=form.walkover_winner;
  }else {
    if(![form.score1,form.score2].every(n=>typeof n==='string'&&/^(0|[1-9]\d*)$/.test(n)))throw new AdminError('Scores must be non-negative whole numbers.');
    score1=Number(form.score1);score2=Number(form.score2);
    const side=seriesWinner(score1,score2,match.series_type,match.map_count);
    if(!side)throw new AdminError(`A confirmed result needs a non-tied score totaling ${match.map_count} maps.`);
    winner=match[`team${side}_id`];
  }
  if(score1===match.score1&&score2===match.score2&&winner===match.winner_id&&form.result_type===match.result_type)
    throw new AdminError('The corrected result is unchanged.');
  const winnerChanged=winner!==match.winner_id;
  const advances=winnerChanged?data.sources.filter(s=>s[3]===matchId):[];
  if(['winner','loser'].some(type=>advances.filter(s=>s[2]===type).length>1))
    throw new AdminError('The bracket repeats an advancement source. Nothing was saved.',409);
  const rewires=[];
  for(const [targetId,side,type] of advances) {
    const target=state.matches.find(m=>m.id===targetId);
    const oldTeam=type==='winner'?match.winner_id:match.winner_id===match.team1_id?match.team2_id:match.team1_id;
    const team=type==='winner'?winner:winner===match.team1_id?match.team2_id:match.team1_id;
    if(!target||!['winner','loser'].includes(type)||![1,2].includes(side)||target.stage_id!==match.stage_id
      ||target.sort_order<=match.sort_order||target.status!=='upcoming'||target.winner_id
      ||target.score1!==0||target.score2!==0||target.result_type==='walkover'
      ||target.detail_maps||target.detail_entries||target.detail_rounds||target.detail_status
      ||target[`team${side}_id`]&&target[`team${side}_id`]!==oldTeam
      ||target[`team${side===1?2:1}_id`]===team)
      throw new AdminError(`Correction blocked by downstream match ${targetId}: confirmed, started, or conflicting state. Nothing was saved.`,409);
    rewires.push({match_id:targetId,side,old_team:target[`team${side}_id`],new_team:team});
  }
  const canonicalSQL=`SELECT
    (SELECT json_group_array(json_array(map_number,map_id,winner_team_id,score_team1,score_team2,mvp_player_id,result_note)) FROM match_maps WHERE match_id=?1) AS maps,
    (SELECT json_group_array(json_array(entry_index,player_id,team_id,uid_snapshot,ign_snapshot)) FROM player_match_entries WHERE match_id=?1) AS entries,
    (SELECT json_group_array(json_array(entry_index,round_index,map_number,kills,deaths,assists)) FROM player_round_stats WHERE match_id=?1) AS rounds,
    (SELECT json_group_array(json_array(map_number,map_id,winner_team_id)) FROM match_map_walkovers WHERE match_id=?1) AS walkovers,
    (SELECT json_array(match_id,status,payload,revision) FROM match_detail_edits WHERE match_id=?1) AS edit`;
  const canonicalSnapshotSQL=`json_object('maps',json(maps),'entries',json(entries),'rounds',json(rounds),'walkovers',json(walkovers),'edit',json(edit))`;
  const [canonical]=await db.batch([db.prepare(`SELECT ${canonicalSnapshotSQL} AS snapshot FROM (${canonicalSQL})`).bind(matchId)]);
  if(!canonical.success)throw new Error('Canonical details unavailable');
  const canonicalSnapshot=canonical.results[0].snapshot;
  const oldDetails=JSON.parse(canonicalSnapshot);
  const edit=oldDetails.edit;
  const newMatch={...match,score1,score2,winner_id:winner,result_type:form.result_type};
  const statements=[db.prepare(`UPDATE tournaments SET name=CASE WHEN (${resultSnapshotSQL})=?2 THEN name ELSE NULL END WHERE id=?1`).bind(tournamentId,state.snapshot),
    db.prepare(`UPDATE matches SET date=CASE WHEN (SELECT ${canonicalSnapshotSQL} FROM (${canonicalSQL}))=?2 THEN date ELSE NULL END WHERE id=?1`).bind(matchId,canonicalSnapshot),
    ...clearDetailStatements(db,matchId),
    db.prepare('UPDATE matches SET score1=?,score2=?,winner_id=?,result_type=? WHERE id=? AND tournament_id=?')
      .bind(score1,score2,winner,form.result_type,matchId,tournamentId)];
  if(mapsGuard)statements.unshift(mapsGuard);
  if(edit&&!walkover) {
    const payload={...JSON.parse(edit[2]),correction_required:true};
    statements.push(db.prepare("UPDATE match_detail_edits SET status='draft',payload=?,revision=revision+1 WHERE match_id=?")
      .bind(JSON.stringify(payload),matchId));
  }else statements.push(db.prepare('DELETE FROM match_detail_edits WHERE match_id=?').bind(matchId));
  for(const r of rewires)statements.push(db.prepare(`UPDATE matches SET team${r.side}_id=? WHERE id=? AND tournament_id=?`)
    .bind(r.new_team,r.match_id,tournamentId));
  statements.push(auditStatement(db,tournamentId,matchId,winnerChanged?'winner':'series-result',reason,
    {match,details:oldDetails,edit:edit?JSON.parse(edit[2]):null,downstream:rewires.map(r=>({match_id:r.match_id,side:r.side,team_id:r.old_team}))},
    {match:newMatch,detailsActive:false,downstream:rewires.map(r=>({match_id:r.match_id,side:r.side,team_id:r.new_team}))}));
  try {
    const results=await db.batch(statements);
    if(results.some(r=>!r.success))throw new Error('Result correction failed');
  }catch(error) {
    if(/NOT NULL constraint failed: tournaments.name|NOT NULL constraint failed: matches.date/.test(String(error?.message)))
      throw new AdminError('The bracket changed while saving. Reload to review it.',409);
    throw error;
  }
}
