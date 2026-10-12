# Proposed Git commit scope

Nothing is staged. No commit or push is authorized.

Suggested message: `feat: complete D1-only public data migration and preserve production deployment tooling`

## Explicit include list

| File | Classification |
| --- | --- |
| `astro.config.mjs` | Required runtime code |
| `docs/phase1a-local-verification.md` | Documentation |
| `docs/phase1b-public-contracts.md` | Documentation |
| `docs/phase1c-local-integration.md` | Documentation |
| `docs/phase2b0-staging-executor.md` | Documentation |
| `docs/phase2c-shadow-diagnostics.md` | Documentation |
| `docs/phase2c-uat-readers.md` | Documentation |
| `docs/post-migration-git-plan.md` | Documentation |
| `docs/production-backup-preparation.md` | Documentation |
| `docs/production-d1-cutover.md` | Documentation |
| `docs/production-d1-preparation.md` | Documentation |
| `docs/production-deployment.md` | Documentation |
| `migrations/0011_public_identity_contracts.sql` | Required migration |
| `package.json` | Build/deployment configuration |
| `scripts/phase1a/http.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase1a/phase1b.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase1a/run.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase1a/safety.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase1a/verify.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/api.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/baseline.json` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/guards.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/identity-backfill.json` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/identity-import.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/identity.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/migration-hashes.json` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/operations.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/preflight.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/registrations.json` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/run.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/schema.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/storage.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2b/wrangler.staging.json` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/deterministic-parity.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/http-validation.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/production-backfill.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/production-backup.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/production-cutover.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/production-preflight.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/production-recovery.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/shadow-diagnostics.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/tail-diagnostic.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/tail-session.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/phase2c/uat-validator.mjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/production/upload-boundary-preload.cjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/production/upload-preload.cjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `scripts/production/upload-request-guard.cjs` | Reusable verification/deployment tooling and pinned public fixtures |
| `src/components/tools/VetoTool.astro` | Required runtime code |
| `src/content.config.ts` | Required runtime code |
| `src/data-access/frontend-assets.ts` | Required runtime code |
| `src/data-access/frontend-bracket.ts` | Required runtime code |
| `src/data-access/frontend-matches.ts` | Required runtime code |
| `src/data-access/frontend-public.ts` | Required runtime code |
| `src/data-access/public-d1.d.mts` | Required runtime code |
| `src/data-access/public-d1.mjs` | Required runtime code |
| `src/data-access/public-mode.mjs` | Required runtime code |
| `src/data-access/public-statistics.ts` | Required runtime code |
| `src/data-access/shadow-contract.mjs` | Required runtime code |
| `src/middleware.ts` | Required runtime code |
| `src/pages/index.astro` | Required runtime code |
| `src/pages/local-verification/[...tool].ts` | Required runtime code |
| `src/pages/maps/[id].astro` | Required runtime code |
| `src/pages/maps/index.astro` | Required runtime code |
| `src/pages/matches/[id].astro` | Required runtime code |
| `src/pages/players/[id].astro` | Required runtime code |
| `src/pages/players/index.astro` | Required runtime code |
| `src/pages/sitemap-0.xml.ts` | Required runtime code |
| `src/pages/sitemap-index.xml.ts` | Required runtime code |
| `src/pages/teams/[id].astro` | Required runtime code |
| `src/pages/teams/index.astro` | Required runtime code |
| `src/pages/tournament/[id].astro` | Required runtime code |
| `src/utils/veto-steps-dom.mjs` | Required runtime code |
| `src/utils/veto.ts` | Required runtime code |
| `tests/deterministic-validation.test.mjs` | Required regression tests |
| `tests/phase1a-safety.test.mjs` | Required regression tests |
| `tests/phase2b-backfill.test.mjs` | Required regression tests |
| `tests/phase2b-executor.test.mjs` | Required regression tests |
| `tests/phase2b-import.test.mjs` | Required regression tests |
| `tests/phase2b-storage.test.mjs` | Required regression tests |
| `tests/production-backfill.test.mjs` | Required regression tests |
| `tests/production-backup.test.mjs` | Required regression tests |
| `tests/production-cutover.test.mjs` | Required regression tests |
| `tests/production-deployment-config.test.mjs` | Required regression tests |
| `tests/production-preflight.test.mjs` | Required regression tests |
| `tests/production-upload-guard.test.cjs` | Required regression tests |
| `tests/production-upload-preload.test.cjs` | Required regression tests |
| `tests/public-interactions.test.mjs` | Required regression tests |
| `tests/public-mode.test.mjs` | Required regression tests |
| `tests/tournament-contract-parity.test.mjs` | Required regression tests |
| `tests/uat-readers.test.mjs` | Required regression tests |
| `tests/uat-shadow-diagnostics.test.mjs` | Required regression tests |
| `tests/uat-shadow-runtime.test.mjs` | Required regression tests |
| `tests/uat-tail-readiness.test.mjs` | Required regression tests |
| `tests/veto-steps-dom.test.mjs` | Required regression tests |
| `tests/veto.test.mjs` | Required regression tests |
| `wrangler.production-build.jsonc` | Build/deployment configuration |
| `wrangler.production.jsonc` | Build/deployment configuration |
| `wrangler.uat.jsonc` | Build/deployment configuration |

## Explicit exclusions

Exclude `.generated/`, `.wrangler/`, `.astro/`, `dist/`, dependency caches, credentials/environment files, all private SQL/photo backups, signed URLs/JWTs, private execution reports, approval/claim artifacts, and all recovered session excerpts. Do not copy the private backup directory into Git. Existing ignore rules cover local generated paths; all external evidence stays external.

## Review and push prerequisites

Review the explicit include list, focused checks and sensitive-content scan before approving staging/commit. Default `wrangler.jsonc`, historical JSON and statistics algorithms must stay unchanged. Retain historical JSON for offline seeding/reference; it is not a production D1 fallback. Do not delete old verification tooling or audit artifacts during commit preparation.

The working branch is main. Compare with the cached upstream locally; a fresh remote ancestry/authentication check is required after separate push authorization. Do not infer live origin status from the cached tracking ref. No migration, seed, deploy, rollback or remote validation is part of Git housekeeping.

Production configuration recovery comes from retained local session output after temporary files disappeared. Future deployments require fresh live configuration verification and a new seal.
