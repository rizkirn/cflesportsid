import type {APIRoute} from 'astro';
import {env} from 'cloudflare:workers';
import {AdminError} from '../../../../admin/tournaments.mjs';
import {authorizeAdmin} from '../../../../admin/auth.mjs';
import {readAssetRequest,saveAsset} from '../../../../admin/assets.mjs';
import {decodeImage} from '../../../../admin/image-decode';
export const prerender=false;
export const POST:APIRoute=async({request,params})=>{
 try{const db=(await authorizeAdmin(request,import.meta.env.DEV,env)).db;const input=await readAssetRequest(request);const result=await saveAsset(db,(env as typeof env & Partial<R2UATBindings>).CFL_ASSETS,params.category!,params.id!,input,decodeImage);return Response.json(result,{headers:{'Cache-Control':'no-store'}});}
 catch(error){return Response.json({error:error instanceof AdminError?error.message:'Could not save image. Reload and try again.'},{status:error instanceof AdminError?error.status:503,headers:{'Cache-Control':'no-store'}});}
};
