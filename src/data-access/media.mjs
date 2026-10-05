import { validAssetKey } from '../utils/asset-keys.mjs';

export async function serveMedia(request, bucket) {
  const error = (status, message, extra = {}) => new Response(request.method === 'HEAD' ? null : message, {
    status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
  if (!['GET', 'HEAD'].includes(request.method)) return error(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  const path = new URL(request.url).pathname;
  const key = path.startsWith('/media/') ? path.slice('/media/'.length) : '';
  if (!validAssetKey(key)) return error(400, 'Invalid image key.');
  if (!bucket) return error(404, 'Image not found.');
  try {
    const object = await bucket[request.method === 'HEAD' ? 'head' : 'get'](key);
    if (!object) return error(404, 'Image not found.');
    const extension = key.split('.').at(-1);
    const mime = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[extension];
    const headers = new Headers({ 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    if (typeof object.size === 'number') headers.set('Content-Length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  } catch {
    return error(503, 'Image temporarily unavailable.');
  }
}
