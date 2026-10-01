# Official tournament bracket

Open Bracket from the persistent tournament workspace. Saved Setup, at least two
participants, and a valid 5–7-player roster for every participant are required.
A four-slot Bronze bracket needs four teams to supply both semifinal losers.

Choose 1–20 requested draws. Each draw independently randomizes the original
participant pool plus required BYEs exactly once using the shared public bracket
engine. There is no extra initial randomization. BYE versus BYE is avoided whenever
mathematically possible. No seeding or manual placement is introduced.

Compact Draw 1..N history controls display one full bracket at a time. The final
draw opens by default and is the only confirmable candidate. Selecting an earlier
draw hides confirmation. Starting another sequence replaces the preview; preview
history is not persisted. This supports Technical Meeting screen sharing.

Confirmation verifies its signature, tournament identity, expiry, roster snapshots
and unchanged setup/participants. One guarded D1 batch inserts explicit BYEs,
upcoming matches and winner/loser/BYE progression. Races or write failures roll
back the batch. Repeated confirmation cannot replace an official bracket.

Success opens Bracket with live score controls. Setup, Participants and Roster
remain viewable and hard locked. Initial match dates use the saved tournament
start date; scheduling remains future work. No fake played BYE
match or fabricated result is created.

Use the existing local development launcher. Its ignored signing secret expires
preview tokens after two hours or launcher restart. Development/loopback/staging
checks, same-Origin POSTs, strict bounded fields and production admin denial
remain mandatory. Tests use isolated local databases only.

No new migration or remote apply is required. Existing migration 0003 is unchanged.
The public `/bracket-generator` and its temporary Custom Team behavior remain
intact; the shared engine is unchanged.

## Phase A: live results

Resolved matches have two compact score inputs and an explicit Save Score action.
Saving sets `matches.score1/score2` and lifecycle `live`; it never advances a team,
creates a map, inserts player stats, or requires details. A reload reads the saved
score. The local launcher binds both public DB reads and admin writes to staging;
production admin remains denied. No polling or push transport is added: public
routes read the latest D1 score on each request, without a rebuild.

The existing rules are fixed maps, not best-of. For three maps, 2–1 and 3–0 are
confirmable; 2–0 is unfinished. Confirm Result uses the saved score only. Unsaved
input changes disable confirmation until Save Score/reload. Confirmation writes
`status=completed` and `winner_id`, then resolves `team1_id/team2_id` in matches
whose `match_sources` point to this match. Winner sources get the winner; loser
sources get the other team, including Bronze Match. Source links are retained.
BYEs stay in `tournament_byes` and are resolved during existing official generation;
they are never represented as played matches or invented series results.

All result writes use an optimistic tournament bracket revision and one guarded
D1 batch. A concurrent score/source/rule/detail-count change aborts the batch.
Conflicting manually resolved teams, repeated sources, downstream results, started
matches and downstream detailed records reject confirmation before writes. Confirmed
results and historical S1/S2 are read-only. Correction/reset needs a later explicit
admin action that reviews affected downstream matches; do not bypass the lock.

Public D1 reads retain the S1/S2 coverage/child parity safeguards and append new
matches, teams and tournaments. Live and completed match routes display the real
series score. No details produces `Match details are not available yet.` on the
same `/matches/:id` route. Availability is derived from actual records, with no
`detail_status` column. New empty player entries are excluded from the public stats
shape until they have real round records. Result win/loss counts remain legitimate;
empty detail creates no player/map statistics. Historical semantics are unchanged.

No migration is needed; 0003 is untouched. No remote migration, reseed or production
write is part of validation. Tests run against isolated offline D1 simulations.

Phase B will add genuine map scores, K/D/A, MVP and W/O details, validate detailed
map winners against the confirmed authoritative series score, and supply a reviewed
Match Detail Editor. Tournament completion/champion updates and correction/reset
are separate explicit actions, not implied by saving a live match score.
