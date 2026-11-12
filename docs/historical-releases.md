# Historical qualification releases

**Historical documentation only. Do not execute these release scripts for new deployments.**

This is an archive index for source and tests retained at their original paths. It is not a deployment runbook, an approval record, or a statement that a historical rollback is safe today. Current local guidance is in [production-deployment.md](production-deployment.md).

## Evidence and limitations

The November 12, 2026 audit verified the constants, imports, source seals and tests in the files below. Those facts establish their intended historical roles; source code and passing mock tests do not prove that an executor actually ran.

The earlier dashboard inspection on November 12 observed Worker `cflesportsid` serving `cflesports.com`, active version prefix `06da29a3`, at 100% traffic. The recorded production resources were D1 `cflesportsid` and R2 `cflesportsid-assets-production`. This is a dated observation, not a fresh production check. The dashboard prefix alone does not independently establish the full version UUID embedded in an executor.

The retained local Qualification UI artifact is `.generated/qualification-ui-QsdM3j/dist`. Its preserved file-inventory SHA-256 is:

`cca9f1b3f96081a4e2fbd91f99d0d810ec3011490af57d2eef7137c4db48147d`

That checksum identifies the preserved artifact inventory, not an independently downloaded remote Worker fingerprint. The private baseline preservation and isolated restore report passed 15/15 checks. Historical source/artifact preservation does not establish complete source-to-production equivalence. Phase 3A deliberately retained newer committed frontend readers instead of restoring the older homepage snapshot.

The old temporary upload/activation operation reports were unavailable during Phase 3C inspection. Actual invocation, approval ownership, submission time and exact execution details of each script remain unverified. Earlier local release-readiness files describe an unverified candidate and must not be mistaken for successful deployment evidence.

Private backups, SQL, configurations, approval evidence and operation payloads belong outside this public repository in durable private storage. Do not reconstruct missing evidence or fabricate approval records from the identifiers below.

## Selection release

Purpose: select the top ten standings teams for All-Star qualification and update both qualification Status renderers. This preceded the presentation-only Qualification UI release.

| Reference | Historical value verified in source |
|---|---|
| Stable / inheritance source | `6f6f4073-6cdd-428e-8951-3c4cdf7a2e15` |
| Uploaded / activation target | `2767f1cb-5070-4012-a6bc-95afe06dfc3f` |
| Upload plan digest | `44387a38b46536bb731a4635519b5d2c848323074cc3da2c4cb553a6ed69581d` |
| Activation plan digest | `81bf1b804113db785deccad5a7501681f2434a24fae01f4e80a90ccb43d7f34e` |
| Source candidate commit | `f8a1fcbb4083859cf51bec32ed0e61a42fe9e900` |

Preserved files:

- [pinned-version-guard.mjs](../scripts/production/pinned-version-guard.mjs): fixed target, exact secret inheritance source, sealed payload/approval checks and restricted upload transport.
- [pinned-version-release.mjs](../scripts/production/pinned-version-release.mjs): artifact inventory, payload construction, metadata capture and upload without activation.
- [activation-review.mjs](../scripts/production/activation-review.mjs): uploaded artifact review and exact homepage source transformation against the candidate commit.
- [activate-reviewed-version.mjs](../scripts/production/activate-reviewed-version.mjs): separately approved activation with pause confirmation, a single-use claim and postflight checks.
- [verify-activation.mjs](../scripts/production/verify-activation.mjs): read-only recovery/postflight for this particular activation; it is not a general current-production verifier.
- [production-pinned-version.test.mjs](../tests/production-pinned-version.test.mjs): mock-based upload, activation, rejection and recovery regressions.

### Historical assumptions

The source proof permits only its exact qualification calculation and Status-expression changes to the candidate homepage. It compares tracked source against the candidate Git commit and rejects unexpected application files. It does not prove that candidate commit was source-equivalent to the stable Worker. This proof is unsuitable for newer frontend readers or arbitrary homepage changes.

The chain referenced private operations such as `/private/tmp/cfl-pinned-release-bAafy8` and `/private/tmp/cfl-activation-review-4jpwbB`. These are historical references, not durable evidence locations or directories to recreate for a future release.

## Qualification UI release

Purpose: update qualification markup, homepage copy and styling while preserving the selection calculation and other homepage sections.

| Reference | Historical value verified in source |
|---|---|
| Stable / inheritance source | `2767f1cb-5070-4012-a6bc-95afe06dfc3f` |
| Uploaded / activation target | `06da29a3-91ac-4379-aeab-0b798335c38b` |
| Upload plan digest | `25cb3b125f326f0085b60256e5db26f2b3471880404f4ef9bfd3a3bb9ebb010e` |
| Activation plan digest | `f91f9f2e8a385760e6bc4bf8b1e166e66b888729966de661820301ad6d2c3953` |
| Retained artifact inventory | The `.generated/qualification-ui-QsdM3j/dist` inventory identified above |

Preserved files:

