import type { D1Database } from './bindings.mjs';
export interface Team { id: string; name: string; tag: string; region: string; }
export interface ParticipantForm { revision: string; participants: Team[]; intent: string; remove_participant?: string; team_id: string; new_name: string; new_tag: string; new_region: string; }
export interface ParticipantState { tournament: { id: string; name: string; status: string }; teams: Team[]; participants: Team[]; snapshot: string; revision: string; stage?: [string,string,string,number,string,number,string|null,number|null,number|null]; ready: boolean; locked: boolean; }
export function readParticipantState(db: D1Database, id: string | undefined): Promise<ParticipantState | null>;
export function participantForm(state: ParticipantState): ParticipantForm;
export function readParticipantForm(request: Request): Promise<ParticipantForm>;
export function validateParticipantRows(rows: Team[], state: ParticipantState): Promise<(Team & {isNew: boolean})[]>;
export function requireEditableParticipants(state: ParticipantState, revision: string): void;
export function editParticipantForm(form: ParticipantForm, state: ParticipantState): Promise<ParticipantForm>;
export function saveParticipants(db: D1Database, id: string, form: ParticipantForm): Promise<number>;
