import { defineMiddleware } from 'astro:middleware';
import { AdminError, requireLocalAdmin } from './admin/tournaments.mjs';

export const onRequest = defineMiddleware(async (context, next) => {
  if (!/^\/admin(?:\/|$)/.test(context.url.pathname)) return next();
  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'; form-action 'self'; base-uri 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
  try {
    const { env } = await import('cloudflare:workers');
    requireLocalAdmin(context.request, import.meta.env.DEV, env);
  } catch (error) {
    return new Response(error instanceof AdminError ? error.message : 'Admin is unavailable.', {
      status: error instanceof AdminError ? error.status : 503,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const path = context.url.pathname.replace(/\/$/, '');
  const canPost = path === '/admin/tournaments/new' || /^\/admin\/tournaments\/[a-z0-9-]{1,120}\/(?:setup|participants|roster|bracket|matches\/[a-z0-9-]{1,160})$/.test(path);
  const allowed = canPost ? ['GET', 'HEAD', 'POST'] : ['GET', 'HEAD'];
  if (!allowed.includes(context.request.method)) {
    return new Response('Method not allowed.', { status: 405, headers: { ...headers, Allow: allowed.join(', ') } });
  }
  const response = await next();
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
});
