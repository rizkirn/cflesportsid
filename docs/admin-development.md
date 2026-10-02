# Tournament admin development

Run `npm run dev` (or `npm run dev:admin`) for localhost admin development
against remote `cflesportsid-staging`. Stop any existing Astro dev server first.
Both D1 bindings target staging ID `4ba57de7-5fda-4703-a956-b1936546986a`;
production is not bound. The launcher rejects a different staging database ID.

Run `node scripts/admin-dev.mjs --local` for offline verification. The launcher
writes ignored `.generated/admin-dev.json` and binds a loopback server. It never
edits local `wrangler.jsonc`. Without `--local` it connects explicitly to remote
`cflesportsid-staging`; do not use remote mode for integration tests.

All admin routes require development mode, loopback host and the staging binding.
Built/deployed admin rejects GET and POST. Matching Origin, strict URL-encoded
fields, bounded bodies, snapshot revisions and guarded atomic batches protect
writes. Do not expose the development server through tunnels or LAN listeners.

## Tournament workspace

The six persistent links are Overview, Setup, Participants, Roster, Bracket and
Matches. Preparation pages remain clickable before confirmation. Saving stays
on the current page. Dependencies explain missing setup, participants or roster
readiness. Confirming the official bracket hard locks Setup, Participants and
Roster on the server; their saved records remain viewable.

Setup offers 4, 8, 16 or 32 slots. Normal elimination rounds are generated:
4 starts at Semi Final, 8 at Quarter Final, 16 at Top 16 and 32 at Top 32.
All finish with Semi Final and Final. Optional Bronze Match is generated before
Final with third-place placement. Normal rounds cannot be added, renamed or
removed manually. Reducing capacity below registered teams is rejected.
The existing preset, map settings and timers remain available. Map pools and
veto steps are preserved. Unsupported multi-stage/started states are read-only.

Participants shows a searchable team directory with registration status,
checkboxes, selection controls and bulk Add Selected / Remove Selected actions.
Each action saves immediately; Create Team is a secondary disclosure. Capacity,
duplicate, missing-team and stale-state checks are retained. Partial membership
including zero teams can be saved during preparation. Removing a participant
removes only its tournament membership and roster, never its global team/players.
New staging teams/players do not automatically publish legacy public profiles.

Adding a team copies its latest earlier tournament roster, ordered by tournament
start date, end date and ID. Only tournaments with a strictly earlier start date
qualify. The copy includes Tournament IGN and positions and is independent of
its source. Retained teams are not recopied. A player already registered here
stays with that team; conflicting copied entries are skipped and readiness shows
which teams require review. No current global team roster is inferred.

For a team with no saved roster, Roster offers an explicit copy action. A usable
latest earlier tournament roster takes precedence; otherwise Copy Current Team
Roster uses players.current_team_id and current_ign as a starting draft. Copy
performs no writes, retains other workspace edits, and shows Unsaved. Review team
assignments and editable Tournament IGN, then Save Roster to persist this tournament
only. Duplicate players, more than seven players, stale revisions and locks reject
the action. Saved rosters remain authoritative on reload; copy cannot replace them.
Current team data is never presented or written as an S1/S2 historical roster.
Historical backfill remains deferred; this fallback requires no new migration.

Roster is one workspace for every participant team. Existing player, Create
Player, removal and team moves edit the full draft; Save Roster persists it
atomically. Team changes can be combined, including swaps. Tournament IGN is
inline and changes only the tournament snapshot. New players receive their
initial global IGN at creation; existing global IGN/team records are preserved.
One player can represent only one team in the same tournament. UID is optional
but unique when supplied. Partial rosters save; every team needs 5–7 saved players
before drawing or confirming a bracket. Forms support 32 teams × 7 players and
are limited to 256 KiB. Unadded player drafts must be added before saving.

Migration 0003 already exists and is applied to remote staging. No new migration
is needed for this revision; do not rewrite 0003 or apply/reseed remotely.
S1/S2 backfill remains out of scope. Player IDs/UID and tournament snapshots can
support a later reviewed import from separate season sources.

## Verification

Run `npm test`, `node node_modules/typescript/bin/tsc --noEmit`,
`npm run data:check` and `npm run build`. For offline HTTP verification initialize
only the local simulation with repository migrations, then run:

```sh
ADMIN_TEST_URL=http://127.0.0.1:4321 ADMIN_TEST_LOCAL=1 node tests/admin-pages.integration.mjs
ADMIN_TEST_URL=http://127.0.0.1:4321 ADMIN_TEST_LOCAL=1 node tests/admin-roster-prefill.integration.mjs
```

The HTTP suites create clearly named records only in that offline database.
The prefill suite needs repository seed data and verifies ChaTraMue's five and
DEMIGOD KAGE's seven current players, no-write copies, draft review and saved reload.
`npm run test:frontend` compares 194 public pages with D1 and JSON fallback,
checks generator controls and production admin denial. Historical pages use
pristine `a91700d`; map-randomizer/veto compare against pristine `cdb6c18`, which
contains their existing economy controls. Both reference builds are generated
locally by the suite. It does not change source data or remote databases.
Live series scoring and explicit result confirmation are available in Bracket.
Scheduling, stored draw history and bracket reset remain
later work. See `docs/admin-bracket.md` for official draw and progression semantics.
Run `ADMIN_TEST_URL=http://127.0.0.1:4321 ADMIN_TEST_LOCAL=1 node tests/admin-live-results.integration.mjs`
against the same isolated seeded server for Phase A HTTP checks. This verifies
score reloads, public D1 reads without building, empty-detail live/completed match
routes, result locks and final/bronze resolution. Existing admin regressions still
cover official generation and preparation locks.

Phase B adds the per-series Match Details Editor after result confirmation.
Migration 0004 is required for saved drafts; it is supplied for review and has
not been applied remotely. See `docs/admin-match-details.md` for validation,
publication boundaries, table mapping and offline integration commands.
