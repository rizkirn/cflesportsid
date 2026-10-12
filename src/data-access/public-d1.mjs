import { assetMediaPath } from '../utils/asset-keys.mjs';
export class PublicDataError extends Error {
    constructor(code, status = 503) { super({ MISSING_BINDING: 'Public database unavailable.', SCHEMA_REQUIRED: 'Public database schema unavailable.', QUERY_FAILED: 'Public database read failed.', INVALID_DATA: 'Public database data is invalid.', INVALID_IDENTITY: 'Historical identity is invalid.', NOT_FOUND: 'Public entity not found.' }[code]); this.name = 'PublicDataError'; this.code = code; this.status = status; }
}
export function publicErrorResponse(error) { const e = error instanceof PublicDataError ? error : new PublicDataError('QUERY_FAILED'); return new Response(JSON.stringify({ error: e.code, message: e.message }), { status: e.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
const links = `WITH team_links_a AS (
 SELECT team_id,tournament_id FROM tournament_teams UNION SELECT team1_id,tournament_id FROM matches UNION SELECT team2_id,tournament_id FROM matches
), team_links_b AS (
 SELECT team_id,tournament_id FROM tournament_rosters UNION SELECT team_id,tournament_id FROM team_penalties
 UNION SELECT e.team_id,m.tournament_id FROM player_match_entries e JOIN matches m ON m.id=e.match_id
), team_links_c(team_id,tournament_id) AS (
 SELECT winner_id,tournament_id FROM matches
 UNION SELECT a.winner_team_id,m.tournament_id FROM match_maps a JOIN matches m ON m.id=a.match_id
 UNION SELECT a.winner_team_id,m.tournament_id FROM match_map_walkovers a JOIN matches m ON m.id=a.match_id
), team_links AS (
 SELECT * FROM team_links_a UNION SELECT * FROM team_links_b UNION SELECT * FROM team_links_c
), player_links AS (
 SELECT player_id,tournament_id FROM tournament_rosters UNION SELECT e.player_id,m.tournament_id FROM player_match_entries e JOIN matches m ON m.id=e.match_id
 UNION SELECT a.mvp_player_id,m.tournament_id FROM match_maps a JOIN matches m ON m.id=a.match_id
), map_links_a AS (
 SELECT map_id,tournament_id FROM stage_map_pool UNION SELECT a.map_id,m.tournament_id FROM match_maps a JOIN matches m ON m.id=a.match_id
), map_links_b AS (
 SELECT a.map_id,m.tournament_id FROM match_map_walkovers a JOIN matches m ON m.id=a.match_id
 UNION SELECT j.value,a.tournament_id FROM official_map_assignments a,json_each(a.maps) j
), map_links AS (
 SELECT * FROM map_links_a UNION SELECT * FROM map_links_b
), visible_teams AS (
 SELECT x.id FROM teams x WHERE NOT EXISTS(SELECT 1 FROM team_links l WHERE l.team_id=x.id)
 OR EXISTS(SELECT 1 FROM team_links l JOIN tournaments t ON t.id=l.tournament_id WHERE l.team_id=x.id AND t.is_test=0)
), visible_players AS (
 SELECT x.id FROM players x WHERE
 (NOT EXISTS(SELECT 1 FROM player_links l WHERE l.player_id=x.id) AND (x.current_team_id IS NULL OR x.current_team_id IN(SELECT id FROM visible_teams)))
 OR EXISTS(SELECT 1 FROM player_links l JOIN tournaments t ON t.id=l.tournament_id WHERE l.player_id=x.id AND t.is_test=0)
), visible_maps AS (
 SELECT x.id FROM maps x WHERE NOT EXISTS(SELECT 1 FROM map_links l WHERE l.map_id=x.id)
 OR EXISTS(SELECT 1 FROM map_links l JOIN tournaments t ON t.id=l.tournament_id WHERE l.map_id=x.id AND t.is_test=0)
)`;
export const publicColumns = Object.freeze({
    teams: ['id', 'name', 'tag', 'region', 'color', 'logo', 'founded', 'description', 'logo_asset_key'],
    players: ['id', 'uid', 'name', 'current_ign', 'current_team_id', 'role', 'status', 'avatar', 'country', 'bio', 'discord', 'twitter', 'youtube', 'twitch', 'photo_asset_key'],
    maps: ['id', 'name', 'game', 'active', 'thumbnail', 'image_asset_key'],
    tournaments: ['id', 'name', 'game', 'region', 'start_date', 'end_date', 'status', 'format', 'winner_team_id', 'poster_asset_key'],
    tournament_stages: ['tournament_id', 'id', 'name', 'format', 'bracket_size', 'series_type', 'map_count', 'final_map_rule', 'action_seconds', 'reserve_seconds'],
    tournament_rounds: ['tournament_id', 'stage_id', 'id', 'name', 'sort_order', 'placement'],
    tournament_teams: ['tournament_id', 'team_id'], tournament_byes: ['tournament_id', 'stage_id', 'id', 'round_id', 'slot', 'team_id'],
    stage_map_pool: ['tournament_id', 'stage_id', 'map_id', 'sort_order'], veto_steps: ['tournament_id', 'stage_id', 'step_order', 'team_side', 'action'],
    team_penalties: ['tournament_id', 'team_id', 'points', 'reason'],
    tournament_rosters: ['tournament_id', 'team_id', 'player_id', 'ign_snapshot', 'position'],
    matches: ['id', 'tournament_id', 'stage_id', 'round_id', 'bracket_slot', 'date', 'status', 'team1_id', 'team2_id', 'score1', 'score2', 'winner_id', 'duration', 'result_type'],
    match_maps: ['match_id', 'map_number', 'map_id', 'winner_team_id', 'score_team1', 'score_team2', 'mvp_player_id', 'result_note'],
    match_map_walkovers: ['match_id', 'map_number', 'map_id', 'winner_team_id'], match_sources: ['match_id', 'side', 'source_type', 'source_match_id', 'source_bye_id'],
    player_match_entries: ['match_id', 'entry_index', 'player_id', 'team_id', 'uid_snapshot', 'ign_snapshot'], player_round_stats: ['match_id', 'entry_index', 'round_index', 'map_number', 'kills', 'deaths', 'assists'],
    player_identity_segments: ['id', 'player_id', 'uid_snapshot', 'boundary_tournament_id', 'ign_snapshot', 'team_id'], player_identity_tournaments: ['player_id', 'tournament_id', 'segment_id'],
});
export const publicFields = Object.freeze({
    teams: ['name', 'tag', 'region', 'color', 'logo', 'founded', 'description', 'logo_asset_key', 'players', 'penalties', 'placementPoints', 'stats'],
    players: ['name', 'ign', 'uid', 'team', 'role', 'status', 'avatar', 'country', 'bio', 'socials', 'photo_asset_key', 'stats'],
    maps: ['name', 'game', 'active', 'thumbnail', 'image_asset_key'],
    tournaments: ['name', 'game', 'region', 'startDate', 'endDate', 'status', 'format', 'winner', 'poster_asset_key', 'teams', 'stages'],
    matches: ['tournamentId', 'stageId', 'roundId', 'bracketSlot', 'date', 'status', 'team1Id', 'team2Id', 'score1', 'score2', 'winnerId', 'duration', 'resultType', 'team1Source', 'team2Source', 'roundDetails', 'playerStats', 'stats1', 'stats2'],
});
const clean = (row, keys) => Object.fromEntries(keys.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
const entry = (collection, id, data) => ({ id, collection, data: clean(data, publicFields[collection]) });
const optional = (row, pairs) => Object.fromEntries(pairs.filter(([column]) => row[column] !== null && row[column] !== undefined).map(([column, key]) => [key, row[column]]));
const group = (rows, key) => { const map = new Map(); for (const row of rows) {
    const id = key(row);
    if (!map.has(id))
        map.set(id, []);
    map.get(id).push(row);
} return map; };
function requireValue(condition, code = 'INVALID_DATA') { if (!condition)
    throw new PublicDataError(code, 500); }
const definitions = Object.entries(publicColumns).map(([table, columns]) => {
    let where = '', order = '';
    if (table === 'teams')
        where = 'x.id IN(SELECT id FROM visible_teams)';
    else if (table === 'players')
        where = 'x.id IN(SELECT id FROM visible_players)';
    else if (table === 'maps')
        where = 'x.id IN(SELECT id FROM visible_maps)';
    else if (table === 'tournaments')
        where = 'x.is_test=0';
    else if (table === 'player_identity_segments')
        where = 'x.player_id IN(SELECT id FROM visible_players) AND x.boundary_tournament_id IN(SELECT id FROM tournaments WHERE is_test=0)';
    else if (table === 'player_identity_tournaments')
        where = 'x.tournament_id IN(SELECT id FROM tournaments WHERE is_test=0) AND x.segment_id IN(SELECT id FROM player_identity_segments WHERE boundary_tournament_id IN(SELECT id FROM tournaments WHERE is_test=0))';
    else if (columns.includes('tournament_id'))
        where = 'x.tournament_id IN(SELECT id FROM tournaments WHERE is_test=0)';
    else
        where = 'x.match_id IN(SELECT m.id FROM matches m JOIN tournaments t ON t.id=m.tournament_id WHERE t.is_test=0)';
    if (table === 'tournament_rosters')
        order = 'x.tournament_id,x.team_id,x.position IS NULL,x.position,x.player_id';
    else if (table === 'player_round_stats')
        order = 'x.match_id,x.entry_index,x.round_index';
    else if (table === 'player_match_entries')
        order = 'x.match_id,x.entry_index';
    else if (table === 'stage_map_pool')
        order = 'x.tournament_id,x.stage_id,x.sort_order';
    else if (table === 'veto_steps')
        order = 'x.tournament_id,x.stage_id,x.step_order';
    else if (table === 'tournament_rounds')
        order = 'x.tournament_id,x.stage_id,x.sort_order,COALESCE(x.placement,0),x.id';
    else
        order = columns.map(c => 'x.' + c).filter(c => c.endsWith('.id')).join(',') || '1';
    return { table, sql: `${links} SELECT ${columns.map(c => 'x.' + c).join(',')} FROM ${table} x WHERE ${where} ORDER BY ${order}` };
});
export const publicReadQueries = Object.freeze(definitions.map(d => d.sql));
export async function readPublicData(db) {
    if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function')
        throw new PublicDataError('MISSING_BINDING');
    const schemaColumns = { ...publicColumns, official_map_assignments: ['tournament_id', 'maps'] };
    const names = Object.keys(schemaColumns);
    let schema;
    try {
        schema = await db.batch(names.map(name => db.prepare(`PRAGMA table_info(${name})`)));
    }
    catch {
        throw new PublicDataError('QUERY_FAILED');
    }
    if (!Array.isArray(schema) || schema.length !== names.length || schema.some(r => r.success !== true || !Array.isArray(r.results)))
        throw new PublicDataError('QUERY_FAILED');
    for (let i = 0; i < names.length; i++) {
        const fields = new Set(schema[i].results.map(c => c.name));
        const required = [...schemaColumns[names[i]], ...(names[i] === 'tournaments' ? ['is_test'] : [])];
        if (required.some(c => !fields.has(c)))
            throw new PublicDataError('SCHEMA_REQUIRED');
    }
    let result;
    try {
        result = await db.batch(publicReadQueries.map(query => db.prepare(query)));
    }
    catch {
        throw new PublicDataError('QUERY_FAILED');
    }
    if (!Array.isArray(result) || result.length !== definitions.length || result.some(r => r.success !== true || !Array.isArray(r.results)))
        throw new PublicDataError('QUERY_FAILED');
    try {
        return projectPublicData(Object.fromEntries(definitions.map((d, i) => [d.table, result[i].results.map(r => clean(r, publicColumns[d.table]))])));
    }
    catch (error) {
        if (error instanceof PublicDataError)
            throw error;
        throw new PublicDataError('INVALID_DATA', 500);
    }
}
function projectPublicData(rows) {
    const playersByPK = new Map(rows.players.map(p => [p.id, p])), teamsByID = new Map(rows.teams.map(t => [t.id, t])), mapsByID = new Map(rows.maps.map(m => [m.id, m]));
    const publicId = p => p.uid ?? p.id;
    const tournamentIDs = new Set(rows.tournaments.map(t => t.id));
    const segments = new Map(rows.player_identity_segments.map(s => [s.id, s]));
    const identities = new Map();
    const tournamentByID = new Map(rows.tournaments.map(t => [t.id, t]));
    for (const s of segments.values())
        requireValue(playersByPK.has(s.player_id) && teamsByID.has(s.team_id) && tournamentIDs.has(s.boundary_tournament_id) && s.id === `${s.uid_snapshot}--before-${s.boundary_tournament_id}` && typeof s.ign_snapshot === 'string' && s.ign_snapshot.trim(), 'INVALID_IDENTITY');
    for (const mapping of rows.player_identity_tournaments) {
        const s = segments.get(mapping.segment_id);
        requireValue(s && s.player_id === mapping.player_id && tournamentIDs.has(mapping.tournament_id) && tournamentByID.get(mapping.tournament_id).start_date < tournamentByID.get(s.boundary_tournament_id).start_date, 'INVALID_IDENTITY');
        const key = JSON.stringify([mapping.player_id, mapping.tournament_id]);
        requireValue(!identities.has(key), 'INVALID_IDENTITY');
        identities.set(key, s.id);
    }
    const identity = (pk, tid, uid) => identities.get(JSON.stringify([pk, tid])) ?? uid;
    const catalog = { teams: [], players: [], maps: [], tournaments: [], matches: [] };
    for (const p of rows.players)
        catalog.players.push(entry('players', publicId(p), { name: p.name, ign: p.current_ign, uid: p.uid, role: p.role, status: p.status, ...optional(p, [['avatar', 'avatar'], ['country', 'country'], ['bio', 'bio'], ['photo_asset_key', 'photo_asset_key']]), ...(teamsByID.has(p.current_team_id) ? { team: p.current_team_id } : {}), socials: optional(p, [['discord', 'discord'], ['twitter', 'twitter'], ['youtube', 'youtube'], ['twitch', 'twitch']]), stats: { kills: 0, deaths: 0, assists: 0, matchesPlayed: 0, mvpCount: 0 } }));
    for (const s of segments.values())
        catalog.players.push(entry('players', s.id, { name: '', ign: s.ign_snapshot, uid: s.uid_snapshot, team: s.team_id, role: 'Player', status: 'inactive', avatar: '/players/default.webp', photo_asset_key: null, socials: {}, stats: { kills: 0, deaths: 0, assists: 0, matchesPlayed: 0, mvpCount: 0 } }));
    requireValue(new Set(catalog.players.map(p => p.id)).size === catalog.players.length, 'INVALID_IDENTITY');
    for (const t of rows.teams)
        catalog.teams.push(entry('teams', t.id, { name: t.name, tag: t.tag, region: t.region, ...optional(t, [['color', 'color'], ['logo', 'logo'], ['founded', 'founded'], ['description', 'description'], ['logo_asset_key', 'logo_asset_key']]), players: rows.players.filter(p => p.current_team_id === t.id).map(publicId), penalties: rows.team_penalties.filter(p => p.team_id === t.id).map(p => ({ tournamentId: p.tournament_id, points: p.points, reason: p.reason })), placementPoints: 0, stats: { wins: 0, losses: 0, draws: 0, matchesPlayed: 0 } }));
    for (const m of rows.maps)
        catalog.maps.push(entry('maps', m.id, { name: m.name, game: m.game, active: Boolean(m.active), ...optional(m, [['thumbnail', 'thumbnail'], ['image_asset_key', 'image_asset_key']]) }));
    const scoped = (table, tid, sid) => rows[table].filter(r => r.tournament_id === tid && (!sid || r.stage_id === sid));
    for (const t of rows.tournaments)
        catalog.tournaments.push(entry('tournaments', t.id, { name: t.name, game: t.game, region: t.region, startDate: t.start_date, endDate: t.end_date, status: t.status, format: t.format, ...optional(t, [['winner_team_id', 'winner'], ['poster_asset_key', 'poster_asset_key']]), teams: scoped('tournament_teams', t.id).map(r => r.team_id), stages: scoped('tournament_stages', t.id).map(s => ({ id: s.id, name: s.name, format: s.format, bracketSize: s.bracket_size, series: { type: s.series_type, mapCount: s.map_count }, mapPool: scoped('stage_map_pool', t.id, s.id).map(r => r.map_id), ...(s.final_map_rule ? { veto: { steps: scoped('veto_steps', t.id, s.id).map(r => ({ team: r.team_side, action: r.action })), finalMap: s.final_map_rule, actionSeconds: s.action_seconds, reserveSeconds: s.reserve_seconds } } : {}), rounds: scoped('tournament_rounds', t.id, s.id).map(r => ({ id: r.id, name: r.name, order: r.sort_order, ...(r.placement ? { placement: r.placement } : {}) })), byes: scoped('tournament_byes', t.id, s.id).map(r => ({ id: r.id, roundId: r.round_id, slot: r.slot, teamId: r.team_id })) })) }));
    const matchIDs = new Set(rows.matches.map(m => m.id)), entries = group(rows.player_match_entries, r => r.match_id), rounds = group(rows.player_round_stats, r => JSON.stringify([r.match_id, r.entry_index])), details = group(rows.match_maps, r => r.match_id), walkovers = group(rows.match_map_walkovers, r => r.match_id), sources = group(rows.match_sources, r => r.match_id);
    for (const table of ['match_maps', 'match_map_walkovers', 'match_sources', 'player_match_entries', 'player_round_stats'])
        requireValue(rows[table].every(r => matchIDs.has(r.match_id)));
    const entryIDs = new Set(rows.player_match_entries.map(r => JSON.stringify([r.match_id, r.entry_index])));
    requireValue(rows.player_round_stats.every(r => entryIDs.has(JSON.stringify([r.match_id, r.entry_index]))));
    for (const m of rows.matches) {
        requireValue(tournamentIDs.has(m.tournament_id) && ['completed', 'live', 'upcoming'].includes(m.status) && [m.score1, m.score2].every(n => Number.isSafeInteger(n) && n >= 0));
        const played = details.get(m.id) ?? [], wo = walkovers.get(m.id) ?? [], es = entries.get(m.id) ?? [];
        requireValue(rows.tournament_rounds.some(r => r.tournament_id === m.tournament_id && r.stage_id === m.stage_id && r.id === m.round_id));
        requireValue([m.team1_id, m.team2_id].every(id => id === null || teamsByID.has(id)) && (m.winner_id === null || [m.team1_id, m.team2_id].includes(m.winner_id)));
        requireValue(m.result_type !== 'walkover' || (!played.length && !wo.length && !es.length));
        requireValue(!played.some(p => wo.some(w => w.map_number === p.map_number)));
        const data = { tournamentId: m.tournament_id, stageId: m.stage_id, roundId: m.round_id, bracketSlot: m.bracket_slot, date: m.date, status: m.status, score1: m.score1, score2: m.score2, ...optional(m, [['team1_id', 'team1Id'], ['team2_id', 'team2Id'], ['winner_id', 'winnerId'], ['duration', 'duration']]), ...(m.result_type === 'walkover' ? { resultType: 'walkover' } : {}), stats1: { kills: 0, deaths: 0, assists: 0 }, stats2: { kills: 0, deaths: 0, assists: 0 }, roundDetails: [], playerStats: [] };
        for (const s of sources.get(m.id) ?? []) {
            requireValue([1, 2].includes(s.side) && ['winner', 'loser', 'bye'].includes(s.source_type));
            if (s.source_type !== 'bye')
                requireValue(rows.matches.some(source => source.id === s.source_match_id && source.tournament_id === m.tournament_id && source.stage_id === m.stage_id && source.id !== m.id));
            else
                requireValue(rows.tournament_byes.some(b => b.tournament_id === m.tournament_id && b.stage_id === m.stage_id && b.id === s.source_bye_id));
            data[`team${s.side}Source`] = s.source_type === 'bye' ? { type: 'bye', byeId: s.source_bye_id } : { type: s.source_type, matchId: s.source_match_id };
        }
        data.roundDetails = [...played.map(r => { requireValue(mapsByID.has(r.map_id)); const d = { round_number: r.map_number, mapId: r.map_id, ...optional(r, [['winner_team_id', 'winnerId'], ['score_team1', 'score1'], ['score_team2', 'score2'], ['result_note', 'resultNote']]) }; if (r.mvp_player_id !== null) {
                const p = playersByPK.get(r.mvp_player_id);
                requireValue(p);
                const e = es.find(e => e.player_id === r.mvp_player_id && e.uid_snapshot !== null);
                d.mvp = e?.uid_snapshot ?? publicId(p);
            } return d; }), ...wo.map(r => ({ round_number: r.map_number, ...(r.map_id ? { mapId: r.map_id } : {}), mode: 'walkover', winnerId: r.winner_team_id }))].sort((a, b) => a.round_number - b.round_number);
        data.playerStats = es.map(e => ({ playerId: e.player_id, teamId: e.team_id, uid: e.uid_snapshot, ...(e.ign_snapshot !== null ? { ign: e.ign_snapshot } : {}), rounds: (rounds.get(JSON.stringify([m.id, e.entry_index])) ?? []).map(r => { requireValue([r.kills, r.deaths, r.assists].every(n => Number.isSafeInteger(n) && n >= 0) && !wo.some(w => w.map_number === r.map_number)); return { kills: r.kills, deaths: r.deaths, assists: r.assists, ...(r.map_number !== null ? { round_number: r.map_number } : {}) }; }) }));
        catalog.matches.push(entry('matches', m.id, data));
    }
    const rosters = rows.tournament_rosters.map(r => { const p = playersByPK.get(r.player_id); requireValue(p && teamsByID.has(r.team_id) && tournamentIDs.has(r.tournament_id) && typeof r.ign_snapshot === 'string' && r.ign_snapshot.trim() && (r.position === null || Number.isSafeInteger(r.position) && r.position >= 1 && r.position <= 7)); return { tournamentId: r.tournament_id, teamId: r.team_id, playerId: identity(r.player_id, r.tournament_id, publicId(p)), uid: p.uid, ign: r.ign_snapshot, position: r.position, orderVerified: r.position !== null }; });
    const assets = {};
    for (const [collection, field] of Object.entries({ teams: 'logo_asset_key', players: 'photo_asset_key', maps: 'image_asset_key', tournaments: 'poster_asset_key' }))
        assets[collection] = Object.fromEntries(catalog[collection].map(e => [e.id, { key: e.data[field] ?? null, url: assetMediaPath(e.data[field], collection) }]));
    const matchTournament = new Map(rows.matches.map(m => [m.id, m.tournament_id]));
    const entryOwners = new Map(rows.player_match_entries.filter(e => e.uid_snapshot !== null).map(e => [JSON.stringify([matchTournament.get(e.match_id), e.uid_snapshot]), e.player_id]));
    const statisticsIdentity = (uid, tid) => {
        if (!uid) return uid;
        const owner = entryOwners.get(JSON.stringify([tid, uid]));
        const p = rows.players.find(p => p.uid === uid || publicId(p) === uid);
        return identity(owner ?? p?.id, tid, uid);
    };
    return Object.freeze({ ...catalog, rosters, assets,
        identitySegments: [...segments.values()].map(s => ({uid:s.uid_snapshot,fromTournament:s.boundary_tournament_id,beforeTournaments:rows.player_identity_tournaments.filter(m=>m.segment_id===s.id).map(m=>m.tournament_id),previous:{ign:s.ign_snapshot,team:s.team_id}})),
        profileIdentity(uid, tournamentId) { return statisticsIdentity(uid,tournamentId); },
        get(collection, id) { if (!Object.hasOwn(catalog, collection))
            throw new PublicDataError('NOT_FOUND', 404); const result = catalog[collection].find(e => e.id === id); if (!result)
            throw new PublicDataError('NOT_FOUND', 404); return result; },
        statisticsMatches(tid) { return catalog.matches.filter(m => !tid || m.data.tournamentId === tid).map(m => ({ ...m, data: { ...m.data, roundDetails: m.data.roundDetails.map(r => ({ ...r, ...(r.mvp ? { mvp: '__d1_public__:' + statisticsIdentity(r.mvp, m.data.tournamentId) } : {}) })), playerStats: m.data.playerStats.map(p => ({ ...p, uid: p.uid ? '__d1_public__:' + identity(p.playerId, m.data.tournamentId, p.uid) : p.uid })) } })); },
    });
}
export function restorePublicStatisticsKeys(statistics) {
    const restore = map => new Map([...map].map(([key, value]) => [key.startsWith('__d1_public__:') ? key.slice(14) : key, value]));
    statistics.players = restore(statistics.players);
    for (const map of statistics.maps.values())
        map.players = restore(map.players);
    return statistics;
}
