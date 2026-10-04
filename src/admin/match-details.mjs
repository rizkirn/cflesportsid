import { AdminError, readAdminForm } from './tournaments.mjs';
import { seriesWinner } from './live-results.mjs';
import { correctionReason, auditStatement, clearDetailStatements } from './corrections.mjs';
import {assignmentsAvailable,officialMapsSQL} from './map-assignments.mjs';

const historical = new Set(['clash-for-glory-s1', 'clash-for-glory-s2']);
const mapPoolSQL = `SELECT maps.id,maps.name FROM maps JOIN matches m ON m.id=?1 JOIN tournaments t ON t.id=m.tournament_id
  WHERE maps.game=t.game AND (
    EXISTS(SELECT 1 FROM stage_map_pool p WHERE p.tournament_id=m.tournament_id AND p.stage_id=m.stage_id AND p.map_id=maps.id)
    OR (maps.active=1 AND NOT EXISTS(SELECT 1 FROM stage_map_pool p WHERE p.tournament_id=m.tournament_id AND p.stage_id=m.stage_id)))
  ORDER BY maps.name,maps.id`;
const effectivePoolSQL=assignment=>assignment?`SELECT id,name FROM maps WHERE id IN(SELECT id FROM (${mapPoolSQL})) OR id IN(SELECT value FROM json_each(${officialMapsSQL})) ORDER BY name,id`:mapPoolSQL;
const detailSnapshotSQL = assignment => `json_object(
  'tournament',json((SELECT json_array(t.status,t.winner_team_id) FROM tournaments t JOIN matches m ON m.tournament_id=t.id WHERE m.id=?1)),
  'assignments',${assignment?`json(${officialMapsSQL})`:'NULL'},
  'match',json((SELECT json_array(m.tournament_id,m.stage_id,m.status,m.team1_id,m.team2_id,m.score1,m.score2,m.winner_id,s.series_type,s.map_count,m.result_type)
    FROM matches m JOIN tournament_stages s ON s.tournament_id=m.tournament_id AND s.id=m.stage_id WHERE m.id=?1)),
  'roster',json((SELECT json_group_array(json_array(team_id,player_id,ign_snapshot,uid)) FROM
    (SELECT r.*,p.uid FROM tournament_rosters r JOIN players p ON p.id=r.player_id JOIN matches m ON m.tournament_id=r.tournament_id
      WHERE m.id=?1 AND r.team_id IN(m.team1_id,m.team2_id) ORDER BY r.team_id,r.position))),
  'pool',json((SELECT json_group_array(id) FROM (${effectivePoolSQL(assignment)}))),
  'configured_pool',json((SELECT json_group_array(id) FROM (${mapPoolSQL}))),
  'edit',json((SELECT json_array(status,payload,revision) FROM match_detail_edits WHERE match_id=?1)),
  'children',json_array((SELECT count(*) FROM match_maps WHERE match_id=?1),(SELECT count(*) FROM player_match_entries WHERE match_id=?1),(SELECT count(*) FROM player_round_stats WHERE match_id=?1),(SELECT count(*) FROM match_map_walkovers WHERE match_id=?1)))`;

