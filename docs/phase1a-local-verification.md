# Phase 1A local verification

Run `node scripts/phase1a/run.mjs` on macOS with the installed Node and Wrangler dependencies. The runner fails before database initialization if its safety probe cannot establish network denial, credential isolation, loopback support and the filesystem boundary. A nested execution sandbox may require host approval to start `sandbox-exec`.

Every run creates a fresh `/private/tmp/cfl-phase1a-XXXXXX` directory. Its private ownership marker, unique database ID, dedicated configuration, copied migrations, generated fixtures, local persistence, Wrangler logs and reports remain there. The default admin launcher and repository persistence directory are never used. No remote command is supported. The OS sandbox allows only loopback networking and file writes inside the disposable directory; Cloudflare credentials are removed from the environment and credential storage is denied.

The controller hashes all seven existing D1 stores and their sidecars, historical JSON and migrations before and after execution. Changes fail the run. It requires the historical source paths to match the checked-out Git revision. The verifier repeats the safety probe before initializing migrations 0001–0010 using Wrangler `--local`, an absolute dedicated configuration and explicit `--persist-to`. It compares actual schema definitions with the same migrations applied independently in memory, then checks historical counts, import fidelity, match projections, statistics, zero-activity profiles, BYEs and feeders.

The existing seed generator runs only from a copied temporary workspace. Historical registration evidence uses S1 revision `b126ef03babd172fc0465f737453a483eae76634` and the checked-out S2 registration source. Fixture reports record the current commit and migration hashes. Source JSON, application readers and statistics code are unchanged.

## Historical roster contract

Membership evidence for all 168 registrations is stored separately in `fixtures/registrations.json`, with source revisions. Player membership, team and IGN are checked against match-time entries. There are no positions in this evidence.

No approved offline fixture contains verified historical D1 positions. Therefore historical `tournament_rosters` rows are not inserted and historical ordering parity is explicitly **UNVERIFIED**. Assigning JSON array positions would invent ordering and is forbidden. A future approved offline D1 snapshot fixture must verify membership independently, preserve its saved positions exactly, and establish provenance before historical ordering parity can be claimed.

Synthetic rosters have explicit fixture positions. Tests verify saved order, permutation invariance of membership/statistics/MVPs, and participation selected by player identity and entered data, including position 6 while excluding position 1. These tests do not certify historical ordering.

## Synthetic cases

Cases run inside a savepoint and roll back before final baseline verification: full-match and map-level walkovers, BYE/feeder resolution, actual winner/loser advancement, D1-only catalogs with distinct UID/primary keys, test classification, nullable/anonymous entries, and historical transfer segmentation. Test filtering is an explicit verification selector; existing public readers remain unchanged and are not certified to exclude test data.

Run guard tests with `node --test tests/phase1a-safety.test.mjs`. They check rejected environment IDs, remote configuration, marker mismatch, symlink escapes, live controllers and unsafe cleanup paths.

## Cleanup

After the controller exits, run `node scripts/phase1a/run.mjs --cleanup /private/tmp/cfl-phase1a-XXXXXX`, replacing the path with the exact generated directory. Cleanup requires a matching ownership marker/configuration, a direct canonical temporary path, no symlinks, no unexpected root entries and no live controller. It removes only that validated directory and rechecks protected stores. Reports are retained until this explicit cleanup.

Phase 1A does not validate browser/HTTP behavior or Cloudflare remote execution. Phase 1B may begin locally with these limitations recorded; historical ordering certification and remote cutover require separate evidence. Do not run Phase 1B automatically.
