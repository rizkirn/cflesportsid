import { getCollection } from 'astro:content';
import { env } from 'cloudflare:workers';
import { readMatches } from './matches.mjs';

export async function getFrontendMatches() {
  const result = await readMatches({
    db: env.DB,
    loadJSON: () => getCollection('matches'),
    onFallback: error => console.warn('[matches] JSON fallback:', error instanceof Error ? error.message : error),
  });
  return result.matches;
}
