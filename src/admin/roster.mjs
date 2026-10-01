import { AdminError, readAdminForm } from './tournaments.mjs';
import { readParticipantState, participantSnapshotSQL } from './participants.mjs';
import { rosterReadiness } from './roster-snapshot.mjs';

function text(value,label,max=120) {
  const result=typeof value==='string'?value.normalize('NFKC').trim().replace(/ +/g,' '):'';
  if(!result || result.length>max || /[\p{Cc}\p{Cf}]/u.test(result)) throw new AdminError(`${label} must contain 1 to ${max} readable characters.`);
  return result;
}
export async function readRosterState(db,id) {
  const state=await readParticipantState(db,id);
  if(!state) return null;
  const result=await db.batch([
    db.prepare(`SELECT ${participantSnapshotSQL} AS snapshot`).bind(id),
    db.prepare('SELECT id,name,current_ign,uid,current_team_id FROM players ORDER BY current_ign COLLATE NOCASE,id'),
    db.prepare(`SELECT r.team_id,r.player_id,r.ign_snapshot FROM tournament_rosters r
      JOIN players p ON p.id=r.player_id
      WHERE r.tournament_id=(SELECT t.id FROM tournaments t
        WHERE t.start_date<(SELECT start_date FROM tournaments WHERE id=?1)
          AND EXISTS(SELECT 1 FROM tournament_rosters previous WHERE previous.tournament_id=t.id AND previous.team_id=r.team_id)
        ORDER BY t.start_date DESC,t.end_date DESC,t.id DESC LIMIT 1)
      ORDER BY r.team_id,r.position`).bind(id),
  ]);
  if(result.some(r=>!r.success)) throw new Error('Roster read failed');
  if(result[0].results[0].snapshot!==state.snapshot) throw new AdminError('Participants or roster changed while loading. Reload.',409);
  const rows=JSON.parse(state.snapshot).roster;
  const players=result[1].results;
  const readiness=rosterReadiness(state.participants,rows);
  return {...state,players,rows,previousRows:result[2].results,roster:readiness};
}
export function rosterCopySource(state,teamId) {
  if (!state.participants.some(team=>team.id===teamId) || state.rows.some(row=>row[0]===teamId)) return null;
  const previous=state.previousRows.filter(row=>row.team_id===teamId && !state.rows.some(saved=>saved[1]===row.player_id));
  if (previous.length && previous.length<=7 && previous.every(row=>{
    try { text(row.ign_snapshot,'Tournament IGN'); return true; } catch { return false; }
  })) return {kind:'previous',entries:previous.map(row=>({team_id:teamId,id:row.player_id,ign:row.ign_snapshot,name:'',uid:''}))};
  const current=state.players.filter(player=>player.current_team_id===teamId);
  return current.length ? {kind:'current',entries:current.map(player=>({team_id:teamId,id:player.id,ign:player.current_ign,name:'',uid:''}))} : null;
}
export function rosterForm(state,teamId) {
  if(!state.participants.some(team=>team.id===teamId)) throw new AdminError('Select a registered participant team.',404);
  return {revision:state.revision,team_id:teamId,intent:'save',player_id:'',new_name:'',new_ign:'',new_uid:'',
    entries:state.rows.filter(row=>row[0]===teamId).map(([,id,ign])=>({id,ign,name:'',uid:''}))};
}
export async function readRosterForm(request) {
  const fields=await readAdminForm(request,{maxBytes:16384,allowedField:key=>['revision','team_id','intent','player_id','new_name','new_ign','new_uid','remove_player','move_player','move_team'].includes(key)||/^entries\.[0-6]\.(?:id|ign|name|uid)$/.test(key)});
  const indices=[...new Set(Object.keys(fields).filter(k=>k.startsWith('entries.')).map(k=>Number(k.split('.')[1])))].sort((a,b)=>a-b);
  const entries=indices.map((index,i)=>{if(index!==i)throw new AdminError('Player fields must be consecutive. Reload.');return Object.fromEntries(['id','ign','name','uid'].map(k=>[k,fields[`entries.${i}.${k}`]??'']));});
  return {...fields,entries};
}
function editable(state,revision) {
  if(!state) throw new AdminError('Tournament not found.',404);
  if(!state.ready || state.locked) throw new AdminError('Tournament roster is read-only after the tournament starts or its bracket is confirmed.',409);
  if(state.revision!==revision) throw new AdminError('Setup, participants or roster changed. Reload before saving.',409);
}
export function validateRosterRows(entries,state,teamId) {
  if(!state.participants.some(team=>team.id===teamId)) throw new AdminError('Select a registered participant team.');
  if(!Array.isArray(entries)||entries.length>7)throw new AdminError('A team can register at most 7 players.');
  const seen=new Set();const uids=new Set();
  return entries.map(row=>{
    const ign=text(row.ign,'Tournament IGN');
    if(row.id) {
      const player=state.players.find(p=>p.id===row.id);
      if(!player) throw new AdminError('A player no longer exists. Reload and select an existing player.');
      if(seen.has(player.id)) throw new AdminError('Each player can appear only once in this tournament.');
      const other=state.rows.find(r=>r[1]===player.id && r[0]!==teamId);
      if(other) throw new AdminError(`This player is already registered with ${state.participants.find(t=>t.id===other[0])?.name ?? 'another team'}. Remove or move that registration first.`,409);
      seen.add(player.id);
      return {id:player.id,ign,name:player.name,uid:player.uid,isNew:false};
    }
    const name=text(row.name,'Player name');const uid=row.uid?.trim()?text(row.uid,'Player UID',64):null;
    if(uid && (uids.has(uid)||state.players.some(p=>p.uid===uid)))throw new AdminError('This UID already belongs to a player. Select the existing player.',409);
    if(uid)uids.add(uid);
    return {id:'',ign,name,uid,isNew:true};
  });
}
export function editRosterForm(state,form) {
  editable(state,form.revision);
  if(form.remove_player!==undefined) {
    if(!/^[0-6]$/.test(form.remove_player)||Number(form.remove_player)>=form.entries.length)throw new AdminError('Select a roster entry to remove.');
    form.entries.splice(Number(form.remove_player),1);
  } else if(form.intent==='add-existing') {
    const player=state.players.find(p=>p.id===form.player_id);
    if(!player)throw new AdminError('Select an existing player to add.');
    form.entries=[...form.entries,{id:player.id,ign:player.current_ign,name:'',uid:''}];
    validateRosterRows(form.entries,state,form.team_id);form.player_id='';
  } else if(form.intent==='add-new') {
    const candidate=[...form.entries,{id:'',ign:form.new_ign,name:form.new_name,uid:form.new_uid}];
    const normalized=validateRosterRows(candidate,state,form.team_id).at(-1);
    form.entries=[...form.entries,{id:'',ign:normalized.ign,name:normalized.name,uid:normalized.uid??''}];
    form.new_name='';form.new_ign='';form.new_uid='';
  } else throw new AdminError('Unknown roster action.');
  return form;
}
function guard(db,id,snapshot) {
  return db.prepare(`UPDATE tournaments SET name=CASE WHEN (${participantSnapshotSQL})=?2 THEN name ELSE NULL END WHERE id=?1`).bind(id,snapshot);
}
async function atomic(db,statements) {
  try {const results=await db.batch(statements);if(results.some(r=>!r.success))throw new Error('Roster save failed');}
  catch(error){if(/NOT NULL constraint failed: tournaments.name|UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(String(error?.message)))throw new AdminError('Roster, participants or player records changed while saving. Reload to review the saved state.',409);throw error;}
}
export async function saveRoster(db,id,form) {
  const state=await readRosterState(db,id);editable(state,form.revision);
  if(form.player_id || form.new_name?.trim() || form.new_ign?.trim() || form.new_uid?.trim())throw new AdminError('Add the selected or new player to the roster before saving.');
  const rows=validateRosterRows(form.entries,state,form.team_id).map(row=>({...row,id:row.id||`player-${crypto.randomUUID()}`}));
  const statements=[guard(db,id,state.snapshot),
    ...rows.filter(r=>r.isNew).map(r=>db.prepare('INSERT INTO players(id,uid,name,current_ign) VALUES(?,?,?,?)').bind(r.id,r.uid,r.name,r.ign)),
    db.prepare('DELETE FROM tournament_rosters WHERE tournament_id=? AND team_id=?').bind(id,form.team_id),
    ...rows.map((r,i)=>db.prepare('INSERT INTO tournament_rosters(tournament_id,team_id,player_id,ign_snapshot,position) VALUES(?,?,?,?,?)').bind(id,form.team_id,r.id,r.ign,i+1)),
  ];
  await atomic(db,statements);return rows.length;
}
export async function moveRosterPlayer(db,id,form) {
  const state=await readRosterState(db,id);editable(state,form.revision);
  if(form.player_id || form.new_name?.trim() || form.new_ign?.trim() || form.new_uid?.trim())throw new AdminError('Save or clear player drafts before moving a saved player.');
  const current=rosterForm(state,form.team_id);
  if(JSON.stringify(form.entries)!==JSON.stringify(current.entries))throw new AdminError('Save roster edits before moving a player.');
  if(!/^[0-6]$/.test(form.move_player??''))throw new AdminError('Select a saved player to move.');
  const entry=current.entries[Number(form.move_player)];
  if(!entry || form.move_team===form.team_id || !state.participants.some(t=>t.id===form.move_team))throw new AdminError('Select a different participant team.');
  const target=state.rows.filter(r=>r[0]===form.move_team);
  if(target.length>=7)throw new AdminError('The destination team already has 7 players.');
  const position=Array.from({length:7},(_,i)=>i+1).find(p=>!target.some(r=>r[3]===p));
  await atomic(db,[guard(db,id,state.snapshot),db.prepare('UPDATE tournament_rosters SET team_id=?,position=? WHERE tournament_id=? AND team_id=? AND player_id=?').bind(form.move_team,position,id,form.team_id,entry.id)]);
}

