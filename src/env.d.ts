/// <reference types="astro/client" />
declare module 'cloudflare:workers' {
  export const env: import('./admin/bindings.mjs').AdminBindings;
}
