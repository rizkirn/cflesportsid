import type {D1Database} from './bindings.mjs';
export const masterDefinitions:Record<string,{title:string;singular:string;fields:string[];labels:string[]}>;
export function masterRevision(key:string,row:Record<string,unknown>):string;
export function readMasterForm(request:Request,key:string):Promise<Record<string,string>>;
export function saveMaster(db:D1Database,key:string,id:string|null,input:Record<string,string>):Promise<string>;
