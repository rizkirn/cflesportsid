# CFL Esports Indonesia

Crossfire: Legends Indonesia standings, player and team statistics, tournament brackets, maps, and a public map veto tool. Built with Astro and deployed to https://cflesportsid.pages.dev.

## Local development

Use Node.js 22 LTS and npm.

```sh
npm ci
npm run dev
```

## Verify before publishing

```sh
npm run data:check
npm test
npm run build
npm run build:check
npm run preview
```

The build creates the static site in `dist/`. Cloudflare Pages builds the site after a push; build command: `npm run build`, output directory: `dist`. Do not edit generated files in `dist/` or `.astro/`.

## Data entry

Content lives in `src/data/teams`, `players`, `matches`, `maps`, and `tournaments`. Filenames are canonical IDs; player filenames use their UID. Display names can change without changing IDs.

Statistics are calculated from completed matches. Record each player's team at match time so transfers do not rewrite historical results. See these guides instead of copying legacy profile totals:

- [Adding data and creating match drafts](docs/data-entry.md)
- [Tournament brackets](docs/tournament-data.md)
- [Calculated statistics](docs/calculated-statistics.md)
- [Map veto configuration](docs/veto.md)

Create a match draft with `npm run data:new-match`, review it, then move it into the match collection. Validate before publishing.

## SEO and assets

The production URL is configured in `astro.config.mjs`. The sitemap and robots file derive from that setting. Update it if the primary domain changes. The old `/tournament/1` URL remains available and has a canonical link to the main tournament page.

Store images in `public/` and reference them with root-relative paths. Existing images use WebP; maps without a thumbnail use the shared placeholder.

## Release status

See [Step 15 checks](docs/release-checklist.md) for verification results and remaining work.

## Local D1 parity

Run `npm run db:parity` after applying local migrations. It compares all player, team, and map statistics against the legacy JSON calculation for each tournament and overall. See [local D1 parity](docs/d1-parity.md) for setup, migration behavior, and verified results.
