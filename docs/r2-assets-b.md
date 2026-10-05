# R2-B: staging read-only media checkpoint

Validated 2026-10-05. Stop before commit/push; R2-C is not started.

## A. Preflight

Checkout /Users/rizkirn/Job/aceon/cflesportsid-development; branch feature/r2-assets. HEAD and origin/feature/r2-assets remain 5db5cce0267cfd5acc8c0a0120617877f55896ed. main/origin/main remain aa8bcfb24509fc4548adabe0d521da4602ffa65c. Working tree was clean before implementation.

Root wrangler.jsonc remains byte-identical: SHA256 a96e1247043080b9a97113460acd16c61f2fe10c062b1c5d0ddeb7d782a4bde9. No applied migration source was modified.

## B–C. Bucket and configuration

Created only cflesportsid-assets-staging in the existing account. r2.dev disabled; no custom domains. New wrangler.uat.jsonc targets only cflesportsid-uat, with routes [], workers.dev enabled, DB bound only to cflesportsid-staging (4ba57de7-5fda-4703-a956-b1936546986a), CFL_ASSETS bound only to cflesportsid-assets-staging, ASSETS served from dist/client. It points to dist/server/entry.mjs and includes Astro ES module rules plus find_additional_modules. Production configuration is unchanged.

## D–F. Endpoint/security/cache

/media/[...key] delegates through the Cloudflare frontend data-access boundary to a tested streaming handler. GET uses R2 get; HEAD uses head and returns no body. Only four fixed categories with ASCII entity IDs/numeric UIDs, SHA256 lowercase hexadecimal filenames and webp/png/jpg/jpeg are accepted. Empty/malformed segments, percent escapes, traversal and SVG/HTML/arbitrary paths are rejected. No arbitrary URL proxy or object listing exists. Non-GET/HEAD returns 405 with Allow. Astro also rejects unsafe cross-origin mutation requests before the handler.

Successful versioned images use extension-derived MIME, nosniff, ETag, Content-Length and public, max-age=31536000, immutable. Missing objects return 404; malformed keys 400; storage failure 503 with safe generic text. Endpoint errors use no-store; normalized traversal reaching the ordinary site 404 has no immutable policy. No Cache API or credential/metadata exposure.

## G–H. Resolver and Thumbnail

Valid category keys resolve to same-origin /media; NULL/invalid references retain local resolution. Browser fallback tries the original local source, then the existing default/placeholder, clears srcset, and terminates after exhaustion. Thumbnail preserves local bundled optimization and passes through media sources. Direct image consumers, Randomizer/Veto, comparison cards and bracket export use the same fallback order. No local asset was removed.

## I–K. Controlled objects and D1

Four original repository WebP files uploaded, total 607312 bytes. No defaults/placeholders or other images were uploaded.

| Row / field | Repository file | R2 key |
|---|---|---|
| teams.familia-nova / logo_asset_key | public/logos/FNOV.webp | teams/familia-nova/logo/cf11d19ef77369105bb2e9c2962ffbc502632de081753ecb68a4f7554468b87a.webp |
| players.1347741365 / photo_asset_key | public/players/1347741365.webp | players/1347741365/avatar/899d944ec000410279d649fb5daaccb8a5eb0ea0aa9759143c20443a6d22f5ca.webp |
| maps.island / image_asset_key | public/maps/island.webp | maps/island/cover/79a06140ec6c8479e2f95eb4df7c73f9a5e9cdfc1fdf41fa0004c2ff2995600f.webp |
| tournaments.clash-for-glory-s2 / poster_asset_key | public/tournaments/clash-for-glory-s2.webp | tournaments/clash-for-glory-s2/poster/6abe6b14e7f88dc968c1028c29d4afcfb819e5e13970a4cda485d05bd61aee92.webp |

Staging migration ledger changed only from 0001–0008 to 0001–0009. Each reference was originally NULL and updated by exact ID plus NULL guard. All other references remain NULL. Full snapshots prove all 21 original table contents unchanged after stripping the four additive nullable fields; foreign-key violations 0.

Two temporary browser fault tests were restored: island's key temporarily referenced a missing hash then returned to the real key; current UID 1345266890 temporarily referenced a missing avatar then returned to NULL. Final retained state is exactly the four valid refs above.

Rollback: set only these four fields to NULL using exact ID plus current-key guards. Leave additive 0009 columns/ledger in place; do not drop historical schema. Revert UAT deployment to previous version a6171499-76fc-4b3c-b35b-c265fc3c5468 if needed. Object removal/bucket deletion is not part of this task. Guarded reference rollback SQL is saved outside the repository at /private/tmp/cfl-r2b-staging-rollback.sql.

## L. UAT version/bindings

URL: https://cflesportsid-uat.cflid.workers.dev

