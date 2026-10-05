# R2-C: staging admin image lifecycle

## A. Preflight

Checkout `/Users/rizkirn/Job/aceon/cflesportsid-development`, branch `feature/r2-assets`; HEAD/origin feature `ffefa839c0ff77a8c4e60a076f3d0f9d99cfe690`. Main/origin main remain `aa8bcfb24509fc4548adabe0d521da4602ffa65c`. Initially clean. Root wrangler SHA256 remains `a96e1247043080b9a97113460acd16c61f2fe10c062b1c5d0ddeb7d782a4bde9`. Staging migration0009/four R2-B references and objects healthy; production0001–0008 without R2.

## B–I. Implementation

Small controls on existing team/player/map inspectors and tournament overview: persisted image, file picker, preview, explicit Upload/Replace, pending lock, concise status, conditional Revert to local. Existing master creation remains separate; only persisted entities receive controls.

`POST /admin/assets/{teams|players|maps|tournaments}/{existing-id}` derives table/column/key kind from an internal allowlist. Player lookup is existing internal ID; object identity is its validated numeric UID. No historical segment editor.

Bound multipart read before parsing (5MiB +64KiB envelope); image bytes ≤5MiB. Actual WebP/PNG/JPEG container/signature, structural bounds, PNG CRC, MIME and extension consistency, static single-frame structure, dimensions and pixel count are checked before full WASM decoding. Decode must yield exact RGBA dimensions. SVG/HTML/GIF/non-image, APNG/animated WebP/multi-picture JPEG, malformed/truncated files and mismatched MIME/extensions are rejected. No conversion or image processing service.

| Category | Maximum side | Maximum pixels |
| --- | ---: | ---: |
| Team logo / player photo | 1024px | 1,048,576 |
| Map cover | 4096px | 4,194,304 |
| Tournament poster | 3072px | 4,194,304 |

Server hashes validated bytes with SHA256 and constructs `teams/{id}/logo/{hash}.{ext}`, `players/{uid}/avatar/{hash}.{ext}`, `maps/{id}/cover/{hash}.{ext}`, or `tournaments/{id}/poster/{hash}.{ext}`. JPEG uses `.jpg`. Original filename is never identity. Existing identical content-addressed objects are reused after HEAD; previous objects are never overwritten or deleted. Identical active replacement returns409.

R2 put precedes a D1 conditional update matching expected prior reference (and player UID). Stale upload/revert409. R2 failure leaves D1 unchanged; D1 failure/race retains prior/newer reference, potentially leaving an orphan. Revert conditionally changes only asset column to NULL; legacy fields, local files, IDs, rosters and stats remain intact.

## J. Security

Existing DEV localhost-only admin boundary preserved. Local admin explicitly binds remote staging D1/R2 for staging writes. UAT production-mode admin remains403; no remote admin/auth changes. Same-origin and Sec-Fetch-Site checks, narrow fields, duplicate rejection and internal category allowlist. Credentials never reach browser; no browser-direct R2 write; media endpoint stays GET/HEAD only.

Live production `/admin`403. New production upload URL404 because R2-C has not been deployed there. Live UAT `/admin` and upload POST403. Unit coverage also rejects production-mode localhost and forwarded admin requests.

## K–Q. Lifecycle UAT and continuity

All four categories plus current KucayyPRMX tested through localhost DEV admin → staging bindings, with public reads on UAT. Valid upload/replace produced SHA keys, media bytes matched, old objects stayed readable, persisted public references changed immediately, and revert restored local/default. Tournament poster consumer is `/tournament/`; detail page does not show a poster.

Invalid SVG, malformed/truncated WebP, >5MiB, wrong category/unknown entity/historical entity, stale upload/revert and cross-origin requests rejected. Unit tests simulate R2 failure and D1 conditional race without losing active reference. All three real formats decoded in unit tests; animation/dimension/pixel and multipart overflow checks covered.

Current UID1345266890 successfully uploads/replaces/reverts. Historical KangDedy remains default.webp, no upload control, never current R2 photo, including while current reference is active. Current stats50/16/24; historical70/40/42. Ordinary UID1083796629 remains continuous (123/172/70), current avatar behavior preserved. No statistical source changes.

Browser verified file preview, upload success, pending disabled controls, explicit Replace/Revert, and restored local image. Existing admin master/lifecycle HTTP regression passed against a fresh isolated local baseline.

## R–T. Validation

191/191 full tests passed in five consecutive normal/default parallel `npm test` runs after test-fixture hardening. The pre-existing shared generated seed-file race was reproduced with an IPC-controlled writer truncate/read interleaving and removed through per-call temporary fixture isolation. Runtime/application source was not changed. An additional default suite run also passed191/191 while a competing writer was held in the exact previously failing truncate window. Local195-page read regression,53 focused tests, typecheck/build/data and parity0 rerun successfully. Details: anti-slop/fix-035-2026-10-05.md.

