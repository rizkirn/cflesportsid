import { createRemoteJWKSet, jwtVerify, customFetch } from 'jose';
import { AdminError, requireLocalAdmin } from './tournaments.mjs';
import { bindAdminDatabase } from './audit.mjs';
export function createAccessVerifier(fetcher = fetch, options = {}) {
    const keys = new Map();
    return async function verify(token, { issuer, audience }) {
        let entry = keys.get(issuer);
        if (!entry) {
            if (keys.size >= 4)
                keys.delete(keys.keys().next().value);
            entry = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), { timeoutDuration: 3000, cooldownDuration: options.cooldownDuration ?? 1000, cacheMaxAge: 300000, [customFetch]: (url, init) => fetcher(url, { ...init, redirect: 'error' }) });
            keys.set(issuer, entry);
        }
        const { payload } = await jwtVerify(token, entry, { issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'nbf', 'sub', 'email', 'type'], clockTolerance: 5 });
        if (payload.type !== 'app' || typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 256 || typeof payload.email !== 'string' || !/^\S+@\S+\.\S+$/.test(payload.email) || payload.email.length > 254 || payload.common_name || payload.service_token_id || payload.service_token_status || payload.iat > Math.floor(Date.now() / 1000) + 5)
            throw new AdminError('Admin authentication required.', 403);
        return Object.freeze({ sub: payload.sub, email: payload.email });
    };
}
const verifyAccess = createAccessVerifier();
export function isAdminPath(path) { return /^\/admin(?:\/|$)/.test(path); }
export function legacyOfficialLocation(url) {
    if (!['/map-randomizer', '/veto'].includes(url.pathname.replace(/\/$/, '')) || !url.searchParams.has('adminTournament'))
        return null;
    const id = url.searchParams.get('adminTournament');
    const veto = url.pathname.replace(/\/$/, '') === '/veto';
    const target = url.searchParams.get(veto ? 'adminMatch' : 'adminRound');
    if (!/^[a-z0-9-]{1,120}$/.test(id ?? '') || !/^[a-z0-9-]{1,160}$/.test(target ?? ''))
        throw new AdminError('Official maps unavailable.', 400);
    return `/admin/tournaments/${id}/maps?${veto ? 'match' : 'round'}=${encodeURIComponent(target)}`;
}
function configuration(env) {
    const issuer = env.ADMIN_ACCESS_ISSUER, audience = env.ADMIN_ACCESS_AUD, hostname = env.ADMIN_HOSTNAME, mode = env.ADMIN_ENVIRONMENT;
    if (env.ADMIN_ENABLED !== 'true' || !['uat', 'production'].includes(mode) || typeof issuer !== 'string' || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || typeof audience !== 'string' || !/^[a-f0-9]{64}$/.test(audience) || typeof hostname !== 'string' || hostname !== hostname.toLowerCase() || !/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(hostname) || ['localhost', '127.0.0.1'].includes(hostname) || !env.DB)
        throw new AdminError('Admin is unavailable.', 403);
    if (mode === 'production' && (/\.(workers\.dev|pages\.dev)$/.test(hostname)) || mode === 'uat' && !hostname.endsWith('.workers.dev'))
        throw new AdminError('Admin is unavailable.', 403);
    return { issuer, audience, hostname };
}
export function createAdminAuthorizer(verifier = verifyAccess) {
    const pending = new WeakMap();
    return async function authorize(request, development, env) {
        if (pending.has(request))
            return pending.get(request);
        const promise = (async () => {
            if (!['GET', 'HEAD', 'POST'].includes(request.method))
                throw new AdminError('Method not allowed.', 405);
            if (development) {
                const raw = requireLocalAdmin(request, true, env);
                const actor = Object.freeze({ sub: 'local-admin', email: 'local-admin@example.invalid' });
                return { actor, writes: true, db: bindAdminDatabase(raw, { actor, writes: true }) };
            }
            const config = configuration(env), url = new URL(request.url);
            if (url.protocol !== 'https:' || url.hostname !== config.hostname || url.port)
                throw new AdminError('Admin is unavailable.', 403);
            const token = request.headers.get('Cf-Access-Jwt-Assertion');
            if (!token || token.length > 16384)
                throw new AdminError('Admin authentication required.', 403);
            let actor;
            try {
                actor = await verifier(token, config);
            }
            catch {
                throw new AdminError('Admin authentication required.', 403);
            }
            const writes = env.ADMIN_WRITES_ENABLED === 'true';
            if (request.method === 'POST' && !writes)
                throw new AdminError('Admin writes are disabled.', 403);
            return { actor, writes, db: bindAdminDatabase(env.DB, { actor, writes }) };
        })();
        pending.set(request, promise);
        return promise;
    };
}
export const authorizeAdmin = createAdminAuthorizer();
