# Match Details Editor (Phase B)

Open global Matches and click a confirmed played match. Empty/draft details open
a large guided Map 1/2/3 dialog. Existing/imported/completed details open a dedicated
compact read page; Edit Details enters correction semantics when supported.
Full-match W/O and unconfirmed matches route to their Bracket result dialog.
The route is `/admin/tournaments/:id/matches/:matchId`. Admin stays local,
development-only and loopback-only, with bounded same-origin forms. Astro renders
the page; a small TypeScript script updates derived scores and roster eligibility.
No React is used.

The editor replaces copying three post-match screenshots into a sheet. Enter all
three map results first. Each slot defaults to Played and can independently be W/O.
Player Stats unlocks when every played map has a selection and two non-negative,
non-tied whole-number round scores, and every W/O map has an explicit winner.
Map selection is optional for W/O when the map was not known. The stage's saved map pool
is authoritative; when it has no pool, the active maps for the tournament's game
are offered. Both derived and confirmed series scores stay visible. A conflict
does not prevent draft work, but always prevents completion.

This pass supports `fixed-maps` with `map_count=3`. Map 3 is required even after
two wins by the same team. Each played map shows the entire saved tournament roster of
5–7 players on each team. All three K/D/A values blank means the player did not
play; all three present means participation, including `0/0/0`. Partial K/D/A is
saved in drafts but rejected on completion. Exactly five players must participate
per side per map. Different five-player combinations across maps represent
substitutions. Each map has one MVP selection from participating players; this
means ACE Gold only. Grey ACE has no stored effect.

W/O slots require no round score, participants, K/D/A, or ACE Gold/MVP. The stats
tab says that the map was W/O. Changing Played to W/O or back clears scores,
K/D/A, MVP and the W/O winner; map choice may remain. The server also canonicalizes
W/O drafts to blank combat fields and blank roster placeholders, ignoring stale
combat input. Those placeholders never become persisted player participation.
Save Draft allows an incomplete W/O winner; Complete Details requires all three
map winners. Derived series score counts both played winners (from round scores)
and explicit W/O winners, and must equal the confirmed Phase A score.

## Full-match and map-level W/O

Unapplied remote migration `0005_walkovers.sql` adds `matches.result_type`, default
`played`, and `match_map_walkovers(match_id,map_number,map_id,winner_team_id)`.
Migrations 0001–0004 are unchanged. 0005 has been exercised only in memory and
an isolated local verification database; do not apply it remotely in this task.
The app requires 0005 on its bound database for these new readers and actions.

Full-match W/O is a completed match with `result_type='walkover'` and explicit
`winner_id`. Its stored score fields stay 0–0, meaning no numeric series score;
public result displays show W/O. It creates no map or player rows and needs no
Match Details. Confirm Full-match W/O uses the same atomic bracket source,
downstream conflict and snapshot checks as a played result. Existing details,
including drafts, prevent converting that match into a full-match W/O.

Map-level W/O belongs to a normal `result_type='played'` series. Every W/O slot
exists in `match_map_walkovers`, with an optional known map ID and required team
winner. Only played slots go into `match_maps`; only their participating players
go into `player_match_entries` and `player_round_stats`. Public readers combine
both slot tables by map number. W/O cards show the slot, map name if known, W/O
and winner; their player table cells say W/O and their cards have no score or MVP.

Statistics preserve the existing raw semantics: every completed match, including
full-match W/O, counts once toward overall/team matches and team series wins or
losses. A mixed series counts once in those records. W/O slots never count as
maps played, map wins/losses, map results, player appearances, K/D/A or MVP.
Played slots keep all existing combat and map statistics. Players count a match
only if they genuinely participated in a played slot; W/O never adds participation.
These are raw series records, not tournament ranking points or penalties.

## Migration and persistence

Migration `0004_match_detail_edits.sql` is required for draft persistence. It adds
only `match_detail_edits(match_id,status,payload,revision)`. Applied migration
0003 is unchanged. Do not apply 0004 remotely as part of this implementation;
review and coordinate its later deployment separately.

Automatic step/debounced saves use the existing save-draft API, which stores the
complete editor document as JSON with status `draft` and
increments its revision. It allows missing maps, scores, K/D/A and MVP selections,
and partial K/D/A. Supplied values still need valid types, non-negative whole
numbers, roster identities and map choices. It writes no rows to `match_maps`,
`player_match_entries` or `player_round_stats`. Public readers therefore continue
to show the Phase A confirmed score and “Match details are not available yet.”
Drafts contribute no K/D/A, maps, player appearances or MVPs to public statistics.
Existing Phase A confirmed team series wins/losses remain counted.

