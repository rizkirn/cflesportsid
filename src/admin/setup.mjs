import { AdminError, readAdminForm } from './tournaments.mjs';

export const cfgTemplate = {
  stage_id: 'playoffs', stage_name: 'Playoffs', format: 'single-elimination',
  bracket_size: '16', series_type: 'fixed-maps', map_count: '3',
  final_map_rule: 'random', action_seconds: '20', reserve_seconds: '90',
  rounds: [
    { id: 'top-16', name: 'Top 16', sort_order: '1', placement: '' },
    { id: 'quarter-final', name: 'Quarter Final', sort_order: '2', placement: '' },
    { id: 'semi-final', name: 'Semi Final', sort_order: '3', placement: '' },
    { id: 'bronze', name: 'Bronze Match', sort_order: '4', placement: '3' },
    { id: 'final', name: 'Final', sort_order: '5', placement: '1' },
  ],
};
const stageFields = ['stage_id', 'stage_name', 'format', 'bracket_size', 'series_type', 'map_count', 'final_map_rule', 'action_seconds', 'reserve_seconds'];
const snapshotSQL = `json_object(
  'stages', json((SELECT json_group_array(json_array(id, name, format, bracket_size, series_type, map_count, final_map_rule, action_seconds, reserve_seconds))
    FROM (SELECT * FROM tournament_stages WHERE tournament_id = ?1 ORDER BY id))),
  'rounds', json((SELECT json_group_array(json_array(stage_id, id, name, sort_order, placement))
    FROM (SELECT * FROM tournament_rounds WHERE tournament_id = ?1 ORDER BY stage_id, sort_order, id))),
  'status', (SELECT status FROM tournaments WHERE id = ?1),
  'matches', (SELECT count(*) FROM matches WHERE tournament_id = ?1),
  'byes', (SELECT count(*) FROM tournament_byes WHERE tournament_id = ?1)
)`;

async function revision(snapshot) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export async function readSetup(db, tournamentId) {
  if (!tournamentId || !/^[a-z0-9-]{1,120}$/.test(tournamentId)) return null;
  const results = await db.batch([
    db.prepare('SELECT id, name, status FROM tournaments WHERE id = ?').bind(tournamentId),
    db.prepare(`SELECT ${snapshotSQL} AS snapshot`).bind(tournamentId),
  ]);
  if (results.some(result => !result.success)) throw new Error('Setup read failed');
  const tournament = results[0].results[0];
  if (!tournament) return null;
  const snapshot = results[1].results[0].snapshot;
  const state = JSON.parse(snapshot);
  return { tournament, state, snapshot, revision: await revision(snapshot),
    locked: tournament.status !== 'upcoming' || state.matches > 0 || state.byes > 0 || state.stages.length > 1 };
}

export function setupForm(setup, useTemplate = false) {
  const form = structuredClone(cfgTemplate);
  const stage = setup.state.stages[0];
  if (stage) form.stage_id = stage[0];
  if (stage && !useTemplate) {
    const [, name, format, bracketSize, seriesType, mapCount, finalMap, action, reserve] = stage;
    Object.assign(form, { stage_name: name, format, bracket_size: String(bracketSize), series_type: seriesType,
      map_count: String(mapCount), final_map_rule: finalMap ?? '', action_seconds: action == null ? '' : String(action),
      reserve_seconds: reserve == null ? '' : String(reserve),
      rounds: setup.state.rounds.filter(round => round[0] === stage[0]).map(([, id, name, order, placement]) => ({ id, name, sort_order: String(order), placement: placement == null ? '' : String(placement) })),
    });
  }
  return { ...form, revision: setup.revision };
}

