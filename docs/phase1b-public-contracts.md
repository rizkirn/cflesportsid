# Phase 1B: D1 public contracts

## Scope and ownership

The new `src/data-access/public-d1.mjs` reader accepts an explicit D1 binding and returns a request-scoped public snapshot. It never imports JSON, the content loader, the hybrid readers, or the historical continuity configuration. No page calls it yet. Existing public readers, JSON fallback, authenticated admin readers, the statistics algorithm and historical source files remain unchanged.

`publicColumns` is the SQL field allowlist. `publicFields` is the catalog DTO allowlist. Nested DTOs are constructed field by field. Unknown result columns are discarded before projection. Audit tables, edit history, actor emails, revision counters and official tool operational metadata are not read or returned. Media references use the existing validated `/media/<asset-key>` contract; this layer does not access R2.

## Existing consumers and prepared contracts

| Contract | Existing dependency / consumers | D1 ownership and public fields |
| --- | --- | --- |
| Teams | Content JSON plus `frontend-bracket.ts`/`frontend-assets.ts`; `/teams/`, `/teams/:id/`, home, match and tournament pages | `teams`, `players.current_team_id`, official `team_penalties`. Existing IDs, metadata, current player IDs, penalties and asset key. |
| Players | Content JSON plus continuity helpers; `/players/`, `/players/:id/`, home, team, map and match pages | `players` and identity tables. Public ID is UID when present, otherwise master ID; name, IGN, optional current team, role, status, public profile metadata, socials and asset key. |
| Maps | Content JSON plus asset overlay; `/maps/`, `/maps/:id/`, matches and tools | `maps`: ID, name, game, active, optional thumbnail and image asset key. Inactive official maps remain discoverable for history. |
| Tournaments | JSON plus `frontend-bracket.ts`; `/tournament/`, `/tournament/:id/`, home, tools | `tournaments`, participants, stages, rounds and BYEs: unchanged IDs, dates, format, status, winner and poster key; stage series, round order/placement and BYEs. |
| Matches | `frontend-matches.ts` / `matches.mjs` hybrid projection; `/matches/`, `/matches/:id/`, all statistics and bracket consumers | `matches`, maps, map walkovers, sources, match entries and round stats. Existing camel-case contract, snapshot UID/IGN, explicit historical team, nullable anonymous entries, scores, winner and map MVPs. |
| Historical identities | `player-continuity.mjs` and config; historical player URLs and all statistics | `player_identity_segments` owns profile ID, UID/IGN snapshot, historical team and boundary tournament; `player_identity_tournaments` explicitly owns covered tournaments. Existing `1345266890--before-clash-for-glory-s2` URL is retained. |
| Tournament rosters | Admin snapshots in D1; JSON registration evidence offline | Public roster: tournamentId, teamId, playerId (segmented profile when applicable), uid, ign, position, orderVerified. Membership and ordering are separate contracts. |
| Bracket sources | JSON stages/BYEs and hybrid match sources | Winner/loser sources reference match IDs; BYE sources reference same-tournament, same-stage BYE IDs. Saved match team IDs remain authoritative; the reader does not advance brackets. |
| Map pools / veto | JSON stage configuration; Veto Tool, randomizer, bracket generator | `stage_map_pool` order and `veto_steps` order; stage final-map rule and action/reserve timers. `stage.mapPool` is an additive public field. Operational assignment histories and actor metadata are excluded. |
| Penalties | Team JSON and admin D1 | Only official tournamentId, points and reason are exposed. Test penalties never enter public output. |
| Assets | Existing D1 asset overlays / media route | Validated team logo, player photo, map image and tournament poster keys; `snapshot.assets` contains only key and public URL. No bucket names or credentials. |
| Sitemap | `astro.config.mjs` reads JSON filenames and continuity config during build | Future consumer can enumerate public snapshot catalogs; unchanged in Phase 1B. D1-only sitemap discovery is a Phase 1C cutover task. |

All existing entity detail/list pages, home, Veto, map randomizer and bracket generator already use `prerender=false`. Sitemap discovery still needs its separate runtime/build design during cutover. This phase adds no route, redirect, response adapter to existing pages or public endpoint.

Catalog `stats`, match `stats1`/`stats2`, and `placementPoints` retain compatibility defaults. They are not authoritative statistical caches. Consumers must use the existing statistics engine through `calculatePublicStatistics`; placement continues to derive from tournament results using existing consumers. Match combat, wins/losses, MVPs and nested map statistics are calculated from recorded match data, never roster order.

