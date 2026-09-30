# D1 match read layer

The existing Astro collections and frontend consumers still use JSON. No UI,
statistics calculation, production database, schema, package or Wrangler
configuration is changed by this step.

`src/data-access/matches.mjs` exposes:

- `readD1Matches(DB, legacyMatches)` for strict reads and comparison checks.
- `readMatches({ db: DB, loadJSON, onFallback })` for a future server-side caller.
  Its result is `{ source: 'd1' | 'json', matches }`, with the same entry IDs,
  metadata, order and match data shape as the JSON collection.

A future server-side caller can supply `loadJSON: () => getCollection('matches')`
and the request's DB binding. Do not switch a consumer until parity passes.
The current static Astro build has no runtime D1 binding; this commit does not
introduce SSR or change the deployment architecture. Do not import the database
adapter into browser code. Other collections remain JSON-backed.

The adapter batches five SELECT queries for matches, maps, participant sources,
player entries and player rounds. It uses entry and round indices instead of
assuming that a player's first recorded round is map 1. Historical team IDs,
anonymous rows and null map attribution survive the read.

D1 owns the stored match fields. JSON supplies collection metadata and fields
that the current seed does not store (`stats1`, `stats2`, match-level `mvp`, and
optional/null representation). This is deliberately a hybrid migration layer,
not a JSON-free backend. Map winners stored by the seed include sweep inference;
comparison normalizes that field through the unchanged `getMapWinner` helper.
It compares every other parsed match field and executes the existing statistics
calculator on both datasets for every tournament and overall.

Fallback is whole-collection: missing binding, failed/malformed query responses,
invalid combat values, orphan rows, differing match IDs or child row counts
return the complete JSON collection. The coverage guard intentionally ties this
migration stage to the JSON snapshot. New matches or changed child counts require
updating both sources; otherwise the adapter falls back. Changes to valid stored
values with unchanged coverage are authoritative, so fallback does not substitute
for parity checking. `onFallback` receives the reason for caller observability.
JSON loading errors propagate because there would be no safe fallback.

## Verification

```sh
npm ci
npm test
npm run data:check
npm run db:seed:generate
npm run db:migrate:local
npm run db:seed:local
npm run db:parity
npm run build
npm run build:check
```

Use a fresh isolated local D1 store before seeding; the seed contains INSERTs and
is not idempotent. `db:parity` checks the existing SQL statistics and the actual
read-layer output, writing `.generated/d1-parity.json`. It performs local reads
only and fails on field or statistics differences. No production reseed is needed.

## Integrating with local uncommitted work

In the user's original checkout, confirm `feature/d1-backend`, record `git status`,
then stash all tracked and untracked work with a descriptive message. Fetch origin
and use `git merge --ff-only origin/feature/d1-backend`. Restore with `git stash apply`
and review the original modified files before dropping that specific stash.
Avoid `stash pop`, hard reset and force push. If fast-forward or stash application
fails, stop and resolve while retaining the stash. This change does not touch
`package.json`, `wrangler.jsonc`, map-randomizer, veto or economy.json, so those
local changes remain independent.