export async function readMatchDetails(db, tournamentId, matchId, {correction=false}={}) {
  const assignmentSchema=await assignmentsAvailable(db);
  const snapshotSQL=detailSnapshotSQL(assignmentSchema);
  const results = await db.batch([
    db.prepare(`SELECT ${snapshotSQL} AS snapshot`).bind(matchId),
    db.prepare(`SELECT m.*,s.series_type,s.map_count,t1.name AS team1_name,t2.name AS team2_name
      FROM matches m JOIN tournament_stages s ON s.tournament_id=m.tournament_id AND s.id=m.stage_id
      LEFT JOIN teams t1 ON t1.id=m.team1_id LEFT JOIN teams t2 ON t2.id=m.team2_id WHERE m.id=? AND m.tournament_id=?`).bind(matchId,tournamentId),
    db.prepare(`SELECT r.*,p.uid FROM tournament_rosters r JOIN players p ON p.id=r.player_id JOIN matches m ON m.tournament_id=r.tournament_id
      WHERE m.id=? AND r.team_id IN(m.team1_id,m.team2_id) ORDER BY r.team_id,r.position`).bind(matchId),
    db.prepare(effectivePoolSQL(assignmentSchema)).bind(matchId),
  ]);
  if (results.some(r=>!r.success)) throw new Error('Match details read failed');
  const match=results[1].results[0];
  if (!match) return null;
  const snapshot=results[0].results[0].snapshot;
  const saved=JSON.parse(snapshot);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshot));
  const revision=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const rows=results[2].results;
  let reason='';
  if (historical.has(tournamentId)) reason='Historical S1/S2 details are read-only.';
  else if(saved.tournament?.[0]==='completed'&&!(correction&&saved.edit?.[0]==='complete')) reason='Tournament is completed. Use the explicit detail correction flow for completed details.';
  else if (match.result_type==='walkover') reason='Full-match W/O: no Match Details are required.';
  else if ((saved.edit?.[0]==='complete' && !correction) || (saved.children.some(n=>n>0) && saved.edit?.[0]!=='complete')) reason='Details are complete or already contain imported data. Use Edit Details for completed editor details.';
  else if(!saved.assignments) reason='Maps not assigned yet';
  else if (match.status!=='completed' || !match.team1_id || !match.team2_id || match.team1_id===match.team2_id
    || match.winner_id!==match[`team${seriesWinner(match.score1,match.score2,match.series_type,match.map_count)}_id`]) reason='Confirm the series result in Bracket before entering details.';
  else if (match.series_type!=='fixed-maps' || match.map_count!==3) reason='This editor supports fixed 3 maps.';
  else if ([match.team1_id,match.team2_id].some(id=>{const n=rows.filter(r=>r.team_id===id).length;return n<5||n>7;})) reason='Each team needs its saved tournament roster of 5–7 players.';
  const payload=saved.edit ? JSON.parse(saved.edit[1]) : emptyDetails(rows);
  if(saved.assignments)payload.maps.forEach((map,i)=>map.map_id=saved.assignments[i]);
  return {match,rows,pool:results[3].results,assignments:saved.assignments??[],assignmentSchema,snapshot,revision,reason,correctable:!historical.has(tournamentId)&&saved.edit?.[0]==='complete'&&match.result_type!=='walkover',status:saved.edit?.[0]??'empty',savedRevision:saved.edit?.[2]??0,payload};
}

