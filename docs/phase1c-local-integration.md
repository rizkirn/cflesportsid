# Phase 1C local integration

## Result

Local integration passed. Existing hybrid readers remain the default. No remote access, migration, deployment, commit or push occurred. Production/staging configuration and migrations 0001–0010 remain untouched.

The verified run is `/private/tmp/cfl-phase1a-d5bwRZ`. Its `report.json` records 24 historical checks and Phase 1B contract checks; `http-report.json` records the HTTP suite. All seven existing stores and sidecars remained byte-identical.

## Files and reader integration

New files:

- `src/data-access/frontend-public.ts`: request-scoped reader selection, historical identity helpers, statistics adapter and shadow comparisons.
- `src/data-access/public-mode.mjs`: local mode guards, contract normalization helper and sitemap entity discovery.
- `src/pages/local-verification/[...tool].ts`: dynamic route which remains 404 outside the guarded local sitemap response.
- `scripts/phase1a/http.mjs`: HTTP harness inside the Phase 1A OS sandbox.
- `tests/public-mode.test.mjs`: mode and canonical sitemap guards.
- This document.

Modified integration boundaries: `frontend-assets.ts`, `frontend-bracket.ts`, `frontend-matches.ts` and `middleware.ts`. Homepage, team/player/map pages, match detail and tournament detail now import the guarded statistics/identity adapters. Their markup, styles and existing URL structure are unchanged. Directory/bracket/tool consumers inherit collection selection through the existing frontend boundaries. Veto uses saved stage map pools only in D1 mode; map randomizer and bracket generator inherit D1 catalogs. Freeform scrim/economy presets remain their existing tool configuration, not tournament-data fallback.

The Phase 1B projection and declaration now expose D1-owned identity helpers. Its visibility CTEs are split into small UNION groups to satisfy the actual local D1 SQL limit. Round ordering uses saved sort order, placement and ID for deterministic ties. These changes do not alter the statistics engine or historical source data.

Runner, verifier and safety helpers now support `--phase1c`; safety tests cover the exact read-only dependency link used by the disposable project copy. All application output and persistence stay outside the repository.

## Modes and failure contract

There is no URL parameter or header that selects a reader mode. Hybrid is the default when no local mode is configured. Its original loaders and fallback behavior remain intact.

Shadow and D1 require all of:

- A development build.
- A loopback request hostname.
- `CFL_PUBLIC_LOCAL=phase1c-disposable`.
- A UUID database identifier distinct from production and staging.
- `CFL_PUBLIC_MODE=shadow` or `d1`.

The launcher separately verifies ownership and rejects all known remote/existing fixture IDs, extra bindings and remote-capable configuration. The Cloudflare dev adapter disables remote bindings. Production/staging builds cannot enable either mode, even when supplied local mode variables.

Prerendered routes retain their existing behavior; they do not load a Workers binding in Node. Authenticated admin and official admin-tool redirects bypass the public mode context.

Shadow starts the D1 snapshot alongside existing reads and returns the hybrid response. Diagnostics contain contract names, mismatch counts and public field paths only, never values or records. Statistics comparisons include nested maps using the unchanged engine. Read failures become comparison failures and do not replace responses.

D1 mode loads a validated snapshot before rendering. Catalog callbacks containing JSON fallback are not invoked. Missing binding, missing schema and failed queries return distinct safe codes with 503 and no-store. Invalid recorded data/identity remains a safe 500. Missing/test-only entities return 404 only after a successful snapshot. Unexpected rendering errors retain the framework error path.

## Normalized shadow contract

Comparisons ignore cached compatibility statistics fields and compare actual computed statistics separately. Entity catalogs compare by public ID. Participant lists and BYEs compare membership plus their explicit source/slot fields. Rounds compare saved order/placement with deterministic tie resolution. A default historical avatar and empty socials normalize to their existing presentation defaults. Stage map pools are an additive D1 contract validated by Phase 1B; they are not treated as a legacy catalog field.