Complete Details validates the entire document and writes status `complete` plus
the existing canonical rows in one guarded D1 batch. The guard rejects changes
to the authoritative match result, stage rules, roster snapshot/UID, eligible map
set or draft revision between reading and writing. Failure rolls back every row.
Neither save path changes confirmed scores, winners or bracket advancement.

| Editor data | Existing statistics storage |
| --- | --- |
| Played map choice, number, round scores, derived winner, ACE Gold | One `match_maps` row per played slot; MVP stores `players.id` |
| W/O slot, optional map choice, explicit winner | One `match_map_walkovers` row; no combat fields |
| Player participating in any map | One `player_match_entries` row per player/team, with player ID, tournament team, UID and tournament IGN snapshots |
| Complete K/D/A for a played map | One `player_round_stats` row per participating player/map; explicit `map_number` and consecutive per-entry `round_index` |
| Blank substitute row | No canonical round row; a player unused in all maps has no match entry |

The standard read layer shapes these rows into existing round details and player
statistics. New MVP player IDs are resolved to the same snapshotted UID key used
by the existing statistics functions. Players without a UID use their stable
player ID. The public match page displays tournament IGN snapshots for these new
entries and round scores for played maps. Global IGN/team records are never
updated. Historical S1/S2 row shaping, MVP keys and aggregates retain their
original behavior. Existing staging-created players still do not automatically
receive legacy public profile pages; their participation is visible on matches
and contributes to the existing statistics calculation.

## Locks and later work

Completed details and already imported canonical rows cannot be edited by this
workflow. S1/S2 remain read-only and do not require roster backfill. Corrections
to confirmed results, correction of completed details and historical
roster backfill require separate reviewed workflows. No shortcut updates the
bracket result to fit inconsistent screenshots.

## Verification

Run `npm test`, `node node_modules/typescript/bin/tsc --noEmit`,
`npm run data:check`, and `npm run test:frontend` (includes the build, public
response check and S1/S2 public regressions). The D1 read parity fixture applies
all five migrations before importing the unchanged S1/S2 seed. The detail HTTP
suite also covers both mixed fixed-three combinations and full-match W/O.

Against an isolated seeded offline admin server, run:

```sh
ADMIN_TEST_URL=http://127.0.0.1:4327 ADMIN_TEST_LOCAL=1 node tests/admin-match-details.integration.mjs
ADMIN_TEST_URL=http://127.0.0.1:4327 ADMIN_TEST_LOCAL=1 node tests/admin-live-results.integration.mjs
ADMIN_TEST_URL=http://127.0.0.1:4327 ADMIN_TEST_LOCAL=1 node tests/admin-pages.integration.mjs
ADMIN_TEST_URL=http://127.0.0.1:4327 ADMIN_TEST_LOCAL=1 node tests/admin-roster-prefill.integration.mjs
```

The Phase B suite creates explicitly named offline test records. It exercises
draft reload, empty public details, unchanged draft player/map pages, completion
errors, substitutions, public completed details without rebuilding, read-only
completion, stale saves and cross-origin denial. SQLite tests additionally verify
canonical row counts, identity preservation and rollback under concurrent edits.

For an isolated test configuration outside the root, apply migrations/seed with
`--local --persist-to .wrangler/state`: Astro's simulator uses the project-root
persistence directory. Use a distinct offline database ID for both DB and staging
bindings, `remote:false`, and a temporary `.dev.vars` draw key next to that
generated configuration. Leave local `wrangler.jsonc` untouched. Run reference
build regressions before starting browser verification; they can invalidate the
development server's shared dependency cache.

## Official map consumption (0008)

New operational details use the confirmed round randomizer or match veto map IDs.
The editor displays map names and hidden fixed IDs; it never offers another map
selector. Missing assignments show “Maps not assigned yet”. Completion validates
each slot against the current official assignment, and stale assignment/context
changes invalidate the draft revision. Assigned maps remain resolvable when later
marked inactive in the master pool. Existing S1/S2 imported details remain read-only.

Partial map W/O retains the assigned map name in canonical/public details, such as
ISLAND · W/O. Full-match W/O before assignment needs no map details. Fixed 3 Maps
still requires three decided slots, not a best-of-three stopping rule. Played slots
retain five players per side, K/D/A and Gold ACE validation; W/O slots do not create
combat statistics. Guided drafts survive map changes and close/reopen. Selected tabs
show Editing, Complete or W/O; only the final step offers Complete Details.
Completed details use compact read mode, with correction history next to content.
Empty result history is hidden; corrections use Result History (N). Ordinary
progression copy is brief, while winner correction reveals downstream conflicts.
