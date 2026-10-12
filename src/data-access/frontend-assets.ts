import { getCollection, type CollectionEntry } from 'astro:content';
import { env } from 'cloudflare:workers';
import {selectPublicCollection} from './frontend-public';
import { readAssetReferences } from '../utils/assets.mjs';

export async function getAssetCollection<K extends 'teams' | 'players' | 'maps' | 'tournaments'>(collection: K): Promise<CollectionEntry<K>[]> {
  return selectPublicCollection(collection, async () => {
    const legacy = await getCollection(collection);
    return readAssetReferences(env.DB, legacy, collection);
  });
}
