import type {D1Database} from './bindings.mjs';
import type {LiveMatch} from './live-results.mjs';
import type {VetoStep,VetoAction} from '../utils/veto-engine.mjs';
export interface MapTarget {roundId?:string;matchId?:string;}
export interface MapContext {
 tournamentId:string;round:{id:string;name:string;stage_id:string;placement:number|null;team1_id?:string;team2_id?:string};matchId?:string;
 teams:{id:string;name:string;tag:string}[];scope:'round'|'match';source:'randomizer'|'veto';snapshot:string;revision:string;args:string[];locked:boolean;
 pool:{id:string;name:string}[];steps:VetoStep[];actionSeconds:number;reserveSeconds:number;assignment:string[]|null;assignmentActions:VetoAction[];confirmedAt:string|null;
}
export const officialMapsSQL:string;
export function assignmentsAvailable(db:D1Database):Promise<boolean>;
export function playedMapStatus(db:D1Database,tournamentId:string,match:Pick<LiveMatch,'id'|'round_id'|'series_type'|'map_count'>):Promise<{required:boolean;assigned:boolean;snapshot:string|null;href:string;message:string;label:string}>;
export function playedMapGuard(db:D1Database,tournamentId:string,match:Pick<LiveMatch,'id'|'round_id'|'series_type'|'map_count'>):Promise<ReturnType<D1Database['prepare']>|null>;
export function readMapContext(db:D1Database,tournamentId:string,target:MapTarget):Promise<MapContext>;
export function defaultVetoSteps(poolSize:number):VetoStep[];
export function readMapConfirmation(request:Request):Promise<Record<string,string>>;
export function confirmMaps(db:D1Database,tournamentId:string,target:MapTarget,form:Record<string,string>):Promise<string[]>;
