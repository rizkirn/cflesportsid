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
assert.equal((await fetch(base + path, { method: 'POST', headers: { origin: base } })).status, 415);
assert.equal((await fetch(base + '/admin', { headers: { 'x-forwarded-for': '127.0.0.1' } })).status, 403);
const { cfgTemplate } = await import('../src/admin/setup.mjs');
const html = await (await get(path)).text();
const revision = html.match(/name="revision" value="([a-f0-9]+)"/)[1];
const setupInput = new URLSearchParams({ ...Object.fromEntries(Object.entries(cfgTemplate).filter(([key]) => key !== 'rounds')), revision });
cfgTemplate.rounds.forEach((round,index) => Object.entries(round).forEach(([key,value])=>setupInput.set(`rounds.${index}.${key}`,value)));
const submit = (data, origin=base) => fetch(base+path,{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:data});
assert.equal((await submit(setupInput,'https://evil.example')).status,403);
const add = new URLSearchParams(setupInput); add.set('intent','add-round');
const added = await submit(add); assert.equal(added.status,200); assert.match(await added.text(),/rounds\.5\.name/);
assert.equal((await (await get(path)).text()).includes('rounds.5.name'),false);
const invalid = new URLSearchParams(setupInput); invalid.set('bracket_size','15'); assert.equal((await submit(invalid)).status,400);
const saved = await submit(setupInput); assert.equal(saved.status,303); assert.equal(saved.headers.get('location'),path.replace('/setup','/participants'));
const participants = await get(saved.headers.get('location')); assert.equal(participants.status,200); assert.match(await participants.text(),/Participant list/);
assert.equal((await submit(setupInput)).status,409);
assert.match(await (await get(path)).text(),/Bronze Match/);
const participantPath = path.replace('/setup','/participants');
const participantPost = (data, origin=base) => fetch(base+participantPath,{method:'POST',redirect:'manual',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:data});
const hiddenFields = html => {
  const params = new URLSearchParams();
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    if (!/type="hidden"/.test(tag)) continue;
    const name=tag.match(/name="([^"]*)"/)[1];
    const value=(tag.match(/value="([^"]*)"/)?.[1] ?? '').replaceAll('&amp;','&').replaceAll('&#39;',"'").replaceAll('&quot;','"');
    params.set(name,value);
  }
  return params;
};
let participantData = hiddenFields(await (await get(participantPath)).text());
assert.equal((await participantPost(participantData,'https://evil.example')).status,403);
assert.equal((await participantPost(participantData)).status,400);
const firstTeam=`HTTP Alpha ${crypto.randomUUID()}`;
const secondTeam=`HTTP Beta ${crypto.randomUUID()}`;
for (const name of [firstTeam,secondTeam]) {
  participantData.set('intent','add-new');participantData.set('new_name',name);participantData.set('new_tag','HTTP');participantData.set('new_region','ID');
  const draft=await participantPost(participantData);assert.equal(draft.status,200);
  participantData=hiddenFields(await draft.text());
}
assert.match(await (await get(participantPath)).text(),/0 \/ 16 teams/);
assert.equal((await get(path.replace('/setup','/bracket'))).status,303);
const draftRevision=participantData.get('revision');
const persisted=await participantPost(participantData);assert.equal(persisted.status,303);assert.equal(persisted.headers.get('location'),path.replace('/setup','/bracket'));
const bracket=await get(persisted.headers.get('location'));assert.equal(bracket.status,200);assert.match(await bracket.text(),/Saved participants/);
let participantHTML=await (await get(participantPath)).text();assert.match(participantHTML,/2 \/ 16 teams/);assert.match(participantHTML,new RegExp(firstTeam));
assert.equal((await participantPost(participantData)).status,409);
participantData=hiddenFields(participantHTML);assert.notEqual(participantData.get('revision'),draftRevision);
const removedId=participantData.get('participants.0.id');
const invalidTeam=new URLSearchParams(participantData);invalidTeam.set('participants.0.id','__missing__');assert.equal((await participantPost(invalidTeam)).status,400);
const duplicateTeam=new URLSearchParams(participantData);duplicateTeam.set('intent','add-existing');duplicateTeam.set('team_id',removedId);assert.equal((await participantPost(duplicateTeam)).status,400);
const removal=new URLSearchParams(participantData);removal.set('remove_participant','0');
const removed=await participantPost(removal);assert.equal(removed.status,200);const removedHTML=await removed.text();assert.match(removedHTML,/1 \/ 16 teams/);
assert.match(await (await get(participantPath)).text(),/2 \/ 16 teams/);
const restored=hiddenFields(removedHTML);restored.set('intent','add-existing');restored.set('team_id',removedId);
const restoredResponse=await participantPost(restored);assert.equal(restoredResponse.status,200);assert.match(await restoredResponse.text(),/2 \/ 16 teams/);
assert.equal((await fetch(base+path.replace('/setup','/bracket'),{method:'POST',headers:{origin:base,'content-type':'application/x-www-form-urlencoded'},body:'intent=save'})).status,405);
console.log('Admin HTTP checks passed: create/setup, participant drafts, create new teams, existing team selection/removal, save/303/bracket, counts, duplicates, stale forms, validation, CSRF, methods and cache headers. All test records remain in the offline simulation.');
