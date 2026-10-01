import { AdminError, readAdminForm } from './tournaments.mjs';
import { readParticipantState, participantSnapshotSQL } from './participants.mjs';
import { rosterReadiness } from './roster-snapshot.mjs';
import { generateSharedBracket } from '../utils/bracket-engine.mjs';

const snapshotSQL = `json_object('participants',json(${participantSnapshotSQL}),'tournament',json((SELECT json_array(id,name,game,region,start_date,end_date,status,format,winner_team_id) FROM tournaments WHERE id=?1)))`;
const encode = value => btoa(Array.from(new TextEncoder().encode(value),b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode = value => new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c=>c.charCodeAt(0)));
async function key(secret) {
  if (typeof secret !== 'string' || secret.length < 64) throw new AdminError('Restart the admin development launcher before drawing.',503);
  return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function seal(payload, secret) {
  const body=encode(JSON.stringify(payload));
  return `${body}.${hex(await crypto.subtle.sign('HMAC',await key(secret),new TextEncoder().encode(body)))}`;
}
async function unseal(token,secret,now) {
  try {
    const [body,signature,...extra]=token.split('.');
    if (extra.length || !body || !/^[a-f0-9]{64}$/.test(signature)) throw new Error();
    const bytes=Uint8Array.from(signature.match(/../g),v=>parseInt(v,16));
    if (!await crypto.subtle.verify('HMAC',await key(secret),bytes,new TextEncoder().encode(body))) throw new Error();
    const payload=JSON.parse(decode(body));
    if (payload.version !== 1 || !Number.isSafeInteger(payload.expires) || payload.expires < now) throw new Error();
    return payload;
  } catch(error) { if(error instanceof AdminError && error.status===503) throw error; throw new AdminError('This draw is invalid or expired. Start a new official draw.',409); }
}
export async function readBracketState(db,id) {
  const state=await readParticipantState(db,id);
  if (!state) return null;
  const results=await db.batch([db.prepare(`SELECT ${snapshotSQL} AS snapshot`).bind(id)]);
  if(!results[0].success) throw new Error('Bracket read failed');
  const snapshot=results[0].results[0].snapshot; const data=JSON.parse(snapshot);
  if(JSON.stringify(data.participants)!==state.snapshot) throw new AdminError('Setup changed while loading. Reload this page.',409);
  const [tid,name,game,region,startDate,endDate]=data.tournament;
  const stage=state.stage;
  const setup=data.participants.setup;
  const options=stage ? { tournamentId:tid,name,game,region,startDate,endDate,teams:state.participants.map(t=>({id:t.id,name:t.name})),stage:{id:stage[0],name:stage[1],format:stage[2],bracketSize:stage[3],series:{type:stage[4],mapCount:stage[5]},rounds:setup.rounds.map(([,id,name,order,placement])=>({id,name,order,...(placement?{placement}:{})})),byes:[]} } : null;
  return {...state,snapshot,options,roster:rosterReadiness(state.participants,data.participants.roster)};
}
function editable(state,revision) {
  if(!state) throw new AdminError('Tournament not found.',404);
  if(!state.ready || state.locked) throw new AdminError('The bracket is read-only. Review Setup and Participants.',409);
  if(!state.roster.ready) throw new AdminError('Complete every participant roster with 5 to 7 players before Official Draw.',409);
  if(state.revision!==revision) throw new AdminError('Setup or participants changed. Reload before drawing.',409);
  if(state.participants.length < Math.max(2,state.stage[3]/2) || state.participants.length>state.stage[3]) throw new AdminError(`A ${state.stage[3]}-slot bracket needs ${Math.max(2,state.stage[3]/2)} to ${state.stage[3]} participants. Add participants or save a smaller bracket in Setup.`);
  if (state.stage[3] === 4 && state.participants.length < 4 && state.options.stage.rounds.some(round => round.placement === 3)) throw new AdminError('Bronze Match requires four teams in a 4-slot bracket so both Semi Finals have losing teams. Add teams or turn off Bronze Match in Setup.');
}
export async function readBracketForm(request) {
  return readAdminForm(request,{maxBytes:1048576,allowedField:k=>['intent','revision','draw_count','token','result_revision','match_id','score1','score2'].includes(k)});
}
const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
export async function officialDraw(state,form,secret,random=secureRandom,now=Date.now()) {
  editable(state,form.revision);
  if(!/^(?:[1-9]|1[0-9]|20)$/.test(form.draw_count??'')) throw new AdminError('Choose 1 to 20 draws.');
  await key(secret);
  const draws=Array.from({length:Number(form.draw_count)},()=>generateSharedBracket(state.options,random));
  const token=await seal({version:1,id:state.tournament.id,snapshot:state.snapshot,expires:now+2*60*60*1000,count:draws.length,bracket:draws.at(-1)},secret);
  return {draws,token};
}
export async function confirmOfficialBracket(db,id,form,secret,now=Date.now()) {
  const payload=await unseal(form.token??'',secret,now);
  const state=await readBracketState(db,id); editable(state,form.revision);
  if(payload.id!==id || payload.snapshot!==state.snapshot) throw new AdminError('Setup, dates, participants or roster changed. Start a new draw.',409);
  const bracket=payload.bracket; const stage=bracket.tournament.data.stages[0];
  // A changing snapshot sets a NOT NULL field to NULL, rolling back the entire D1 batch.
  const statements=[db.prepare(`UPDATE tournaments SET name=CASE WHEN (${snapshotSQL})=?2 THEN name ELSE NULL END WHERE id=?1`).bind(id,state.snapshot),
    ...stage.byes.map(b=>db.prepare('INSERT INTO tournament_byes(tournament_id,stage_id,id,round_id,slot,team_id) VALUES(?,?,?,?,?,?)').bind(id,stage.id,b.id,b.roundId,b.slot,b.teamId)),
    ...bracket.matches.map(({id:mid,data:m})=>db.prepare('INSERT INTO matches(id,tournament_id,stage_id,round_id,bracket_slot,date,status,team1_id,team2_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(mid,id,stage.id,m.roundId,m.bracketSlot,m.date,'upcoming',m.team1Id??null,m.team2Id??null)),
    ...bracket.matches.flatMap(({id:mid,data:m})=>[1,2].flatMap(side=>{const s=m[`team${side}Source`];return s?[db.prepare('INSERT INTO match_sources(match_id,side,source_type,source_match_id,source_bye_id) VALUES(?,?,?,?,?)').bind(mid,side,s.type,s.matchId??null,s.byeId??null)]:[]})),
  ];
  try { const results=await db.batch(statements); if(results.some(r=>!r.success)) throw new Error('Official bracket save failed'); }
  catch(error) { if(/NOT NULL constraint failed: tournaments.name|UNIQUE constraint failed|FOREIGN KEY constraint failed/.test(String(error?.message))) throw new AdminError('The bracket changed while confirming. Reload to review the saved state.',409); throw error; }
  return bracket;
}
