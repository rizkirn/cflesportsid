export const UAT = Object.freeze({hostname:'cflesportsid-uat.cflid.workers.dev',worker:'cflesportsid-uat',database:'4ba57de7-5fda-4703-a956-b1936546986a',account:'bf6ed4ccd73133871881b47ea58dae3d'});

export const PRODUCTION_PUBLIC = Object.freeze({hostname:'cflesports.com',worker:'cflesportsid',database:'efded3c4-1cf9-46a9-823e-d0f2d17c683a',account:'bf6ed4ccd73133871881b47ea58dae3d'});

export function resolvePublicMode(bindings, development, url) {
  const mode = bindings.CFL_PUBLIC_MODE ?? 'hybrid';
  if (mode === 'hybrid') return mode;
  if (bindings.CFL_PUBLIC_ENVIRONMENT === 'production') {
    if (development || mode !== 'd1' || url.protocol !== 'https:' || url.hostname !== PRODUCTION_PUBLIC.hostname || url.port ||
        bindings.CFL_PUBLIC_ACCOUNT_ID !== PRODUCTION_PUBLIC.account || bindings.CFL_PUBLIC_HOSTNAME !== PRODUCTION_PUBLIC.hostname ||
        bindings.CFL_PUBLIC_WORKER !== PRODUCTION_PUBLIC.worker || bindings.CFL_PUBLIC_DATABASE_ID !== PRODUCTION_PUBLIC.database ||
        bindings.CFL_PUBLIC_LOCAL !== undefined || bindings.cflesportsid_staging !== undefined ||
        typeof bindings.DB?.prepare !== 'function' || typeof bindings.DB?.batch !== 'function' ||
        typeof bindings.CFL_ASSETS?.get !== 'function' || typeof bindings.ASSETS?.fetch !== 'function') throw new Error('PRODUCTION_PUBLIC_MODE_REQUIRED');
    return mode;
  }
  if (bindings.CFL_PUBLIC_ACCOUNT_ID !== undefined) throw new Error('PRODUCTION_PUBLIC_MODE_REQUIRED');
  if (bindings.CFL_PUBLIC_ENVIRONMENT === 'uat') {
    if (development || url.protocol !== 'https:' || url.hostname !== UAT.hostname || url.port ||
        bindings.CFL_PUBLIC_HOSTNAME !== UAT.hostname || bindings.CFL_PUBLIC_WORKER !== UAT.worker ||
        bindings.CFL_PUBLIC_DATABASE_ID !== UAT.database || bindings.CFL_PUBLIC_LOCAL !== undefined ||
        !['shadow', 'd1'].includes(mode)) throw new Error('UAT_PUBLIC_MODE_REQUIRED');
    return mode;
  }
  if (bindings.CFL_PUBLIC_ENVIRONMENT !== undefined || bindings.CFL_PUBLIC_WORKER !== undefined || bindings.CFL_PUBLIC_HOSTNAME !== undefined) throw new Error('LOCAL_PUBLIC_MODE_REQUIRED');
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const databaseId = bindings.CFL_PUBLIC_DATABASE_ID;
  const forbidden = ['efded3c4-1cf9-46a9-823e-d0f2d17c683a', '4ba57de7-5fda-4703-a956-b1936546986a'];
  if (!development || !localHost || bindings.CFL_PUBLIC_LOCAL !== 'phase1c-disposable' ||
      typeof databaseId !== 'string' || !/^[0-9a-f-]{36}$/.test(databaseId) || forbidden.includes(databaseId) ||
      !['shadow', 'd1'].includes(mode)) throw new Error('LOCAL_PUBLIC_MODE_REQUIRED');
  return mode;
}

export function canonicalContract(value) {
  if (Array.isArray(value)) return value.map(canonicalContract);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined && value[key] !== null)
    .map(key => [key, canonicalContract(value[key])]));
  return value;
}

export function publicSitemapPaths(snapshot) {
  const routes = {teams:'teams', players:'players', maps:'maps', matches:'matches', tournaments:'tournament'};
  return [...new Set(Object.entries(routes).flatMap(([collection, route]) =>
    snapshot[collection].map(entry => `/${route}/${encodeURIComponent(entry.id)}/`)))].sort();
}

export const publicStaticSitemapPaths = Object.freeze(['/', '/bracket-generator/', '/map-randomizer/', '/maps/', '/matches/', '/players/', '/teams/', '/tournament/', '/veto/']);
export function publicSitemapResponse(snapshot, index = false) {
  const prefix = '<?xml version="1.0" encoding="UTF-8"?>';
  const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';
  const site = 'https://' + PRODUCTION_PUBLIC.hostname;
  const body = index ? '<sitemapindex xmlns="' + namespace + '"><sitemap><loc>' + site + '/sitemap-0.xml</loc></sitemap></sitemapindex>' :
    '<urlset xmlns="' + namespace + '">' + [...new Set([...publicStaticSitemapPaths, ...publicSitemapPaths(snapshot)])].sort().map(path => '<url><loc>' + site + path + '</loc></url>').join('') + '</urlset>';
  return new Response(prefix + body, {headers:{'Content-Type':'application/xml; charset=utf-8', 'Cache-Control':'no-store'}});
}
