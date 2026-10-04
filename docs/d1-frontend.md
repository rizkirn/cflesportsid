# Frontend match reads through D1

## Statistical continuity

Same UID means continuous statistics by default; IGN changes do not reset them.
Different UIDs are separate records, even with the same name. We do not identify
or merge real-world people across accounts. Confirmed ownership transfers are
configured in `src/config/player-continuity.mjs`: tournaments before the named
boundary use the previous segment; the boundary and later tournaments use the
current UID profile. Include every earlier tournament in `beforeTournaments`
when adding a boundary. Match dates and IGN spelling never choose a segment.
The previous segment has a stable `/players/<uid>--before-<tournament>/` URL.
These are presentation/statistics keys, not master player IDs. Both D1 and JSON
matches use the same resolver. Raw match rows and team attribution are unchanged.

This phase follows `a91700d35517cba960c64dec06a6fa6716a894bb`. Only match reads move to D1. Teams, players, maps and tournaments still use the JSON content collections. The existing match collection remains the complete fallback and supplies metadata and fields absent from the current schema. No migrations, production writes or production reseed are needed. `src/utils/statistics.ts`, all templates/styles and browser interaction code retain their existing behavior.

## Consumer audit

| Route | Match use |
| --- | --- |
| `/` | Standings, season totals, recent matches |
| `/matches` | Match list, sorting/filtering |
| `/matches/[id]` | Detail, maps, team/player insights and comparison data |
| `/teams` | Standings and team statistics |
| `/teams/[id]` | Career statistics and historical match records |
| `/players` | Player statistics |
| `/players/[id]` | Career statistics, match history and map attribution |
| `/maps` | Map statistics |
| `/maps/[id]` | Map, player and team statistics |
| `/tournament` | Tournament match summaries |
| `/tournament/[id]` | Brackets, participant sources, totals and validation |
| `/veto` | Match picker and veto session configuration |
| `/bracket-generator` | Existing match data for bracket generation |

All 13 route files call `getFrontendMatches()` and set `prerender = false`. Detail pages resolve their IDs at request time and return HTTP 404 for missing entries. Tournament detail still validates the selected tournament against the loaded matches. The former build-time JSON validation remains available through `npm run data:check` and must run before deployment.

The audit covered all `src` files, including `getCollection`, `getEntry`, content helpers, content loaders, imports, filesystem paths and browser fetches. The only direct `getCollection('matches')` left is the fallback callback in `src/data-access/frontend-matches.ts`. `src/content.config.ts` deliberately keeps the JSON loader. `src/utils/bracket-generator.ts` emits JSON download filenames; it does not load match records. Components and the statistics, standings, tournament and content helpers consume the entries supplied by their pages. Sitemap configuration enumerates JSON filenames for stable route coverage; it does not render match data from JSON.

## Runtime and deployment

The original site was a static Cloudflare Pages deployment. Static pages cannot access a runtime DB binding. Astro 7 requires the current official Cloudflare adapter, which supports Workers and has removed Pages support. Keeping the existing Astro version and using the supported adapter is smaller than downgrading Astro or adding a bespoke Pages proxy/adapter.

Sources:
- https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/

The config keeps the static default and opts only the 13 match-dependent routes into runtime rendering. Map randomizer, robots and the 404 asset remain prerendered. JSON collections are bundled into the Worker; their records still update through builds. Match data comes from the request's `cloudflare:workers` `env.DB`, using the previously validated five-query SELECT batch. No database client or credentials are exposed to browser code. Reads are request scoped, with no global cache retaining D1 handles or stale match data.

`wrangler.jsonc` adds exactly:

```json
"main": "@astrojs/cloudflare/entrypoints/server",
"compatibility_flags": ["nodejs_compat"],
"assets": { "binding": "ASSETS", "directory": "./dist/client" }
```

The adapter generates the deployed entrypoint and asset paths in `dist/server/wrangler.json`. The checked-in D1 ID stays `local-placeholder`: retain the user's actual existing database ID when integrating. Do not deploy with that placeholder or omit it to provision a replacement database. Local test configs always use local stores; they never enable remote bindings.

Build with `npm run build`; deploy a reviewed Worker artifact using the adapter's generated configuration (`wrangler deploy --config dist/server/wrangler.json`). No deployment was performed for this phase. The former Pages output-directory setting `dist` cannot deploy this runtime artifact. Configure a Workers deployment/preview before hosting this phase. A feature-branch Pages preview may therefore fail or lack the runtime routes until its deployment configuration is updated. Pushing this branch does not update `main`.

The public site URL, canonical URLs, sitemap URLs and robots remain `https://cflesportsid.pages.dev`. A Workers deployment alone does not move that hostname: a separate hosting/domain routing decision is needed before production cutover. Do not change canonical URLs merely for a temporary Worker preview. No hostname, Pages project, Worker, routing rule or production D1 configuration has been changed remotely.

