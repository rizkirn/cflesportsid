// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { readdirSync } from 'node:fs';

const site = 'https://cflesportsid.pages.dev';
const detailPages = [['matches', 'matches'], ['teams', 'teams'], ['players', 'players'], ['maps', 'maps'], ['tournaments', 'tournament']]
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
  integrations: [sitemap({ customPages: detailPages, filter: url => !new URL(url).pathname.startsWith('/admin') })],
});
