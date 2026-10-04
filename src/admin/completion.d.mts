import type {D1Database} from './bindings.mjs';
export interface CompletionState {ready:boolean;issues:string[];placements:{champion:string|null;runnerUp:string|null;third:string|null};snapshot:string;revision:string;status:string;historical:boolean;teams:{id:string;name:string}[];}
export const completionSnapshotSQL:string;
export function readCompletion(db:D1Database,id:string):Promise<CompletionState|null>;
export function readCompletionForm(request:Request):Promise<Record<string,string>>;
export function completeTournament(db:D1Database,id:string,form:Record<string,string>):Promise<void>;
