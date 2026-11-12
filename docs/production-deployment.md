# Production operations and local validation

This document separates current local development checks from historical releases and recovery. It does not authorize production access, deployment, activation, database work, credential changes or restoration.

**The fixed-version release executors are historical reference material. Do not execute them for new deployments.** Their sequences, pins, evidence gaps and preserved dependencies are documented in [historical-releases.md](historical-releases.md).

## Current local guidance

Use checks appropriate to the change:

| Change | Local validation |
|---|---|
| UI, CSS or copy | Relevant tests, affected-page visual checks and compilation/build as applicable |
| Application behavior | Relevant unit/integration tests, type checks, build and compatibility checks |
| Database, authentication or infrastructure | Risk-specific tests and explicit review of schema, recovery, bindings, routing or authentication effects |

A minor frontend change does not require replaying historical roster, identity, migration or photo-reference preflights. This repository does not yet provide an approved general-purpose frontend deployment workflow. The local commands below are validation commands, not release authorization.

### Configuration and build

[wrangler.production.jsonc](../wrangler.production.jsonc) is the repository's dedicated production-target configuration. It records the account, Worker, domain, resources, runtime and asset settings. Treat those as configuration inputs to review against separately authorized current evidence, not a fresh description of production. Do not substitute the default or UAT configuration.

`keep_vars: true` is not proof of historical variable/secret values and does not by itself restore an active version's configuration after rollback. Binding metadata and authentication fingerprints do not prove secret-value equality or successful login behavior.

[wrangler.production-build.jsonc](../wrangler.production-build.jsonc) is build-only, with no account, D1 or R2 bindings. Never deploy it.

With existing locked dependencies installed, the available local commands include:

```sh
npm run test:production-tooling
npm run typecheck
npm run build:production
```

`test:production-tooling` covers routine operational helpers, metadata collection and recovery workspace boundaries using local fixtures. It does not run an operational preflight or recovery CLI.

`typecheck` generates local binding declarations through [admin-types.mjs](../scripts/admin-types.mjs), synchronizes Astro types and runs TypeScript. Generated declarations remain ignored by Git.

`build:production` selects the production D1 build target and build-only configuration. It writes `dist/`; generated JSON-driven sitemap files are excluded and sitemap URLs use the D1 request snapshot. Do not seed or migrate a database during a build. Use a disposable workspace when protecting existing outputs, and disable external networking and credential access during isolated validation.

[package.json](../package.json) also defines:

- `test:production-historical`: historical cutover, preflight, backup/backfill, pinned release and upload-guard regressions. The backup-plan tests require a real private storage parent; the full command is not a credential-free isolated test recipe.
- `test:regression`: an alias for unchanged default `npm test` coverage. Neither test command is deployment approval.

Use a new artifact inventory and checksum for a reviewed build. A successful rebuild does not prove byte identity with an earlier artifact or source-to-production equivalence. Historical tooling used more than one inventory representation; record the algorithm and file set rather than comparing unlabeled digests.

### Operational metadata helpers

[metadata-helpers.mjs](../scripts/production/metadata-helpers.mjs) contains pure project-specific target, reader-mode and binding comparisons without migration/schema imports or import-time I/O.

[metadata-collector.mjs](../scripts/production/metadata-collector.mjs) centralizes bounded metadata GET transport, scope restrictions, pagination completeness checks, drift inputs, secret-field rejection and sanitized transport errors. It does not grant upload or activation authority.

[frontend-preflight.mjs](../scripts/production/frontend-preflight.mjs) retains a separately approved operational metadata-review capability. Its CLI obtains authentication, accesses Cloudflare metadata and writes private evidence, so it is not a routine UI check and must not be run merely to validate local CSS. Production use requires explicit scoped approval and a freshly identified expected version. Do not copy an old version UUID or temporary workspace from historical instructions.

`GO_FOR_RELEASE_REVIEW` means only that the implemented metadata/configuration checks passed. Source mapping remains explicitly unverified; approval creation and upload authorization remain false. A report must not be relabeled as an approval or used as a substitute for an approved release plan. Unexpected bindings, unidentified extra databases, runtime/asset drift or incomplete metadata require review, not weakened checks.

## Historical migration and cutover procedures

