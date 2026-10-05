type Kind = 'teams' | 'players' | 'maps' | 'tournaments';
export const assetFields: Record<Kind, string>;
export function overlayAssetReferences<T>(entries: T[], collection: Kind, rows: any[]): T[];
export function readAssetReferences<T>(db: any, entries: T[], collection: Kind): Promise<T[]>;
export function resolveAsset(collection: Exclude<Kind, 'tournaments'>, entry: any, options?: { localFiles?: Set<string> }): { reference: string | null; legacy: string; fallback: string; src: string };
export function resolveAsset(collection: 'tournaments', entry: any, options?: { localFiles?: Set<string> }): { reference: string | null; legacy: string | null; fallback: null; src: string | null };
export function thumbnailSource(src: string, fallback: string | undefined, bundled: boolean): string;
