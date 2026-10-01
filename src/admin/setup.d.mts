import type { D1Database } from './bindings.mjs';
export interface RoundForm { id: string; name: string; sort_order: string; placement: string; }
export interface SetupForm {
  stage_id: string; stage_name: string; format: string; bracket_size: string; series_type: string;
  map_count: string; final_map_rule: string; action_seconds: string; reserve_seconds: string;
  rounds: RoundForm[]; revision: string; bronze_match?: string; intent?: string; remove_round?: string;
}
export interface Setup {
  tournament: { id: string; name: string; status: string }; revision: string; snapshot: string; locked: boolean;
  state: { stages: [string, string, string, number, string, number, string | null, number | null, number | null][];
    rounds: [string, string, string, number, number | null][]; status: string; matches: number; byes: number; participants: string[] };
}
export const cfgTemplate: Omit<SetupForm, 'revision'>;
export const setupSnapshotSQL: string;
export function eliminationRounds(size: string | number, bronze?: boolean): RoundForm[];
export function readSetup(db: D1Database, tournamentId: string | undefined): Promise<Setup | null>;
export function setupForm(setup: Setup, useTemplate?: boolean): SetupForm;
export function readSetupForm(request: Request): Promise<SetupForm>;
export function validateSetup(input: SetupForm): { id: string; name: string; format: string; bracket_size: number;
  series_type: string; map_count: number; final_map_rule: string; action_seconds: number; reserve_seconds: number;
  rounds: { id: string; name: string; sort_order: number; placement: number | null }[] };
export function saveSetup(db: D1Database, tournamentId: string, input: SetupForm): Promise<string>;
export function readParticipants(db: D1Database, tournamentId: string): Promise<{ id: string; name: string; tag: string }[]>;
