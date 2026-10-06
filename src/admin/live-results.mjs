import {mutationDatabase} from './audit.mjs';
import { AdminError } from './tournaments.mjs';
import { playedMapGuard } from './map-assignments.mjs';

const historical = new Set(['clash-for-glory-s1', 'clash-for-glory-s2']);
export const resultSnapshotSQL = `json_object(
  'tournament',json((SELECT json_array(status,winner_team_id) FROM tournaments WHERE id=?1)),
  'stages',json((SELECT json_group_array(json_array(id,series_type,map_count)) FROM (SELECT * FROM tournament_stages WHERE tournament_id=?1 ORDER BY id))),
  'rounds',json((SELECT json_group_array(json_array(stage_id,id,sort_order,placement)) FROM (SELECT * FROM tournament_rounds WHERE tournament_id=?1 ORDER BY stage_id,sort_order))),
  'matches',json((SELECT json_group_array(json_array(id,stage_id,round_id,bracket_slot,status,team1_id,team2_id,score1,score2,winner_id,result_type)) FROM (SELECT * FROM matches WHERE tournament_id=?1 ORDER BY id))),
  'sources',json((SELECT json_group_array(json_array(s.match_id,s.side,s.source_type,s.source_match_id,s.source_bye_id)) FROM (SELECT match_sources.* FROM match_sources JOIN matches ON matches.id=match_sources.match_id WHERE matches.tournament_id=?1 ORDER BY match_id,side) s)),
  'byes',json((SELECT json_group_array(json_array(stage_id,id,team_id,round_id,slot)) FROM (SELECT * FROM tournament_byes WHERE tournament_id=?1 ORDER BY stage_id,id))),
  'details',json((SELECT json_group_array(json_array(m.id,
    (SELECT count(*) FROM match_maps WHERE match_id=m.id)+(SELECT count(*) FROM match_map_walkovers WHERE match_id=m.id),
    (SELECT count(*) FROM player_match_entries WHERE match_id=m.id),
    (SELECT count(*) FROM player_round_stats WHERE match_id=m.id))) FROM (SELECT id FROM matches WHERE tournament_id=?1 ORDER BY id) m)))`;
const snapshotSQL=resultSnapshotSQL;

export async function readLiveResults(db, id) {
  const results = await db.batch([
    db.prepare(`SELECT ${snapshotSQL} AS snapshot`).bind(id),
    db.prepare(`SELECT m.*, r.name AS round_name, r.sort_order, s.series_type, s.map_count,
      (SELECT count(*) FROM match_maps WHERE match_id=m.id)+(SELECT count(*) FROM match_map_walkovers WHERE match_id=m.id) AS detail_maps,
      (SELECT count(*) FROM player_match_entries WHERE match_id=m.id) AS detail_entries,
      (SELECT count(*) FROM player_round_stats WHERE match_id=m.id) AS detail_rounds,
      (SELECT status FROM match_detail_edits WHERE match_id=m.id) AS detail_status
      FROM matches m JOIN tournament_stages s ON s.tournament_id=m.tournament_id AND s.id=m.stage_id
      JOIN tournament_rounds r ON r.tournament_id=m.tournament_id AND r.stage_id=m.stage_id AND r.id=m.round_id
      WHERE m.tournament_id=? ORDER BY r.sort_order,m.bracket_slot,m.id`).bind(id),
  ]);
  if (results.some(r => !r.success)) throw new Error('Live bracket read failed');
  const snapshot = results[0].results[0].snapshot;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
  const revision = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return { snapshot, revision, matches: results[1].results, historical: historical.has(id) };
}

export function seriesWinner(score1, score2, type, count) {
  if (type !== 'fixed-maps' || !Number.isSafeInteger(count) || count < 1 || count % 2 !== 1) return null;
  if (![score1, score2].every(n => Number.isSafeInteger(n) && n >= 0) || score1 + score2 !== count || score1 === score2) return null;
  return score1 > score2 ? 1 : 2;
}

