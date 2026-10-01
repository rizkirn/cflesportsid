import assert from 'node:assert/strict';

const base = process.env.ADMIN_TEST_URL;
if (!base || !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Set ADMIN_TEST_URL to the offline staging server URL.');
if (process.env.ADMIN_TEST_LOCAL !== '1') throw new Error('Run only against an isolated local staging simulation, with ADMIN_TEST_LOCAL=1.');
const get = path => fetch(base + path, { redirect: 'manual' });
const post = (input, origin = base) => fetch(base + '/admin/tournaments/new', {
  method: 'POST', redirect: 'manual', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(input),
});
const name = `HTTP verification ${crypto.randomUUID()}`;
const input = { name, start_date: '2026-10-01', end_date: '2026-10-01' };
const initial = await get('/admin');
assert.equal(initial.status, 200);
assert.equal(initial.headers.get('cache-control'), 'no-store');
assert.equal(initial.headers.get('x-robots-tag'), 'noindex, nofollow');
assert.equal((await get('/admin/tournaments/new')).status, 200);
assert.equal((await post(input, 'https://evil.example')).status, 403);
assert.equal((await post({ ...input, start_date: '2026-02-30' })).status, 400);
assert.equal((await post({ ...input, winner_team_id: 'injected' })).status, 400);
const created = await post(input);
assert.equal(created.status, 303);
const path = created.headers.get('location');
assert.match(path, /^\/admin\/tournaments\/http-verification-[a-f0-9-]+\/setup$/);
const setup = await get(path);
assert.equal(setup.status, 200); assert.match(await setup.text(), new RegExp(name));
const duplicate = await post(input);
assert.equal(duplicate.status, 409); assert.match(await duplicate.text(), /already exists/);
assert.match(await (await get('/admin')).text(), new RegExp(name));
assert.equal((await get('/admin/tournaments/__missing__/setup')).status, 404);
assert.equal((await fetch(base + path, { method: 'POST', headers: { origin: base } })).status, 405);
assert.equal((await fetch(base + '/admin', { headers: { 'x-forwarded-for': '127.0.0.1' } })).status, 403);
console.log('Admin HTTP checks passed: staging list, create/303/setup, duplicate, validation, CSRF, missing ID, methods, proxy denial and cache headers. Test records remain only in the offline simulation.');
