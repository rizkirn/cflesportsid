// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { readdirSync } from 'node:fs';
import { playerContinuitySplits } from './src/config/player-continuity.mjs';
import { historicalPlayerKey } from './src/utils/player-continuity.mjs';

const productionD1 = process.env.CFL_PUBLIC_BUILD_TARGET === 'production-d1';
const site = 'https://cflesports.com';
const detailPages = productionD1 ? [] : [['matches', 'matches'], ['teams', 'teams'], ['players', 'players'], ['maps', 'maps'], ['tournaments', 'tournament']]
  .flatMap(([collection, route]) => readdirSync(new URL(`./src/data/${collection}/`, import.meta.url))
    .filter(file => file.endsWith('.json'))
    .map(file => `${site}/${route}/${file.slice(0, -5)}/`));

export default defineConfig({
  site,
  adapter: cloudflare({ imageService: 'passthrough', prerenderEnvironment: 'node',
    ...(process.env.CFL_ADMIN_CONFIG ? { configPath: process.env.CFL_ADMIN_CONFIG } : {}),
  }),
  session: false,
  prefetch: true,
  integrations: productionD1 ? [] : [sitemap({ customPages: [...detailPages, ...playerContinuitySplits.map(split => `${site}/players/${historicalPlayerKey(split)}/`)], filter: url => !new URL(url).pathname.startsWith('/admin') })],
});
