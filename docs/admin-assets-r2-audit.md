# Admin image assets: audit and setup boundary

Audit date: 2026-10-04. Source checkout: cflesportsid-development,
feature/d1-backend. No R2 bucket, binding, upload, migration or production resource
was changed. The accepted admin visual system remains in use.

## What exists

Astro renders through the Cloudflare adapter with passthrough images. The root
configuration contains ASSETS and two D1 bindings, with DB preview overrides for
staging. It contains no R2 binding. The admin launcher generates a development
configuration containing only approved staging D1 bindings and the draw key.
Adding R2 to root config alone would not make uploads work in that launcher.

Current schema from migration 0001 and local D1:

| Entity | Existing reference | Current public resolution |
| --- | --- | --- |
| Team | teams.logo | Legacy JSON logo or `/logos/{tag}.webp`; fallback `/logos/default.webp`. D1 frontend helper currently supplements new IDs rather than replacing legacy IDs. |
| Player | players.avatar | Public player pages read JSON; avatar or `/players/{uid}.webp`, default `/players/default.webp`. D1 avatar changes are not currently overlaid on legacy public records. |
| Map | maps.thumbnail | Public pages use `/maps/{id}.webp`, fallback `/maps/placeholder.svg`; public tools use legacy collection images. Admin tools use D1 map identity/context. |
| Tournament | No poster column | Public list uses an S1/S2 poster mapping to `/tournaments/{id}.webp`; other tournaments have no poster. |

Master CRUD currently accepts manual team logo and map thumbnail paths/HTTPS URLs;
it does not implement file uploads or player photos. Existing stored references
and files must be retained. Runtime `/public` writes and binary/base64 D1 storage
are unsuitable and were not implemented.

## Account and remote audit

The active Wrangler OAuth account is bf6ed4ccd73133871881b47ea58dae3d.
The read-only bucket-list request returned code 10042: enable R2 in Dashboard.
The read-only query to the specifically approved staging D1 ID returned code 7403:
the account is invalid or unauthorized for that database. Therefore R2 is not
enabled on the currently selected CLI account, and this audit cannot establish
that it is the account owning the project's staging resources. Confirm the owning
account before enabling R2. No authentication was changed by Work.

Previously verified staging history was 0001 through 0008, S1 85 registered
players and S2 83/13 teams, including FNOV 6 and PAMAN 6. A fresh remote check is
blocked by current account access; these prior counts are not presented as a new
successful remote verification. Local fixtures use the actual migration files.

## Proposed shared architecture

One shared pipeline for team-logo, player-photo, map-image, tournament-poster:

Admin file picker and unsaved preview → existing local-admin/origin checks →
bounded multipart validation → R2 put with generated key → conditional D1 update
→ shared asset resolver. Stored image references are independent of rosters,
match statistics and map assignments.

Use a private R2 bucket served through a read-only Worker `/media/...` endpoint.
No public bucket switch, custom domain or S3 credentials are needed for that
design. The endpoint validates category/key, returns image content type and
nosniff headers, and supports immutable caching for unique object names. Admin
upload/delete endpoints retain requireLocalAdmin and same-origin restrictions;
no upload capability is exposed in production.

Use separate staging and production buckets. Proposed staging bucket:
`cflesportsid-assets-staging`, binding `CFL_ASSETS`. Reserve production name
`cflesportsid-assets` for a separate later authorization; do not create/bind it now.
The current staging-only development launcher must copy the approved staging R2
binding and set remote true for remote admin development, false for isolated tests.
Keep production assets untouched during this setup.

## Smallest schema decision

Prefer four nullable entity-level key columns over a generic media table. Each
entity has exactly one relevant image; existing legacy fields stay available for
fallback. Object MIME/size/hash metadata belongs to R2 metadata. No media-manager
or polymorphic foreign keys are needed.

Proposed next migration, only after setup is authorized and remote state checked:

```sql
ALTER TABLE teams ADD COLUMN logo_asset_key TEXT;
ALTER TABLE players ADD COLUMN photo_asset_key TEXT;
ALTER TABLE maps ADD COLUMN image_asset_key TEXT;
ALTER TABLE tournaments ADD COLUMN poster_asset_key TEXT;
```

No migration file was added or applied in this pass. Tournament completion uses
existing status/winner_team_id and needs no schema change. Existing migrations
must remain byte-for-byte unchanged.

The resolver will prefer a validated asset key, otherwise preserve the current
legacy reference/path/default. Public JSON records need D1 asset-key overlays for
existing IDs; they cannot rely on the current new-ID-only merge. Player/map
collection consumers and shared tool image resolution also need that overlay.
Do not mass-migrate files or change historical identity/statistics. Missing
columns or unavailable D1 should fall back to the existing public behavior.

## Required user setup

1. Sign into the Cloudflare account that owns D1
   `4ba57de7-5fda-4703-a956-b1936546986a`. Refresh Wrangler authentication to that
   account if necessary; the login dialog belongs to the user.
2. In that account Dashboard, open Storage & Databases → R2 Object Storage and
   complete its enablement. Review any billing/terms yourself.
3. Create only the staging bucket via Dashboard → R2 → Create bucket, name
   `cflesportsid-assets-staging`, or run from this checkout:

   ```sh
   npx wrangler r2 bucket create cflesportsid-assets-staging
   npx wrangler r2 bucket list
   ```

4. Explicitly authorize the configuration change required for the binding. For
   staging-only preparation, add a named staging R2 configuration to wrangler.jsonc:

   ```json
   {
     "env": {
       "staging": {
         "r2_buckets": [
           { "binding": "CFL_ASSETS", "bucket_name": "cflesportsid-assets-staging" }
         ]
       }
     }
   }
   ```

   Merge this into existing config rather than replacing other fields. The admin
   launcher must explicitly copy `env.staging.r2_buckets` into its generated local
   configuration. This keeps staging R2 out of the default production runtime.
   Named environments do not inherit D1/R2 arrays; do not deploy this environment
   or run migrations with it until its approved staging D1 binding is present.
   A later production cutover must bind its separate production bucket, with the
   staging bucket under preview config. No deployment is needed for local admin.
   This pass deliberately did not edit wrangler.jsonc or create another config.

5. Work can then implement the launcher passthrough, generated binding types,
   shared image validation/upload/resolver, CRUD previews, asset-key migration,
   and staging-only migration/upload tests. Verify the approved D1 identity and
   current migrations before applying the new migration. Never use the production
   D1 ID for those commands. Exact migration command will be supplied with the
   final new migration after setup, rather than applied speculatively.

## Security and failure safety to implement after setup

Picker accepts .jpg/.jpeg/.png/.webp; client rejects >5 MB and previews with an
object URL while the persisted image remains active. Server independently bounds
body/file size, validates extension, MIME and actual JPEG/PNG/WebP structure and
signature, rejects spoofed/unsupported files, and never trusts an original filename
as a path. Generated category/entity/UUID keys prevent traversal and unrelated
overwrites. Metadata/reference updates use revision checks.

Validate → put a new object → conditional D1 reference update → optional old-object
cleanup only after success. Failed upload/D1 update preserves the prior active
reference; an orphan is safer than deletion of an active object. Remove uses Save
or explicit confirmation, then falls back to legacy/default/no poster. Preview
uses contain for square logos and varying posters, landscape for maps. These
behaviors and JPEG/PNG/WebP, spoofing, size and replacement tests remain deferred;
no fake picker or nonpersistent upload system was added.

References checked against installed Wrangler 4.144.0 schema and official docs:
[bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/),
[Workers binding access](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/).
