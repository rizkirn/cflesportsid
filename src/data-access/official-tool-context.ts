import {legacyOfficialLocation} from '../admin/auth.mjs';
export function officialToolRedirect(request:Request){
 const location=legacyOfficialLocation(new URL(request.url));
 return location?new Response(null,{status:303,headers:{Location:location,'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}}):null;
}
