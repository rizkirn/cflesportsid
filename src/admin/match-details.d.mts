import type { D1Database } from './bindings.mjs';
export interface DetailPlayer {player_id:string; kills:string; deaths:string; assists:string;}
export interface DetailMap {mode?:'played'|'walkover';winner_side?:string;map_id:string; score1:string; score2:string; mvp:string; players:DetailPlayer[];}
export interface DetailPayload {maps:DetailMap[];correction_required?:boolean;}
export interface DetailsForm {revision:string; intent:string; reason?:string; payload:DetailPayload;}
export interface DetailRoster {team_id:string; player_id:string; ign_snapshot:string; uid:string|null;}
export interface DetailState {
  assignments?:string[];assignmentSchema?:boolean;
  match:{id:string;tournament_id:string;status:string;result_type:string;winner_id:string;team1_id:string;team2_id:string;team1_name:string;team2_name:string;score1:number;score2:number;series_type:string;map_count:number;};
  rows:DetailRoster[];pool:{id:string;name:string}[];snapshot:string;revision:string;reason:string;correctable:boolean;status:string;savedRevision:number;payload:DetailPayload;
}
export function readMatchDetails(db:D1Database,tournamentId:string,matchId:string,options?:{correction?:boolean}):Promise<DetailState|null>;
export function emptyDetails(rows:DetailRoster[]):DetailPayload;
export function readDetailsForm(request:Request):Promise<DetailsForm>;
export function mapResults(payload:DetailPayload,pool:{id:string}[]):{score1:number|null;score2:number|null;side:number}[];
export function validateDetails(payload:DetailPayload,state:DetailState,complete:boolean):void;
export function saveMatchDetails(db:D1Database,tournamentId:string,matchId:string,form:DetailsForm):Promise<void>;
export function normalizeDetails(payload:DetailPayload,rows:DetailRoster[]):DetailPayload;
