import {AdminError,readAdminForm} from './tournaments.mjs';
import {resultSnapshotSQL,seriesWinner} from './live-results.mjs';
import {validateDetails} from './match-details.mjs';

export const completionSnapshotSQL=`json_object(
 'competition',json(${resultSnapshotSQL}),
 'setup',json((SELECT json_group_array(json_array(id,format,bracket_size)) FROM (SELECT * FROM tournament_stages WHERE tournament_id=?1 ORDER BY id))),
 'participants',json((SELECT json_group_array(team_id) FROM (SELECT * FROM tournament_teams WHERE tournament_id=?1 ORDER BY team_id))),
 'edits',json((SELECT json_group_array(json_array(e.match_id,e.status,e.payload,e.revision)) FROM (SELECT e.* FROM match_detail_edits e JOIN matches m ON m.id=e.match_id WHERE m.tournament_id=?1 ORDER BY e.match_id)e)),
 'maps',json((SELECT json_group_array(json_array(match_id,map_number,map_id,winner_team_id,score_team1,score_team2,mvp_player_id)) FROM (SELECT mm.* FROM match_maps mm JOIN matches m ON m.id=mm.match_id WHERE m.tournament_id=?1 ORDER BY match_id,map_number))),
 'walkovers',json((SELECT json_group_array(json_array(match_id,map_number,map_id,winner_team_id)) FROM (SELECT w.* FROM match_map_walkovers w JOIN matches m ON m.id=w.match_id WHERE m.tournament_id=?1 ORDER BY match_id,map_number))),
 'entries',json((SELECT json_group_array(json_array(match_id,entry_index,player_id,team_id,uid_snapshot,ign_snapshot)) FROM (SELECT p.* FROM player_match_entries p JOIN matches m ON m.id=p.match_id WHERE m.tournament_id=?1 ORDER BY match_id,entry_index))),
 'stats',json((SELECT json_group_array(json_array(match_id,entry_index,round_index,map_number,kills,deaths,assists)) FROM (SELECT p.* FROM player_round_stats p JOIN matches m ON m.id=p.match_id WHERE m.tournament_id=?1 ORDER BY match_id,entry_index,round_index))),
 'rosters',json((SELECT json_group_array(json_array(team_id,player_id,ign_snapshot)) FROM (SELECT * FROM tournament_rosters WHERE tournament_id=?1 ORDER BY team_id,position))),
 'pool',json((SELECT json_group_array(id) FROM (SELECT id FROM maps ORDER BY id))),
 'assignments',json((SELECT json_group_array(json_array(stage_id,round_id,match_id,scope,team1_id,team2_id,maps)) FROM (SELECT * FROM official_map_assignments WHERE tournament_id=?1 ORDER BY id)))
)`;

