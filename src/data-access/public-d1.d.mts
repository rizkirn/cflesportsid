import type { CollectionEntry } from 'astro:content';

export type PublicCollection = 'teams' | 'players' | 'maps' | 'tournaments' | 'matches';
export type PublicErrorCode = 'MISSING_BINDING' | 'SCHEMA_REQUIRED' | 'QUERY_FAILED' | 'INVALID_DATA' | 'INVALID_IDENTITY' | 'NOT_FOUND';
export class PublicDataError extends Error {
  constructor(code: PublicErrorCode, status?: number);
  code: PublicErrorCode;
  status: number;
}
export interface PublicDatabase {
  prepare(query: string): unknown;
  batch(statements: unknown[]): Promise<{ success: boolean; results: Record<string, unknown>[] }[]>;
}
export interface PublicRoster {
  tournamentId: string;
  teamId: string;
  playerId: string;
  uid: string | null;
  ign: string;
  position: number | null;
  orderVerified: boolean;
}
type Tournament = CollectionEntry<'tournaments'>;
export interface PublicSnapshot {
  teams: CollectionEntry<'teams'>[];
  players: CollectionEntry<'players'>[];
  maps: CollectionEntry<'maps'>[];
  tournaments: (Omit<Tournament, 'data'> & {
    data: Omit<Tournament['data'], 'stages'> & {
      stages: (Tournament['data']['stages'][number] & { mapPool: string[] })[];
    };
  })[];
  matches: CollectionEntry<'matches'>[];
  rosters: PublicRoster[];
  identitySegments: {uid:string; fromTournament:string; beforeTournaments:string[]; previous:{ign:string; team:string}}[];
  profileIdentity(uid:string, tournamentId:string):string;
  assets: Record<string, Record<string, { key: string | null; url: string | null }>>;
  get<C extends PublicCollection>(collection: C, id: string): PublicSnapshot[C][number];
  statisticsMatches(tournamentId?: string): CollectionEntry<'matches'>[];
}
export const publicColumns: Readonly<Record<string, readonly string[]>>;
export const publicFields: Readonly<Record<PublicCollection, readonly string[]>>;
export const publicReadQueries: readonly string[];
export function readPublicData(db: PublicDatabase | null | undefined): Promise<PublicSnapshot>;
export function publicErrorResponse(error: unknown): Response;
export function restorePublicStatisticsKeys<T extends {
  players: Map<string, unknown>;
  maps: Map<string, { players: Map<string, unknown> }>;
}>(statistics: T): T;
