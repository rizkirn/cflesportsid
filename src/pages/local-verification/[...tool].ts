import type {APIRoute} from 'astro';

export const prerender = false;
// The guarded local middleware serves the sitemap; default requests remain 404.
export const GET: APIRoute = () => new Response(null, {status:404});
