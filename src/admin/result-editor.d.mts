import type { D1Database } from './bindings.mjs';
export function readResultEditorForm(request: Request): Promise<Record<string,string>>;
export function saveEditedResult(db: D1Database, tournamentId: string, form: Record<string,string>): Promise<void>;
