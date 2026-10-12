# Phase 2C UAT readers

Local implementation only. No remote mode has been enabled.

## Guard and configuration

`wrangler.uat.jsonc` retains the existing UAT Worker/account, staging-only DB, staging R2 bucket, assets and routing. The five `CFL_PUBLIC_*` vars identify the dedicated UAT host, Worker and database, and select hybrid by default. `keep_vars: true` preserves existing dashboard-managed admin authentication variables; secrets remain managed externally. Do not copy credentials into the file. Production `wrangler.jsonc` and the production sitemap remain unchanged.

Shadow/D1 requires HTTPS on exactly `cflesportsid-uat.cflid.workers.dev`, Worker claim `cflesportsid-uat`, database claim `4ba57de7-5fda-4703-a956-b1936546986a`, environment `uat`, an explicit mode, and absence of the disposable-local flag. Existing local guards still apply. Unknown/conflicting values fail closed. Hybrid does not query D1 through this layer.

A D1 binding object does not reveal its configured UUID. The runtime checks configured claims; the mandatory separate validator checks actual deployed settings and the active 100% Worker version. This is an operational gate, not runtime proof of an arbitrary misbound resource. Reject a missing/wrong DB, R2, assets, duplicate bindings or inconsistent authentication fingerprint. Do not treat flags alone as binding verification.

## Read-only validator

Run `node scripts/phase2c/uat-validator.mjs check-config --config <absolute checkout>/wrangler.uat.jsonc` locally. It never reads credentials or accesses the network.

For a separately authorized read-only UAT review, `baseline --config <absolute checkout>/wrangler.uat.jsonc --expect-mode hybrid` supports the original hybrid deployment without new identity flags. Capture its authentication fingerprint and binding count before deployment. After deployment, use `remote --config <absolute checkout>/wrangler.uat.jsonc --expect-mode hybrid` and require the same authentication fingerprint. For later separately approved modes use `--expect-mode shadow` or `d1`. The independent client permits fixed-account UAT GET endpoints only, follows no redirects, has timeouts, prints no credentials and has no database-write, deployment or import handler. Phase 2B guards remain unchanged.

## Shadow contracts

Compare complete stage map pools and veto mapPoolIds, preserving array order. Legacy veto pool IDs and D1 stage pool IDs normalize to the same public contract without dropping either when both exist. Round/BYE collections have canonical ordering; veto actions, match entries and map details preserve meaningful ordering. Historical profile IDs, IGN, team, tournament-bound participation and statistics remain covered. Master player IDs absent from legacy match data are excluded from catalog equality; identity mapping is tested separately. Registration array order is never used as authoritative roster order.

Diagnostics contain collection names, mismatch counts and allowlisted top-level field names only. They include D1-only missing entities and database failures even for pages reading no collection. They never print IDs, field values, SQL, error messages or credentials. Shadow retains hybrid response status, headers and bytes. Additional D1 queries and awaited comparisons can increase latency; measure UAT response times.

## Approval and acceptance sequence

1. Pass local config checks, focused tests, historical fixtures, TypeScript and production build. Review the exact working-tree deployment artifact; no commit/push is implied.
2. Separately authorize read-only deployed binding/authentication baseline verification.
3. Separately approve hybrid UAT deployment using only the explicit UAT configuration. Retain authentication vars/secrets and compare fingerprints before/after. No migration or backfill is necessary.
4. Separately approve shadow configuration. Test directories, all historical profile links, both KangDedy/KucayyPRMX profiles, matches/brackets/BYEs/W/O, Fixed 3 Maps, veto/randomizer/bracket generator, assets and redirects. Require unchanged HTTP responses and zero unexplained mismatches, including map pools and nested statistics. Document legitimate D1-only entities instead of suppressing differences.
5. Separately approve D1-only UAT testing. Require correct 404s for missing/test-only entities, official catalogs/statistics unchanged, no private operational fields, functional R2/browser interactions and explicit database errors. Simulate missing schema/binding/query failure only in isolated local fixtures; never alter staging to induce failures.
6. Validate the existing verification sitemap endpoint without changing production sitemap generation. If any condition fails, stop; separately authorize a return to hybrid. Never restore a database automatically.

No maintenance page is required for reader validation. No write tests or synthetic fixtures may target staging. Remote validation and browser UAT remain pending after this local implementation.

## Deterministic validation without Tail

`node scripts/phase2c/deterministic-parity.mjs` is an explicitly authorized read-only staging operation. It verifies the active UAT shadow target, parses historical JSON through the actual Astro schema, reads D1 through `readPublicData`, and compares full public contracts and the existing nested statistics engine. Its adapter accepts only the projection's exact SELECT/schema queries and baseline ledger, foreign-key and roster reads; no write method exists. Replayed query fingerprints detect concurrent data changes. Reports contain counts, contract names, safe field names and hashes, never raw records or SQL results. Roster membership and saved D1 ordering are separate checks. The approved backup roster hash is the ordering reference.

`http-validation.mjs --plan <sealed-private-plan> --approve <digest>` is a separate operation for a verified active D1-only UAT version. It issues exactly 204 bounded public GETs, with no Tail or canary, compares retained status/body/selected headers, and periodically rechecks active version, mode, bindings and authentication. Approval, source/artifact/baseline hashes, exclusive claim and time limits remain mandatory. It has no deployment or activation function. A matching hybrid response is not proof of D1 usage: active-version D1 flags and actual staging bindings must pass first.

D1-only activation requires separate approval. A subsequent HTTP plan must pin the resulting active version/deployment; it cannot be finalized before activation. Missing entities remain 404 while missing binding/schema/query faults remain explicit errors. Remote fault injection, browser interactions, test-only synthetic discovery and sitemap cutover are not implied by historical parity; existing disposable-local regression tests cover those contracts. No automatic retry or rollback is permitted.
