# Production D1-only deployment

Production migration and UAT are complete. This document preserves the verified settings and reusable upload guard; it does not authorize remote access, deployment, migration or restoration.

## Configuration

Use only `wrangler.production.jsonc` for deployment. It preserves the captured production account, Worker, custom domain, runtime date/flags, workers.dev/preview settings, DB, CFL_ASSETS, ASSETS and asset routing. Only filesystem paths were converted to repository-relative paths. `keep_vars: true` preserves existing remote authentication variables and secrets; no authentication values are stored here. Do not replace it with the default Wrangler or UAT configuration.

`wrangler.production-build.jsonc` is build-only. It has no account, D1 or R2 bindings. Never deploy it. The default Wrangler configuration remains unchanged and is not the production D1-only deployment entry point.

## Local build

With the existing locked dependencies installed, run `npm run build:production`. This explicitly selects the production D1 build and build-only configuration, writes `dist/`, and excludes generated JSON-driven sitemap files. The sitemap URLs are served through the D1 request snapshot. Do not seed or migrate any database during a build.

Run `npm run test:production-tooling`, `node_modules/.bin/tsc --noEmit`, and the existing focused `tests/production-cutover.test.mjs` tests. For isolated CI/local checks, block outbound networking and protect `.wrangler/state`; allow only build outputs and Vite caches. Hash the artifact with the existing `inventory` function from `scripts/phase1a/safety.mjs` and `sha(JSON.stringify(inventory(...)))` from `scripts/phase2b/guards.mjs`. Seal the new artifact checksum rather than assuming byte identity with an earlier build.

## Separately approved deployment

1. Obtain explicit approval for fresh read-only production metadata/configuration capture using the existing `production-preflight.mjs` and production target guards. Verify active version, 100% traffic, current mode, actual DB/R2/assets, routes, authentication fingerprint and runtime settings. Compare to this dedicated configuration; stop on drift. Never infer live settings from this file alone.
2. Prepare a private owner-only operation directory outside Git. Reuse the existing production cutover plan structure and approval checks. Seal target, fresh baseline/version/mode/deployment/fingerprints, configuration checksum, artifact inventory checksum, installed Wrangler CLI checksum, guard source checksums, exact upload arguments, nonce, limits and expiration. Review rollback-version availability without activating it. Require separate explicit human approval of the new digest. Old approvals cannot be reused.
3. Supply private `production-deployment-plan.json`, `deployment-approval.json`, `deployment-preflight.json` and `execution-start.json` in that directory. They must never enter the repository. Preflight is at most five minutes old. Approval is at most thirty minutes and within plan expiration; readiness must be READY. A fresh production writer/upload pause is a separate owner confirmation.
4. Start the installed Wrangler CLI from that private directory with the absolute repository `scripts/production/upload-boundary-preload.cjs` and `upload-preload.cjs` preloads, in that order. The exact `versions upload --config <absolute-repository-path>/wrangler.production.jsonc` arguments, tag and other flags must match the approved plan. Use a minimal environment permitted by the preload; disable Wrangler metrics and log writing. Authentication is supplied only in process environment after approval, never command text or checked-in files. Guard hashes are resolved from repository `scripts/production/`; plans are resolved from the private working directory. The one-use upload claim remains after failure.
5. The guard permits only exact account/Worker metadata GETs, one static-asset session, bounded Worker static-asset transfers and one strict-inheritance version upload. The three corrected metadata GETs are service metadata, script secret-name/type metadata, and preview metadata. No secret mutations, D1/R2 requests, OAuth refresh or activation are allowed through the upload guard. Unknown requests fail closed. Rejection logs retain only sanitized method, path and category. Do not retain metadata response bodies or secret names in diagnostics.
6. Independently verify the uploaded version before separately guarded activation under the approved plan. The upload preload cannot activate a Worker. Reuse the existing production metadata verification and operation-specific activation approval; never use an unguarded deploy as a shortcut. Check the ACTIVE version at 100%, D1-only mode/no fallback, bindings, routes, authentication and asset routing after activation. No automatic retry or rollback. Smoke requests require their own approval.

Wrangler 4.144.0 was the installed version used for the preserved guard. Dependency changes require local request-flow review and new sealed checksums. No permission expansion is implied.

## Recovery and evidence

Retain private SQL/photo backups, recovery bookmark, rehearsal reports, source/artifact inventories, configuration evidence, approval records and deployment/smoke reports outside Git in durable private storage. The compatible historical hybrid rollback version is `2cd82667-7a4b-4995-9995-444ff260b4af`; confirm availability and compatibility before separately approving rollback. The SQL backup precedes migration 0011 and identity backfill. Restoring it is a separate destructive decision and can discard later writes. R2 objects and Worker code are not restored by SQL import.

The original temporary deployed artifact is no longer available locally. Runtime/configuration fields were recovered from retained local session records; this is not fresh live inspection. A rebuild can verify current source/build contracts, but cannot prove byte-for-byte equality to an absent original artifact. Fresh target/configuration verification and a new artifact seal are mandatory before any future deployment.