Typecheck, build and data validation pass (185 valid records, zero errors/warnings). Public local regression:195 pages, media/fallbacks and D1 parity0. Public live UAT regression PASS:195 pages, baseline consumer/tools references, GET/HEAD/MIME/hash/ETag/nosniff/immutable cache, invalid/traversal/method rejection, continuity, admin403 and canonical/sitemap/robots. Staging D1 parity0 confirmed against the unchanged complete snapshot. Golden S1 2726/2731/1185, S2 2293/2279/1133, total5019/5010/2318;128 statistical rows/127 masters. All19 Team Details unchanged in read regression.

Reproducible HTTP harness: `R2C_LOCAL=1 node tests/admin-assets.integration.mjs` against seeded local admin. Staging execution additionally requires `R2C_STAGING=1 R2C_PUBLIC_URL=https://cflesportsid-uat.cflid.workers.dev`; references restored in finally, with conflicts reported instead of overwriting newer data. Inventory output ignored under `.generated/`. Staging test writes require explicit authorization.

## U–V. Final staging data and retained objects

Full staging schema, migration ledger and all21 table snapshots exactly equal pre-R2-C. Four R2-B keys restored; current KucayyPRMX keyNULL and all other references unchanged. No migrations, new remote master entities, roster/stat writes or object deletions.

Nine unique R2-C objects retained as unreferenced test objects. One key below already belonged to R2-B and was reused, never overwritten. All10 keys HEAD200. Original four baseline objects retained.

| Key | Bytes | State |
| --- | ---: | --- |
| `teams/familia-nova/logo/16c6b788f67d823aef47655e54ffefedcf74f69ba9d5b7c47485c7675f058a12.webp` | 23890 | R2-C unreferenced |
| `teams/familia-nova/logo/cf11d19ef77369105bb2e9c2962ffbc502632de081753ecb68a4f7554468b87a.webp` | 17164 | R2-B baseline, reused |
| `players/1347741365/avatar/cf11d19ef77369105bb2e9c2962ffbc502632de081753ecb68a4f7554468b87a.webp` | 17164 | R2-C unreferenced |
| `players/1347741365/avatar/16c6b788f67d823aef47655e54ffefedcf74f69ba9d5b7c47485c7675f058a12.webp` | 23890 | R2-C unreferenced |
| `maps/island/cover/cf11d19ef77369105bb2e9c2962ffbc502632de081753ecb68a4f7554468b87a.webp` | 17164 | R2-C unreferenced |
| `maps/island/cover/16c6b788f67d823aef47655e54ffefedcf74f69ba9d5b7c47485c7675f058a12.webp` | 23890 | R2-C unreferenced |
| `tournaments/clash-for-glory-s2/poster/cf11d19ef77369105bb2e9c2962ffbc502632de081753ecb68a4f7554468b87a.webp` | 17164 | R2-C unreferenced |
| `tournaments/clash-for-glory-s2/poster/16c6b788f67d823aef47655e54ffefedcf74f69ba9d5b7c47485c7675f058a12.webp` | 23890 | R2-C unreferenced |
| `players/1345266890/avatar/16c6b788f67d823aef47655e54ffefedcf74f69ba9d5b7c47485c7675f058a12.webp` | 23890 | R2-C unreferenced |
| `players/1345266890/avatar/cf11d19ef77369105bb2e9c2962ffbc502632de081753ecb68a4f7554468b87a.webp` | 17164 | R2-C unreferenced |

## W–X. Deployment and production safety

Only UAT Worker deployed: version `86852bd1-dc8a-4f21-b8d4-af458a652562`, URL `https://cflesportsid-uat.cflid.workers.dev`. Bindings ASSETS, DB `cflesportsid-staging` ID `4ba57de7-5fda-4703-a956-b1936546986a`, CFL_ASSETS `cflesportsid-assets-staging`. Three compiled WASM decoders included; measured startup31ms.

Production Worker settings/deployment exactly unchanged; no R2 binding. Complete production D1 schema/ledger/tables snapshot exactly unchanged. Pages configuration and149 deployment records identical. No DNS/domain/Bulk Redirect/R2 bucket configuration operations. Canonical/sitemap/robots remain `https://cflesports.com`. R2-C objects are private and delivered via media binding; no R2 credentials/public bucket access added.

## Y–AA. Source checkpoint and limits

Changes: three jSquash dependencies/lockfile, staging admin R2 binding generator, image validators/decoders/types, allowlisted write service/endpoint, middleware POST allowlist, small AssetEditor/consumers, unit/HTTP tests and this document/fix034. Root wrangler, UAT config, migrations and production bindings unchanged. Temporary fixture route removed before build/deploy. No secrets, backups or generated artifacts added to Git.

Everything remains unstaged/uncommitted; HEAD and remote refs unchanged. No R2-D or production rollout. Production needs separately approved migration0009 and R2 binding/bucket before delivery rollout; production admin protection must remain intact. Orphan cleanup deliberately deferred. The parallel-seed fixture race is resolved; no global serialization, sleeps, retries or weakened assertions were added.
