# Bracket Setup v1

Use the existing `scripts/admin-dev.mjs` launcher. It preserves `wrangler.jsonc`,
binds only staging (including the frontend read binding), and listens on loopback.
`--local` uses an isolated local simulation; omitting it targets configured staging.
The launcher generates a fresh signing key in ignored `.generated/.dev.vars`,
with mode 0600. This follows Cloudflare's local secret-file convention and is
not a password/login system. Do not reuse that file for other settings; it is
owned by the launcher. Draw previews expire after two hours or launcher restart.

From saved Setup and Participants, open `/admin/tournaments/{id}/bracket`.
Choose **How many draws?** (1–20) and start Official Draw. The server creates
exactly that number of independent draws from the original registered pool and
required BYEs; every numbered draw is shown. There is no initial extra draw,
seeding, manual placement, or database write during preview. The last draw is
marked Final candidate and has the only **Confirm Official Bracket** action.
Starting another sequence discards the displayed preview.

Confirmation verifies the signed candidate, tournament identity, expiry and
unchanged setup/participants/tournament metadata. One guarded transactional D1
batch inserts explicit BYEs, upcoming matches and winner/loser/BYE progression.
No fake played BYE match, result, map, player or roster record is created. A
concurrent change or insert failure aborts the whole batch. A second confirmation
cannot replace an existing bracket. Successful confirmation redirects to the
read-only `/admin/tournaments/{id}/matches` list and locks Setup/Participants.

Match dates initially use the saved tournament start date. This is disclosed
before confirmation; individual scheduling and results editing are later work.
No S3 dates are supplied. Preview history/audit storage and bracket reset are not
part of v1. No schema migration is needed for this workflow.

The existing local-development and explicit staging-binding boundary remains
mandatory. POSTs additionally require same Origin, URL-encoded content, bounded
body size and exact nonrepeated fields. Built/deployed admin is closed, including
GET and POST to bracket/matches. There is no public bracket write endpoint.

Verification uses real-schema SQLite tests, an offline D1 HTTP flow and browser
checks. Public runtime comparisons retain legacy equality for unchanged pages;
`/bracket-generator/` intentionally gains custom-team controls, while its D1 and
JSON-fallback output must still match. Tests never target remote staging or
production.

References: [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch),
[local secret files](https://developers.cloudflare.com/workers/configuration/secrets/#local-development-with-secrets).
