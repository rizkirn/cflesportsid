import type {AdminActor} from './auth.mjs';
export const auditActions:Readonly<Record<string,string>>;
export function bindAdminDatabase(db:any,context:{actor:AdminActor;writes:boolean}):any;
export function mutationDatabase(db:any,action:string,entityId:string|(()=>string)):any;
