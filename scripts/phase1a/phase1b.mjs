import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { playerContinuitySplits } from '../../src/config/player-continuity.mjs';
import { readPublicData, restorePublicStatisticsKeys, PublicDataError, publicErrorResponse, publicReadQueries } from '../../src/data-access/public-d1.mjs';
import { plain } from '../d1-parity.mjs';
function binding(sql) { return { prepare(query) { let values = []; return { bind(...v) { values = v; return this; }, async all() { return { success: true, results: sql.prepare(query).all(...values) }; } }; }, async batch(items) { return Promise.all(items.map(item => item.all())); } }; }
function expanded(legacy, snapshot, tid) {
    const code=ts.transpileModule(readFileSync(new URL('../../src/data-access/public-statistics.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const context={exports:{},require(name){if(name==='../utils/statistics')return legacy;if(name==='./public-d1.mjs')return {restorePublicStatisticsKeys};throw Error('Unexpected statistics dependency');}};
    vm.runInNewContext(code,context);
    return plain(context.exports.calculatePublicStatistics(snapshot,tid));
}
export function initializePublicFixtures(sql, registrations) {
    for (const s of playerContinuitySplits) {
        const p = sql.prepare('SELECT id FROM players WHERE uid=?').get(s.uid);
        assert.ok(p);
        const id = `${s.uid}--before-${s.fromTournament}`;
        sql.prepare('INSERT INTO player_identity_segments VALUES(?,?,?,?,?,?)').run(id, p.id, s.uid, s.fromTournament, s.previous.ign, s.previous.team);
        for (const tid of s.beforeTournaments)
            sql.prepare('INSERT INTO player_identity_tournaments VALUES(?,?,?)').run(p.id, tid, id);
    }
    for (const r of registrations) {
        const p = sql.prepare('SELECT id FROM players WHERE uid=?').get(r.uid);
        assert.ok(p);
        sql.prepare('INSERT INTO tournament_rosters(tournament_id,team_id,player_id,ign_snapshot,position) VALUES(?,?,?,?,NULL)').run(r.tournament_id, r.team_id, p.id, r.ign);
    }
}
export async function verifyPublicHistorical(sql, data, legacy, registrations) {
    const migrationDB = new DatabaseSync(':memory:');
    try {
        migrationDB.exec('PRAGMA foreign_keys=ON');
        const root = process.env.CFL_PHASE1A_ROOT;
        const marker = JSON.parse(readFileSync(join(root, 'ownership.json'), 'utf8'));
        for (const name of Object.keys(marker.migrations).filter(n => !n.startsWith('0011')))
            migrationDB.exec(readFileSync(join(root, 'migrations', name), 'utf8'));
        migrationDB.exec("INSERT INTO teams(id,name,tag,region) VALUES('saved-team','Saved team','S','ID'); INSERT INTO players(id,name,current_ign) VALUES('saved-a','Saved A','A'),('saved-b','Saved B','B'); INSERT INTO tournaments(id,name,start_date,end_date,status,format) VALUES('saved-t','Saved','2027-01-01','2027-01-02','ongoing','single-elimination'); INSERT INTO tournament_teams VALUES('saved-t','saved-team'); INSERT INTO tournament_rosters VALUES('saved-t','saved-team','saved-a','Old A',7),('saved-t','saved-team','saved-b','Old B',2)");
        const before = migrationDB.prepare('SELECT * FROM tournament_rosters ORDER BY player_id').all();
        migrationDB.exec(readFileSync(join(root, 'migrations', '0011_public_identity_contracts.sql'), 'utf8'));
        assert.deepEqual(migrationDB.prepare('SELECT * FROM tournament_rosters ORDER BY player_id').all(), before);
        assert.deepEqual(migrationDB.prepare('PRAGMA foreign_key_check').all(), []);
    }
    finally {
        migrationDB.close();
    }
    const snapshot = await readPublicData(binding(sql));
    const results = [];
    const matchContract = m => {
        const d = m.data;
        const fields = ['tournamentId', 'stageId', 'roundId', 'bracketSlot', 'date', 'status', 'team1Id', 'team2Id', 'score1', 'score2', 'winnerId', 'team1Source', 'team2Source'];
        return { id: m.id, ...Object.fromEntries(fields.filter(k => d[k] !== undefined).map(k => [k, d[k]])), roundDetails: d.roundDetails.map(r => ({ ...r, winnerId: legacy.getMapWinner(m, r) })), playerStats: d.playerStats.map(p => ({ teamId: p.teamId, uid: p.uid ?? null, ...(p.ign !== undefined ? { ign: p.ign } : {}), rounds: p.rounds })) };
    };
    assert.deepEqual(plain(snapshot.matches.map(matchContract)), plain([...data.matches.values()].map(matchContract)), 'Historical public match and bracket contract');
    for (const tid of [...data.tournaments.keys(), undefined]) {
        const expected = legacy.calculateStatistics([...data.matches.values()].filter(m => !tid || m.data.tournamentId === tid));
        for (const p of snapshot.players)
            if (!expected.players.has(p.id))
                expected.players.set(p.id, legacy.emptyStats());
        for (const t of snapshot.teams)
            if (!expected.teams.has(t.id))
                expected.teams.set(t.id, legacy.emptyStats());
        for (const m of snapshot.maps)
            if (!expected.maps.has(m.id))
                expected.maps.set(m.id, legacy.emptyMapStats());
        assert.deepEqual(expanded(legacy, snapshot, tid), plain(expected), 'Nested player/map and team/map parity: ' + (tid ?? 'overall'));
        results.push({ scope: tid ?? 'overall', profiles: snapshot.players.length, teams: snapshot.teams.length, maps: snapshot.maps.length, nestedMismatches: 0 });
    }
    assert.equal(snapshot.players.length, 128);
    assert.equal(snapshot.matches.length, 26);
    assert.equal(snapshot.rosters.length, 168);
    assert.ok(snapshot.rosters.every(r => r.position === null && !r.orderVerified));
    const membership = snapshot.rosters.map(r => [r.tournamentId, r.teamId, r.uid, r.ign].join('|')).sort();
    assert.deepEqual(membership, registrations.map(r => [r.tournament_id, r.team_id, r.uid, r.ign].join('|')).sort());
    const past = snapshot.get('players', '1345266890--before-clash-for-glory-s2');
    assert.equal(past.data.ign, 'KangDedy');
    assert.equal(past.data.team, 'cha-tra-mue');
    assert.ok(snapshot.tournaments.every(t => t.data.stages.length));
    assert.equal(snapshot.tournaments.flatMap(t => t.data.stages.flatMap(s => s.byes)).length, 6);
    assert.equal(snapshot.tournaments.flatMap(t => t.data.stages.flatMap(s => s.mapPool)).length, 21);
    assert.equal(snapshot.tournaments.flatMap(t => t.data.stages.flatMap(s => s.veto?.steps ?? [])).length, 16);
    assert.equal(snapshot.teams.flatMap(t => t.data.penalties).length, 1);
    assert.ok(publicReadQueries.every(q => !q.includes('admin_audit_log') && !q.includes('match_detail_edits') && !q.includes('match_correction_audit')));
    const unsafe = binding(sql);
    const batch = unsafe.batch;
    unsafe.batch = async (items) => (await batch(items)).map(r => ({ ...r, results: r.results.map(row => ({ ...row, actor_email: 'PRIVATE_SENTINEL', audit_payload: 'PRIVATE_SENTINEL', internal_revision: 'PRIVATE_SENTINEL' })) }));
    assert.ok(!JSON.stringify(await readPublicData(unsafe)).includes('PRIVATE_SENTINEL'));
    await assert.rejects(() => readPublicData(null), e => e instanceof PublicDataError && e.code === 'MISSING_BINDING' && e.status === 503);
    await assert.rejects(() => readPublicData({ prepare() { throw Error('PRIVATE_SENTINEL'); }, batch: async () => { throw Error('PRIVATE_SENTINEL'); } }), e => e.code === 'QUERY_FAILED' && !e.message.includes('PRIVATE_SENTINEL'));
    const failedRead=binding(sql);const successfulBatch=failedRead.batch;let batches=0;
    failedRead.batch=async items=>{if(++batches===2)throw Error('PRIVATE_SENTINEL');return successfulBatch(items);};
    await assert.rejects(()=>readPublicData(failedRead),e=>e.code==='QUERY_FAILED'&&e.status===503&&!e.message.includes('PRIVATE_SENTINEL'));
    assert.equal(publicErrorResponse(new PublicDataError('MISSING_BINDING')).status, 503);
    assert.equal(publicErrorResponse(new PublicDataError('NOT_FOUND', 404)).status, 404);
    sql.exec('SAVEPOINT missing_schema; DROP TABLE player_identity_tournaments');
    await assert.rejects(() => readPublicData(binding(sql)), e => e.code === 'SCHEMA_REQUIRED');
    sql.exec('ROLLBACK TO missing_schema; RELEASE missing_schema');
    sql.exec('SAVEPOINT invalid_identity');
    const segment = sql.prepare('SELECT * FROM player_identity_segments LIMIT 1').get();
    sql.prepare('UPDATE player_identity_segments SET ign_snapshot=? WHERE id=?').run('Different snapshot', segment.id);
    const changed = await readPublicData(binding(sql));
    assert.equal(changed.get('players', segment.id).data.ign, 'Different snapshot');
    sql.exec('ROLLBACK TO invalid_identity; RELEASE invalid_identity');
    sql.exec('SAVEPOINT bad_boundary');sql.prepare('UPDATE player_identity_tournaments SET tournament_id=? WHERE player_id=?').run(segment.boundary_tournament_id,segment.player_id);await assert.rejects(()=>readPublicData(binding(sql)),e=>e.code==='INVALID_IDENTITY'&&e.status===500);sql.exec('ROLLBACK TO bad_boundary; RELEASE bad_boundary');
    sql.exec('SAVEPOINT bad_segment');
    sql.prepare('INSERT INTO player_identity_segments VALUES(?,?,?,?,?,?)').run('invalid-profile', segment.player_id, segment.uid_snapshot, segment.boundary_tournament_id, segment.ign_snapshot, segment.team_id);
    await assert.rejects(() => readPublicData(binding(sql)), e => e.code === 'INVALID_IDENTITY' && e.status === 500);
    sql.exec('ROLLBACK TO bad_segment; RELEASE bad_segment');
    return { status: 'PASS', scopes: results, registrationMemberships: 168, ordering: 'UNVERIFIED', savedPositionsMigration: 'PASS', publicFieldIsolation: 'PASS', explicitFailures: 'PASS' };
}
export async function verifyPublicEdges(sql, data, legacy) {
    const officialBefore = expanded(legacy, await readPublicData(binding(sql)), undefined);
    sql.exec("SAVEPOINT public_edges; INSERT INTO teams(id,name,tag,region) VALUES('fx-secret-team','Private fixture','PRIVATE','ID');INSERT INTO players(id,uid,name,current_ign,current_team_id) VALUES('fx-secret-player','fixture-private-uid','Private fixture','Private fixture','fx-secret-team');INSERT INTO maps(id,name) VALUES('fx-secret-map','Private fixture');INSERT INTO tournament_teams VALUES('fx-test','fx-secret-team');INSERT INTO tournament_rosters VALUES('fx-test','fx-secret-team','fx-secret-player','Private fixture',1);INSERT INTO stage_map_pool VALUES('fx-test','stage','fx-secret-map',3);INSERT INTO team_penalties(tournament_id,team_id,points,reason) VALUES('fx-test','fx-a',999,'Private penalty')");
    sql.exec("INSERT INTO match_maps(match_id,map_number,map_id,winner_team_id,score_team1,score_team2,mvp_player_id) VALUES('fx-private',1,'fx-secret-map','fx-a',7,0,'fx-secret-player'); INSERT INTO player_match_entries VALUES('fx-private',0,'fx-secret-player','fx-a','fixture-private-uid','Private fixture'); INSERT INTO player_round_stats VALUES('fx-private',0,0,1,999,888,777)");
    sql.exec("INSERT INTO players(id,uid,name,current_ign) VALUES('fx-secret-mvp','fixture-private-mvp','Private MVP','Private MVP'); UPDATE match_maps SET mvp_player_id='fx-secret-mvp' WHERE match_id='fx-private'");
    const key = 'teams/fx-a/logo/' + 'a'.repeat(64) + '.webp';
    sql.prepare("UPDATE teams SET logo_asset_key=? WHERE id='fx-a'").run(key);
    const snapshot = await readPublicData(binding(sql));
    for (const [collection, id] of [['teams', 'fx-secret-team'], ['players', 'fixture-private-uid'], ['players', 'fixture-private-mvp'], ['maps', 'fx-secret-map'], ['tournaments', 'fx-test'], ['matches', 'fx-private']])
        assert.throws(() => snapshot.get(collection, id), e => e.code === 'NOT_FOUND' && e.status === 404);
    assert.ok(!JSON.stringify(snapshot).includes('Private penalty'));
    assert.ok(snapshot.get('teams', 'fx-a'));
    assert.ok(snapshot.get('players', 'fixture-uid-a6'));
    assert.ok(snapshot.get('maps', 'fx-map1'));
    assert.ok(!data.players.has('fixture-uid-a6'));
    assert.equal(snapshot.assets.teams['fx-a'].url, '/media/' + key);
    const saved = sql.prepare("SELECT p.uid,r.position,r.ign_snapshot FROM tournament_rosters r JOIN players p ON p.id=r.player_id WHERE r.tournament_id='fx-official' AND team_id='fx-a' ORDER BY position").all();
    assert.deepEqual(snapshot.rosters.filter(r => r.tournamentId === 'fx-official' && r.teamId === 'fx-a').map(r => [r.uid, r.position, r.ign]), saved.map(r => [r.uid, r.position, r.ign_snapshot]));
    const before = expanded(legacy, snapshot, undefined);
    assert.deepEqual(before, officialBefore, 'Test combat, MVPs, private masters and penalties cannot affect any public statistics');
    sql.exec('SAVEPOINT reorder_public');
    const old = sql.prepare("SELECT * FROM tournament_rosters WHERE tournament_id='fx-official' AND team_id='fx-a' ORDER BY position").all();
    sql.exec("DELETE FROM tournament_rosters WHERE tournament_id='fx-official' AND team_id='fx-a'");
    old.reverse().forEach((r, i) => sql.prepare('INSERT INTO tournament_rosters VALUES(?,?,?,?,?)').run(r.tournament_id, r.team_id, r.player_id, r.ign_snapshot, i + 1));
    assert.deepEqual(expanded(legacy, await readPublicData(binding(sql)), undefined), before);
    sql.exec('ROLLBACK TO reorder_public; RELEASE reorder_public');
    assert.ok(snapshot.matches.every(m => m.data.tournamentId !== 'fx-test'));
    assert.equal(snapshot.get('matches', 'fx-progress').data.resultType, 'walkover');
    assert.equal(snapshot.get('matches', 'fx-progress').data.roundDetails.length, 0);
    assert.equal(snapshot.get('matches', 'fx-mixed').data.roundDetails.filter(r => r.mode === 'walkover').length, 1);
    assert.ok(snapshot.get('matches', 'fx-mixed').data.playerStats.some(p => p.uid === null && p.playerId === null));
    assert.equal(snapshot.get('matches', 'fx-progress-final').data.team1Id, 'fx-a');
    assert.equal(snapshot.get('matches', 'fx-progress-bronze').data.team2Id, 'fx-b');
    assert.ok(sql.prepare("SELECT id FROM tournaments WHERE id='fx-test'").get());
    assert.ok(sql.prepare("SELECT id FROM players WHERE id='fx-secret-player'").get());
    sql.exec('ROLLBACK TO public_edges; RELEASE public_edges');
    return { status: 'PASS', testCatalogAndStatisticsIsolation: 'PASS', officialEntities: 'PASS', savedRosterOrder: 'PASS', rosterPermutation: 'PASS', walkovers: 'PASS', nullableEntries: 'PASS', assetMedia: 'PASS', adminVisibilityUnchanged: 'PASS' };
}
