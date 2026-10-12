# Phase 2B.0 staging safety executor

This framework prepares staging operations. It does not change public readers. The backup handler supports explicitly approved execution. Phase 2B.3 adds an approval-gated D1 SQL-file import transport for the pinned two-record identity backfill. REST query batch writes remain unavailable. Migration, deployment, reader enablement, restoration and recovery rehearsal retain separate approval-bound plans without live dispatchers in this framework. A plan is not authorization, and backup never invokes another operation.

## Fixed target

- Account: bf6ed4ccd73133871881b47ea58dae3d
- Database: cflesportsid-staging / 4ba57de7-5fda-4703-a956-b1936546986a
- Worker: cflesportsid-uat
- Configuration: scripts/phase2b/wrangler.staging.json, supplied by its absolute canonical path.

The configuration contains only the staging D1 binding, no production binding, R2 buckets, environments, previews or deployment entrypoint. Root Wrangler configuration is never discovered. The implementation uses fixed Cloudflare API endpoints rather than spawning Wrangler: this prevents implicit environment-file loading, OAuth refresh and configuration discovery. Existing OAuth is read without modification; an expired token stops execution. An explicitly supplied CLOUDFLARE_API_TOKEN is supported. Conflicting account, Wrangler, application mode, proxy and Node injection variables are rejected.

## Read-only preflight

Run from the repository, substituting its absolute path and a new private report path:

    node scripts/phase2b/run.mjs preflight --config /absolute/repository/scripts/phase2b/wrangler.staging.json --out /private/tmp/cfl-phase2b0-OWNED/preflight.json

Preflight checks:

- API account and D1 identity.
- Worker settings AND the version receiving 100% of traffic. Multiple active versions fail closed.
- Hybrid mode and the exact staging D1 binding.
- Pinned SHA-256 values for all eleven migration files, with exactly 0001–0010 applied and only 0011 pending.
- All 41 application schema objects against migration definitions, without executing migration SQL.
- Column inventory, foreign keys, roster indexes and absence of inbound roster relationships.
- All 168 roster memberships, historical IGN/team/UID values and valid saved positions.
- S1/S2 boundaries and the actual player primary key corresponding to public UID 1345266890.

Registration reference provenance is pinned to b126ef03babd172fc0465f737453a483eae76634 for S1 and b2c5c4dc684bcd69c7d15d212d2de32236700179 for S2. The reference contains no positions. Reports contain counts and fingerprints, not roster records or secrets. Saved D1 ordering is fingerprinted for exact before/after comparison, never rebuilt from registration order.

The approved 30-day retention is account-owner evidence from Phase 2A. The executor checks the compatible D1 backend; it does not claim to independently inspect billing permissions. Preflight performs no bookmark capture, export or database write.

## Plans and explicit approvals

Supported operation names:

- backup
- migration
- identity-backfill
- deployment
- reader-enablement
- restoration
- recovery-rehearsal

The plan command is read-only and does not authorize an operation:

    node scripts/phase2b/run.mjs plan --config /absolute/repository/scripts/phase2b/wrangler.staging.json --report /private/preflight.json --operation backup --payload /private/backup-payload.json --out /private/backup-plan.json

A backup payload contains only maintenanceWindowConfirmed: true and outputDirectory: an explicit absolute path to a new cfl-phase2b-backup-UNIQUE directory. The operator must actually stop staging writers before affirming the maintenance window; this flag cannot enforce an external admin write freeze.

Every plan binds its operation, target, configuration, preflight fingerprint, migration hash and operation-specific payload to a SHA-256 digest. The preflight must be at most 15 minutes old. A private, owner-controlled approval record outside the repository must name:

- format: cfl-phase2b-approval-v1
- approved: true, only after explicit human approval
- approvedBy: the approving operator
- id: a unique approval identifier
- target: the exact account/database/Worker object
- operation: exactly one operation
- planDigest: the reviewed plan digest
- issuedAt and expiresAt: UTC timestamps, valid for at most 30 minutes

Approval files must have owner-only permissions. Do not commit approval records or create them automatically from a successful test/preflight. These records document operator approval; they are not cryptographic proof of a human identity. A mutation adapter cannot reuse backup approval for migration, deployment or restoration.

