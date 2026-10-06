import { env } from 'cloudflare:workers';
import { serveMedia } from './media.mjs';

export function serveFrontendMedia(request: Request) {
  const bindings = env as typeof env & Partial<R2UATBindings>;
  return serveMedia(request, bindings.CFL_ASSETS);
}
