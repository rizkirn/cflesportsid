# UAT shadow diagnostic collection

The local-only module `scripts/phase2c/shadow-diagnostics.mjs` replaces the diagnostic parsing and collection logic formerly embedded in `/private/tmp/cfl-shadow-execute.mjs`. It performs no network requests, launches no processes, and changes no deployment configuration. Do not reuse the old collector for another run.

## Approved-run integration

Before any separately approved UAT shadow operation, include the generated public marker and collector source checksum in the new validation plan. The marker is a public correlation value, never an approval token or credential. Keep the existing deployment executor's target, binding, authentication, approval, freshness and concurrent-deployment guards. This module does not replace those guards.

Create a collector with the freshly verified active shadow version UUID, approved routes and `createPublicMarker()`. Attach Wrangler JSON stdout to `collector.feed(chunk)`. Capture process failures separately and abort the run on any tail failure; a live process alone does not prove successful diagnostic collection. The tail must retain the exact UAT Worker target and strict local version validation. The one-request diagnostic operation below may omit only the server-side version filter, when explicitly included in its approval plan. Never persist raw tail output, request headers, cookies, bodies or exception text.

Call `validateShadowRun({collector, sendCanary, runMatrix})`. `sendCanary` receives the exact HTTPS UAT canary URL and must perform one GET with redirects disabled, verify the expected status, and return promptly. `runMatrix` must use `collector.matrixURL(path)` for every planned request. The callback is not invoked until a correlated canary diagnostic with the exact Worker/version and a successful database comparison has been captured. The maximum configurable canary wait is 60 seconds. A timeout permanently fails this collector; no automatic retry, deployment or rollback occurs.

The same route is requested again during the matrix with a different probe phase. The canary does not satisfy matrix coverage. Allow the bounded planned tail drain inside `runMatrix` before it resolves; the wrapper then rejects missing required diagnostics. Always save the sanitized `collector.summary()` on failure. A new collector does not authorize another remote operation.

## Correlation and safe evidence

The marker is `cflshadowrun-` followed by 16 random bytes encoded as lowercase hexadecimal. Its complete ID-character substring contains non-hexadecimal lowercase letters and no uppercase letters, avoiding the documented hex/base64 TailRequest redaction heuristics. This is a defensive compatibility choice, not proof that redaction caused the prior missing Wrangler events.

Exact HTTPS hostname, single run-marker/probe parameters, approved paths, Worker name and version are checked. Wrong hosts and run markers increment rejection counters; matching-run target/version errors stop collection. Malformed events, unexpected diagnostic fields, mismatches and duplicates also stop collection. Missing diagnostics remain visible in counters and route-index coverage, and cannot produce a passing report.

Reports contain event counts, recognized diagnostic count, accepted comparison count, mismatch count, route indexes and allowlisted contract/field names. They do not contain source record values. Counts include the separate canary; `diagnosticRequests` counts matrix routes only. The collector requires a database diagnostic for every accepted event.

## Limitations

Local mocks do not establish remote tail delivery, deployed shadow execution or remote parity. The retained historical cause remains unproven. Another separately approved shadow deployment/validation is required before D1-only testing. Browser interactions and contracts not emitted by the existing reader remain outside this collector's coverage.


## Readiness-aware single-request diagnostic

`tail-session.mjs` replaces the fixed seven-second startup delay for the diagnostic runner. It creates an ephemeral session using the official Workers Scripts Tail API, opens the returned WebSocket with the installed Wrangler `trace-v1` protocol, and sends `{debug:false}`. Readiness requires the WebSocket `open` event and successful subscription-send callback. These are transport readiness signals, not a server acknowledgement of diagnostic execution; the correlated canary must still prove comparison capture. JSON-mode Wrangler provides no separate readiness message, so the adapter does not infer readiness from a process or silence.

The adapter restricts API requests to the exact UAT account/Worker and POST/create plus DELETE/cleanup of its own session. It allows only the returned `wss://tail.developers.workers.dev` host, rejects credentials, ports and redirects, and sends no API authorization header to the socket. An unexpected returned host fails closed and requires review. Session creation has an API side effect: this operation is observability-only but is not GET-only. No Worker configuration, database records or deployment are changed. No reconnect, retry or rollback is implemented. If initialization returns no usable session ID, cleanup cannot be confirmed; report that uncertainty and investigate separately.

`tail-diagnostic.mjs prepare` is entirely offline. It generates a private 0700 directory under `/private/tmp/cfl-tail-diagnostic-*`, with 0600 plan/ownership files. The plan pins the retained shadow version/deployment, staging resources through the existing validator, authentication fingerprint, Worker-level settings fingerprint, homepage baseline, source checksums, installed WebSocket library, Node runtime, public marker, single-use nonce, destination and two-hour expiration. Authentication fingerprints cannot establish the unchanged bytes of unreadable secret bindings.

The execute command requires `--approve <exact digest>` from separately recorded owner approval. It rejects environment overrides, validates explicit `wrangler.uat.jsonc`, and reads credentials using the existing read-only helper. It performs fresh GET-only target verification before creating a session, again after readiness before the one homepage request, and after successful capture. Each verification rejects split or changing deployments through the existing validator. The immutable expected version/deployment and resource/authentication fingerprints must match. A concurrent change between remote checks cannot be eliminated entirely; local event-version validation remains mandatory.

The approved diagnostic omits only the server-side scriptVersion filter. The GET filter remains; wrong Worker/version events are never accepted. After confirmed readiness and revalidation, exactly one correlated homepage GET is sent, with redirects disabled. Status, body checksum and selected headers must match the retained baseline. A 30-second readiness deadline and separate 30-second canary deadline are used; diagnostic timing begins at request dispatch. The runner has no matrix callback, deployment handler or D1 mutation API. Tail cleanup remains permitted after approval expiry or validation failure, so an expired operation cannot strand a known session.

Sanitized reports retain process/session/connection/subscription/request timestamps, first byte, byte/chunk counts, completed event count, buffered byte count, numeric close code, generic error code, cleanup status and the existing collector's allowlisted diagnostics. Raw events, WebSocket URL, response body, headers from tail events, cookies, exception text and credentials are not persisted. The approval token is a plan digest, separate from the public correlation marker.

The output directory is temporary. Preserve the sanitized report in durable private storage if long-term evidence is required; do not delete evidence automatically. A fresh plan and separate approval are required after expiry or source/runtime change. Local mocks prove lifecycle and guard behavior, not remote delivery or parity.

References:
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/tail/
- Installed Wrangler 4.144.0 `createTail` and `tail` implementations, `node_modules/wrangler/wrangler-dist/cli.js`.