## Backup handler — NOT executed during Phase 2B.0

After a separate approval:

    node scripts/phase2b/run.mjs backup --config /absolute/repository/scripts/phase2b/wrangler.staging.json --report /private/preflight.json --payload /private/backup-payload.json --approval /private/approval.json

The handler re-runs preflight, rejects state drift, rechecks the approval file, claims approval exclusively, and creates a new private directory with an ownership marker. It captures a Time Travel bookmark, requests the complete SQL export without table/data/schema filters, polls within a bound and downloads only from allowed Cloudflare export hosts. API credentials are never forwarded to the signed download URL; redirects are rejected.

The SQL must contain every expected application schema object and migration ledger, plus data for known populated tables. The saved export is hashed and reread for checksum verification. Post-export preflight must match before a completion manifest is produced. Backups include private operational data: retain them outside Git/public assets with owner-only permissions.

Failures preserve evidence and the consumed approval; there is no automatic retry, deletion, restoration or next operation. Unknown download hosts, API formats, permissions or incomplete exports fail closed. Remote export permissions and the actual signed-download host will only be tested during the separately approved backup.

Checksum verification is local and non-mutating:

    node scripts/phase2b/run.mjs verify-export --config /absolute/repository/scripts/phase2b/wrangler.staging.json --file /private/staging.sql --manifest /private/manifest.json

## Identity backfill artifact

scripts/phase2b/identity-backfill.json contains exactly two parameterized INSERT statements, intended for one atomic D1 batch. It resolves the player by UID in the target database. It only inserts into player_identity_segments and player_identity_tournaments.

Required mapping: UID 1345266890; segment 1345266890--before-clash-for-glory-s2; historical S1; boundary S2; IGN KangDedy; team cha-tra-mue.

Both absent: insert two rows. Both exact: no-op. Conflicting, partially present, missing-player, wrong-boundary or wrong-roster states: reject. The first INSERT deliberately violates the segment's NOT NULL primary-key constraint when its guard fails, aborting the atomic batch. Never submit these statements individually or wrap them in a raw SQLite BEGIN/COMMIT through D1.

Existing player, roster, match and statistics records are never updated by this artifact. A future backfill executor must freshly verify staging identity and schema 0011, read the scoped identity state, submit this pinned artifact atomically after its own approval, and verify exact resulting rows. The pre-migration 0010 preflight is not a post-migration verifier.

## Recovery rehearsal and restoration

The rehearsal plan requires an export checksum, a new disposable directory outside the repository, and a new UUID distinct from production, staging and known fixture IDs. It must not use any of the seven existing stores.

Under a separate future approval, create an ownership-marked local D1 configuration with only that UUID, force local execution and explicit persistence under the marked root, deny external network and credential access, verify export checksum, import the export without replaying migrations, and compare schema, ledger, foreign keys, roster fingerprints and historical statistics. Reject reuse of an existing directory. Cleanup must validate the marker, owner and exact path and never follow symlinks. No rehearsal/import/cleanup is performed by this phase's CLI.

Restoration requires its own plan with an exact bookmark, reason and maintenance confirmation, plus separate explicit approval. There is intentionally no restore endpoint in this phase's transport. Restore is never an error handler.

Recovery acceptance: correct staging identity/binding, expected ledger/schema, zero FK violations, exact saved rosters and positions, S1/S2/overall parity, historical URLs, bracket/BYE/W/O behavior, admin reads and R2 references. Return to compatible hybrid application behavior before restoring schema 0010. Time Travel does not restore Worker code or R2 objects.

## Verification and limits

Safety tests use mocked Cloudflare responses, synthetic export bytes and an in-memory identity fixture. No live backup or write transport is invoked. Existing-store byte fingerprints are compared separately before and after testing.

Final verification: 44 executor tests and 39 selected regression tests passed; TypeScript --noEmit, module syntax checks and git diff --check passed. Seven existing D1 stores and their sidecars remained byte-identical. Historical source data, migration files, existing Wrangler configurations, statistics.ts and HEAD were unchanged.

An earlier regression selection unexpectedly ran the existing D1 continuity test, which replays migration SQL in an in-memory fixture. No persisted local or remote database was migrated. The final regression run explicitly excludes that test with --test-skip-pattern="D1 output and outage". New executor tests use handwritten in-memory schema fixtures and synthetic export bytes, not remote or existing local databases.