Version 81a3ebc7-9d8a-4590-ba7a-bc83c8661be4; deployment b99a482c-606f-418f-8990-cdf1323c783e. API read-back confirms exactly ASSETS, staging DB and staging CFL_ASSETS. No production D1 binding. Startup 20 ms. Initial upload was rejected due to missing Astro module rules; the packaging configuration was corrected, dry-run included all 78 modules, and the successful deployment superseded no production resource.

## M–P. Live UAT and continuity

All four media objects: GET 200, HEAD 200 with no body, byte hashes match originals, image/webp + nosniff + ETag + immutable headers. Valid missing key 404; malformed/traversal/empty-segment/SVG/HTML requests 4xx without immutable caching; same-origin POST/PUT/PATCH/DELETE 405. No write endpoint exists.

All four consumers resolve media; Randomizer/Veto use the Island media key; S1 NULL poster retains local image. Browser verified Island media loads, then deliberate missing media falls back to /maps/island.webp with srcset cleared. Current Kucayy missing media plus missing local avatar reaches /players/default.webp with fallback index 2. Historical KangDedy uses default.webp even while a current UID asset key exists. Both fault references were restored.

KangDedy 70/40/42 and KucayyPRMX 50/16/24 remain separate; ordinary UID 1083796629 stays continuous at 123/172/70. Historical/current navigation remains present. /admin GET/POST remain 403. Canonical/robots/sitemap use the existing source value https://cflesports.com; no canonical source was changed.

## Q–R. Validation and golden totals

- 179/179 unit tests passed.
- Typecheck and Astro build passed; data validation 185 records, 0 errors/warnings.
- Local public regression: 195 pages across NULL/invalid refs, pre-0009 schema and absent DB; 46 optimized assets; all 19 Team Details and both tournament pages unchanged across fallback states.
- Real local R2 GET/HEAD/security/hash tests passed; local D1 parity zero mismatches.
- Live UAT: 195 public routes 200, four media consumers, tools, continuity, canonical and guard passed. Staging snapshot D1 parity zero mismatches.
- Live overall 128 statistical rows / 127 master players; aggregate 5019/5010/2318.
- S1 2726/2731/1185; S2 2293/2279/1133.

Integration harness now sends local Worker logs directly to files; this fixes pipe saturation while synchronous CLI database checks run. Mutation-method tests include same-origin headers to exercise the media 405 handler without disabling Astro CSRF protection.

## S. Production/scope safety

Production D1 before/after full schema, migration ledger 0001–0008 and all 21 tables are identical. Production Worker settings/bindings and deployment history match before/after API snapshots. Pages source configuration remains unchanged including the branch exclusion. No Pages write, DNS/domain/Bulk Redirect write, production R2 creation/binding, admin upload, production deployment or data migration was performed. DNS/Bulk Redirect were not independently snapshotted in R2-B; their preservation is based on no operations touching them.

## T–U. Source inventory/status

35 files changed/new (24 modified, 11 new), all unstaged and uncommitted on feature/r2-assets. No source push, merge or checkout switch occurred. New docs: docs/r2-assets-b.md and anti-slop/fix-033-2026-10-05.md.

- src/components/MatchInsights.astro
- src/components/Thumbnail.astro
- src/components/admin/BracketTeams.astro
- src/components/tools/MapRandomizerTool.astro
- src/components/tools/VetoTool.astro
- src/pages/bracket-generator.astro
- src/pages/index.astro
- src/pages/maps/[id].astro
- src/pages/maps/index.astro
- src/pages/matches/[id].astro
- src/pages/matches/index.astro
- src/pages/players/[id].astro
- src/pages/players/index.astro
- src/pages/teams/[id].astro
- src/pages/teams/index.astro
- src/pages/tournament/[id].astro
- src/pages/tournament/index.astro
- src/utils/assets.d.mts
- src/utils/assets.mjs
- src/utils/bracket-generator-ui.ts
- src/utils/bracket-image.ts
- src/utils/standings.ts
- tests/r2-assets.integration.mjs
- tests/veto.test.mjs
- src/data-access/frontend-media.ts
- src/data-access/media.d.mts
- src/data-access/media.mjs
- src/data-access/r2-bindings.d.ts
- src/pages/media/[...key].ts
- src/utils/asset-keys.d.mts
- src/utils/asset-keys.mjs
- tests/media.test.mjs
- wrangler.uat.jsonc

## V. R2-C boundary

No unresolved R2-B functional blocker. Admin upload/authentication, validation of uploaded image contents, object replacement/deletion lifecycle and eventual production rollout require a separate approved phase. Endpoint trusts the controlled object content behind validated hash keys; R2-B provides no upload surface. Root production config does not yet bind R2. Do not start R2-C or commit/push without the next checkpoint approval.
