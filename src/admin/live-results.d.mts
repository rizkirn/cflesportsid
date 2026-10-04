import type { D1Database } from './bindings.mjs';
import type { BracketForm } from './bracket.mjs';
export interface LiveMatch {
  id:string; stage_id:string; round_id:string; bracket_slot:number; status:string;
  result_type:'played'|'walkover';
  team1_id:string|null; team2_id:string|null; score1:number; score2:number; winner_id:string|null;
  round_name:string; sort_order:number; series_type:string; map_count:number; detail_maps:number; detail_entries:number; detail_rounds:number; detail_status:'draft'|'complete'|null;
}
export interface LiveResults { snapshot:string; revision:string; matches:LiveMatch[]; historical:boolean; }
export const resultSnapshotSQL:string;
export function readLiveResults(db:D1Database,id:string):Promise<LiveResults>;
export function seriesWinner(score1:number,score2:number,type:string,count:number):1|2|null;
export function saveLiveResult(db:D1Database,id:string,form:BracketForm):Promise<void>;
