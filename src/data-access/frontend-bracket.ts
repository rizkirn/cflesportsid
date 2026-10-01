import { getCollection, type CollectionEntry } from 'astro:content';
import { env } from 'cloudflare:workers';

export async function getFrontendTeams(): Promise<CollectionEntry<'teams'>[]> {
  const legacy = await getCollection('teams');
  try {
    const result = await env.DB.prepare('SELECT * FROM teams ORDER BY id').all<any>();
    if (!result.success) throw new Error('Team read failed');
    const ids = new Set(legacy.map(t => t.id));
    return [...legacy, ...result.results.filter(t => !ids.has(t.id)).map(t => ({ id: t.id, collection:'teams' as const, data: {
      name: t.name, tag: t.tag, region: t.region, ...(t.color ? { color:t.color } : {}), ...(t.logo ? { logo:t.logo } : {}),
      placementPoints: 0, penalties: [], players: [], stats: { wins:0, losses:0, draws:0, matchesPlayed:0 },
    } }))];
  } catch (error) {
    console.warn('[teams] JSON fallback:', error instanceof Error ? error.message : error);
    return legacy;
  }
}

export async function getFrontendTournaments(): Promise<CollectionEntry<'tournaments'>[]> {
  const legacy = await getCollection('tournaments');
  try {
    const queries = ['SELECT * FROM tournaments ORDER BY id', 'SELECT * FROM tournament_stages ORDER BY tournament_id,id',
      'SELECT * FROM tournament_rounds ORDER BY tournament_id,stage_id,sort_order', 'SELECT * FROM tournament_byes ORDER BY tournament_id,stage_id,slot',
      'SELECT * FROM tournament_teams ORDER BY tournament_id,team_id'];
    const results = await env.DB.batch<any>(queries.map(sql => env.DB.prepare(sql)));
    if (results.some(r => !r.success)) throw new Error('Tournament read failed');
    const [tournaments, stages, rounds, byes, teams] = results.map(r => r.results);
    const ids = new Set(legacy.map(t => t.id));
    return [...legacy, ...tournaments.filter(t => !ids.has(t.id) && stages.some(s => s.tournament_id === t.id)).map(t => ({ id:t.id, collection:'tournaments' as const, data: {
      name:t.name, game:t.game, region:t.region, startDate:t.start_date, endDate:t.end_date, status:t.status, format:t.format,
      ...(t.winner_team_id ? { winner:t.winner_team_id } : {}),
      teams:teams.filter(team => team.tournament_id === t.id).map(team => team.team_id),
      stages:stages.filter(s => s.tournament_id === t.id).map(s => ({
        id:s.id, name:s.name, format:s.format, bracketSize:s.bracket_size, series:{type:s.series_type,mapCount:s.map_count},
        rounds:rounds.filter(r => r.tournament_id === t.id && r.stage_id === s.id).map(r => ({id:r.id,name:r.name,order:r.sort_order,...(r.placement ? {placement:r.placement} : {})})),
        byes:byes.filter(b => b.tournament_id === t.id && b.stage_id === s.id).map(b => ({id:b.id,roundId:b.round_id,slot:b.slot,teamId:b.team_id})),
      })),
    } }))];
  } catch (error) {
    console.warn('[tournaments] JSON fallback:', error instanceof Error ? error.message : error);
    return legacy;
  }
}
