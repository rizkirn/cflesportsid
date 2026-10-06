export interface AdminActor {sub:string;email:string;}
export interface AdminAuthBindings {ADMIN_ENVIRONMENT?:'uat'|'production';ADMIN_ENABLED?:string;ADMIN_WRITES_ENABLED?:string;ADMIN_ACCESS_ISSUER?:string;ADMIN_ACCESS_AUD?:string;ADMIN_HOSTNAME?:string;ADMIN_DRAW_KEY?:string;DB?:any;cflesportsid_staging?:any;}
export function authorizeAdmin(request:Request,development:boolean,env:AdminAuthBindings):Promise<{actor:AdminActor;writes:boolean;db:any}>;
export function isAdminPath(path:string):boolean;
export function legacyOfficialLocation(url:URL):string|null;
export function createAccessVerifier(fetcher?:typeof fetch,options?:{cooldownDuration?:number}):(token:string,config:{issuer:string;audience:string})=>Promise<AdminActor>;

export function createAdminAuthorizer(verifier?:ReturnType<typeof createAccessVerifier>):typeof authorizeAdmin;
