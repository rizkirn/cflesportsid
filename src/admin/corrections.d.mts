import type { D1Database, D1PreparedStatement } from './bindings.mjs';
export interface ResultCorrectionForm {
  intent:string;confirmed:string;reason:string;result_revision:string;
  result_type:string;score1:string;score2:string;walkover_winner?:string;
}
export interface CorrectionHistoryEntry {
  created_at:string;correction_type:string;reason:string;old_state:string;new_state:string;
}
export function correctionReason(value:unknown):string;
export function auditStatement(db:D1Database,tournamentId:string,matchId:string,type:string,reason:string,oldState:unknown,newState:unknown):D1PreparedStatement;
export function clearDetailStatements(db:D1Database,matchId:string):D1PreparedStatement[];
export function readCorrectionHistory(db:D1Database,tournamentId:string,matchId:string):Promise<CorrectionHistoryEntry[]>;
export function readResultCorrectionForm(request:Request):Promise<ResultCorrectionForm>;
export function saveResultCorrection(db:D1Database,tournamentId:string,matchId:string,form:ResultCorrectionForm):Promise<void>;