## Historical identities and statistics

The statistics adapter temporarily namespaces snapshot UIDs and MVP keys to prevent the unchanged engine's legacy continuity configuration from reassigning identities. D1 mappings determine attribution first; only the returned statistical map keys are restored. The engine itself is neither copied nor changed. Raw match projections preserve match-time UID/IGN and player primary keys.

Migration `0011_public_identity_contracts.sql` adds two identity tables with owner/tournament foreign keys and uniqueness constraints. Its roster rebuild copies every existing row and position verbatim, preserves primary key, uniqueness and foreign keys, and permits NULL positions for membership whose historical order is unknown. Existing remote positions must never be replaced with registration order. The disposable fixture loads 168 verified registrations with NULL positions and one approved continuity segment with its S1 membership. The identity fixture reads configuration only offline; runtime ownership belongs to D1.

## Test visibility policy

Every tournament-scoped query requires `is_test=0`. Master teams, players and maps associated exclusively with test tournaments are excluded from discovery; shared official entities remain visible. Unassociated official master records and zero-activity profiles remain discoverable. Players with no tournament activity whose current team is test-only are excluded. Test-only entities and absent entities share the same 404 contract. Admin queries are unaffected.

A standalone master entity has no official/test marker in the existing schema, so an unattached master cannot be classified as test-only. Test entity creation must associate it with its test tournament. A standalone-entity visibility flag would require a separate product decision and forward migration.

## Failure contract

| Condition | Code | HTTP status |
| --- | --- | --- |
| Missing / malformed binding | MISSING_BINDING | 503 |
| Missing required table or column | SCHEMA_REQUIRED | 503 |
| Query throws / unsuccessful result | QUERY_FAILED | 503 |
| Invalid recorded data | INVALID_DATA | 500 |
| Invalid historical identity mapping | INVALID_IDENTITY | 500 |
| Missing or test-only entity after successful read | NOT_FOUND | 404 |

`publicErrorResponse` returns a generic message, safe code and `Cache-Control: no-store`. Query text, caught exception details and records are not disclosed. No failure substitutes JSON. Callers must await a successful snapshot before resolving an entity; a failed database read is never a 404.

## Local reproduction and verification

Run `node scripts/phase1a/run.mjs --phase1b`. The existing Phase 1A controller creates a new external temporary directory with its own UUID, configuration, marker and persistence state. It copies and applies migrations 0001–0011 there, loads historical fixtures there and runs the original 24 checks plus the Phase 1B historical/edge contract groups. The OS sandbox denies external networking, credentials and writes outside that directory. All seven existing stores and sidecars are hashed before/after.

Run `node --test tests/phase1a-safety.test.mjs tests/veto-steps-dom.test.mjs` and `node_modules/.bin/tsc --noEmit` for safety, DOM-injection and type checks. The Veto steps renderer uses element creation and textContent for team tags, history map names and the decider; malicious markup remains literal text.

Historical comparisons cover S1, S2 and overall, all 128 profiles including the historical segment and zero activity, all 19 teams and 11 maps, every statistical field and nested player-by-map/team-by-map statistics. Separate checks verify all 168 roster memberships, saved synthetic positions, permutation-independent combat/MVP attribution, BYEs/feeders, full and map-level W/O, transfers, anonymous entries, D1-only discovery, test-only combat/MVP/penalty exclusion, media references, allowlists and explicit failures. A populated pre-0011 in-memory database inside the same isolated verifier proves the migration copies nonsequential saved positions unchanged.

Cleanup is explicit: `node scripts/phase1a/run.mjs --cleanup <exact-disposable-directory>`. It validates ownership, path, marker, symlinks, allowed contents, controller exit and protected-store hashes before removal. Evidence is retained until requested cleanup.

## Phase 1C prerequisites and limitations

Proceed with isolated local consumer integration only. Do not infer permission to apply 0011 remotely, seed remote identities, change public readers, remove fallback or deploy. Remote schemas remain at their previously verified 0010; Phase 1B cannot be enabled there yet.

Obtain an approved offline roster-order reference before claiming historical order parity. Review the future official identity backfill independently of schema installation. Add rendered route/sitemap/media integration tests during consumer cutover, and assess snapshot query costs on representative larger datasets before adopting request-wide catalog loading at scale. Current pages remain hybrid and therefore retain their existing test-visibility limitations until cutover. Remote unchanged status in this phase is established by blocked remote access and no remote operations, not a fresh remote state read.
