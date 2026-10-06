# Admin authentication foundation (source/local only)

Status: Phase 1–4 implementation. No Access configuration, online write enablement, secrets, deployment, or remote migration has been performed.

## Request boundary

Middleware and each concrete admin route independently call `authorizeAdmin`. A WeakMap caches the verification promise for that Request; Astro locals also receive its trusted context. Mutations receive the authorized DB wrapper, not JWT/header/body identity. The actor retained by the audit wrapper contains only subject and verified administrator email.

Online configuration is default-deny. Required trusted bindings (not configured by this work):

| Binding | Meaning |
| --- | --- |
| ADMIN_ENABLED | Exact `true` enables verified admin reads. Missing/other values deny. |
| ADMIN_WRITES_ENABLED | Independently requires exact `true` for POST and mutation context. |
| ADMIN_ENVIRONMENT | `uat` or `production`. |
| ADMIN_HOSTNAME | Exact lowercase allowed hostname; HTTPS and no non-default port. UAT requires workers.dev; production rejects workers.dev and pages.dev. |
| ADMIN_ACCESS_ISSUER | Exact `https://<team>.cloudflareaccess.com`, no path/trailing slash. |
| ADMIN_ACCESS_AUD | Environment-specific Access application audience, 64 lowercase hex characters. UAT and production must have different applications/AUDs. |
| DB | Correct environment D1 binding. Host/JWT verification cannot prove its database ID: later rollout must independently verify the actual deployed binding. |
| ADMIN_DRAW_KEY | Separate environment secret for existing bracket HMAC. It is not an authentication credential. Configure later, independently for UAT/production. |

There are no actual AUDs, personal emails or production secrets in source. Later rollout must configure Access for `/admin` and `/admin/*`, use human Allow membership and environment-specific AUDs, and verify deployment bindings before enabling writes. No application email allowlist duplicates Access membership.

JWT verification uses jose 6.2.12 with RS256, configured issuer/AUD, required exp/iat/nbf/sub/email/type, five seconds clock tolerance, future-iat rejection, application type `app`, and human subject/email. Recognizable service identities are rejected. Email-only headers cannot authorize. All failures return generic denial without printing tokens or claims.

JWKS URL is built exclusively from the validated trusted configuration, never token claims or request input. HTTPS redirects are rejected. At most four issuer caches, 5-minute freshness, 1-second rotation cooldown and 3-second fetch timeout; unknown rotated kid refreshes. Tests use public TEST ONLY RSA fixtures and an injected local JWKS transport. No unit-test network access.

Local bypass remains compile-time DEV + loopback + staging binding. Forwarded/forwarded-for and mismatched x-forwarded-host are rejected. The existing exact same-host x-forwarded-host exception is preserved because Astro DEV itself supplies that transport header; DEV + actual loopback + staging binding remain mandatory. Production builds cannot use it. Its actor is synthetic `local-admin` / `local-admin@example.invalid`. Missing staging DB remains an error. Existing launcher defaults are unchanged: use its explicit `--local` option for a local simulation.

## Routes and tools

All 15 concrete admin files (dynamic master and four-category asset routes included) guard independently. GET/HEAD require online authentication; POST additionally requires write enablement. Existing middleware POST allowlist and unsupported-method rejection remain. Authentication precedes form/multipart decoding, R2 or database mutation.

Public Randomizer/Veto keep their shared simulation engines. Valid legacy `adminTournament` links return 303 to the existing `/admin/tournaments/<id>/maps` workspace. This workspace owns official persistence and is protected. Invalid targets fail with 400. There is no public official-tool DB read/write boundary.

Strict Origin/Sec-Fetch-Site, content types, allowed/unique fields, streaming body limits, no CORS, admin no-store/noindex/frame restrictions and the existing draw HMAC are retained.

## Audit persistence

Migration `0010_admin_audit_log.sql` adds ID, actor subject/email, controlled action, entity type/ID and server timestamp. It has no entity foreign keys and no payload/token/contact metadata. Its timestamp/ID index supports chronological review; historical entities require no backfill. TEST deletion retains its history.

`mutationDatabase` requires the trusted request DB context and write enablement. Existing D1-only mutation entry points use a scoped statement wrapper. The wrapper inserts an audit event immediately after the first domain write inside the SAME native D1 batch; inline team/player creation receives additional controlled events in that batch. Read-only batches receive no event. Results returned to existing validators exclude audit results.

A single statement affecting zero rows adds no event and preserves existing stale/locked validation. Multi-statement first-write zero changes abort through the audit NOT NULL constraint. Existing snapshot guards/FKs still abort stale multi-statement writes. An audit insertion failure rolls back the domain batch. No asynchronous/background audit writes.

R2 ordering remains validation → PUT → conditional D1 reference activation + audit batch. R2 failure does not activate/audit. Failed activation/audit can leave an orphan object; the previous reference remains. Revert conditionally sets NULL + audit. Previous versions are never deleted. Image limits/container decoding and key generation are unchanged.

Actions: master create/edit; tournament create/edit/setup/completion/TEST delete; participants; roster save/move and inline create; bracket/maps confirmation; result/details draft/completion/correction; full/partial W/O; asset upload/replace/revert. Reads, previews, simulations, unsaved changes and failed authentication are not success events.

Audit retention/export and Access revocation are later operational decisions. This source does not add a cleanup job or promise immediate JWT revocation; Access policy enforcement and short session duration remain necessary at the edge.

## Local verification

- Normal parallel tests: 223/223 (191 existing + 32 added).
- Signed local keys: claims/signature/algorithm/service/host/config/read/write/local isolation, JWKS rotation/unavailability, all route classes.
- Audit: success identity/action/schema, failure/stale/untrusted contexts, full-batch rollback, deletion retention, inline create, all action constraints, R2 orphan/no-reference and replacement/revert ordering.
- Actual Astro DEV local-only admin page/create/TEST-delete smoke is checked separately.
- `tests/admin-auth-runtime.integration.mjs`: real local workerd + native D1, signed JWT, read-only POST/Origin/form denial, successful atomic audit and forced audit rollback.
- `tests/admin-public-regression.integration.mjs`: 195 D1/fallback public routes, 46 assets, sitemap/robots, continuity, guard denial and official redirects.
- Build checker reports 197 responses/files: the same 195 public sitemap routes plus two static verification files. Existing R2 fallback chain is now recognized by the checker; no consumer/UI logic changed.
- New migration applies locally after 0009; seeded audit table starts empty. Existing migrations unchanged. Historical counts/totals and parity are checked separately. The standard seed contains no historical roster rows: the existing certified snapshot supplied168 rows to the isolated local parity fixture; no remote data was read or changed.
- JOSE verification/JWKS exports bundle to17,882 bytes minified /6,815 gzip in a standalone browser-target measurement, with zero package runtime dependencies. Actual application sharing/tree shaking may differ.

Sources: [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [jose](https://github.com/panva/jose).
