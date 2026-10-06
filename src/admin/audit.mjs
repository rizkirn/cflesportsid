import { AdminError } from './tournaments.mjs';
const contexts = new WeakMap();
const statements = new WeakMap();
export const auditActions = Object.freeze({ CREATE_TEAM: 'team', EDIT_TEAM: 'team', CREATE_PLAYER: 'player', EDIT_PLAYER: 'player', CREATE_MAP: 'map', EDIT_MAP: 'map', CREATE_TOURNAMENT: 'tournament', EDIT_TOURNAMENT: 'tournament', SAVE_SETUP: 'tournament', COMPLETE_TOURNAMENT: 'tournament', DELETE_TEST_TOURNAMENT: 'tournament', SAVE_PARTICIPANTS: 'tournament', SAVE_ROSTER: 'tournament', MOVE_ROSTER_PLAYER: 'tournament', CONFIRM_BRACKET: 'tournament', CONFIRM_MAPS: 'tournament', SAVE_RESULT: 'match', FULL_WALKOVER: 'match', CORRECT_RESULT: 'match', SAVE_DETAILS_DRAFT: 'match', COMPLETE_DETAILS: 'match', CORRECT_DETAILS: 'match', PARTIAL_WALKOVER: 'match', UPLOAD_ASSET: 'asset', REPLACE_ASSET: 'asset', REVERT_ASSET: 'asset' });
export function bindAdminDatabase(raw, { actor, writes }) {
    if (!actor?.sub || !actor?.email || typeof writes !== 'boolean')
        throw new AdminError('Admin identity is unavailable.', 403);
    const db = new Proxy(raw, { get(target, key) { const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
    contexts.set(db, { raw, actor: Object.freeze({ sub: actor.sub, email: actor.email }), writes });
    return db;
}
export function mutationDatabase(db, action, entityId) {
    const context = contexts.get(db);
    if (!context || !context.writes)
        throw new AdminError('Admin writes are disabled.', 403);
    if (!Object.hasOwn(auditActions, action))
        throw new AdminError('Unknown audit action.', 500);
    const raw = context.raw;
    const audit = (a, id, required = true) => raw.prepare(`INSERT INTO admin_audit_log(id,actor_sub,actor_email,action,entity_type,entity_id)
 ${required ? 'VALUES(CASE WHEN changes()>0 THEN ? ELSE NULL END,?,?,?,?,?)' : 'SELECT ?,?,?,?,?,? WHERE changes()>0'}`).bind(crypto.randomUUID(), context.actor.sub, context.actor.email, a, auditActions[a], String(id));
    async function batch(items) {
        if (items.some(item => !statements.has(item))) throw new AdminError('Untrusted mutation statement.', 403);
        const writeIndex = items.findIndex(s => /^(?:INSERT|UPDATE|DELETE)\b/i.test(statements.get(s)?.sql.trim() ?? ''));
        if (writeIndex < 0)
            return raw.batch(items);
        const expanded = [], indices = [];
        for (let i = 0; i < items.length; i++) {
            indices.push(expanded.length);
            expanded.push(statements.get(items[i]).native);
            if (i === writeIndex)
                expanded.push(audit(action, typeof entityId === 'function' ? entityId() : entityId, items.length > 1));
            const meta = statements.get(items[i]);
            if (!['CREATE_TEAM', 'CREATE_PLAYER'].includes(action) && /^INSERT INTO (teams|players)\s*\(/i.test(meta?.sql.trim() ?? ''))
                expanded.push(audit(/^INSERT INTO teams/i.test(meta.sql.trim()) ? 'CREATE_TEAM' : 'CREATE_PLAYER', meta.args[0]));
        }
        try {
            const result = await raw.batch(expanded);
            if (result.some(r => !r.success))
                throw Error('Audit transaction failed');
            return indices.map(i => result[i]);
        }
        catch (error) {
            if (/admin_audit_log\.id/.test(String(error?.message)))
                throw new AdminError('Record changed. Reload before saving.', 409);
            throw error;
        }
    }
    const scoped = {
        prepare(sql) {
            const native = raw.prepare(sql);
            const isWrite = /^(?:INSERT|UPDATE|DELETE)\b/i.test(sql.trim());
            function wrap(statement, args = []) {
                const wrapped = new Proxy(statement, {
                    get(target, key) {
                        if (key === 'bind') return (...values) => wrap(target.bind(...values), values);
                        if (isWrite && ['run', 'all', 'first'].includes(key)) {
                            return async (column) => {
                                const [result] = await batch([wrapped]);
                                if (key !== 'first') return result;
                                const row = result.results?.[0] ?? null;
                                return column && row ? row[column] : row;
                            };
                        }
                        if (isWrite && key === 'raw') throw new AdminError('Unsupported mutation execution.', 403);
                        const value = target[key];
                        return typeof value === 'function' ? value.bind(target) : value;
                    },
                });
                statements.set(wrapped, { sql, args, native: statement });
                return wrapped;
            }
            return wrap(native);
        },
        batch,
    };
    contexts.set(scoped, context);
    return scoped;
}
