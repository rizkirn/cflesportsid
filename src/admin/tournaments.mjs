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
  return readAdminForm(request, { allowedField: key => ['name', 'start_date', 'end_date'].includes(key) });
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
  const result = await db.prepare(`INSERT INTO tournaments
    (id, name, game, region, start_date, end_date, status, format, winner_team_id)
    VALUES (?, ?, 'crossfire-legends', 'ID', ?, ?, 'upcoming', 'single-elimination', NULL)
    ON CONFLICT(id) DO NOTHING`).bind(id, value.name, value.start_date, value.end_date).run();
  if (!result.success) throw new Error('Tournament insert failed');
  if (result.meta.changes !== 1) throw new AdminError('A tournament with this name or slug already exists. Use a distinct name.', 409);
  return id;
}

export async function listTournaments(db) {
  const result = await db.prepare(`SELECT id, name, game, region, start_date, end_date, status, format, winner_team_id
    FROM tournaments ORDER BY CASE status WHEN 'ongoing' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, start_date DESC, id`).all();
  if (!result.success) throw new Error('Tournament list failed');
  return result.results;
}

export async function getTournament(db, id) {
  if (!id || !/^[a-z0-9-]{1,120}$/.test(id)) return null;
  return db.prepare(`SELECT id, name, game, region, start_date, end_date, status, format, winner_team_id
    FROM tournaments WHERE id = ?`).bind(id).first();
}
