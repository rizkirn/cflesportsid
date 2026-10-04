import { AdminError, readAdminForm, tournamentId } from './tournaments.mjs';
import { setupSnapshotSQL } from './setup.mjs';
import { rosterRowsSQL } from './roster-snapshot.mjs';

export const participantSnapshotSQL = `json_object('setup', json(${setupSnapshotSQL}), 'participants', json((
  SELECT json_group_array(team_id) FROM (SELECT team_id FROM tournament_teams WHERE tournament_id = ?1 ORDER BY team_id)
)), 'roster', json(${rosterRowsSQL}))`;
const snapshotSQL = participantSnapshotSQL;
const rowFields = ['id', 'name', 'tag', 'region'];
const idPattern = /^[a-z0-9-]{1,120}$/;
export async function readParticipantState(db, id) {
  if (!id || !idPattern.test(id)) return null;
  const result = await db.batch([
    db.prepare('SELECT * FROM tournaments WHERE id = ?').bind(id),
    db.prepare(`SELECT ${snapshotSQL} AS snapshot`).bind(id),
    db.prepare('SELECT id, name, tag, region FROM teams ORDER BY name COLLATE NOCASE, id'),
  ]);
  if (result.some(r => !r.success)) throw new Error('Participant state read failed');
  const tournament = result[0].results[0];
  if (!tournament) return null;
  const snapshot = result[1].results[0].snapshot;
  const state = JSON.parse(snapshot); const stage = state.setup.stages[0];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
  const revision = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const teams = result[2].results;
  const ready = state.setup.stages.length === 1 && state.setup.rounds.length > 0 && stage[2] === 'single-elimination'
    && [4, 8, 16, 32, 64].includes(stage[3]);
  return { tournament, teams, snapshot, revision, stage, ready,
    participants: state.participants.map(id => teams.find(team => team.id === id)).filter(Boolean),
    locked: tournament.status !== 'upcoming' || state.setup.matches > 0 || state.setup.byes > 0 || state.setup.stages.length > 1 };
}
export function participantForm(state) {
  return { revision: state.revision, participants: state.participants.map(team => ({ ...team })),
    intent: 'save', team_id: '', new_name: '', new_tag: '', new_region: 'ID' };
}
export async function readParticipantForm(request) {
  const fields = await readAdminForm(request, { maxBytes: 524288,
    allowedField: key => ['revision', 'intent', 'remove_participant', 'team_id', 'new_name', 'new_tag', 'new_region'].includes(key) || /^selected\.[a-z0-9-]{1,120}$/.test(key)
      || /^participants\.(?:0|[1-9][0-9]{0,2})\.(?:id|name|tag|region)$/.test(key) && Number(key.split('.')[1]) < 256,
  });
  const participants = [];
  const indices = [...new Set(Object.keys(fields).filter(key => key.startsWith('participants.')).map(key => Number(key.split('.')[1])))].sort((a,b) => a-b);
  for (const index of indices) {
    if (index !== participants.length) throw new AdminError('Participant fields must be consecutive. Reload the form.');
    participants.push(Object.fromEntries(rowFields.map(key => [key, fields[`participants.${index}.${key}`] ?? ''])));
  }
  return { revision: fields.revision ?? '', participants, intent: fields.intent ?? 'save', remove_participant: fields.remove_participant,
    selected: Object.keys(fields).filter(key => key.startsWith('selected.') && fields[key] === '1').map(key => key.slice(9)),
    team_id: fields.team_id ?? '', new_name: fields.new_name ?? '', new_tag: fields.new_tag ?? '', new_region: fields.new_region ?? 'ID' };
}
function text(value, label, min, max) {
  const result = typeof value === 'string' ? value.normalize('NFKC').trim().replace(/ +/g, ' ') : '';
  if (result.length < min || result.length > max || /[\p{Cc}\p{Cf}]/u.test(result)) throw new AdminError(`${label} must contain ${min} to ${max} readable characters.`);
  return result;
}
export async function validateParticipantRows(rows, state) {
  if (!Array.isArray(rows) || rows.length > state.stage[3] || rows.length > 256) throw new AdminError('The participant count exceeds the bracket size.');
  const resolved = []; const seen = new Set();
  for (const row of rows) {
    let team;
    if (row.id) {
      team = state.teams.find(team => team.id === row.id);
      if (!team) throw new AdminError('A selected team no longer exists. Reload and select an existing team.');
      team = { ...team, isNew: false };
    } else {
      const name = text(row.name, 'Team name', 3, 120);
      const tag = text(row.tag, 'Team tag', 1, 20);
      const region = text(row.region, 'Team region', 2, 32);
      const id = await tournamentId(name);
      if (state.teams.some(team => team.id === id || team.name.normalize('NFKC').trim().replace(/ +/g, ' ').toLowerCase() === name.toLowerCase())) {
        throw new AdminError('A team with this name or URL already exists. Select it from existing teams.', 409);
      }
      team = { id, name, tag, region, isNew: true };
    }
    if (seen.has(team.id)) throw new AdminError('Each team can participate only once.');
    seen.add(team.id); resolved.push(team);
  }
  return resolved;
}
export function requireEditableParticipants(state, revision) {
  if (!state.ready) throw new AdminError('Complete Tournament Setup before editing participants.', 409);
  if (state.locked) throw new AdminError('Participants are read-only after the tournament starts or a bracket has matches or byes.', 409);
  if (revision !== state.revision) throw new AdminError('Participants or setup have changed since this form opened. Reload before saving.', 409);
}
export async function editParticipantForm(form, state) {
  requireEditableParticipants(state, form.revision);
  if (form.intent === 'add-selected' || form.intent === 'remove-selected') {
    if (!form.selected?.length) throw new AdminError('Select at least one team.');
    if (form.selected.some(id => !state.teams.some(team => team.id === id))) throw new AdminError('A selected team no longer exists. Reload.');
    if (form.intent === 'add-selected') {
      const candidate = [...form.participants, ...form.selected.map(id => state.teams.find(team => team.id === id))];
      await validateParticipantRows(candidate, state); form.participants = candidate;
    } else {
      if (form.selected.some(id => !form.participants.some(team => team.id === id))) throw new AdminError('Select registered participants to remove.');
      form.participants = form.participants.filter(team => !form.selected.includes(team.id));
    }
    form.selected = [];
  } else if (form.remove_participant !== undefined) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(form.remove_participant) || Number(form.remove_participant) >= form.participants.length) throw new AdminError('Select a participant to remove.');
    form.participants.splice(Number(form.remove_participant), 1);
  } else if (form.intent === 'add-existing') {
    const team = state.teams.find(team => team.id === form.team_id);
    if (!team) throw new AdminError('Select an existing team to add.');
    const candidate = [...form.participants, { ...team }];
    await validateParticipantRows(candidate, state); form.participants = candidate; form.team_id = '';
  } else if (form.intent === 'add-new') {
    const candidate = [...form.participants, { id: '', name: form.new_name, tag: form.new_tag, region: form.new_region }];
    const normalized = await validateParticipantRows(candidate, state);
    const team = normalized.at(-1);
    form.participants = [...form.participants, { id: '', name: team.name, tag: team.tag, region: team.region }];
    form.new_name = ''; form.new_tag = ''; form.new_region = 'ID';
  } else throw new AdminError('Unknown participant action.');
  return form;
}
export async function saveParticipants(db, id, form) {
  const state = await readParticipantState(db, id);
  if (!state) throw new AdminError('Tournament not found.', 404);
  requireEditableParticipants(state, form.revision);
  const teams = await validateParticipantRows(form.participants, state);
  // The NOT NULL constraint aborts the entire transaction if setup, participants, or bracket state changed after the read.
  const statements = [db.prepare(`UPDATE tournaments SET name = CASE WHEN (${snapshotSQL}) = ?2 THEN name ELSE NULL END WHERE id = ?1`).bind(id, state.snapshot),
    ...teams.filter(team => team.isNew).map(team => db.prepare(`INSERT INTO teams (id, name, tag, region) VALUES (?, ?, ?, ?)`).bind(team.id, team.name, team.tag, team.region)),
    ...state.participants.filter(team => !teams.some(selected => selected.id === team.id)).map(team => db.prepare('DELETE FROM tournament_teams WHERE tournament_id = ? AND team_id = ?').bind(id,team.id)),
    ...teams.map(team => db.prepare('INSERT INTO tournament_teams (tournament_id, team_id) VALUES (?, ?) ON CONFLICT(tournament_id,team_id) DO NOTHING').bind(id, team.id)),
  ];
  try {
    const result = await db.batch(statements);
    if (result.some(r => !r.success)) throw new Error('Participant save failed');
  } catch (error) {
    const message = String(error?.message);
    if (/NOT NULL constraint failed: tournaments\.name/.test(message)) throw new AdminError('Participants or setup changed while saving. Reload before trying again.', 409);
    if (/UNIQUE constraint failed: teams\.id/.test(message)) throw new AdminError('A new team was created by another admin. Reload and select the existing team.', 409);
    if (/FOREIGN KEY constraint failed/.test(message)) throw new AdminError('A selected team changed while saving. Reload before trying again.', 409);
    throw error;
  }
  return teams.length;
}
