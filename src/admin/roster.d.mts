import type { D1Database } from './bindings.mjs';
import type { ParticipantState } from './participants.mjs';
export interface RosterEntry { id: string; ign: string; name: string; uid: string; }
export interface RosterForm { revision: string; team_id: string; entries: RosterEntry[]; intent: string; player_id: string; new_name: string; new_ign: string; new_uid: string; remove_player?: string; move_player?: string; move_team?: string; }
export interface RosterState extends ParticipantState { players: {id:string;name:string;current_ign:string;uid:string|null;current_team_id:string|null}[]; previousRows:{team_id:string;player_id:string;ign_snapshot:string}[]; rows:[string,string,string,number,number][]; roster:{ready:boolean;teams:{id:string;count:number;ready:boolean}[]}; }
export function rosterCopySource(state:RosterState,teamId:string):{kind:'previous'|'current';entries:WorkspaceRosterEntry[]}|null;
export function readRosterState(db:D1Database,id:string|undefined):Promise<RosterState|null>;
export function rosterForm(state:RosterState,teamId:string):RosterForm;
export function readRosterForm(request:Request):Promise<RosterForm>;
export function editRosterForm(state:RosterState,form:RosterForm):RosterForm;
export function saveRoster(db:D1Database,id:string,form:RosterForm):Promise<number>;
export function moveRosterPlayer(db:D1Database,id:string,form:RosterForm):Promise<void>;
export function validateRosterRows(entries:RosterEntry[],state:RosterState,teamId:string):unknown[];
export interface WorkspaceRosterEntry extends RosterEntry { team_id: string; }
export interface WorkspaceRosterForm { revision: string; intent: string; team_id: string; player_id: string; new_name: string; new_ign: string; new_uid: string; remove_entry?: string; copy_team?: string; entries: WorkspaceRosterEntry[]; }
export function workspaceRosterForm(state: RosterState): WorkspaceRosterForm;
export function readWorkspaceRosterForm(request: Request): Promise<WorkspaceRosterForm>;
export function validateWorkspaceRoster(form: WorkspaceRosterForm,state: RosterState): unknown[];
export function editWorkspaceRoster(form: WorkspaceRosterForm,state: RosterState): WorkspaceRosterForm;
export function saveWorkspaceRoster(db: D1Database,id: string,form: WorkspaceRosterForm): Promise<number>;