export function completionReadiness(data) {
 const {competition:c}=data;const issues=[];
 const matches=c.matches.map(([id,stage_id,round_id,bracket_slot,status,team1_id,team2_id,score1,score2,winner_id,result_type])=>({id,stage_id,round_id,bracket_slot,status,team1_id,team2_id,score1,score2,winner_id,result_type}));
 const stages=data.setup;
 if(!matches.length)issues.push('Draw the official bracket first.');
 if(stages.length!==1||stages[0][1]!=='single-elimination'||![4,8,16,32,64].includes(stages[0][2]))return {ready:false,issues:[...issues,'Review the tournament bracket structure.'],placements:{champion:null,runnerUp:null,third:null}};
 const stage=stages[0];const rounds=c.rounds.filter(r=>r[0]===stage?.[0]);const main=rounds.filter(r=>r[3]!==3);const bronze=rounds.filter(r=>r[3]===3);
 if(main.length!==Math.log2(stage[2])||main.filter(r=>r[3]===1).length!==1||main.at(-1)?.[3]!==1||bronze.length>1||rounds.some((r,i)=>r[2]!==i+1||![null,1,3].includes(r[3]))||bronze.length&&rounds.at(-2)!==bronze[0])return {ready:false,issues:[...issues,'Review Final and Bronze round configuration.'],placements:{champion:null,runnerUp:null,third:null}};
 const findSlot=(round,slot)=>matches.filter(m=>m.stage_id===stage?.[0]&&m.round_id===round[1]&&m.bracket_slot===slot);
 for(const round of rounds){
  const index=main.indexOf(round);const capacity=round[3]===3?1:stage[2]/2**(index+1);
  const byes=c.byes.filter(b=>b[0]===stage[0]&&b[3]===round[1]);
  if(byes.some(b=>index!==0||b[4]<1||b[4]>capacity||!data.participants.includes(b[2])))issues.push('Review bracket BYEs.');
  for(let slot=1;slot<=capacity;slot++)if(findSlot(round,slot).length+byes.filter(b=>b[4]===slot).length!==1)issues.push(`${round[3]===1?'Final':round[3]===3?'Bronze':'Bracket'} has a missing or repeated match.`);
 }
 const unresolved=matches.filter(m=>m.status!=='completed'||!m.team1_id||!m.team2_id||m.team1_id===m.team2_id||![m.team1_id,m.team2_id].includes(m.winner_id));
 if(unresolved.length)issues.push(`${unresolved.length} required matches remain unresolved.`);
 for(const m of matches){
  const rule=c.stages.find(s=>s[0]===m.stage_id);const round=rounds.find(r=>r[1]===m.round_id);
  if(!round||!rule||m.bracket_slot<1||m.bracket_slot>(round[3]===3?1:stage[2]/2**(main.indexOf(round)+1)))issues.push('Review unexpected bracket matches.');
  if(!data.participants.includes(m.team1_id)||!data.participants.includes(m.team2_id))issues.push('Match teams disagree with tournament participants.');
  if(unresolved.includes(m))continue;
  if(m.result_type==='walkover'){
   if(m.score1!==0||m.score2!==0||data.edits.some(e=>e[0]===m.id)||[data.maps,data.walkovers,data.entries,data.stats].some(rows=>rows.some(r=>r[0]===m.id)))issues.push('Review full-match W/O data.');
  }else if(m.result_type!=='played'||m.winner_id!==m[`team${seriesWinner(m.score1,m.score2,rule?.[1],rule?.[2])}_id`])issues.push('Review confirmed series scores.');
  else {
   const edit=data.edits.find(e=>e[0]===m.id);const maps=data.maps.filter(r=>r[0]===m.id);const wo=data.walkovers.filter(r=>r[0]===m.id);
   if(edit?.[1]!=='complete'||maps.length+wo.length!==rule[2]){issues.push('Required Match Details remain pending.');continue;}
   try{
    const payload=JSON.parse(edit[2]);if(payload.correction_required)throw new Error();
    const rows=data.rosters.filter(r=>[m.team1_id,m.team2_id].includes(r[0])).map(([team_id,player_id])=>({team_id,player_id}));
    const assignment=data.assignments.find(a=>a[0]===m.stage_id&&a[1]===m.round_id&&a[3]==='match'&&a[2]===m.id&&a[4]===m.team1_id&&a[5]===m.team2_id)??data.assignments.find(a=>a[0]===m.stage_id&&a[1]===m.round_id&&a[3]==='round');
    if(!assignment)throw new Error();
    validateDetails(payload,{match:m,rows,pool:data.pool.map(id=>({id})),assignments:JSON.parse(assignment[6])},true);
    for(const [i,p]of payload.maps.entries()){
     const saved=(p.mode==='walkover'?wo:maps).find(r=>r[1]===i+1);const winner=m[`team${p.mode==='walkover'?p.winner_side:Number(p.score1)>Number(p.score2)?1:2}_id`];
     if(!saved||saved[2]!==p.map_id||saved[3]!==winner||p.mode!=='walkover'&&(saved[4]!==Number(p.score1)||saved[5]!==Number(p.score2)||saved[6]!==p.mvp))throw new Error();
     const stats=data.stats.filter(r=>r[0]===m.id&&r[3]===i+1);
     if(p.mode==='walkover'){if(stats.length)throw new Error();continue;}
     const played=p.players.filter(p=>p.kills!=='');if(stats.length!==played.length)throw new Error();
     for(const player of played){const entry=data.entries.find(e=>e[0]===m.id&&e[2]===player.player_id&&e[3]===rows.find(r=>r.player_id===player.player_id)?.team_id);const stat=stats.find(r=>r[1]===entry?.[1]);if(!stat||stat[4]!==Number(player.kills)||stat[5]!==Number(player.deaths)||stat[6]!==Number(player.assists))throw new Error();}
    }
    const players=new Set(payload.maps.filter(p=>p.mode!=='walkover').flatMap(p=>p.players.filter(p=>p.kills!=='').map(p=>p.player_id)));
    const entries=data.entries.filter(e=>e[0]===m.id);if(entries.length!==players.size||entries.some(e=>!players.has(e[2])))throw new Error();
    if(data.stats.some(r=>r[0]===m.id&&![1,2,3].includes(r[3])))throw new Error();
   }catch{issues.push('Match Details need correction or reconciliation.');}
  }
 }
 const expectedSource=(round,slot,side)=>{
  const index=main.indexOf(round);if(index===0)return null;
  const parentRound=round[3]===3?main.at(-2):main[index-1];const parentSlot=(slot-1)*2+side;
  const parent=findSlot(parentRound,parentSlot)[0];const bye=c.byes.find(b=>b[0]===stage[0]&&b[3]===parentRound[1]&&b[4]===parentSlot);
  return parent?{type:round[3]===3?'loser':'winner',parent}:bye&&round[3]!==3?{type:'bye',bye}:null;
 };
 for(const m of matches){const round=rounds.find(r=>r[1]===m.round_id);if(!round)continue;
  for(const side of [1,2]){const sources=c.sources.filter(s=>s[0]===m.id&&s[1]===side);const expected=expectedSource(round,m.bracket_slot,side);
   if(main.indexOf(round)===0){if(sources.length)issues.push('Review opening bracket sources.');continue;}
   const s=sources[0];const p=expected?.parent;const team=expected?.type==='bye'?expected.bye[2]:expected?.type==='loser'?(p.winner_id===p.team1_id?p.team2_id:p.team1_id):p?.winner_id;
   if(!expected||sources.length!==1||s[2]!==expected.type||m[`team${side}_id`]!==team||(expected.type==='bye'?s[4]!==expected.bye[1]:s[3]!==p.id))issues.push('Progression conflict: match teams disagree with their feeder results.');
  }
 }
 const opening=matches.filter(m=>m.stage_id===stage[0]&&m.round_id===main[0][1]).flatMap(m=>[m.team1_id,m.team2_id]);opening.push(...c.byes.filter(b=>b[0]===stage[0]&&b[3]===main[0][1]).map(b=>b[2]));
 if(opening.length!==data.participants.length||new Set(opening).size!==opening.length||opening.some(id=>!data.participants.includes(id)))issues.push('Review opening teams and BYEs.');
 if(c.sources.some(s=>![1,2].includes(s[1])||!matches.some(m=>m.id===s[0])))issues.push('Review bracket sources.');
 const final=main.at(-1)&&findSlot(main.at(-1),1)[0];const third=bronze[0]&&findSlot(bronze[0],1)[0];
 const resolved=m=>m&&!unresolved.includes(m)&&m.status==='completed';
 return {ready:issues.length===0,issues:[...new Set(issues)],placements:{champion:resolved(final)?final.winner_id:null,runnerUp:resolved(final)?final.winner_id===final.team1_id?final.team2_id:final.team1_id:null,third:resolved(third)?third.winner_id:null}};
}