Sessions are disabled because the site does not use them, avoiding an unnecessary KV resource. The image service uses passthrough, avoiding a new paid Images binding. Image identity, displayed dimensions, alt text and fallbacks remain the same; runtime image URLs change and serve originals instead of pre-resized images, so image payload sizes may increase. The regression suite verifies that those runtime URLs load. Static builds use Node prerendering for the unchanged static routes.

D1 errors, unavailable bindings, invalid/incomplete rows and coverage differences return the whole JSON collection and emit a server-side warning. JSON loading failures still propagate. The existing coverage guard deliberately requires the same match IDs and child counts in D1 and JSON during this staged migration. Admin writes and JSON-free reads are outside this phase.

## Verification

```sh
npm ci
npm test
npm run data:check
npm run db:seed:generate
npm run db:migrate:local
npm run db:seed:local
npm run db:parity
npm run test:frontend
npx tsc --noEmit
```

Use a fresh isolated local D1 store for the migration/seed commands; the seed is not idempotent. Do not run remote migration or seed commands. `test:frontend` builds the runtime artifact, archives the pre-integration commit into an ignored temporary directory, builds that static baseline, and starts two local Workers with disposable stores. One has seeded D1; the other has no DB binding. It compares all 194 content pages with each other and with the baseline, verifies asset responses, sitemap and robots, five missing-ID routes, a live local D1 update without rebuild, and a query failure that must fall back to JSON. It closes the local Workers when done. This integration suite needs loopback access and the baseline commit in local Git history.

HTML comparison normalizes stylesheet bundling, module asset names, the adapter's injected browser compatibility prelude, original-versus-transformed image URLs and JSON object key order. It retains markup, classes, dimensions, text, links, inline interaction code and embedded JSON field values. The unchanged browser logic also remains covered by the existing veto, bracket and randomizer tests.

`build:check` now supports `dist/client` and checks every sitemap route against the local runtime. Start `npm run preview`, then run `BUILD_CHECK_URL=http://127.0.0.1:4321 npm run build:check`. Without that URL, a runtime build check fails explicitly instead of reporting success after inspecting only the few static files. Existing image paths that intentionally use a valid `onerror` fallback are accepted. `test:frontend` includes this check automatically.

## Results for this phase

- Unit and consumer audit tests: 58/58 passed.
- Data check: 185 valid records, zero errors and warnings.
- Local D1 parity: 26 matches, 78 maps, zero field/statistics mismatches across S1, S2 and overall.
- Runtime build: passed; the previous 195-route static build is now split between runtime routes and three prerendered routes.
- Frontend regression: 194 content pages equal across seeded D1, no-binding fallback and the pre-integration baseline; 44 runtime asset URLs passed. Sitemap/robots, five missing-ID routes, live D1 updates and query-failure fallback passed.
- Production page checker: 197 rendered responses/static files, zero issues.
- TypeScript: `tsc --noEmit` passed.

## Safely integrating the user's dirty checkout

Work was done in a separate clone based on the remote feature branch. The user's checkout and its uncommitted work were not used or modified.

First confirm the checkout is on `feature/d1-backend`; do not switch or merge into `main`. Record `git status` and review the five local changes. Then:

```sh
git stash push --include-untracked -m "before-frontend-d1-integration"
git rev-parse stash
# Save the printed stash SHA.
git fetch origin feature/d1-backend
git merge --ff-only origin/feature/d1-backend
git stash apply <saved-stash-SHA>
```

Keep that stash until all restored files have been reviewed and tested. If the merge cannot fast-forward, stop and inspect branch divergence. If stash application conflicts, resolve them while keeping the stash; do not use hard reset, force push, `stash pop`, or automatic remote-file replacement.

Exact overlap:

- `package.json`: adds `dependencies.@astrojs/cloudflare = ^14.3.3` and `scripts.test:frontend = npm run build && node tests/frontend-pages.integration.mjs`. Preserve all local scripts, dependencies and `allowScripts` settings. The lockfile changes for the adapter and its dependency classification; regenerate/reconcile it from the merged package file if local dependency changes require this.
- `wrangler.jsonc`: adds the three runtime keys above. Preserve the user's real `DB` database ID/name, migrations directory, variables and existing bindings. Merge `nodejs_compat` into any local flag array and reconcile any local `main` or `assets` setting. Do not replace the local D1 ID with the repository placeholder.
- `src/pages/veto.astro`: adds the `getFrontendMatches` import and `prerender = false`, and replaces its single `getCollection('matches')` call. Preserve local veto behavior and economy configuration. These small frontmatter edits are the only remote veto changes.
- `src/pages/map-randomizer.astro` and `src/data/veto/economy.json`: unchanged by this phase.

After resolving overlaps, run `npm install` if the merged dependencies changed, then the unit/data/frontend checks. Inspect `git diff` and `git status` against the recorded local work. Only then locate the matching stash entry by SHA in `git stash list` and drop that exact entry.
