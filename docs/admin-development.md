# Tournament admin development

Run `node scripts/admin-dev.mjs` from the repository root, then open
`http://127.0.0.1:4321/admin`. This connects to **remote cflesportsid-staging**.
Cloudflare credentials must already be available to Wrangler.

The launcher reads the existing local `wrangler.jsonc` and writes an ignored
`.generated/admin-dev.json`. It requires the `cflesportsid_staging` binding to
name `cflesportsid-staging`. Both bindings in the generated development config
point to staging, including the public read binding. It never edits the user's
configuration and never binds production. Inspect the generated config before
starting if changing database bindings.

For offline verification use `node scripts/admin-dev.mjs --local`. Initialize
that local simulation with:

```sh
npx wrangler d1 migrations apply cflesportsid-staging --config .generated/admin-dev.json --local --persist-to .wrangler/state
```

The remote staging database must already have the repository's migrations.
No migrations, seeds, or test records are written remotely by tests.

## Boundary

All `/admin` routes require Astro development mode, a loopback request host,
and the explicit staging binding. The launcher binds the server to `127.0.0.1`.
Forwarded client addresses and mismatching forwarded hosts are rejected. Astro's
internal proxy sends a matching forwarded host, which is accepted. Do not expose this development server through
a tunnel, reverse proxy, or LAN listener. Host checks alone are not authentication;
the loopback-only listener and development-only compilation are part of the boundary.
Builds and deployed previews reject admin access even on localhost. No public
write API or custom password login is provided.

POST creation additionally requires a matching Origin and same-origin browser
request metadata, URL-encoded data, and a body no larger than 4 KiB. SQL uses bound
parameters. Remote admin access must wait for an identity boundary such as
Cloudflare Access with server-verified tokens; enabling it by removing the local
checks is unsafe.

Run `node scripts/admin-types.mjs` after binding changes to regenerate the scoped
Cloudflare types. They live in a module so Workers DOM types do not replace browser DOM types.

## First workflow

`/admin` reads tournament records directly from staging without a JSON fallback.
`/admin/tournaments/new` asks for the name and both confirmed dates because the
existing schema requires non-null dates. It never supplies S3 dates.

Creation sets game `crossfire-legends`, region `ID`, status `upcoming`, format
`single-elimination`, and winner `NULL` on the server. Names produce stable slugs;
names with no ASCII slug produce a deterministic digest ID. Slug collisions return
409 without overwriting a record. Successful creation redirects with 303 to
`/admin/tournaments/{id}/setup`, which opens the setup form.

With JavaScript, a valid submission announces that the record is being saved,
disables the submit button, and prevents repeat submit events. Server errors and
history navigation restore a usable form. Native HTML validation runs before
this enhancement; without JavaScript, the normal POST form still works.

## Verification

Run `npm test`, `npm run data:check`, and `npm run build`. For HTTP verification,
start the offline launcher, apply local migrations as above, then run:

```sh
ADMIN_TEST_URL=http://127.0.0.1:4321 ADMIN_TEST_LOCAL=1 node tests/admin-pages.integration.mjs
```

This test creates clearly named verification records in the offline database.
Never point it at a remote staging session. The historical frontend parity suite
uses commit `a91700d` and predates the committed S&D Economy changes in
`map-randomizer` and `veto`. For this change those two temporary baseline pages
were refreshed from pristine commit `cdb6c18`; no repository data or baseline
test source was altered.

## Tournament Setup v1

The setup form starts with the editable Clash for Glory preset: Playoffs,
single elimination, 16 slots, fixed three maps, random final map, action 20 seconds,
reserve 90 seconds, and Top 16 / Quarter Final / Semi Final / Bronze Match (3) /
Final (1). Existing saved values load by default. Applying the preset changes only
the form until Save & Continue is pressed.

Stage and round names, bracket size, map count, timers, round order, and placement
are editable. Version 1 supports the existing single-elimination / fixed-maps /
random modes. Brackets must be powers of two, map counts odd, and progression
rounds must match the bracket depth. Final is last; optional Bronze immediately
precedes it. Round IDs remain stable when names change. Add/remove buttons post
only form edits, work without JavaScript, and never write to D1.

Saving writes one stage and its rounds in a single D1 transaction, then redirects
with 303 to `/admin/tournaments/{id}/participants`. This destination displays saved
setup and any existing registered teams; participant selection and bracket
generation remain outside this scope. Map pools, veto steps, and S&D/Economy
rulesets are not edited here.

Setup posts use the same local-only staging boundary, exact Origin checking,
strict form fields, and a 16 KiB body limit. Existing stage IDs cannot change.
Started tournaments, setups with matches/byes, and multiple-stage tournaments are
read-only. Snapshot revisions reject stale tabs; a transaction-level snapshot
constraint also prevents races between validation and writing. Failed writes
roll back stage and round changes together. Existing stage map pools and veto
steps are preserved.