export function emptyDetails(rows) {
  return {maps:Array.from({length:3},()=>({mode:'played',winner_side:'',map_id:'',score1:'',score2:'',mvp:'',players:rows.map(r=>({player_id:r.player_id,kills:'',deaths:'',assists:''}))}))};
}
export async function readDetailsForm(request) {
  const fields=await readAdminForm(request,{maxBytes:32768,allowedField:key=>['revision','intent','reason'].includes(key)
    || /^maps\.[0-2]\.(?:mode|winner_side|map_id|score1|score2|mvp)$/.test(key)
    || /^maps\.[0-2]\.players\.(?:[0-9]|1[0-3])\.(?:player_id|kills|deaths|assists)$/.test(key)});
  const maps=Array.from({length:3},(_,i)=>{
    const indices=[...new Set(Object.keys(fields).filter(k=>k.startsWith(`maps.${i}.players.`)).map(k=>Number(k.split('.')[3])))].sort((a,b)=>a-b);
    const players=indices.map((n,j)=>{
      if(n!==j)throw new AdminError('Roster fields must be consecutive. Reload.');
      return Object.fromEntries(['player_id','kills','deaths','assists'].map(k=>[k,fields[`maps.${i}.players.${j}.${k}`]??'']));
    });
    return {mode:fields[`maps.${i}.mode`]??'played',...Object.fromEntries(['winner_side','map_id','score1','score2','mvp'].map(k=>[k,fields[`maps.${i}.${k}`]??''])),players};
  });
  return {revision:fields.revision,intent:fields.intent,reason:fields.reason,payload:{maps}};
}
function number(value,label,required) {
  if(value==='') {if(required)throw new AdminError(`${label} is required.`);return null;}
  if(typeof value!=='string'||!/^(0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw new AdminError(`${label} must be a non-negative whole number.`);
  return Number(value);
}
export function mapResults(payload,pool) {
  if (!Array.isArray(payload?.maps)||payload.maps.length!==3)throw new AdminError('All 3 maps are required, including Map 3 after a 2–0 start.');
  return payload.maps.map((m,i)=>{
    if(m.mode==='walkover') {
      if(m.map_id!==''&&!pool.some(p=>p.id===m.map_id))throw new AdminError(`Map ${i+1}: select a map from the tournament pool.`);
      if(!['1','2'].includes(m.winner_side))throw new AdminError(`Map ${i+1}: select the W/O winner.`);
      return {score1:null,score2:null,side:Number(m.winner_side)};
    }
    if(m.mode!==undefined&&m.mode!=='played')throw new AdminError(`Map ${i+1}: unknown map mode.`);
    if(!pool.some(p=>p.id===m.map_id))throw new AdminError(`Map ${i+1}: select a map from the tournament pool.`);
    const a=number(m.score1,`Map ${i+1} first round score`,true),b=number(m.score2,`Map ${i+1} second round score`,true);
    if(a===b)throw new AdminError(`Map ${i+1}: round scores cannot tie.`);
    return {score1:a,score2:b,side:a>b?1:2};
  });
}
export function validateDetails(payload,state,complete) {
  if(!Array.isArray(payload?.maps)||payload.maps.length!==3)throw new AdminError('All 3 maps are required, including Map 3 after a 2–0 start.');
  for(const [i,m] of payload.maps.entries()) {
    if(state.assignments&&m.map_id!==state.assignments[i])throw new AdminError(`Map ${i+1}: use the confirmed official map.`);
    if(m.mode!==undefined&&!['played','walkover'].includes(m.mode))throw new AdminError(`Map ${i+1}: unknown map mode.`);
    if(m.map_id!==''&&!state.pool.some(p=>p.id===m.map_id))throw new AdminError(`Map ${i+1}: select a map from the tournament pool.`);
    if(m.mode==='walkover') {
      if(!['','1','2'].includes(m.winner_side)||complete&&!m.winner_side)throw new AdminError(`Map ${i+1}: select the W/O winner.`);
      continue;
    }
    number(m.score1,`Map ${i+1} first round score`,complete);number(m.score2,`Map ${i+1} second round score`,complete);
    if(!Array.isArray(m.players)||m.players.length!==state.rows.length||new Set(m.players.map(p=>p.player_id)).size!==state.rows.length
      ||m.players.some(p=>!state.rows.some(r=>r.player_id===p.player_id)))throw new AdminError(`Map ${i+1}: use the saved tournament roster.`);
    for(const p of m.players)for(const k of ['kills','deaths','assists'])number(p[k],`Map ${i+1} ${k}`,false);
    if(m.mvp!==''&&!state.rows.some(r=>r.player_id===m.mvp))throw new AdminError(`Map ${i+1}: select a roster player for ACE Gold.`);
  }
  if(!complete)return;
  const results=mapResults(payload,state.pool);
  for(const [i,m] of payload.maps.entries()) {
    if(m.mode==='walkover')continue;
    for(const p of m.players) {
      const present=['kills','deaths','assists'].filter(k=>p[k]!=='').length;
      if(present!==0&&present!==3)throw new AdminError(`Map ${i+1}: enter all K/D/A values for a participating player, or leave all three blank.`);
    }
    const played=m.players.filter(p=>['kills','deaths','assists'].every(k=>p[k]!==''));
    for(const side of [1,2])if(played.filter(p=>state.rows.find(r=>r.player_id===p.player_id).team_id===state.match[`team${side}_id`]).length!==5)
      throw new AdminError(`Map ${i+1}: exactly 5 participating players are required per team.`);
    if(!played.some(p=>p.player_id===m.mvp))throw new AdminError(`Map ${i+1}: select exactly one participating player as ACE Gold/MVP.`);
  }
  const score1=results.filter(r=>r.side===1).length,score2=3-score1;
  if(score1!==state.match.score1||score2!==state.match.score2)throw new AdminError(`Detailed series score ${score1}–${score2} differs from confirmed score ${state.match.score1}–${state.match.score2}. Correct the details before completing.`);
}
export async function saveMatchDetails(db,tournamentId,matchId,form) {
  const correcting=form.intent==='correct-details';
  const state=await readMatchDetails(db,tournamentId,matchId,{correction:correcting});
  if(!state)throw new AdminError('Match not found.',404);
  if(state.reason)throw new AdminError(state.reason,409);
  if(form.revision!==state.revision)throw new AdminError('Match details or roster changed. Reload before saving.',409);
  if(!['save-draft','complete-details','correct-details'].includes(form.intent))throw new AdminError('Unknown detail action.');
  if(correcting&&!state.correctable)throw new AdminError('No completed editor details to correct.',409);
  const complete=form.intent!=='save-draft';
  const needsCorrection=correcting||state.payload.correction_required===true;
  const reason=complete&&needsCorrection?correctionReason(form.reason):null;
  form.payload=normalizeDetails(form.payload,state.rows);
  if(needsCorrection&&!complete)form.payload.correction_required=true;
  validateDetails(form.payload,state,complete);
  const statements=[db.prepare(`UPDATE matches SET date=CASE WHEN (${detailSnapshotSQL(state.assignmentSchema)})=?2 THEN date ELSE NULL END WHERE id=?1`).bind(matchId,state.snapshot),
    db.prepare(`INSERT INTO match_detail_edits(match_id,status,payload,revision) VALUES(?,?,?,?)
      ON CONFLICT(match_id) DO UPDATE SET status=excluded.status,payload=excluded.payload,revision=excluded.revision`)
      .bind(matchId,complete?'complete':'draft',JSON.stringify(form.payload),state.savedRevision+1)];
  if(complete) {
    if(needsCorrection) {
      statements.push(auditStatement(db,tournamentId,matchId,'details',reason,
        {match:state.match,details:state.payload},{match:state.match,details:form.payload}));
      statements.push(...clearDetailStatements(db,matchId));
    }
    const results=mapResults(form.payload,state.pool);
    const participants=state.rows.filter(r=>form.payload.maps.some(m=>m.players.some(p=>p.player_id===r.player_id&&p.kills!=='')));
    form.payload.maps.forEach((m,i)=>statements.push(m.mode==='walkover'
      ? db.prepare('INSERT INTO match_map_walkovers(match_id,map_number,map_id,winner_team_id) VALUES(?,?,?,?)')
        .bind(matchId,i+1,m.map_id||null,state.match[`team${results[i].side}_id`])
      : db.prepare(`INSERT INTO match_maps(match_id,map_number,map_id,winner_team_id,score_team1,score_team2,mvp_player_id) VALUES(?,?,?,?,?,?,?)`)
        .bind(matchId,i+1,m.map_id,state.match[`team${results[i].side}_id`],results[i].score1,results[i].score2,m.mvp)));
    participants.forEach((r,index)=>{
      statements.push(db.prepare(`INSERT INTO player_match_entries(match_id,entry_index,player_id,team_id,uid_snapshot,ign_snapshot) VALUES(?,?,?,?,?,?)`)
        .bind(matchId,index,r.player_id,r.team_id,r.uid,r.ign_snapshot));
      let roundIndex=0;
      form.payload.maps.forEach((m,i)=>{
        const p=m.players.find(p=>p.player_id===r.player_id);
        if(p.kills!=='')statements.push(db.prepare(`INSERT INTO player_round_stats(match_id,entry_index,round_index,map_number,kills,deaths,assists) VALUES(?,?,?,?,?,?,?)`)
          .bind(matchId,index,roundIndex++,i+1,Number(p.kills),Number(p.deaths),Number(p.assists)));
      });
    });
  }
  try {const results=await db.batch(statements);if(results.some(r=>!r.success))throw new Error('Match details save failed');}
  catch(error) {if(/NOT NULL constraint failed: matches.date|UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(String(error?.message)))throw new AdminError('Match details changed while saving. Reload to review the saved state.',409);throw error;}
}

export function normalizeDetails(payload,rows) {
  if(!Array.isArray(payload?.maps))return payload;
  return {maps:payload.maps.map(m=>m.mode==='walkover'
    ? {mode:'walkover',winner_side:m.winner_side??'',map_id:m.map_id,score1:'',score2:'',mvp:'',players:emptyDetails(rows).maps[0].players}
    : {...m,winner_side:''})};
}