export async function readSetupForm(request) {
  const input = await readAdminForm(request, { maxBytes: 16384,
    allowedField: key => [...stageFields, 'revision', 'intent', 'remove_round'].includes(key) || /^rounds\.(?:[0-9]|1[0-5])\.(?:id|name|sort_order|placement)$/.test(key),
  });
  const rounds = [];
  for (let i = 0; i < 16; i++) {
    if (Object.keys(input).some(key => key.startsWith(`rounds.${i}.`))) {
      if (i !== rounds.length) throw new AdminError('Round fields must be consecutive. Reload the setup form.');
      rounds.push(Object.fromEntries(['id', 'name', 'sort_order', 'placement'].map(key => [key, input[`rounds.${i}.${key}`] ?? ''])));
    }
  }
  return { ...Object.fromEntries(stageFields.map(key => [key, input[key] ?? ''])), revision: input.revision ?? '',
    intent: input.intent ?? 'save', remove_round: input.remove_round, rounds };
}

export function editRoundForm(input) {
  if (input.remove_round !== undefined) {
    if (!/^(?:[0-9]|1[0-5])$/.test(input.remove_round) || Number(input.remove_round) >= input.rounds.length || input.rounds.length <= 1) {
      throw new AdminError('Keep at least one round.');
    }
    input.rounds.splice(Number(input.remove_round), 1);
    input.rounds.forEach((round, index) => { round.sort_order = String(index + 1); });
  } else if (input.intent === 'add-round') {
    if (input.rounds.length >= 16) throw new AdminError('A setup can contain at most 16 rounds.');
    input.rounds.push({ id: '', name: '', sort_order: String(input.rounds.length + 1), placement: '' });
  } else if (input.intent !== 'save') throw new AdminError('Unknown setup action.');
  return input;
}

function cleanName(value, label, max) {
  const name = typeof value === 'string' ? value.normalize('NFKC').trim().replace(/ +/g, ' ') : '';
  if (!name || name.length > max || /[\p{Cc}\p{Cf}]/u.test(name)) throw new AdminError(`${label} must contain 1 to ${max} readable characters.`);
  return name;
}
function integer(value, label, min, max) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new AdminError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return Number(value);
}

