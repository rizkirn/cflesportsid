import {AdminError,readAdminForm} from './tournaments.mjs';
import {resolveVetoResult} from '../utils/veto-engine.mjs';
import scrimSettings from '../data/veto/scrim.json' with {type:'json'};

export const officialMapsSQL=`(SELECT a.maps FROM official_map_assignments a JOIN matches m ON m.id=?1
 WHERE a.tournament_id=m.tournament_id AND a.stage_id=m.stage_id AND a.round_id=m.round_id
 AND (a.scope='round' OR(a.match_id=m.id AND a.team1_id=m.team1_id AND a.team2_id=m.team2_id))
 ORDER BY a.scope='match' DESC LIMIT 1)`;
const contextSQL=`json_object(
 'tournament',json((SELECT json_array(name,status,winner_team_id) FROM tournaments WHERE id=?1)),
 'stage',json((SELECT json_array(id,series_type,map_count,final_map_rule,action_seconds,reserve_seconds) FROM tournament_stages WHERE tournament_id=?1 AND id=?2)),
 'pool',json((SELECT json_group_array(json_array(id,name)) FROM (SELECT id,name FROM maps WHERE game=(SELECT game FROM tournaments WHERE id=?1) AND
 (EXISTS(SELECT 1 FROM stage_map_pool WHERE tournament_id=?1 AND stage_id=?2 AND map_id=maps.id) OR(active=1 AND NOT EXISTS(SELECT 1 FROM stage_map_pool WHERE tournament_id=?1 AND stage_id=?2))) ORDER BY name,id))),
 'steps',json((SELECT json_group_array(json_array(team_side,action)) FROM(SELECT * FROM veto_steps WHERE tournament_id=?1 AND stage_id=?2 ORDER BY step_order))),
 'matches',json((SELECT json_group_array(json_array(id,status,team1_id,team2_id,score1,score2,winner_id,result_type,
 (SELECT count(*) FROM match_maps WHERE match_id=m.id),(SELECT count(*) FROM match_map_walkovers WHERE match_id=m.id),(SELECT count(*) FROM match_detail_edits WHERE match_id=m.id)))
 FROM(SELECT * FROM matches WHERE tournament_id=?1 AND stage_id=?2 AND round_id=?3 AND(?4='' OR id=?4) ORDER BY id)m)),
 'assignment',json((SELECT json_group_array(json_array(id,maps,actions,confirmed_at,team1_id,team2_id)) FROM official_map_assignments WHERE tournament_id=?1 AND stage_id=?2 AND round_id=?3 AND(scope='round' AND ?4='' OR match_id=?4))))`;