Evidence is retained under /private/tmp/cfl-phase2b0-76vWWC: executor-tests.txt, regression-tests.txt, preflight-blocked.json, safety-before.json and safety-after.json. No successful live preflight report or real backup was generated.

The live preflight attempt stopped locally at AUTH_EXPIRED_REFRESH_MANUALLY before networking. No fresh remote PASS report is claimed. Refresh authentication manually, rerun read-only preflight and review a new backup plan before approving backup execution.

Cloudflare references:
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/

## Phase 2B.1 durable storage

Prefer a pre-created, user-owned 0700 parent such as ~/Documents/CFL-Private-Backups. Expand ~ to the canonical absolute path before planning; choose a new child named cfl-phase2b-backup-UNIQUE. Existing /Users/rizkirn/CFL-Private-Backups/staging is also eligible. No destination is inferred from the environment. The exact outputDirectory remains inside the SHA-256-approved payload; changing it invalidates approval. No backup is authorized by storage configuration.

The parent must exist, belong to the current user and deny group/other permissions. Every path component must be a real directory, never a symlink. Repository destinations, relative/noncanonical paths, reused backup paths and unsafe parents fail closed. Legacy /private/tmp remains supported only as a sticky temporary parent. A fresh output directory is created exclusively with mode 0700; files are created exclusively with mode 0600 and fsynced. Existing artifacts are never overwritten.

Available disk space is checked during planning and before execution: at least 64 MiB reserve. After download, the exact export byte length plus that reserve must fit before writing SQL. This is a capacity check, not a reservation; concurrent disk use can still fail safely, retaining incomplete evidence and requiring new approval. Parent inode/device identity is rechecked after remote preflight.

Complete-export schema/data validation, SHA-256 and saved-file readback remain required; the manifest and directory are synced before success. Storage remains private operational data. Local disk durability does not establish encryption, off-device recovery or a successful restoration rehearsal. The owner has committed to pausing staging edits/imports/scripts during the final preflight and backup window; no maintenance page is required. Backup, migration, backfill and restoration still require distinct approvals.

Storage-fix verification: 51 selected executor/storage tests passed, along with TypeScript --noEmit, syntax and whitespace checks. Backfill fixture tests and the full backup dispatcher were excluded; no real export, backup, remote request or database initialization was performed. All 110 existing Wrangler state files, including the seven D1 stores, matched prior byte fingerprints. A fresh staging-only preflight and a new digest-bound plan remain required before separate backup authorization.


## Phase 2B.3 identity backfill

Prepare a fresh schema-0011 **read-only** preflight with the explicit staging configuration:

    node scripts/phase2b/run.mjs preflight --config /absolute/repository/scripts/phase2b/wrangler.staging.json --purpose identity-backfill --backup-manifest /private/approved-backup/manifest.json --out /private/new-preflight.json

The original schema-0010 preflight remains the default for its original operations. The identity purpose requires all eleven pinned migrations exactly once, no pending migration, all 44 application schema objects, zero foreign-key violations, 168 verified registration memberships, unchanged saved ordering, and empty identity tables. A private, canonical backup manifest and complete export checksum must match the current roster fingerprint. No SQL export or backup operation runs during this check.

Generate a transport-specific payload without credentials or network requests:

    node scripts/phase2b/run.mjs identity-payload --config /absolute/repository/scripts/phase2b/wrangler.staging.json --expires <UTC-ISO-expiration> --out /private/new-payload.json

The payload includes the pinned `artifactHash`, transport `d1-sql-file-import-v1`, renderer version `identity-numbered-sql-v1`, renderer source SHA-256, rendered SQL SHA-256, a fresh UUID-v4 nonce and `approvalExpiresAt`. Generate the plan with the existing `plan` command and operation `identity-backfill`. The plan also binds the account, staging database UUID, UAT Worker, configuration, migration, backup and preflight evidence. Review both the preflight expiry and approval expiry. The approval's `expiresAt` must exactly equal the plan's `approvalExpiresAt`; changing or extending either invalidates authorization. Old batch-transport approvals are not accepted.

