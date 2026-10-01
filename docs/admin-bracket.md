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

Success opens the existing read-only Matches page. Setup, Participants and Roster
remain viewable and hard locked. Initial match dates use the saved tournament
start date; scheduling and results editing remain future work. No fake played BYE
match or fabricated result is created.

Use the existing local development launcher. Its ignored signing secret expires
preview tokens after two hours or launcher restart. Development/loopback/staging
checks, same-Origin POSTs, strict bounded fields and production admin denial
remain mandatory. Tests use isolated local databases only.

No new migration or remote apply is required. Existing migration 0003 is unchanged.
The public `/bracket-generator` and its temporary Custom Team behavior remain
intact; the shared engine is unchanged.
