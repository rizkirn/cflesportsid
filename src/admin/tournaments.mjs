export class AdminError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function requireLocalAdmin(request, development, env) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (!development || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || request.headers.has('forwarded') || request.headers.has('x-forwarded-for')
    || (forwardedHost !== null && forwardedHost !== url.host)) {
    throw new AdminError('Admin is available only on the local development server.', 403);
  }
  if (!env.cflesportsid_staging) throw new AdminError('The staging database is unavailable.', 503);
  return env.cflesportsid_staging;
}

export async function readAdminForm(request, { maxBytes = 4096, allowedField }) {
  if (request.headers.get('origin') !== new URL(request.url).origin
    || (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) {
    throw new AdminError('Reload the form and submit it from this admin page.', 403);
  }
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    throw new AdminError('Unsupported form submission.', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError('The form is empty.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new AdminError('The form is too large.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  for (const key of form.keys()) {
    if (!allowedField(key) || form.getAll(key).length !== 1) {
      throw new AdminError('Unexpected or repeated form fields.');
    }
  }
  return Object.fromEntries(form);
}

export async function readCreateForm(request) {
  return readAdminForm(request, { allowedField: key => ['name', 'start_date', 'end_date','is_test','bracket_size','map_count','action_seconds','reserve_seconds','bronze_match'].includes(key) });
}

export async function createTournamentWithSetup(db,input) {
  const {cfgTemplate,validateSetup}=await import('./setup.mjs');
  const value=validateTournament(input);
  const setup=validateSetup({...cfgTemplate,...Object.fromEntries(['bracket_size','map_count','action_seconds','reserve_seconds'].map(key=>[key,input[key]??cfgTemplate[key]])),bronze_match:input.bronze_match??''});
  if(!['0','1'].includes(input.is_test??'0'))throw new AdminError('Select Official or Test.');
  const lifecycle=await testLifecycleAvailable(db);
  if(input.is_test==='1'&&!lifecycle)throw new AdminError('Test tournament creation requires migration 0007. No tournament was created.',503);
  const id=await tournamentId(value.name);
  const insert=lifecycle?db.prepare(`INSERT INTO tournaments(id,name,game,region,start_date,end_date,status,format,is_test) VALUES(?,?,'crossfire-legends','ID',?,?,'upcoming','single-elimination',?)`).bind(id,value.name,value.start_date,value.end_date,input.is_test==='1'?1:0):db.prepare(`INSERT INTO tournaments(id,name,game,region,start_date,end_date,status,format) VALUES(?,?,'crossfire-legends','ID',?,?,'upcoming','single-elimination')`).bind(id,value.name,value.start_date,value.end_date);
  try {
    const results=await db.batch([insert,db.prepare(`INSERT INTO tournament_stages(tournament_id,id,name,format,bracket_size,series_type,map_count,final_map_rule,action_seconds,reserve_seconds) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,setup.id,setup.name,setup.format,setup.bracket_size,setup.series_type,setup.map_count,setup.final_map_rule,setup.action_seconds,setup.reserve_seconds),...setup.rounds.map(round=>db.prepare('INSERT INTO tournament_rounds(tournament_id,stage_id,id,name,sort_order,placement) VALUES(?,?,?,?,?,?)').bind(id,setup.id,round.id,round.name,round.sort_order,round.placement))]);
    if(results.some(result=>!result.success))throw new Error('Tournament setup creation failed');
  }catch(error){if(/UNIQUE constraint failed/.test(String(error?.message)))throw new AdminError('A tournament with this name or URL already exists.',409);throw error;}
  return id;
}

export function validateTournament(input) {
  const name = typeof input.name === 'string' ? input.name.normalize('NFKC').trim().replace(/ +/g, ' ') : '';
  if (name.length < 3 || name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new AdminError('Tournament name must contain 3 to 120 characters without control characters.');
  }
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '0001-01-01' && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(input.start_date) || !validDate(input.end_date)) {
    throw new AdminError('Enter valid start and end dates.');
  }
  if (input.end_date < input.start_date) throw new AdminError('End date must be on or after start date.');
  return { name, start_date: input.start_date, end_date: input.end_date };
}

export async function tournamentId(name) {
  const canonical = name.normalize('NFKC').trim().replace(/ +/g, ' ').toLowerCase();
  const slug = canonical.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug) return slug;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `tournament-${Array.from(new Uint8Array(digest)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function createTournament(db, input) {
  const value = validateTournament(input);
  const id = await tournamentId(value.name);
  if(input.is_test!==undefined&&!['0','1'].includes(input.is_test))throw new AdminError('Select Official or Test.');
  const lifecycle=await testLifecycleAvailable(db);
  if(input.is_test==='1'&&!lifecycle)throw new AdminError('Test tournament creation requires migration 0007. No tournament was created.',503);
  const result = lifecycle ? await db.prepare(`INSERT INTO tournaments
    (id,name,game,region,start_date,end_date,status,format,winner_team_id,is_test)
    VALUES (?,?,'crossfire-legends','ID',?,?,'upcoming','single-elimination',NULL,?)
    ON CONFLICT(id) DO NOTHING`).bind(id,value.name,value.start_date,value.end_date, input.is_test==='1'?1:0).run() : await db.prepare(`INSERT INTO tournaments
    (id, name, game, region, start_date, end_date, status, format, winner_team_id)
    VALUES (?, ?, 'crossfire-legends', 'ID', ?, ?, 'upcoming', 'single-elimination', NULL)
    ON CONFLICT(id) DO NOTHING`).bind(id, value.name, value.start_date, value.end_date).run();
  if (!result.success) throw new Error('Tournament insert failed');
  if (result.meta.changes !== 1) throw new AdminError('A tournament with this name or slug already exists. Use a distinct name.', 409);
  return id;
}

export async function listTournaments(db) {
  const result = await db.prepare(`SELECT *
    FROM tournaments ORDER BY CASE status WHEN 'ongoing' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, start_date DESC, id`).all();
  if (!result.success) throw new Error('Tournament list failed');
  return result.results;
}

export async function getTournament(db, id) {
  if (!id || !/^[a-z0-9-]{1,120}$/.test(id)) return null;
  return db.prepare(`SELECT *
    FROM tournaments WHERE id = ?`).bind(id).first();
}

export async function testLifecycleAvailable(db) {
  const result=await db.prepare('PRAGMA table_info(tournaments)').all();
  if(!result.success)throw new Error('Tournament schema unavailable');
  return result.results.some(column=>column.name==='is_test');
}

export function metadataRevision(tournament) {
  return JSON.stringify([tournament.name,tournament.start_date,tournament.end_date,tournament.status]);
}

export async function saveTournamentMetadata(db,id,form) {
  const tournament=await getTournament(db,id);
  if(!tournament)throw new AdminError('Tournament not found.',404);
  if(form.revision!==metadataRevision(tournament))throw new AdminError('Tournament changed. Reload before saving.',409);
  const value=validateTournament(form);
  const result=await db.prepare(`UPDATE tournaments SET name=?1,start_date=?2,end_date=?3
    WHERE id=?4 AND name=?5 AND start_date=?6 AND end_date=?7 AND status='upcoming' AND winner_team_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM matches WHERE tournament_id=?4)
    AND NOT EXISTS(SELECT 1 FROM tournament_byes WHERE tournament_id=?4)`)
    .bind(value.name,value.start_date,value.end_date,id,tournament.name,tournament.start_date,tournament.end_date).run();
  if(!result.success)throw new Error('Tournament metadata save failed');
  if(result.meta.changes!==1)throw new AdminError('Tournament preparation is locked or changed. Nothing was saved.',409);
}

export async function deleteTestTournament(db,id,form) {
  if(!(await testLifecycleAvailable(db)))throw new AdminError('Test deletion requires migration 0007.',503);
  const tournament=await getTournament(db,id);
  if(!tournament)throw new AdminError('Tournament not found.',404);
  if(tournament.is_test!==1)throw new AdminError('Official tournaments cannot be deleted.',403);
  if(form.confirmed!=='yes'||form.confirm_name!==tournament.name)throw new AdminError('Type the exact tournament name and confirm permanent deletion.');
  const matchIds='SELECT id FROM matches WHERE tournament_id=?';
  const statements=[
    db.prepare('UPDATE tournaments SET name=CASE WHEN is_test=1 AND name=? THEN name ELSE NULL END WHERE id=?').bind(tournament.name,id),
    db.prepare('DELETE FROM match_correction_audit WHERE tournament_id=?').bind(id),
    ...((await db.prepare("SELECT name FROM sqlite_master WHERE name='official_map_assignments'").all()).results.length?[db.prepare('DELETE FROM official_map_assignments WHERE tournament_id=?').bind(id)]:[]),
    ...['player_round_stats','player_match_entries','match_detail_edits','match_map_walkovers','match_maps','match_sources'].map(table=>db.prepare(`DELETE FROM ${table} WHERE match_id IN (${matchIds})`).bind(id)),
    db.prepare('DELETE FROM matches WHERE tournament_id=?').bind(id),
    ...['tournament_rosters','tournament_teams','tournament_byes','stage_map_pool','veto_steps','team_penalties','tournament_rounds','tournament_stages'].map(table=>db.prepare(`DELETE FROM ${table} WHERE tournament_id=?`).bind(id)),
    db.prepare('DELETE FROM tournaments WHERE id=? AND is_test=1').bind(id),
  ];
  try {
    const results=await db.batch(statements);
    if(results.some(result=>!result.success))throw new Error('Test cleanup failed');
  }catch(error) {
    if(/FOREIGN KEY|NOT NULL|Official tournaments/.test(String(error?.message)))throw new AdminError('Deletion blocked by changed or externally referenced tournament data. Nothing was deleted.',409);
    throw error;
  }
}
