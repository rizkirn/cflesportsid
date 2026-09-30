import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const DATA = new URL('../src/data/', import.meta.url);
const OUT = new URL('../.generated/', import.meta.url);

const q = value => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const n = value => value == null ? 'NULL' : Number(value);
const idFromFile = file => basename(file, '.json');
const json = async (dir, file) => JSON.parse(await readFile(new URL(dir + '/' + file, DATA), 'utf8'));
const files = async dir => (await readdir(new URL(dir + '/', DATA))).filter(x => x.endsWith('.json')).sort();
const insert = (table, columns, values) =>
  `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;

const sql = ['PRAGMA foreign_keys = ON;', 'BEGIN TRANSACTION;'];
const playerIds = new Set();

for (const file of await files('teams')) {
  const x = await json('teams', file), id = idFromFile(file);
  sql.push(insert('teams',
    ['id','name','tag','color','logo','region','founded','description'],
    [q(id),q(x.name),q(x.tag),q(x.color),q(x.logo),q(x.region),q(x.founded),q(x.description)]));
}

for (const file of await files('players')) {
  const x = await json('players', file), id = idFromFile(file);
  playerIds.add(id);
  sql.push(insert('players',
    ['id','uid','name','current_ign','current_team_id','role','status','avatar','country','bio','discord','twitter','youtube','twitch'],
    [q(id),q(x.uid ?? id),q(x.name),q(x.ign),q(x.team),q(x.role ?? 'Player'),q(x.status ?? 'active'),q(x.avatar),q(x.country),q(x.bio),
     q(x.socials?.discord),q(x.socials?.twitter),q(x.socials?.youtube),q(x.socials?.twitch)]));
}

for (const file of await files('maps')) {
  const x = await json('maps', file), id = idFromFile(file);
  sql.push(insert('maps',['id','name','game','active','thumbnail'],
    [q(id),q(x.name),q(x.game ?? 'crossfire-legends'),x.active === false ? 0 : 1,q(x.thumbnail)]));
}

for (const file of await files('tournaments')) {
  const x = await json('tournaments', file), tid = idFromFile(file);
  sql.push(insert('tournaments',['id','name','game','region','start_date','end_date','status','format','winner_team_id'],
    [q(tid),q(x.name),q(x.game ?? 'crossfire-legends'),q(x.region ?? 'ID'),q(x.startDate),q(x.endDate),q(x.status),q(x.format),q(x.winner)]));
  for (const teamId of x.teams ?? []) sql.push(insert('tournament_teams',['tournament_id','team_id'],[q(tid),q(teamId)]));
  for (const stage of x.stages ?? []) {
    sql.push(insert('tournament_stages',
      ['tournament_id','id','name','format','bracket_size','series_type','map_count','final_map_rule','action_seconds','reserve_seconds'],
      [q(tid),q(stage.id),q(stage.name),q(stage.format),n(stage.bracketSize),q(stage.series?.type),n(stage.series?.mapCount),q(stage.veto?.finalMap),n(stage.veto?.actionSeconds),n(stage.veto?.reserveSeconds)]));
    for (const round of stage.rounds ?? []) sql.push(insert('tournament_rounds',
      ['tournament_id','stage_id','id','name','sort_order','placement'],
      [q(tid),q(stage.id),q(round.id),q(round.name),n(round.order),n(round.placement)]));
    for (const bye of stage.byes ?? []) sql.push(insert('tournament_byes',
      ['tournament_id','stage_id','id','round_id','slot','team_id'],
      [q(tid),q(stage.id),q(bye.id),q(bye.roundId),n(bye.slot),q(bye.teamId)]));
    for (const [i,mapId] of (stage.veto?.mapPoolIds ?? []).entries()) sql.push(insert('stage_map_pool',
      ['tournament_id','stage_id','map_id','sort_order'],[q(tid),q(stage.id),q(mapId),i+1]));
    for (const [i,step] of (stage.veto?.steps ?? []).entries()) sql.push(insert('veto_steps',
      ['tournament_id','stage_id','step_order','team_side','action'],[q(tid),q(stage.id),i+1,q(step.team),q(step.action)]));
  }
}

const matchRows = [];
for (const file of await files('matches')) {
  const x = await json('matches', file);
  matchRows.push({ id:idFromFile(file), x });
}
// Matches first so winner/loser source FKs can safely be inserted afterwards.
for (const {id,x} of matchRows) sql.push(insert('matches',
  ['id','tournament_id','stage_id','round_id','bracket_slot','date','status','team1_id','team2_id','score1','score2','winner_id','duration'],
  [q(id),q(x.tournamentId),q(x.stageId),q(x.roundId),n(x.bracketSlot),q(x.date),q(x.status),q(x.team1Id),q(x.team2Id),n(x.score1 ?? 0),n(x.score2 ?? 0),q(x.winnerId),q(x.duration)]));

for (const {id,x} of matchRows) {
  for (const [side,source] of [[1,x.team1Source],[2,x.team2Source]]) if (source) {
    sql.push(insert('match_sources',['match_id','side','source_type','source_match_id','source_bye_id'],
      [q(id),side,q(source.type),q(source.matchId),q(source.byeId)]));
  }
  for (const rd of x.roundDetails ?? []) {
    const mvp = rd.mvp ? String(rd.mvp) : null;
    if (mvp && !playerIds.has(mvp)) throw new Error(`${id}: unknown MVP UID: ${mvp}`);
    const inferredWinner = x.status === 'completed'
      ? (rd.winnerId ?? (x.score1 > 0 && x.score2 === 0 ? x.team1Id : x.score2 > 0 && x.score1 === 0 ? x.team2Id : null))
      : null;
    sql.push(insert('match_maps',
      ['match_id','map_number','map_id','winner_team_id','score_team1','score_team2','mvp_player_id','result_note'],
      [q(id),n(rd.round_number),q(rd.mapId),q(inferredWinner),n(null),n(null),q(mvp),q(rd.resultNote)]));
  }
  for (const [entryIndex, ps] of (x.playerStats ?? []).entries()) {
    const pid = ps.uid ? String(ps.uid) : null;
    if (pid && !playerIds.has(pid)) throw new Error(`${id}: unknown player UID: ${pid}`);
    sql.push(insert('player_match_entries',
      ['match_id','entry_index','player_id','team_id','uid_snapshot','ign_snapshot'],
      [q(id),entryIndex,q(pid),q(ps.teamId),q(ps.uid),q(ps.ign)]));
    for (const [roundIndex, r] of (ps.rounds ?? []).entries()) {
      if (r.round_number != null && !(x.roundDetails ?? []).some(rd => rd.round_number === r.round_number)) {
        throw new Error(`${id}: player ${pid ?? '(unknown)'} references missing map ${r.round_number}`);
      }
      sql.push(insert('player_round_stats',
        ['match_id','entry_index','round_index','map_number','kills','deaths','assists'],
        [q(id),entryIndex,roundIndex,n(r.round_number),n(r.kills ?? 0),n(r.deaths ?? 0),n(r.assists ?? 0)]));
    }
  }
}

for (const file of await files('teams')) {
  const x = await json('teams', file), teamId=idFromFile(file);
  for (const p of x.penalties ?? []) sql.push(insert('team_penalties',
    ['tournament_id','team_id','points','reason'],[q(p.tournamentId),q(teamId),n(p.points),q(p.reason)]));
}

sql.push('COMMIT;');
await mkdir(OUT,{recursive:true});
const output = new URL('seed-s1-s2.sql', OUT);
await writeFile(output, sql.join('\n')+'\n');
console.log(`Generated ${sql.length} SQL statements at .generated/seed-s1-s2.sql`);
