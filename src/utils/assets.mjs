import { playerContinuitySplits } from '../config/player-continuity.mjs';

export const assetFields = {
  teams: 'logo_asset_key', players: 'photo_asset_key',
  maps: 'image_asset_key', tournaments: 'poster_asset_key',
};

export function overlayAssetReferences(entries, collection, rows) {
  const field = assetFields[collection];
  const references = new Map(rows.map(row => [collection === 'players' ? row.uid : row.id, row[field] ?? null]));
  return entries.map(entry => ({ ...entry, data: { ...entry.data,
    [field]: references.get(collection === 'players' ? entry.data.uid : entry.id) ?? null,
  } }));
}

export async function readAssetReferences(db, entries, collection) {
  const field = assetFields[collection];
  try {
    const identity = collection === 'players' ? 'uid' : 'id';
    const result = await db.prepare(`SELECT ${identity}, ${field} FROM ${collection}`).all();
    if (!result.success) throw new Error('Asset reference read failed');
    return overlayAssetReferences(entries, collection, result.results);
  } catch {
    return entries;
  }
}

export function resolveAsset(collection, entry, { localFiles } = {}) {
  const data = entry?.data ?? entry ?? {};
  const id = entry?.id;
  const historical = collection === 'players' && playerContinuitySplits.some(split =>
    id === `${split.uid}--before-${split.fromTournament}`);
  const fallback = { teams: '/logos/default.webp', players: '/players/default.webp', maps: '/maps/placeholder.svg', tournaments: null }[collection];
  const reference = historical ? null : data[assetFields[collection]] ?? null;
  let legacy = historical ? fallback : collection === 'teams'
    ? data.logo || (data.tag ? `/logos/${data.tag}.webp` : fallback)
    : collection === 'players' ? data.avatar || (data.uid ? `/players/${data.uid}.webp` : fallback)
    : collection === 'maps' ? id ? `/maps/${id}.webp` : fallback
    : id ? `/tournaments/${id}.webp` : null;
  if (localFiles && legacy?.startsWith('/') && !localFiles.has(legacy)) legacy = fallback;
  // R2-A records the reference but serves only the existing local/legacy source.
  return { reference, legacy, fallback, src: legacy ?? fallback };
}

export function thumbnailSource(src, fallback, bundled) {
  const passThrough = src?.startsWith('/media/') || /^https:\/\//.test(src ?? '');
  return bundled || passThrough ? src : fallback || src;
}
