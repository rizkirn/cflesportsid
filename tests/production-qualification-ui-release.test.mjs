import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { STABLE_VERSION, VERSION_PATH, SCRIPT, validatePinnedPayload, createPinnedTransport } from '../scripts/production/qualification-ui/guard.mjs';
import { verifyUiSourceScope } from '../scripts/production/qualification-ui/release.mjs';

function payload() {
  return {
    bindings: [
      { name: 'DB', type: 'd1', id: 'efded3c4-1cf9-46a9-823e-d0f2d17c683a' },
      { name: 'CFL_ASSETS', type: 'r2_bucket', bucket_name: 'cflesportsid-assets-production' },
      { name: 'ASSETS', type: 'assets' },
      { name: 'ADMIN_DRAW_KEY', type: 'inherit', version_id: STABLE_VERSION },
    ],
    assets: { config: { base_path: '/', html_handling: 'auto-trailing-slash', not_found_handling: 'none', run_worker_first: false } },
    main_module: 'entry.mjs', modules: [{ name: 'entry.mjs', content_type: 'application/javascript+module', content_base64: 'ZXhwb3J0IGRlZmF1bHQge30=' }],
  };
}

test('UI release pins active baseline and secret inheritance to the verified qualification deployment', () => {
  assert.equal(STABLE_VERSION, '2767f1cb-5070-4012-a6bc-95afe06dfc3f');
  const p = payload(); validatePinnedPayload(p, p);
  for (const source of ['latest', '6f6f4073-6cdd-428e-8951-3c4cdf7a2e15', '57e6f48a-ef3f-4283-89ed-9e6c4deef309']) {
    const changed = structuredClone(p); changed.bindings.at(-1).version_id = source;
    assert.throws(() => validatePinnedPayload(changed, changed), /SECRET_SOURCE_NOT_PINNED/);
  }
});

test('UI release requires deploy=false and cannot activate or force deployment', async () => {
  for (const path of [VERSION_PATH.replace('?deploy=false', ''), VERSION_PATH.replace('false', 'true'), SCRIPT + '/deployments', SCRIPT + '/deployments?force=true']) {
    let calls = 0;
    const api = createPinnedTransport({ token: 'fixture', checkApproval: () => {}, expectedPayload: payload(), fetcher: async () => { calls++; throw Error('must not reach network'); } });
    await assert.rejects(() => api.request('POST', path, payload()), /ENDPOINT_OR_DEPLOY_FLAG_REJECTED/);
    assert.equal(calls, 0);
  }
});

test('UI source proof permits only qualification markup and styling, preserving calculation and other sections', () => {
  const root = mkdtempSync(tmpdir() + '/cfl-ui-source-proof-');
  try {
    for (const side of ['before', 'after']) {
      mkdirSync(root + '/' + side + '/src/pages', { recursive: true });
      mkdirSync(root + '/' + side + '/src/styles', { recursive: true });
      mkdirSync(root + '/' + side + '/public');
      writeFileSync(root + '/' + side + '/src/pages/index.astro', '---\nconst qualifiedTeams = standings.slice(0, ALL_STAR_SPOTS);\n---\n<section class="home-panel qualification-section">' + side + '</section><section>Latest Matches</section>');
      writeFileSync(root + '/' + side + '/src/styles/home.css', '.qualification-summary {display:' + (side === 'before' ? 'flex' : 'grid') + ';}.other-section {color:orange;}');
    }
    assert.equal(verifyUiSourceScope(root + '/after', root + '/before').qualificationLogicUnchanged, true);
    writeFileSync(root + '/after/src/styles/home.css', '.qualification-summary {display:grid;}.other-section {color:red;}');
    assert.throws(() => verifyUiSourceScope(root + '/after', root + '/before'), /UNRELATED_STYLING_CHANGE/);
    writeFileSync(root + '/after/src/pages/index.astro', '---\nconst qualifiedTeams = [];\n---\n<section class="home-panel qualification-section">after</section><section>Latest Matches</section>');
    assert.throws(() => verifyUiSourceScope(root + '/after', root + '/before'), /LOGIC_OR_OTHER_SECTION_CHANGED/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