export async function assignmentsAvailable(db){return (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='official_map_assignments'").all()).results.length===1;}
export async function playedMapStatus(db,tournamentId,match){
 const required=match.series_type==='fixed-maps'&&match.map_count===3&&!['clash-for-glory-s1','clash-for-glory-s2'].includes(tournamentId)&&await assignmentsAvailable(db);
 const late=['semi-final','bronze','final'].includes(match.round_id);
 const snapshot=required?(await db.prepare(`SELECT ${officialMapsSQL} AS maps`).bind(match.id).all()).results[0]?.maps:null;
 return {required,assigned:!required||!!snapshot,snapshot,href:`/admin/tournaments/${tournamentId}/maps?${late?'match='+match.id:'round='+match.round_id}`,message:late?'Complete the map veto before entering the result.':'Confirm the official maps before entering the result.',label:late?'Open Veto':'Open Maps'};
}
export async function playedMapGuard(db,tournamentId,match){
 const status=await playedMapStatus(db,tournamentId,match);
 if(!status.assigned)throw new AdminError(status.message,409);
 return status.required?db.prepare(`UPDATE tournaments SET name=CASE WHEN ${officialMapsSQL}=?2 THEN name ELSE NULL END WHERE id=?3`).bind(match.id,status.snapshot,tournamentId):null;
}
export async function readMapContext(db,tournamentId,{roundId,matchId}={}) {
 if(!(await assignmentsAvailable(db)))throw new AdminError('Official maps require migration 0008.',503);
 if(['clash-for-glory-s1','clash-for-glory-s2'].includes(tournamentId))throw new AdminError('Historical maps are read-only.',403);
 const target=matchId?await db.prepare(`SELECT r.*,m.team1_id,m.team2_id,m.id AS match_id FROM matches m JOIN tournament_rounds r ON r.tournament_id=m.tournament_id AND r.stage_id=m.stage_id AND r.id=m.round_id WHERE m.tournament_id=? AND m.id=?`).bind(tournamentId,matchId).all():await db.prepare('SELECT * FROM tournament_rounds WHERE tournament_id=? AND id=?').bind(tournamentId,roundId).all();
 const round=target.results[0];if(!round||target.results.length!==1)throw new AdminError('Round or match not found.',404);
 const late=['semi-final','bronze','final'].includes(round.id)||round.placement!==null;
 if(!!matchId!==late)throw new AdminError(late?'Use match Veto for this round.':'Use round Randomizer for this round.');
 const args=[tournamentId,round.stage_id,round.id,matchId??''];
 const snapshot=(await db.prepare(`SELECT ${contextSQL} AS snapshot`).bind(...args).all()).results[0].snapshot;
 const data=JSON.parse(snapshot);if(!data.tournament||!data.stage)throw new AdminError('Tournament setup unavailable.',404);
 const teams=matchId?(await db.prepare('SELECT id,name,tag FROM teams WHERE id IN(?,?)').bind(round.team1_id,round.team2_id).all()).results:[];
 const steps=data.steps.length?data.steps.map(([team,action])=>({team,action})):defaultVetoSteps(data.pool.length);
 const assignment=data.assignment.find(row=>!matchId||row[4]===round.team1_id&&row[5]===round.team2_id);
 if(data.stage[1]!=='fixed-maps'||data.stage[2]!==3||data.stage[3]!=='random')throw new AdminError('Official maps require Fixed 3 Maps with random Map 3.');
 const locked=data.tournament[1]==='completed'||!!data.tournament[2]||data.matches.some(row=>row[7]==='walkover'?!!matchId&&(data.assignment.length>0||row.slice(8).some(Boolean)):row[1]!=='upcoming'||row[4]||row[5]||row[6]||row.slice(8).some(Boolean));
 const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshot))),b=>b.toString(16).padStart(2,'0')).join('');
 return {tournamentId,round,matchId,teams,scope:matchId?'match':'round',source:matchId?'veto':'randomizer',snapshot,revision,args,locked,pool:data.pool.map(([id,name])=>({id,name})),steps,
 actionSeconds:data.stage[4]??20,reserveSeconds:data.stage[5]??90,assignment:assignment?JSON.parse(assignment[1]):null,
 assignmentActions:assignment?JSON.parse(assignment[2]):[],confirmedAt:assignment?.[3]??null};
}
export function defaultVetoSteps(poolSize){
 if(poolSize<3)throw new AdminError('At least three maps are required.');
 let bans=Math.min(scrimSettings.veto.steps.filter(step=>step.action==='ban').length,poolSize-3);
 return scrimSettings.veto.steps.filter(step=>step.action==='pick'||bans-->0);
}
export async function readMapConfirmation(request){return readAdminForm(request,{maxBytes:16384,allowedField:key=>['revision','maps','actions','confirmed'].includes(key)});}
export async function confirmMaps(db,tournamentId,target,form){
 const state=await readMapContext(db,tournamentId,target);
 if(state.locked)throw new AdminError('Maps are locked after a match starts or has saved details.',409);
 if(state.matchId&&state.teams.length!==2)throw new AdminError('Both teams must be known before Veto.',409);
 if(form.confirmed!=='yes')throw new AdminError('Confirm the official maps.');
 if(form.revision!==state.revision)throw new AdminError('Round, teams, rules or maps changed. Reload before confirming.',409);
 let maps,actions;try{maps=JSON.parse(form.maps);actions=JSON.parse(form.actions);}catch{throw new AdminError('Run the map tool first.');}
 if(!Array.isArray(maps)||maps.length!==3||new Set(maps).size!==3||maps.some(id=>!state.pool.some(map=>map.id===id)))throw new AdminError('Confirm three distinct maps from this tournament pool.');
 if(state.source==='veto'){
  try{const resolved=resolveVetoResult(state.pool.map(map=>map.id),state.steps,actions,maps[2]);if(JSON.stringify(resolved)!==JSON.stringify(maps))throw new Error('Picks differ from the veto history.');}catch(error){throw new AdminError(error.message);}
 }else if(!Array.isArray(actions)||actions.length)throw new AdminError('Randomizer results cannot contain veto actions.');
 const id=state.matchId?`match:${state.matchId}`:`round:${tournamentId}:${state.round.stage_id}:${state.round.id}`;
 const statements=[db.prepare(`UPDATE tournaments SET name=CASE WHEN(${contextSQL})=?5 THEN name ELSE NULL END WHERE id=?1`).bind(...state.args,state.snapshot),
 db.prepare('DELETE FROM official_map_assignments WHERE id=?').bind(id),
 db.prepare(`INSERT INTO official_map_assignments(id,tournament_id,stage_id,round_id,match_id,source,scope,team1_id,team2_id,maps,actions) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(id,tournamentId,state.round.stage_id,state.round.id,state.matchId??null,state.source,state.scope,state.round.team1_id??null,state.round.team2_id??null,JSON.stringify(maps),JSON.stringify(actions))];
 try{const results=await db.batch(statements);if(results.some(result=>!result.success))throw new Error('Map confirmation failed');}catch(error){if(/NOT NULL|FOREIGN KEY|UNIQUE/.test(error.message))throw new AdminError('Map context changed. Reload before confirming.',409);throw error;}
 return maps;
}
