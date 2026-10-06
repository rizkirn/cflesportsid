# R2-A checkpoint

## A. Preflight

Only `/Users/rizkirn/Job/aceon/cflesportsid-development` was used.
Branch `feature/r2-assets` started clean at
`aa8bcfb24509fc4548adabe0d521da4602ffa65c`.
HEAD, main, origin/main and the merge base matched that checkpoint.
No other checkout or worktree was created.

## B–C. Migration and schema

`0009_r2_asset_references.sql` contains only:

```sql
ALTER TABLE teams ADD COLUMN logo_asset_key TEXT;
ALTER TABLE players ADD COLUMN photo_asset_key TEXT;
ALTER TABLE maps ADD COLUMN image_asset_key TEXT;
ALTER TABLE tournaments ADD COLUMN poster_asset_key TEXT;
```

All four columns are nullable TEXT without a default or backfill. Populated
0008 upgrade rehearsal compared every existing table/row before and after:
existing values were unchanged and all added values were NULL. Fresh local
0001–0009 application and seed import passed; foreign keys were clean.
Migrations 0001–0008 remain unchanged.

## D–E. Overlay and resolver

`frontend-assets.ts` preserves the JSON collection and reads only the relevant
identity plus asset-key column. Player references join by UID, not master ID.
`overlayAssetReferences` copies only the asset field; identity, IGN, membership,
rosters, match data and statistics are untouched. Reads are collection-wide,
not per entity. Existing team/tournament D1 readers reuse their existing
query/batch results, including records that originated in JSON.

Missing DB bindings, failed queries and pre-0009 columns return the original
collection. No global request data or asset cache was added.

The shared `resolveAsset` returns `reference`, `legacy`, `fallback`, and `src`.
R2-A stores the reference separately and serves the legacy source. A populated
key never enables `/media` by itself. Future media delivery can be introduced
at this resolution boundary; key validation, media serving and remote image
fallback behavior belong to R2-B.

## F–H. Consumers and Thumbnail/tools

Homepage, standings, teams, players, maps, matches/MVP/MatchInsights inputs,
tournament bracket/poster presentation, bracket-generator catalog/export
inputs and admin bracket rendering use the shared resolver. Player/map JSON
consumers now read asset-only overlays. Existing admin master readers use
SELECT * and safely expose the columns; their editable field lists remain
unchanged. No upload UI or production authentication was added.

Thumbnail retains bundled WebP optimization, retina srcset and its existing
error fallback. Future same-origin `/media/` and existing HTTPS image sources
pass through instead of being replaced solely because the build glob cannot
find them. Missing bundled local photos retain the default fallback.

Randomizer resolves map images on the server for both simulation and official
contexts. Veto receives an escaped JSON dictionary of resolved map sources;
browser rendering consumes that dictionary and does not construct a second
map-image path. Tool engines and persistence rules were not changed.

## I–L. Continuity and local fallbacks

Historical `1345266890--before-clash-for-glory-s2` always resolves to
`/players/default.webp`, even if a current avatar or asset key is supplied.
This applies to profile, leaderboard, historical match insights/MVP and map
statistics. It never uses `/players/1345266890.webp`.
Current KucayyPRMX retains normal current avatar behavior.
Ordinary rename UID 1083796629 remains continuous; no continuity configuration
or identity aggregation was changed.

Team legacy logo/tag path and default logo remain available. Player legacy
avatar/UID path and default remain available. Maps retain map-ID paths and
the SVG placeholder. S1/S2 posters use available local tournament files;
tournaments without a local poster retain the existing placeholder markup.
No local assets were removed, moved, uploaded or fabricated.

## M–N. Validation

- Full unit suite: 169/169 passed, including 14 added R2-A tests.
- Typecheck and build passed.
- Data validation: 185 records, zero errors/warnings.
- Public local Worker regression: 195 pages across NULL keys, populated keys,
  pre-0009 schema and missing DB binding; 46 optimized asset URLs succeeded.
- All 19 team pages and both tournament pages were unchanged across the tested
  asset-key/schema states. Existing team/tournament statistical tests passed.
- Local D1 import/statistical parity: zero mismatches.
- S1 K/D/A: 2726/2731/1185; S2: 2293/2279/1133;
  combined: 5019/5010/2318. Overall remains 128 statistical rows/127 masters.
- Historical match avatar payloads contain no current UID avatar path.
- Built Worker `/admin`: GET/POST 403. Canonical/sitemap/robots remain
  `https://cflesports.com`.

Integration persistence is isolated under ignored `.generated/r2a-*` with a
temporary config and dummy database ID. Every database/Worker operation was
explicitly local. The test temporarily removes the four columns to exercise
pre-0009 fallback, then restores them; it does not modify remote schemas.

## O. Changed files

- `migrations/0009_r2_asset_references.sql`
- `src/content.config.ts`
- `src/data-access/frontend-assets.ts`, `frontend-bracket.ts`
- `src/utils/assets.mjs`, `assets.d.mts`, `content.ts`, `standings.ts`
- `src/components/Thumbnail.astro`
- `src/components/admin/BracketTeams.astro`, `OperationalBracket.astro`
- `src/components/tools/MapRandomizerTool.astro`, `VetoTool.astro`
- `src/pages/index.astro`, `bracket-generator.astro`
- `src/pages/teams/index.astro`, `teams/[id].astro`
- `src/pages/players/index.astro`, `players/[id].astro`
- `src/pages/maps/index.astro`, `maps/[id].astro`
- `src/pages/matches/index.astro`, `matches/[id].astro`
- `src/pages/tournament/index.astro`, `tournament/[id].astro`
- `tests/assets.test.mjs`, `r2-assets.integration.mjs`
- `tests/standings-penalty.test.mjs`, `veto.test.mjs` (resolver/catalog fixtures)
- This report and `anti-slop/fix-032-2026-10-05.md`

## P–R. Application state and next boundary

0009 was rehearsed locally only. Staging and production were untouched.
No R2 bucket, binding, object upload, media endpoint, Cloudflare configuration,
deployment, DNS, Pages, Bulk Redirect or canonical change occurred.
`wrangler.jsonc` is unchanged. Main remains at the validated checkpoint.
Changes are unstaged and uncommitted on `feature/r2-assets`; no push occurred.

R2-A has no remaining validation blocker. R2-B requires separately authorized
staging bucket/binding and media delivery work. Production uploads still need
a separate authentication decision; the production admin guard remains closed.
No R2-B work was started.