- [qualification-ui/guard.mjs](../scripts/production/qualification-ui/guard.mjs): UI-specific fixed baseline and restricted upload transport, including the prior version's modules read.
- [qualification-ui/release.mjs](../scripts/production/qualification-ui/release.mjs): two-file source-scope proof, artifact construction and sealed upload.
- [qualification-ui/activation-review.mjs](../scripts/production/qualification-ui/activation-review.mjs): review of the fixed UI upload and its historical source proof.
- [qualification-ui/activate.mjs](../scripts/production/qualification-ui/activate.mjs): separately approved UI activation, pause-file validation, single-use claim and repeated postflight.
- [production-qualification-ui-release.test.mjs](../tests/production-qualification-ui-release.test.mjs): guard and source-scope regressions. These tests do not cover the entire UI activation/review chain.

The UI source proof compares `src/` and `public/` file sets and allows changes only to `src/pages/index.astro` and `src/styles/home.css`. It requires unchanged frontmatter and other homepage sections and checks the limited qualification CSS scope. It does not authorize overwriting newer application code with this historical baseline.

Preparation references the prior private plan at `/private/tmp/cfl-pinned-release-bAafy8/release-plan.private.json` and verifies its fixed digest and uploaded payload. Review and activation also reference `/private/tmp/cfl-qualification-release-p2xl37xp`. The retained artifact and private baseline do not recreate these missing temporary operation records or their authorization.

## Dependencies and preservation boundaries

Both chains target Worker `cflesportsid` and domain `cflesports.com`. The release validators require the production D1, R2 and ASSETS bindings, supported runtime/asset settings and the expected authentication configuration. Their payloads pin secret inheritance to a historical version UUID and prohibit raw secret values. Upload approval is separate from activation approval.

The two guards are similar but have different version pins and allowed reads. The release modules share substantial code but differ in source proof and evidence dependencies. They are historical implementations, not interchangeable general-purpose release tools.

Their dependency relationships include:

- [production-preflight.mjs](../scripts/phase2c/production-preflight.mjs), whose compatibility exports reach the pure Phase 3B [metadata-helpers.mjs](../scripts/production/metadata-helpers.mjs). The historical preflight retains migration/schema dependencies; routine frontend tooling does not import it.
- Historical schema, identity, environment and storage helpers under `scripts/phase2b/` and `scripts/phase2c/`, plus migration files and identity fixtures read by those helpers.
- Installed `blake3-wasm` and `mrmime`, the installed Wrangler CLI and [package-lock.json](../package-lock.json). Transitive installed dependencies are not a promise of a stable public API.
- Root calculations based on the current directory depths, the candidate Git object, private workspace configuration, build modules, asset ignore rules and artifact inventories.
- Source seals containing exact filenames and file digests, installed package contents and Wrangler files. The UI release seal additionally names the earlier pinned guard and release module. The preflight pins its extracted metadata helper's checksum.

Keep both chains and their tests at their existing paths. Moving one file can break imports, root calculations, test fixtures, source proof or seals. Even unchanged file bytes at new paths can change seal inputs. Do not edit pins or weaken validation to make an old plan pass.

## Safeguards worth retaining

The historical implementations provide regression examples for explicit targets, secret-source pinning, endpoint allowlists, exact payload/configuration comparison, artifact-byte verification, bounded requests, approval expiration, separate writer/upload pauses, single-use claims, failure handling without retries, and independent postflight checks.

Those safeguards may inform separately reviewed future tooling. Their historical executors, fixed source proofs and private evidence paths are not prerequisites for ordinary frontend development. The pure Phase 3B helpers already support local validation independently of this archive.

The historical transports distinguish version upload from activation. Upload uses a fixed `deploy=false` endpoint; activation accepts one exact separately approved deployment action. A failed or uncertain submission is not permission to retry, remove a claim, force activation, or automatically roll back.

## Approvals and recovery are not transferable

The digest identifiers above are references, not approvals. Historical plans and approvals have bounded lifetimes and depend on exact artifacts, configuration, tooling, targets, baselines and pause confirmations. Source changes in Phase 3B changed seal inputs. No historical approval can authorize a future release, even if a version or digest is copied into a new file.

Historical rollback availability checks only describe what those operations intended to inspect. They do not establish current availability, or compatibility with today's D1 schema, data, R2 objects or authentication state. SQL restoration does not restore Worker code or R2 objects and can discard later writes. Recovery, rollback and production smoke checks require separately scoped approval and current evidence.

## Regression coverage

[package.json](../package.json) separates routine helper tests from historical tooling tests; default `npm test` still discovers all test files. The Phase 3B isolated run passed 378/378 selected tests, including the two historical regression files above. That is local compatibility evidence, not production execution evidence.

The full historical command also includes backup-plan tests requiring a real private storage parent. Do not relax isolation or access private backups just to run that complete command. Select safe mock-based tests in a disposable workspace with external networking and credential access disabled. Any future refactor of UI activation needs dedicated tests for that chain's review, approval, claim and postflight boundaries.