export async function readCompletion(db,id){
 const [result,teams]=await db.batch([db.prepare(`SELECT ${completionSnapshotSQL} AS snapshot`).bind(id),db.prepare('SELECT id,name FROM teams ORDER BY id')]);
 if(!result.success||!teams.success)throw new Error('Completion read failed');
 const snapshot=result.results[0].snapshot;const data=JSON.parse(snapshot);if(!data.competition.tournament)return null;
 const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshot))),b=>b.toString(16).padStart(2,'0')).join('');
 return {...completionReadiness(data),snapshot,revision,status:data.competition.tournament[0],historical:['clash-for-glory-s1','clash-for-glory-s2'].includes(id),teams:teams.results};
}
export function readCompletionForm(request){return readAdminForm(request,{allowedField:key=>['intent','revision','confirmed'].includes(key)});}
export async function completeTournament(db,id,form){
 const state=await readCompletion(db,id);if(!state)throw new AdminError('Tournament not found.',404);
 if(state.historical||state.status==='completed')throw new AdminError('Tournament is completed and read-only.',409);
 if(form.intent!=='complete-tournament'||form.confirmed!=='yes')throw new AdminError('Confirm tournament completion.');
 if(!state.ready)throw new AdminError(state.issues.join(' '),409);
 if(form.revision!==state.revision)throw new AdminError('Competition data changed. Review completion again.',409);
 try{
  const result=await db.batch([db.prepare(`UPDATE tournaments SET name=CASE WHEN (${completionSnapshotSQL})=?2 THEN name ELSE NULL END,status='completed',winner_team_id=?3 WHERE id=?1 RETURNING id`).bind(id,state.snapshot,state.placements.champion)]);
  if(result.some(r=>!r.success))throw new Error('Tournament completion failed');
  if(result[0].results.length!==1)throw new AdminError('Tournament changed while completing. Nothing was saved.',409);
 }catch(error){if(/NOT NULL constraint failed: tournaments.name/.test(String(error?.message)))throw new AdminError('Competition data changed while completing. Nothing was saved.',409);throw error;}
}