The run recorded 200 shadow requests and 1,117 comparisons:

| Contract | Comparisons | Mismatches |
| --- | ---: | ---: |
| Matches | 195 | 0 |
| Computed statistics, including nested maps | 164 | 0 |
| Maps | 168 | 0 |
| Teams | 212 | 0 |
| Players | 187 | 0 |
| Tournaments | 191 | 0 |

Normalized rendered HTML for all 195 historical/tool routes was identical between hybrid and shadow. Development origin and transient script timestamps were normalized; response data was not replaced.

## Historical and HTTP verification

The original 24 checks and Phase 1B groups passed: S1/S2/overall statistics, all 128 historical profiles including zero activity, 19 teams, 11 maps, nested player/team-by-map statistics, historical identity boundaries, 168 registrations, saved synthetic roster positions, order-independent participation/MVPs, BYEs, winner/loser progression, fixed three-map formats, full/map walkovers and anonymous entries. Offline historical roster ordering remains explicitly unverified and is never reconstructed from registration arrays.

The HTTP suite passed 594 recorded route checks: 195 routes in each of hybrid, shadow and D1 modes, five official D1-only fixture details and four test-only 404 details. An additional 15 missing-entity checks returned 404. All 186 historical entity link targets were verified, three static fallback assets returned 200, and the historical profile retained its URL, IGN and team attribution.

Actual local Workers/D1 reads render the pages. Query-failure injection exists only in the disposable source copy, not application code. Missing binding, empty schema and query failure each returned 503 for a missing-looking player URL, proving failures do not masquerade as 404. Test-only teams, players, maps and tournaments were absent from catalogs and sitemap. A D1-only full-match walkover rendered without fabricated combat.

The safety/consumer/DOM/mode suite passed 15 tests. TypeScript `--noEmit` and `git diff --check` passed. The statistics engine, JSON source data, continuity configuration, authenticated admin implementation, Wrangler configuration and production sitemap configuration are unchanged.

## Sitemap and assets

`publicSitemapPaths` prepares canonical detail URLs from the filtered D1 snapshot, including historical identities and D1-only official entities. `/local-verification/sitemap.xml` previews that discovery only in D1 mode; hybrid/shadow return 404. The production sitemap remains unchanged. A future cutover must combine this entity discovery with existing static/public routes and its approved sitemap delivery strategy.

Asset references retain the existing validated `/media/<key>` contract. Phase 1B validates D1 reference resolution; HTTP tests validate static fallback assets. Production/staging R2 objects were not fetched. End-to-end media bytes with a dedicated isolated R2 fixture remain separate work before a media-serving cutover.

## Reproduction, cleanup and remaining gates

Run `node scripts/phase1a/run.mjs --phase1c`. It creates a new marked temporary root, initializes only that database through 0011, verifies the historical baseline, then runs local HTTP servers from a disposable source copy. Dependencies are reused through one validated read-only link. External networking and writes outside the root are denied by the OS sandbox; credentials are unavailable. HTTP servers are stopped on success or failure.

Evidence is retained. Cleanup is explicit with `node scripts/phase1a/run.mjs --cleanup <exact-disposable-root>`. It verifies the ownership marker, exited controller, root path, allowed entries and symlinks before deletion; it cannot follow the dependency link into the checkout. No evidence was deleted in this phase.

GO for staging preparation: planning and review may begin. This is not authorization for staging mutations or rollout. Required gates include independent approval/review of migration 0011 and identity backfill, verification of staging bindings/backup/recovery, and a separately approved staging reader enablement policy because current modes deliberately reject staging. Obtain an approved offline position fixture before claiming historical roster-order parity. Unattached master entities still require association evidence to classify them as test-only. No browser interaction/visual redesign was performed; HTTP rendering and DOM injection tests are the evidence for this phase.
