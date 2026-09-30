# Local D1 parity

Run from `feature/d1-backend` with Node 22.12+ and installed dependencies:

```sh
npm ci
npm run db:migrate:local
npm run db:parity
```

For an existing seed from migration 0001, migration 0002 preserves the imported rows and requires no reset or reseed for the current S1/S2 dataset. Do not run `db:seed:local` again on a populated database: the seed uses INSERT and will reject duplicate keys.

For a new, empty local database:

```sh
npm run db:seed:generate
npm run db:migrate:local
npm run db:seed:local
npm run db:parity
```

To inspect another local persistence directory:

```sh
npm run db:parity -- --persist-to=/absolute/path/to/state
```

The checker always passes `--local` to Wrangler and only executes SELECT queries and `PRAGMA foreign_key_check`. It never seeds, migrates, resets, or contacts production. Unsupported arguments, including `--remote`, fail. A missing schema, failed query, invalid source data, empty import, or any mismatch exits nonzero. Each completed run prints all mismatches with legacy and D1 values and writes `.generated/d1-parity.json`. Errors replace any previous report so an old successful result cannot be mistaken for the latest run.

## Comparison

The reference is the actual `src/utils/statistics.ts`, transpiled and executed at runtime. JSON is parsed with the existing collection schemas through `checkData()`, including defaults. The D1 side independently aggregates stored matches, map results, player entries, and player rounds; it does not call `calculateStatistics` or infer missing database map winners from match scores.

Every tournament and overall are checked. All 127 registered players are included in every scope, with zero statistics when absent. The checker also compares imported registry IDs, match metadata, map results, player identities, historical teams, notes, and individual combat rows. These row checks catch compensating mistakes that would cancel in aggregate totals. IDs introduced only on one side are mismatches.

Compared statistics include K/D/A, maps played, matches played, MVP, wins/losses, team totals, map totals, map/player and map/team breakdowns, known map outcomes, player-round counts, and unassigned-round counts/kills. No rounding tolerance is used: all fields are integer counts.

Semantics retained from `statistics.ts`:

- Only completed matches contribute statistics.
- Each recorded player round counts toward career maps played, including rounds with unknown map attribution. A player with at least one round counts once per match; an empty entry has zero matches played.
- Unassigned rounds contribute combat to global/player/historical-team totals, but never to a named map. Anonymous rounds still contribute to global, team, and map totals where attribution is known.
- Map-specific matches played deduplicate repeated map names within a match. Player map wins/losses remain zero because the legacy function does not calculate them. Career player/team wins and losses are match outcomes; map/team wins and losses are map outcomes.
- MVP counts come from map MVP IDs, including MVP-only players. Walkover maps count even without combat rows.
- Explicit map winners take precedence over sweep inference. Split match scores do not establish unknown map winners. Administrative winners can differ from combat scores.

## Import corrections and audit

Migration 0002 stores match participation in `player_match_entries` and individual rounds in `player_round_stats`. A nullable `map_number` preserves unassigned rounds; entry/round indices preserve multiple anonymous or unassigned rows and empty player entries. The read-only `player_map_stats` view retains the previous query columns and includes unassigned rows. Writes now go to the two underlying tables. Unknown nonempty player/MVP IDs and assigned map numbers that do not exist fail import instead of silently disappearing. The existing content schema already rejects unmatched map numbers.

The current JSON has zero unassigned rounds. The old importer would nevertheless have dropped such rows in a future import. Migration 0002 cannot recover rows already discarded by an older importer; parity reports any such missing data. Restore those rows from the source data into an independently prepared local database and verify parity before replacing an existing state.

`resultNote` is free text with no schema-defined score orientation. The current numeric notes agree with known winners if interpreted as team1/team2, but this does not establish an orientation contract, particularly for administrative results. The importer now retains the note verbatim and leaves `score_team1`/`score_team2` null. Migration 0002 clears the old importer's derived score columns. Winners still come only from explicit winners or completed sweeps. These score columns should only be populated once structured, orientation-defined source scores are introduced; the parity contract must then be updated deliberately.

`db:validate` also now includes unassigned combat in tournament totals and filters live/upcoming rows before aggregating career statistics.

## Verification

`npm test` includes SQLite integration tests using the real seed generator and both migrations. The SQLite flag enables Node's built-in SQLite module on Node 22.12. Cases include a populated 0001 upgrade, unassigned and anonymous rounds, empty entries, MVP-only players, repeated maps, transfers, live/upcoming matches, sweeps, split results, contradictory note scores, and deliberate corruption. `db:parity` separately verifies the actual Wrangler local D1 database.

Verified on 2026-09-30 with Wrangler 4.144.0, using a fresh local import because the prior checkout/local D1 state was unavailable:

| Scope | Players checked | Matches | Maps | Kills | Deaths | Assists | Mismatches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| S1 | 127 | 13 | 39 | 2726 | 2731 | 1185 | 0 |
| S2 | 127 | 13 | 39 | 2293 | 2279 | 1133 | 0 |
| Overall | 127 | 26 | 78 | 5019 | 5010 | 2318 | 0 |

Imported totals: 19 teams, 11 registered map types, 2 tournaments, 258 player-match entries, 712 player rounds, and 72 map MVPs. Ten map types appear in completed matches.

Wrangler local execution options: [Cloudflare D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute).
