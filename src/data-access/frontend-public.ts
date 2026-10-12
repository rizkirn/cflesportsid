import {AsyncLocalStorage} from 'node:async_hooks';
import type {CollectionEntry} from 'astro:content';
import * as engine from '../utils/statistics';
import * as continuity from '../utils/player-continuity.mjs';
import {readPublicData, restorePublicStatisticsKeys, type PublicSnapshot, type PublicCollection, type PublicDatabase} from './public-d1.mjs';
import {resolvePublicMode, publicSitemapPaths} from './public-mode.mjs';

export {emptyStats, emptyMapStats, kdRatio, kdaRatio, getMapWinner} from '../utils/statistics';
export {historicalPlayerKey} from '../utils/player-continuity.mjs';

import {comparePublicContracts} from './shadow-contract.mjs';

type Context = {mode: 'shadow'|'d1'; snapshot: Promise<PublicSnapshot>; ready?: PublicSnapshot; comparisons: Promise<{contract:string; mismatches:number}>[]};
const requests = new AsyncLocalStorage<Context>();

export async function publicRequest(bindings: Record<string, unknown>, development: boolean, url: URL, next: () => Promise<Response>) {
  const mode = resolvePublicMode(bindings, development, url);
  if (mode === 'hybrid') return next();
  const context: Context = {mode, snapshot: readPublicData(bindings.DB as PublicDatabase), comparisons: []};
  context.snapshot = context.snapshot.then(snapshot => {context.ready = snapshot; return snapshot;});
  // Attach rejection handling immediately, including requests which read no catalog.
  void context.snapshot.catch(() => {});
  return requests.run(context, async () => {
    if (mode === 'd1') await context.snapshot;
    if (mode === 'd1' && url.pathname === '/local-verification/sitemap.xml') {
      const paths = publicSitemapPaths(context.ready!);
      return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+paths.map((path:string) => '<url><loc>https://cflesports.com'+path+'</loc></url>').join('')+'</urlset>', {headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});
    }
    const response = await next();
    if (mode === 'shadow') {
      const results = await Promise.allSettled([context.snapshot.then(() => ({contract:'database',mismatches:0})), ...context.comparisons]);
      const diagnostics = results.map(result => result.status === 'fulfilled' ? result.value : {contract:'database', mismatches:1});
      console.info('[public-shadow]', JSON.stringify(diagnostics));
    }
    return response;
  });
}

export async function selectPublicCollection<C extends PublicCollection>(collection: C, legacy: () => Promise<CollectionEntry<C>[]>) {
  const context = requests.getStore();
  if (!context) return legacy();
  if (context.mode === 'd1') return (await context.snapshot)[collection] as CollectionEntry<C>[];
  const hybrid = legacy();
  const comparison = Promise.all([hybrid,context.snapshot]).then(([entries,snapshot]) => {
    return comparePublicContracts(collection, entries, snapshot[collection]);
  });
  void comparison.catch(() => {});
  context.comparisons.push(comparison);
  return hybrid;
}

function statisticsContract(value: any): any {
  if(value instanceof Map)return [...value].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([key,item])=>[key,statisticsContract(item)]);
  if(Array.isArray(value))return value.map(statisticsContract);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,statisticsContract(value[key])]));
  return value;
}
export function calculateStatistics(matches: CollectionEntry<'matches'>[]) {
  const context = requests.getStore();
  if(context?.mode==='shadow'){
    const legacy=engine.calculateStatistics(matches);const ids=new Set(matches.map(match=>match.id));
    const comparison=context.snapshot.then(snapshot=>({contract:'statistics',mismatches:JSON.stringify(statisticsContract(legacy))===JSON.stringify(statisticsContract(restorePublicStatisticsKeys(engine.calculateStatistics(snapshot.statisticsMatches().filter(match=>ids.has(match.id))))))?0:1}));
    void comparison.catch(()=>{});context.comparisons.push(comparison);return legacy;
  }
  if (context?.mode !== 'd1' || !context.ready) return engine.calculateStatistics(matches);
  const ids = new Set(matches.map(match => match.id));
  return restorePublicStatisticsKeys(engine.calculateStatistics(context.ready.statisticsMatches().filter(match => ids.has(match.id))));
}

export function statisticalProfiles(players: CollectionEntry<'players'>[]) {
  return requests.getStore()?.mode === 'd1' ? players : continuity.statisticalProfiles(players);
}
export function statisticalPlayerKey(uid: string, tournamentId: string) {
  const context = requests.getStore();
  return context?.mode === 'd1' ? context.ready!.profileIdentity(uid,tournamentId) : continuity.statisticalPlayerKey(uid,tournamentId);
}
export function matchPlayerProfile(players: CollectionEntry<'players'>[], uid: string, tournamentId: string) {
  if (requests.getStore()?.mode !== 'd1') return continuity.matchPlayerProfile(players,uid,tournamentId);
  const id = statisticalPlayerKey(uid,tournamentId);
  return players.find(player => player.id === id);
}
export function getPlayerContinuitySplits() {
  const context = requests.getStore();
  return context?.mode === 'd1' ? context.ready!.identitySegments : continuity.playerContinuitySplits;
}
export function localD1Snapshot() {return requests.getStore()?.mode === 'd1' ? requests.getStore()!.ready : undefined;}
export {publicSitemapPaths};

export function publicVetoMapCatalog(stage: {mapPool?:string[]}, maps: Map<string,CollectionEntry<'maps'>>) {
  if (requests.getStore()?.mode !== 'd1' || !stage.mapPool) return maps;
  return new Map(stage.mapPool.map(id => {const map = maps.get(id); if (!map) throw new Error('Public stage map unavailable.'); return [id,{...map,data:{...map.data,active:true}}];}));
}
