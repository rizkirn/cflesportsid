import {publicFields} from './public-d1.mjs';
import {statisticalProfiles} from '../utils/player-continuity.mjs';
import {canonicalContract} from './public-mode.mjs';

export function normalizePublicContract(collection, entries) {
  const profiles = collection === 'players' && entries.every(p => !p.id.includes('--before-')) ? statisticalProfiles(entries) : entries;
  return profiles.map(entry => {
    const data = Object.fromEntries(publicFields[collection].filter(field => !['stats','stats1','stats2'].includes(field))
      .filter(field => entry.data[field] !== undefined).map(field => [field, entry.data[field]]));
    if (collection === 'players') {data.socials ??= {}; if(entry.id.includes('--before-')) delete data.avatar;}
    if (collection === 'teams' && Array.isArray(data.players)) data.players = [...data.players].sort();
    if (collection === 'tournaments') {
      data.teams = [...data.teams].sort();
      data.stages = data.stages.map(stage => {
        const mapPool = stage.mapPool ?? stage.veto?.mapPoolIds;
        const veto = stage.veto ? {...stage.veto, mapPoolIds:stage.veto.mapPoolIds ?? mapPool} : undefined;
        return {...stage, ...(mapPool ? {mapPool:[...mapPool]} : {}), ...(veto ? {veto} : {}),
          rounds:[...stage.rounds].sort((a,b)=>a.order-b.order || (a.placement??0)-(b.placement??0) || a.id.localeCompare(b.id)),
          byes:[...stage.byes].sort((a,b)=>a.roundId.localeCompare(b.roundId)||a.slot-b.slot||a.id.localeCompare(b.id))};
      });
    }
    if (collection === 'matches') data.playerStats = data.playerStats.map(({playerId,...rest})=>rest);
    return canonicalContract({id:entry.id,data});
  }).sort((a,b)=>a.id.localeCompare(b.id));
}

export function comparePublicContracts(collection, legacy, projected) {
  const a = new Map(normalizePublicContract(collection,legacy).map(row=>[row.id,row.data]));
  const b = new Map(normalizePublicContract(collection,projected).map(row=>[row.id,row.data]));
  let mismatches=0; const fields=new Set();
  for (const id of new Set([...a.keys(),...b.keys()])) {
    const left=a.get(id),right=b.get(id);
    if (JSON.stringify(left)===JSON.stringify(right)) continue;
    mismatches++;
    if (!left || !right) fields.add('entity');
    else for (const field of publicFields[collection]) if(JSON.stringify(left[field])!==JSON.stringify(right[field]))fields.add(field);
  }
  return {contract:collection,mismatches,fields:[...fields].sort()};
}