The earlier D1 migration, identity backfill and reader cutover are historical procedures, not the normal path for a frontend update. Relevant files remain under [scripts/phase2c](../scripts/phase2c), including [production-preflight.mjs](../scripts/phase2c/production-preflight.mjs) and [production-cutover.mjs](../scripts/phase2c/production-cutover.mjs).

The migration preflight includes schema 0010/0011, S1/S2 roster/identity contracts, photo references and approved remote reads. Its name does not make it a generic frontend preflight. The cutover checks protect source-reader and resource-preservation contracts; retaining their tests does not authorize another cutover.

Earlier deployment procedures used private sealed plans, configuration/artifact/CLI/guard hashes, fresh metadata, expiring digest approval, separate writer/upload pause confirmation and single-use claims. [upload-boundary-preload.cjs](../scripts/production/upload-boundary-preload.cjs), [upload-preload.cjs](../scripts/production/upload-preload.cjs) and [upload-request-guard.cjs](../scripts/production/upload-request-guard.cjs) preserve those regression contracts. Their original installed Wrangler reference was 4.144.0; a dependency change requires review, not an assumption that the old request flow remains valid.

These preloads and historical plan formats are not current deployment instructions. Do not combine their plans with the distinct fixed-version JSON uploader. Do not use an unguarded deployment command to bypass a historical restriction.

## Historical pinned-version releases

The selection release (`6f6f4073…` to `2767f1cb…`) and subsequent Qualification UI release (`2767f1cb…` to `06da29a3…`) are catalogued in [historical-releases.md](historical-releases.md).

Their upload, activation-review, activation and postflight scripts stay at their original paths to preserve source bytes, relative imports and regression coverage. Their fixed versions, approval digests, candidate commit, exact source proofs and private temporary paths make them unsuitable for direct reuse.

The dated dashboard observation of `06da29a3` at 100% is distinct from a verified remote artifact fingerprint. The retained local Qualification UI artifact has a verified inventory checksum, but complete source-to-production equivalence and per-script execution details remain unverified. Old local readiness reports are not deployment-success records.

## Recovery-specific procedures

[reconstruct-config.mjs](../scripts/production/reconstruct-config.mjs) is a recovery-oriented operation, not a prerequisite for routine frontend changes. It can obtain credentials, read Cloudflare metadata and replace the exact configuration in a private isolated workspace. Do not execute it without separately scoped approval.

Its pure [active-configuration.mjs](../scripts/production/active-configuration.mjs) validators and [recovery-workspace.mjs](../scripts/production/recovery-workspace.mjs) filesystem safeguards remain testable locally. Reconstruction checks the explicit active variable map, resources, runtime, routing, asset settings and secret metadata. Its current inheritance policy requires verified active/latest correspondence when secrets are present; matching secret names alone is insufficient.

Recovery output can contain nonsecret variable values, private configuration and secret names. Keep captures and configuration files private even when no secret values are exported. Only sanitized reports are suitable for review. Before replacement, the workspace/configuration must meet private-path checks, the reviewed configuration must be unchanged, and its original bytes must be preserved privately. A successful reconstruction does not approve a release.

The older [verify-activation.mjs](../scripts/production/verify-activation.mjs) performs postflight/recovery checks for its fixed historical selection release. It is not a current production-health or rollback tool.

Retain SQL/photo backups, bookmarks, rehearsal reports, source/artifact inventories, approval evidence and deployment reports outside Git in durable private storage. Earlier cutover documentation named hybrid version `2cd82667-7a4b-4995-9995-444ff260b4af`; later pinned chains referenced different stable versions. None is guaranteed available or safe with current D1 schema/data, R2 objects or authentication state.

A SQL backup preceding migration 0011 and identity backfill can discard subsequent writes if restored. SQL import does not restore Worker code or R2 objects. Database restoration, Worker rollback, R2 recovery, credential changes and production smoke checks each require current evidence and explicit scope-specific approval. There is no automatic rollback authorization.

## Before any future production operation

Review and approve a concrete operation against current target/configuration evidence, the proposed source and artifact, the applicable risks and recovery compatibility. Source-mapping uncertainty must remain visible. Where tooling uses seals, obtain fresh reviewed digests rather than replaying historical approvals.

Upload and activation are separate actions. Any approved operation must preserve its applicable resource, secret, endpoint, artifact, expiration, pause, claim and independent verification safeguards. An uncertain submission is not permission to retry, erase a claim or force rollback. This documentation defines boundaries; it does not implement a new release workflow.
