declare namespace Cloudflare {
  interface Env {
    DB?: import('./data-access/matches.mjs').MatchDatabase;
  }
}

declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}
