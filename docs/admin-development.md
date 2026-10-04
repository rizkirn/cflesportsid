# Tournament admin development

`npm run dev` / `dev:admin` uses localhost admin against remote staging through
`scripts/admin-dev.mjs`. Production is not bound by that launcher. Never use the
remote launcher for integration tests. `node scripts/admin-dev.mjs --local` uses
the offline simulation and writes only ignored generated config, not wrangler.jsonc.

Admin requires development mode, loopback host and cflesportsid_staging binding.
Production GET and POST return 403. Forms require matching Origin, URL-encoded
whitelisted fields and bounded bodies. Snapshot revisions and atomic D1 batches
protect operational writes. Do not expose the dev server through LAN or tunnels.

## Interaction model

Global sidebar: Overview; Tournaments, Brackets, Matches; Teams, Players, Maps.
Tournament tabs: Overview, Participants, Roster, Maps. Bracket and Matches remain global
operational destinations. Old tournament Matches links still work; Setup GET
redirects Overview. Setup POST remains a compatibility handler.

Create Tournament opens one dialog with identity and setup. Its single atomic
batch creates the tournament, stage and generated rounds, then opens its workspace.
Visible fields are name/dates, immutable Official/Test, 4/8/16/32/64 slots, maps
(default 3), action/reserve seconds and optional Bronze Match. Internal defaults
are crossfire-legends, ID, single-elimination, upcoming and Playoffs. Setup editing
is compact on Overview; official draw locks setup, membership and rosters. Existing
map pools, veto steps and unsupported multi-stage/started locks remain intact.

Participants uses searchable/filterable rows with pending Add/Remove. Save Teams
is the only membership write and redirects to Roster. Search offers Create New Team
when no match exists. Create & Add saves its master immediately and adds pending
selection; it does not save membership. Dirty drafts have a sticky Save Teams bar
and a Stay / Discard Changes navigation warning.
Capacity, duplicate, stale, missing-team and roster-conflict checks remain. Removing
a participant removes only its tournament membership/roster, never master entities.

Roster keeps saved tournament rows authoritative. Empty teams automatically receive
a draft from the latest usable strictly earlier tournament (5–7 players), otherwise
an eligible current/master team roster. Prefill never persists historical facts.
Conflicting players stay in their existing draft/saved team and incomplete rosters
remain visible for review. Per-team Add Player (<7) opens a UID/IGN search dialog.
Teams use a single-open accordion with count/readiness and a compact page summary.
Search offers Create New Player when no eligible match exists. Create & Add creates
the master and adds it to the current draft, retaining the open team. Full teams
reject creation before any master write. Save Roster atomically persists snapshots;
dirty drafts have a sticky bar and Stay / Discard Changes warning. Success opens Maps.
Tournament IGN edits never modify global current IGN. One player belongs to one
team per tournament. Partial rosters save; drawing requires 5–7 saved players/team.

Bracket mirrors the public bracket's slot geometry, team stripes, logos and winner
score emphasis, including connector paths. Public output is unchanged. Draw navigation
stays one horizontal row with a current window and ellipses. Only the final signed
candidate can be confirmed, through a dialog. No stored draw history/reset added.

A match opens a short result dialog. Played results decide all 3 slots: 3-0, 2-1,
1-2 or 0-3. Full-match W/O chooses a winner without details. Save Result opens a
confirmation with winner/progression impact; Confirm Result invokes the existing
atomic backend. Confirmed-result edits automatically require correction reason,
old/new comparison and downstream blockers. Progression never happens in Details.

Matches rows go directly to details for played confirmed matches. Empty/draft
Details uses a large responsive map-by-map dialog. Each Played map requires a map,
round score, exactly five participants/team (blank means absent, zero is valid),
and exactly one Gold ACE/MVP. Partial W/O has explicit winner, optional map and no
combat stats. Three map winners reconcile with matches.score1/score2. Draft saves
are serialized with revision checks; Next/Previous/Close/Escape await safe saves,
and errors retain the open draft. Completion publishes canonical rows only after
Phase B validation. Full-match W/O stays in Bracket.

Existing/imported/completed Details opens a compact dedicated read page with map
tabs and two stat tables, stacked on phones. Edit Details enters the existing
reason-required correction semantics. History sits directly below content/actions.
Result corrections that invalidate details require explicit reconciliation.
Setup retains configurable odd map counts; the result dialog follows that count.
The existing Phase B detail editor remains limited to Fixed 3 Maps.

Master Teams/Players/Maps support Create dialogs and editable right inspectors.
Teams persist name/tag/region/description/color/logo URL. Players persist UID
(immutable after creation), current IGN, optional name/current team, and display
reliable tournament snapshot history. Maps persist name, Active/Inactive and image
URL. Stable team/map IDs are generated; player identity uses UUID. Optimistic edit
checks prevent stale overwrite. HTTPS/local asset URLs are supported; there is no
file-upload storage. No master delete/archive is supplied. Global IGN/team changes
do not change tournament roster snapshots or canonical historic stats.

0007 adds immutable is_test and denies official deletion. Exact-name confirmed test
cleanup atomically removes tournament-owned rows/audits and preserves masters.
External source references block cleanup with full rollback. Existing 0006/0007
are unchanged. Missing 0006 disables corrections; missing 0007 refuses Test
creation/deletion. No new migration is required for master CRUD's existing columns.
No remote migrations, database resets or reseeds are part of this refactor.

## Verification