export function workspaceRosterForm(state) {
  return { revision: state.revision, intent: 'save', team_id: state.participants[0]?.id ?? '', player_id: '', new_name: '', new_ign: '', new_uid: '',
    entries: state.rows.map(([team_id, id, ign]) => ({ team_id, id, ign, name: '', uid: '' })) };
}
export async function readWorkspaceRosterForm(request) {
  const fields = await readAdminForm(request, { maxBytes: 262144, allowedField: key => ['revision','intent','team_id','player_id','new_name','new_ign','new_uid','remove_entry','copy_team'].includes(key)
    || /^entries\.(?:0|[1-9][0-9]{0,2})\.(?:team_id|id|ign|name|uid)$/.test(key) && Number(key.split('.')[1]) < 224 });
  const indices = [...new Set(Object.keys(fields).filter(key => key.startsWith('entries.')).map(key => Number(key.split('.')[1])))].sort((a,b) => a-b);
  const entries = indices.map((index,i) => { if (index !== i) throw new AdminError('Roster fields must be consecutive. Reload.'); return Object.fromEntries(['team_id','id','ign','name','uid'].map(key => [key,fields[`entries.${i}.${key}`] ?? ''])); });
  return { ...fields, entries };
}
export function validateWorkspaceRoster(form, state) {
  if (form.entries.length > 224) throw new AdminError('A tournament can register at most 224 players.');
  const seen = new Set(); const uids = new Set(); const counts = new Map();
  return form.entries.map(row => {
    if (!state.participants.some(team => team.id === row.team_id)) throw new AdminError('Select a registered team for every player.');
    const count = (counts.get(row.team_id) ?? 0) + 1; counts.set(row.team_id, count);
    if (count > 7) throw new AdminError(`${state.participants.find(team => team.id === row.team_id).name} already has 7 players.`);
    const ign = text(row.ign, 'Tournament IGN');
    if (row.id) {
      const player = state.players.find(player => player.id === row.id);
      if (!player) throw new AdminError('A player no longer exists. Reload.');
      if (seen.has(row.id)) throw new AdminError('Each player can appear only once in this tournament.');
      seen.add(row.id); return { ...row, ign, name: player.name, uid: player.uid, isNew: false };
    }
    const name = text(row.name, 'Player name'); const uid = row.uid?.trim() ? text(row.uid, 'Player UID', 64) : null;
    if (uid && (uids.has(uid) || state.players.some(player => player.uid === uid))) throw new AdminError('This UID already belongs to a player. Select the existing player.',409);
    if (uid) uids.add(uid);
    return { ...row, ign, name, uid, isNew: true };
  });
}
export function editWorkspaceRoster(form, state) {
  editable(state, form.revision);
  const candidate = structuredClone(form);
  if (candidate.remove_entry !== undefined) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(candidate.remove_entry) || Number(candidate.remove_entry) >= candidate.entries.length) throw new AdminError('Select a player to remove.');
    candidate.entries.splice(Number(candidate.remove_entry),1); delete candidate.remove_entry;
  } else if (candidate.copy_team !== undefined) {
    const source=rosterCopySource(state,candidate.copy_team);
    if (!source) throw new AdminError('This team has a saved roster or no roster source. Reload to review it.',409);
    if (candidate.entries.some(row=>row.team_id===candidate.copy_team)) throw new AdminError('Remove or save this team’s draft before copying a roster.',409);
    candidate.entries.push(...source.entries); delete candidate.copy_team;
  } else if (form.intent === 'add-existing') {
    const player = state.players.find(player => player.id === form.player_id);
    if (!player) throw new AdminError('Select an existing player.');
    candidate.entries.push({team_id:form.team_id,id:player.id,ign:player.current_ign,name:'',uid:''}); candidate.player_id = '';
  } else if (form.intent === 'add-new') {
    candidate.entries.push({team_id:form.team_id,id:'',ign:form.new_ign,name:form.new_name,uid:form.new_uid});
    candidate.new_name = ''; candidate.new_ign = ''; candidate.new_uid = '';
  } else throw new AdminError('Unknown roster action.');
  validateWorkspaceRoster(candidate,state); return candidate;
}
export async function saveWorkspaceRoster(db, id, form) {
  const state = await readRosterState(db,id); editable(state,form.revision);
  if (form.player_id || form.new_name?.trim() || form.new_ign?.trim() || form.new_uid?.trim()) throw new AdminError('Add or clear player drafts before saving.');
  const positions = new Map();
  const rows = validateWorkspaceRoster(form,state).map(row => { const position = (positions.get(row.team_id) ?? 0) + 1; positions.set(row.team_id,position); return {...row,id:row.id || `player-${crypto.randomUUID()}`,position}; });
  await atomic(db,[guard(db,id,state.snapshot),
    ...rows.filter(row => row.isNew).map(row => db.prepare('INSERT INTO players(id,uid,name,current_ign) VALUES(?,?,?,?)').bind(row.id,row.uid,row.name,row.ign)),
    db.prepare('DELETE FROM tournament_rosters WHERE tournament_id=?').bind(id),
    ...rows.map(row => db.prepare('INSERT INTO tournament_rosters(tournament_id,team_id,player_id,ign_snapshot,position) VALUES(?,?,?,?,?)').bind(id,row.team_id,row.id,row.ign,row.position))]);
  return rows.length;
}
