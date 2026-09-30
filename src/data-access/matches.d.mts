import type { CollectionEntry } from 'astro:content';
type Match = CollectionEntry<'matches'>;
export interface MatchDatabase {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<{ success: boolean; results: Record<string, unknown>[] }[]>;
}
export const matchReadQueries: string[];
export function shapeD1Matches(rows: Record<string, any>[][], legacyMatches: Match[]): Match[];
export function readD1Matches(db: MatchDatabase | undefined, legacyMatches: Match[]): Promise<Match[]>;
export function readMatches(options: {
  db?: MatchDatabase;
  loadJSON: () => Promise<Match[]>;
  onFallback?: (error: unknown) => void;
}): Promise<{ source: 'd1' | 'json'; matches: Match[] }>;