Run npm test, npx tsc --noEmit, npm run data:check and npm run build.
Use a fresh isolated local fixture with migrations 0001–0007 and the generated
repository seed. For each HTTP suite set ADMIN_TEST_URL=http://127.0.0.1:PORT and
ADMIN_TEST_LOCAL=1. Suites: admin-pages, admin-roster-prefill, admin-live-results,
admin-match-details and admin-master `.integration.mjs` files. They create labelled
Test records only in that fixture. They cover 32 teams/160 players, pending saves,
prefill, stale/lock checks, 20 signed draws, corrections/audit, mixed W/O details,
master create/edit and test cleanup.

`node tests/admin-public-regression.integration.mjs` uses only this checkout's build
and fresh local fixtures: 194 D1/fallback pages, assets, sitemap/robots, missing-ID
routes, live reads, production admin denial and check-build. It creates no alternate
source checkout. The older frontend suite additionally builds archival references;
do not run it when the task prohibits other checkouts. Existing unit data-parity
fixtures retain historic statistics coverage. See docs/admin-match-details.md and
docs/admin-bracket.md for storage/validation/progression rules.

## Official map assignments (2026-10-02)

Migration 0008 adds official assignment headers: randomizer/round or veto/match,
three ordered map IDs, team snapshots for match veto, action history and confirmation
time. Applied migrations are unchanged. Local fixtures now require 0001–0008.
The Maps workspace renders shared Randomizer/Veto components in the native admin
shell. Public pages wrap the same components with their public layout. Results are
the preview; redundant public setup, Copy controls and iframe chrome are omitted.
Public simulation actions never save; only Confirm Maps / Confirm Veto writes an
official assignment. Round assignment may precede the draw and applies to all
matches in that round. Started matches/details lock replacement; a full-match W/O
without maps does not block assignment to the other matches in an early round.
Late rounds require match veto and resolved teams. Revision guards reject changed
pool/rules/teams/results. Veto confirmations replay the shared public engine.
Contextual tool routes remain local-admin-only and no-store.

All early rounds are assigned at the Technical Meeting before the draw or advancing
teams are known. Sizes 4/8/16/32/64 have 0/1/2/3/4 randomizer rounds. Confirm & Next
persists the current round then opens the next pending round; the last Confirm Maps
opens a summary and Continue to Bracket. Map sets are unique within a round and may
repeat between rounds. Semifinal/Bronze/Final use resolved-team match Veto.

Played scores/results require confirmed official maps; an atomic map snapshot guard
rejects concurrent assignment changes. Full W/O needs no maps/details. A first Veto
may be confirmed after full W/O with no details so an explicit correction to Played
has a valid path; replacement remains locked. Confirmed Played cards open guided or
read-mode Match Details; Edit Result is secondary. Confirmed full W/O has no details
and only the header Close. This UAT pass adds no schema/migration.

Roster search shows clickable eligible UID/IGN results immediately; Arrow keys and
Enter select directly into the draft. Save Roster remains explicit. Historical
prefill ignores TEST tournaments. Staging audit found absent S2 snapshots and a
dummy S3 FNOV roster incorrectly feeding prefill. Original S2 match entries supplied
64 snapshots across 12 teams, including five FNOV UIDs; no unsupported players were
invented for the participant with no match evidence.

Authorized staging work targeted only cflesportsid-staging,
4ba57de7-5fda-4703-a956-b1936546986a. Before mutation: remote migration ledger 0001–0007,
backup export, descendant and FK audit, controlled cleanup rehearsed on the export.
Six dummy tournaments were removed through scoped safe-delete ordering. Migration
0008 was applied only there. One fresh TEST covered setup, participants, S2 roster
prefill, shared randomizer before draw, late veto, results, details, partial/full W/O,
corrections, conflict rejection and deletion. Final export has only S1/S2, zero
assignment rows, empty FK check, and exactly identical master rows (19/127/11).
All S1/S2 matches, participants, match maps, entries and map statistics are unchanged.
No production migration/write/cutover occurred.

Additional coverage: tests/admin-map-assignments.test.mjs and the explicitly guarded
tests/admin-official-maps.integration.mjs phased staging validation. The latter
requires ADMIN_TEST_STAGING=1 and is not a general-purpose production runner.

S2 registration follow-up (fix-024): user confirmed original repository team rosters include reserves and non-playing players. The staging historical snapshot now contains 83 players across all 13 S2 teams, including Paman 6 and FNOV 6. Added 18 rows beyond the previous 65; no match results, W/O, combat statistics, master data or other tournament data changed. Match-entry-only reconstruction must not be treated as a complete registered roster.

S1 fallback follow-up (fix-025): staging now has 85 original S1 registrations from pre-S2 Git revision b126ef0. For future tournaments use latest earlier official team snapshot: S2 for S2 participants, S1 for S1-only teams. Partial sources are visible, not discarded for having fewer than five; minimum readiness remains five. Newer source teams win automatic duplicate-player prefill before older teams regardless of display order; overlap is explained in the roster. Saved current tournament rows are never overwritten by prefill.

Latest-membership correction (fix-026) supersedes the selection-dependent overlap behavior in fix-025: automatic prefill filters every player by their latest earlier official tournament team globally, even when the destination team is not selected. Master fallback uses the same filter. Endeavours always has four eligible S1 players; historic six-player S1 snapshot remains intact. Removed overlap explanations. Saved current roster remains explicit, minimum readiness remains five.