export async function saveLiveResult(db, id, form) {
  db=mutationDatabase(db,form.intent==='confirm-walkover'?'FULL_WALKOVER':'SAVE_RESULT',form.match_id);
  const state = await readLiveResults(db, id);
  if (state.historical) throw new AdminError('Historical S1/S2 results are read-only.', 409);
  if (form.result_revision !== state.revision) throw new AdminError('The bracket changed. Reload before saving the score.', 409);
  if (!['save-score', 'confirm-result','confirm-walkover','edit-initial-result'].includes(form.intent)) throw new AdminError('Unknown result action.');
  const match = state.matches.find(m => m.id === form.match_id);
  if (!match) throw new AdminError('Match not found.', 404);
  if (match.status === 'completed' || match.winner_id) throw new AdminError('Result confirmed. Corrections require a separate admin action.', 409);
  if (!match.team1_id || !match.team2_id || match.team1_id === match.team2_id) throw new AdminError('Both teams must be resolved before updating a score.', 409);
  if (match.series_type !== 'fixed-maps' || !Number.isSafeInteger(match.map_count) || match.map_count < 1 || match.map_count % 2 !== 1) throw new AdminError('Unsupported series rules.', 409);
  const data = JSON.parse(state.snapshot);
  if (!data.tournament || data.tournament[0] === 'completed' || data.tournament[1]) throw new AdminError('Tournament is completed and read-only.', 409);
  const sources = data.sources.filter(s => s[0] === match.id);
  for (const [, side, type, parentId, byeId] of sources) {
    const parent = state.matches.find(m => m.id === parentId);
    const bye = data.byes.find(b => b[0] === match.stage_id && b[1] === byeId);
    if (type !== 'bye' && (!parent || parent.stage_id !== match.stage_id || parent.sort_order >= match.sort_order
      || !parent.team1_id || !parent.team2_id || ![parent.team1_id,parent.team2_id].includes(parent.winner_id))) {
      throw new AdminError('The feeder result is invalid or unresolved.', 409);
    }
    const expected = type === 'bye' ? bye?.[2] : parent?.status === 'completed' && parent.winner_id
      ? type === 'winner' ? parent.winner_id : parent.winner_id === parent.team1_id ? parent.team2_id : parent.team1_id : null;
    if (!expected || expected !== match[`team${side}_id`]) throw new AdminError('Match teams disagree with their bracket sources.', 409);
  }
  let score1 = match.score1, score2 = match.score2;
  if (form.intent === 'save-score' || form.intent === 'edit-initial-result') {
    if (![form.score1, form.score2].every(n => typeof n === 'string' && /^(0|[1-9]\d*)$/.test(n))) throw new AdminError('Scores must be non-negative whole numbers.');
    score1 = Number(form.score1); score2 = Number(form.score2);
    if (![score1, score2].every(Number.isSafeInteger) || score1 + score2 > match.map_count) throw new AdminError(`Series scores cannot total more than ${match.map_count} maps.`);
  }
  const walkover=form.intent==='confirm-walkover';
  const mapsGuard=walkover?null:await playedMapGuard(db,id,match);
  if(walkover) {
    if(![match.team1_id,match.team2_id].includes(form.walkover_winner))throw new AdminError('Select the W/O winner.');
    if(match.detail_maps||match.detail_entries||match.detail_rounds||match.detail_status)throw new AdminError('Existing details prevent a full-match W/O.',409);
    score1=0;score2=0;
  }
  const confirmed = form.intent === 'confirm-result'||form.intent === 'edit-initial-result'||walkover;
  const side = walkover?(form.walkover_winner===match.team1_id?1:2):seriesWinner(score1, score2, match.series_type, match.map_count);
  if (confirmed && !side) throw new AdminError(`A confirmed result needs a non-tied score totaling ${match.map_count} maps.`);
  const winner = confirmed ? match[`team${side}_id`] : null;
  const loser = confirmed ? match[`team${side === 1 ? 2 : 1}_id`] : null;
  const advances = confirmed ? data.sources.filter(s => s[3] === match.id) : [];
  if (['winner','loser'].some(type => advances.filter(s => s[2] === type).length > 1)) {
    throw new AdminError('The bracket repeats an advancement source. Nothing was saved.', 409);
  }
  for (const [targetId, targetSide, type] of advances) {
    const target = state.matches.find(m => m.id === targetId);
    const team = type === 'winner' ? winner : loser;
    const details = data.details.find(d => d[0] === targetId);
    if (!target || !['winner', 'loser'].includes(type) || target.stage_id !== match.stage_id || target.sort_order <= match.sort_order
      || target.status !== 'upcoming' || target.winner_id || target.score1 !== 0 || target.score2 !== 0
      || details?.slice(1).some(count => count > 0)
      || (target[`team${targetSide}_id`] && target[`team${targetSide}_id`] !== team)
      || target[`team${targetSide === 1 ? 2 : 1}_id`] === team) {
      throw new AdminError('A downstream match has conflicting or started state. Nothing was saved.', 409);
    }
  }
  // A stale snapshot violates NOT NULL and rolls back the score and every advancement together.
  const statements = [db.prepare(`UPDATE tournaments SET name=CASE WHEN (${snapshotSQL})=?2 THEN name ELSE NULL END WHERE id=?1`).bind(id, state.snapshot),
    db.prepare('UPDATE matches SET score1=?,score2=?,status=?,winner_id=?,result_type=? WHERE id=? AND tournament_id=?').bind(score1, score2, confirmed ? 'completed' : 'live', winner,walkover?'walkover':'played', match.id, id),
    ...advances.map(([target, targetSide, type]) => db.prepare(`UPDATE matches SET team${targetSide}_id=? WHERE id=? AND tournament_id=?`).bind(type === 'winner' ? winner : loser, target, id)),
  ];
  if(mapsGuard)statements.unshift(mapsGuard);
  if(walkover)statements.splice(1,0,db.prepare(`UPDATE tournaments SET name=CASE WHEN
    EXISTS(SELECT 1 FROM match_detail_edits WHERE match_id=?2) THEN NULL ELSE name END WHERE id=?1`).bind(id,match.id));
  try {
    const results = await db.batch(statements);
    if (results.some(r => !r.success)) throw new Error('Live result save failed');
  } catch (error) {
    if (/NOT NULL constraint failed: tournaments.name/.test(String(error?.message))) throw new AdminError('The bracket changed while saving. Reload to review it.', 409);
    throw error;
  }
}