export function validateSetup(input) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.stage_id) || input.stage_id.length > 64) throw new AdminError('Invalid stage ID.');
  const name = cleanName(input.stage_name, 'Stage name', 120);
  if (input.format !== 'single-elimination') throw new AdminError('Setup v1 supports single-elimination format.');
  if (input.series_type !== 'fixed-maps') throw new AdminError('Setup v1 supports fixed-maps series.');
  if (input.final_map_rule !== 'random') throw new AdminError('Setup v1 supports random final maps.');
  const bracket_size = integer(input.bracket_size, 'Bracket size', 2, 256);
  if (!Number.isInteger(Math.log2(bracket_size))) throw new AdminError('Bracket size must be a power of two (2, 4, 8, 16, 32, 64, 128, or 256).');
  const map_count = integer(input.map_count, 'Maps per match', 1, 15);
  if (map_count % 2 !== 1) throw new AdminError('Maps per match must be odd to avoid tied series.');
  const action_seconds = integer(input.action_seconds, 'Action time', 1, 300);
  const reserve_seconds = integer(input.reserve_seconds, 'Reserve time', 1, 3600);
  if (!Array.isArray(input.rounds) || input.rounds.length < 1 || input.rounds.length > 16) throw new AdminError('Enter 1 to 16 rounds.');
  const rounds = input.rounds.map((round, index) => {
    const name = cleanName(round.name, `Round ${index + 1} name`, 80);
    const id = round.id || name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '') || `round-${index + 1}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) throw new AdminError(`Round ${index + 1} has an invalid ID.`);
    if (!['', '1', '3'].includes(round.placement)) throw new AdminError('Placement must be empty, 1 (Final), or 3 (Bronze Match).');
    return { id, name, sort_order: integer(round.sort_order, 'Round order', 1, 16), placement: round.placement === '' ? null : Number(round.placement) };
  }).sort((a, b) => a.sort_order - b.sort_order);
  if (new Set(rounds.map(round => round.id)).size !== rounds.length) throw new AdminError('Each round needs a distinct name or ID.');
  if (rounds.some((round, index) => round.sort_order !== index + 1)) throw new AdminError('Round order must use each number from 1 to the round count exactly once.');
  const finals = rounds.filter(round => round.placement === 1);
  const bronze = rounds.filter(round => round.placement === 3);
  if (finals.length !== 1 || finals[0] !== rounds.at(-1)) throw new AdminError('Include exactly one Final (placement 1), ordered last.');
  if (bronze.length > 1 || (bronze.length === 1 && (bracket_size < 4 || bronze[0] !== rounds.at(-2)))) throw new AdminError('Use at most one Bronze Match (placement 3), ordered immediately before the Final.');
  if (rounds.filter(round => round.placement === null).length !== Math.log2(bracket_size) - 1) throw new AdminError('The progression rounds must match the bracket size. For 16 slots, use Top 16, Quarter Final, and Semi Final before placement rounds.');
  return { id: input.stage_id, name, format: input.format, bracket_size, series_type: input.series_type, map_count,
    final_map_rule: input.final_map_rule, action_seconds, reserve_seconds, rounds };
}

export async function saveSetup(db, tournamentId, input) {
  const current = await readSetup(db, tournamentId);
  if (!current) throw new AdminError('Tournament not found.', 404);
  if (current.locked) throw new AdminError('Setup is read-only once matches or byes exist, the tournament has started, or multiple stages are present.', 409);
  const value = validateSetup(input);
  if (input.revision !== current.revision) throw new AdminError('Setup has changed since this form was opened. Reload before saving.', 409);
  if (current.state.stages[0] && current.state.stages[0][0] !== value.id) throw new AdminError('The saved stage ID cannot be changed.', 409);
  // A stale snapshot sets name to NULL, causing the existing NOT NULL constraint to abort the whole D1 batch before any changes.
  const statements = [db.prepare(`INSERT INTO tournament_stages
    (tournament_id, id, name, format, bracket_size, series_type, map_count, final_map_rule, action_seconds, reserve_seconds)
    SELECT ?1, ?2, CASE WHEN (${snapshotSQL}) = ?3 THEN ?4 ELSE NULL END, ?5, ?6, ?7, ?8, ?9, ?10, ?11
    ON CONFLICT(tournament_id, id) DO UPDATE SET name = excluded.name, format = excluded.format,
      bracket_size = excluded.bracket_size, series_type = excluded.series_type, map_count = excluded.map_count,
      final_map_rule = excluded.final_map_rule, action_seconds = excluded.action_seconds, reserve_seconds = excluded.reserve_seconds`)
    .bind(tournamentId, value.id, current.snapshot, value.name, value.format, value.bracket_size, value.series_type, value.map_count, value.final_map_rule, value.action_seconds, value.reserve_seconds),
    db.prepare('DELETE FROM tournament_rounds WHERE tournament_id = ? AND stage_id = ?').bind(tournamentId, value.id),
    ...value.rounds.map(round => db.prepare(`INSERT INTO tournament_rounds (tournament_id, stage_id, id, name, sort_order, placement) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(tournamentId, value.id, round.id, round.name, round.sort_order, round.placement)),
  ];
  try {
    const results = await db.batch(statements);
    if (results.some(result => !result.success)) throw new Error('Setup batch failed');
  } catch (error) {
    if (/NOT NULL constraint failed: tournament_stages\.name/.test(String(error?.message))) throw new AdminError('Setup changed while saving. Reload before trying again.', 409);
    throw error;
  }
  return value.id;
}

export async function readParticipants(db, tournamentId) {
  const result = await db.prepare(`SELECT teams.id, teams.name, teams.tag FROM tournament_teams
    JOIN teams ON teams.id = tournament_teams.team_id WHERE tournament_teams.tournament_id = ? ORDER BY teams.name, teams.id`).bind(tournamentId).all();
  if (!result.success) throw new Error('Participant read failed');
  return result.results;
}
