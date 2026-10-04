export class AdminError extends Error { constructor(message: string, status?: number); status: number; }
export interface TournamentInput { name: string; start_date: string; end_date: string; }
export interface Tournament extends TournamentInput {
  id: string; game: string; region: string; status: 'upcoming' | 'ongoing' | 'completed';
  format: string; winner_team_id: string | null;
  is_test?: number;
}
export function requireLocalAdmin(request: Request, development: boolean, env: Partial<AdminBindings>): D1Database;
export function readCreateForm(request: Request): Promise<Record<string, string>>;
export function readAdminForm(request: Request, options: { maxBytes?: number; allowedField: (key: string) => boolean }): Promise<Record<string, string>>;
export function validateTournament(input: Record<string, unknown>): TournamentInput;
export function tournamentId(name: string): Promise<string>;
export function createTournament(db: D1Database, input: Record<string, unknown>): Promise<string>;
export function createTournamentWithSetup(db:D1Database,input:Record<string,string>):Promise<string>;
export function listTournaments(db: D1Database): Promise<Tournament[]>;
export function getTournament(db: D1Database, id: string | undefined): Promise<Tournament | null>;
import type { AdminBindings, D1Database } from './bindings.mjs';
export function testLifecycleAvailable(db: D1Database): Promise<boolean>;
export function deleteTestTournament(db: D1Database, id: string, form: Record<string,string>): Promise<void>;
export function metadataRevision(tournament: Tournament): string;
export function saveTournamentMetadata(db: D1Database,id: string,form: Record<string,string>): Promise<void>;
