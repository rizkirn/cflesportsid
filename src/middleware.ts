import {publicRequest} from './data-access/frontend-public';
import {publicErrorResponse,PublicDataError} from './data-access/public-d1.mjs';
import { defineMiddleware } from 'astro:middleware';
import {AdminError} from './admin/tournaments.mjs';
import {authorizeAdmin,isAdminPath,legacyOfficialLocation} from './admin/auth.mjs';

export const onRequest = defineMiddleware(async (context, next) => {
  const officialTool = ['/map-randomizer', '/veto'].includes(context.url.pathname.replace(/\/$/, '')) && context.url.searchParams.has('adminTournament');
  if (!officialTool && !isAdminPath(context.url.pathname)) {
    if (context.isPrerendered) return next();
    const {env} = await import('cloudflare:workers');
    const bindings = env as unknown as Record<string, unknown>;
    if (!bindings.CFL_PUBLIC_MODE || bindings.CFL_PUBLIC_MODE === 'hybrid') return next();
    try {return await publicRequest(bindings,import.meta.env.DEV,context.url,next);}
    catch(error) {if(error instanceof PublicDataError || error instanceof Error && ['LOCAL_PUBLIC_MODE_REQUIRED','UAT_PUBLIC_MODE_REQUIRED','PRODUCTION_PUBLIC_MODE_REQUIRED'].includes(error.message))return publicErrorResponse(error);throw error;}
  }
  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Frame-Options': officialTool ? 'SAMEORIGIN' : 'DENY',
    'Content-Security-Policy': `frame-ancestors ${officialTool ? "'self'" : "'none'"}; form-action 'self'; base-uri 'self'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
  try {
    const { env } = await import('cloudflare:workers');
    if(officialTool){const location=legacyOfficialLocation(context.url);return new Response(null,{status:303,headers:{...headers,Location:location!}});}
    const admin=await authorizeAdmin(context.request,import.meta.env.DEV,env);
    Object.assign(context.locals,{admin});
  } catch (error) {
    return new Response(error instanceof AdminError ? error.message : 'Admin is unavailable.', {
      status: error instanceof AdminError ? error.status : 503,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const path = context.url.pathname.replace(/\/$/, '');
  const masterPaths = ['/admin/teams', '/admin/players', '/admin/maps'];
  const tournamentPaths = ['/admin/tournaments', '/admin/tournaments/new'];
  const canPost = /^\/admin\/assets\/(?:teams|players|maps|tournaments)\/[a-z0-9][a-z0-9-]{0,119}$/.test(path) || [...masterPaths, ...tournamentPaths].includes(path)
    || /^\/admin\/tournaments\/[a-z0-9-]{1,120}$/.test(path)
    || /^\/admin\/tournaments\/[a-z0-9-]{1,120}\/(?:setup|participants|roster|bracket|maps|matches\/[a-z0-9-]{1,160})$/.test(path);
  const allowed = canPost ? ['GET', 'HEAD', 'POST'] : ['GET', 'HEAD'];
  if (!allowed.includes(context.request.method)) {
    return new Response('Method not allowed.', { status: 405, headers: { ...headers, Allow: allowed.join(', ') } });
  }
  const response = await next();
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
});
