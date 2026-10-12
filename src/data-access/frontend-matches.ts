import { getCollection } from 'astro:content';
import { env } from 'cloudflare:workers';
import {selectPublicCollection} from './frontend-public';
import { readMatches } from './matches.mjs';

export async function getFrontendMatches() {
  return selectPublicCollection('matches', async () => {
  const result = await readMatches({
    db: env.DB,
    loadJSON: () => getCollection('matches'),
    onFallback: error => console.warn('[matches] JSON fallback:', error instanceof Error ? error.message : error),
  });
  return result.matches;
  });
}