The original artifact is unchanged. The renderer substitutes only numbered parameters outside quoted strings, identifiers and comments, with correct SQL literal escaping. It allows exactly the two pinned INSERT targets and rejects extra statements, transaction wrappers, schema operations or ledger writes. A nonce comment differentiates import uploads between operations without adding a SQL statement. SHA-256 authenticates the reviewed file; MD5 is used only for Cloudflare's upload ETag protocol.

The execution command remains `identity-backfill`, with explicit `--config`, `--report`, `--payload`, and `--approval` files. Missing approval is rejected before credential lookup. Execution repeats the schema-0011 preflight, compares all saved evidence, rereads approval and the pinned artifact, and claims approval exclusively. It creates `identity.sql` and an ownership marker under `/private/tmp/cfl-phase2b-identity-import-<nonce>/`, with directory permissions 0700 and file permissions 0600. Existing directories or files are never overwritten. Their ownership, canonical paths, marker, source checksum and SQL checksum are rechecked before write requests.

Import protocol:

1. Revalidate approval, its exact expiration, preflight freshness, and SQL bytes before `/import` initialization. Initialization may immediately begin processing a cached upload.
2. For a fresh upload, accept only HTTPS signed URLs on standard hexadecimal-account R2 hosts; reject credentials, fragments, other hosts and redirects. PUT only the approved bytes, without forwarding Cloudflare authorization headers. Require the upload ETag to equal their MD5.
3. Revalidate approval and SQL before ingestion. Submit the filename returned by the fixed staging import endpoint, with the same ETag.
4. Poll only the same import bookmark, with bounded polling. Cached initialization bypasses upload and ingestion. Never automatically initialize or ingest again.
5. Require successful completion, exactly two executed statements and a final bookmark. Treat `rows_written` as audit metadata, not an inserted-record count.
6. Perform exact database postflight: one historical segment, one S1 mapping, unchanged target master identity, 168 roster records and saved positions, match entries, round statistics, combat aggregates, matches, maps and walkovers, and zero foreign-key violations.

No migration, ledger edit, master-player edit, automatic retry, restoration, deployment or reader enablement can run from this handler. Failed or ambiguous execution consumes the approval and stops with a secret-free error requiring read-only investigation. A timeout is not proof that the import rolled back. Operational SQL artifacts remain private for investigation; do not delete them by wildcard. Test cleanup validates its newly generated ownership markers before removing only its disposable directories.

### Atomicity evidence and limitations

This uses the same supported `/import` init/upload/ingest/poll mechanism as `wrangler d1 execute --remote --file`. Cloudflare's official Wrangler implementation explicitly states that a failed file execution returns the database to its original state. The import API reference itself does not repeat that rollback statement. The executor does not invoke Wrangler, modify OAuth credentials or deploy a Worker.

Local fixtures initialize schema 0011 directly, without running migrations, in a new disposable D1 UUID and persistence directory. Every Cloudflare request is intercepted by a mock fetcher. The mock import ingests the actual approved rendered SQL through the disposable binding's transactional `DB.batch()`. A forced second-insert failure leaves both identity tables empty; successful execution preserves every other application table. A postflight failure leaves committed local identity rows in place and stops without restoration. These tests prove local SQL behavior and executor controls, **not remote import rollback**.

References:

- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/
- https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/src/d1/execute.ts
- https://developers.cloudflare.com/d1/worker-api/d1-database/#batch

Imports temporarily block D1 requests. Keep staging writes paused for the approved window; an owner-only staging maintenance page is unnecessary. Signed-upload host variants outside the allowlist fail closed and require review. No application R2 bucket or additional Worker is configured. Read-only preflight and plan preparation may proceed after local validation; actual staging execution requires fresh evidence and explicit approval of the new digest.

The fixture's positions are synthetic ordering, not reconstruction or offline verification of authoritative remote S2 ordering. Pinned identity data, registration references, baseline and migration 0011 remain unchanged.

Local import validation: 131 selected executor/storage/backfill/import/safety/public-mode/veto tests passed; TypeScript `--noEmit`, executor syntax checks and whitespace validation passed. All 110 existing `.wrangler` files, including seven D1 application stores plus internal metadata, matched their before-test SHA-256 fingerprints. No remote endpoint was contacted during implementation or tests.
