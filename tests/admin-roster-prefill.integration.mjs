import assert from 'node:assert/strict';
import {html,post,fields,create,participantsForm} from './admin-http-fixture.mjs';
const root=await create(`Prefill verification ${crypto.randomUUID()}`);
await post(root+'/participants',participantsForm(await html(root+'/participants'),['cha-tra-mue','demigod-kage']));
let page=await html(root+'/roster');assert.doesNotMatch(page,/Copy Current Team Roster/);assert.match(page,/Draft roster/);
const entries=[...fields(page).keys()].filter(key=>/^entries\.\d+\.id$/.test(key));assert.equal(entries.length,12);assert.match(await html(root),/0\/2/);
let draft=fields(page);draft.set('entries.0.ign','Reviewed CTM UX');draft.set('intent','save');await post(root+'/roster',draft);
page=await html(root+'/roster');assert.match(page,/Reviewed CTM UX/);assert.match(await html(root),/2\/2/);
console.log('Roster prefill HTTP PASS: 5+7 players automatically drafted, no silent persistence, reviewed snapshot saved and current tournament roster wins.');
