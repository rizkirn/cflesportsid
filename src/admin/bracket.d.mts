import type { D1Database } from './bindings.mjs';
import type { ParticipantState } from './participants.mjs';
import type { SharedBracket, SharedBracketOptions } from '../utils/bracket-engine.mjs';
export interface BracketState extends ParticipantState { options: SharedBracketOptions | null; roster: {ready:boolean;teams:{id:string;count:number;ready:boolean}[]}; }
export interface BracketForm { revision?: string; draw_count?: string; intent?: string; token?: string; result_revision?:string; match_id?:string; score1?:string; score2?:string; walkover_winner?:string; }
export function readBracketState(db: D1Database, id: string | undefined): Promise<BracketState | null>;
export function readBracketForm(request: Request): Promise<BracketForm>;
export function officialDraw(state: BracketState, form: BracketForm, secret: string | undefined, random?: () => number, now?: number): Promise<{draws: SharedBracket[]; token: string}>;
export function confirmOfficialBracket(db: D1Database, id: string, form: BracketForm, secret: string | undefined, now?: number): Promise<SharedBracket>;
