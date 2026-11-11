import { env } from 'cloudflare:workers';
import type { CollectionEntry } from 'astro:content';
import { selectPublicCollection } from './frontend-public';
import { readPublicData, type PublicSnapshot } from './public-d1.mjs';
import { getOverallStandings } from '../utils/standings';

export async function getFrontendStandings() {
  let snapshot: Promise<PublicSnapshot> | undefined;
  const readSnapshot = () => snapshot ??= readPublicData(env.DB);
  const [teams, matches, tournaments] = await Promise.all([
    selectPublicCollection('teams', async () => (await readSnapshot()).teams as CollectionEntry<'teams'>[]),
    selectPublicCollection('matches', async () => (await readSnapshot()).matches as CollectionEntry<'matches'>[]),
    selectPublicCollection('tournaments', async () => (await readSnapshot()).tournaments as CollectionEntry<'tournaments'>[]),
  ]);
  return getOverallStandings(teams, matches, tournaments);
}
