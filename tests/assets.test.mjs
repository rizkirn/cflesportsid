import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { assetFields, overlayAssetReferences, readAssetReferences, resolveAsset, thumbnailSource } from '../src/utils/assets.mjs';
import { statisticalProfiles, matchPlayerProfile } from '../src/utils/player-continuity.mjs';
import { checkData } from '../scripts/data-tools.mjs';
import { compareStatistics } from '../scripts/d1-parity.mjs';

const { data } = checkData();
const fixtures = {
  teams:{id:'cha-tra-mue',data:{name:'ChaTraMue',tag:'CTM',logo:'/logos/CTM.webp',stats:{kills:1}}},
  players:{id:'1345266890',data:{uid:'1345266890',ign:'KucayyPRMX',team:'g2c-prmx',avatar:'/players/current.webp',stats:{kills:50}}},
  maps:{id:'island',data:{name:'ISLAND',active:true}},
  tournaments:{id:'clash-for-glory-s1',data:{name:'S1',teams:['cha-tra-mue']}},
};

for (const collection of Object.keys(assetFields)) {
  test(`${collection} overlay copies only the asset key and never emits media URLs in R2-A`, () => {
    const entry=fixtures[collection], original=structuredClone(entry), field=assetFields[collection];
    const row={id:entry.id,uid:entry.data.uid,[field]:`${collection}/fake/key.webp`,name:'Changed',ign:'Changed',stats:{kills:999}};
    const overlaid=overlayAssetReferences([entry],collection,[row])[0];
    assert.deepEqual(entry,original);
    assert.deepEqual(overlaid,{...entry,data:{...entry.data,[field]:row[field]}});
    assert.equal(resolveAsset(collection,overlaid).src,resolveAsset(collection,entry).src);
    assert.equal(resolveAsset(collection,overlaid).reference,row[field]);
    assert.equal(resolveAsset(collection,{...entry,data:{...entry.data,[field]:null}}).src,resolveAsset(collection,entry).src);
  });
  test(`${collection} unavailable or pre-0009 D1 returns the original collection`, async () => {
    const entries=[fixtures[collection]];
    assert.equal(await readAssetReferences(undefined,entries,collection),entries);
    assert.equal(await readAssetReferences({prepare(){throw new Error('no such column');}},entries,collection),entries);
    assert.equal(await readAssetReferences({prepare:()=>({all:async()=>({success:false})})},entries,collection),entries);
  });
}

test('asset reads are collection-wide and player references join by UID, not master ID', async () => {
  let calls=0;
  const db={prepare(sql){assert.equal(sql,'SELECT uid, photo_asset_key FROM players');calls++;return {all:async()=>({success:true,results:[{uid:'1345266890',photo_asset_key:'players/1345266890/a.webp'}]})};}};
  const entries=Array.from({length:127},()=>({...fixtures.players,id:'player-uuid'}));
  const result=await readAssetReferences(db,entries,'players');
  assert.equal(calls,1);
  assert.equal(result[0].data.photo_asset_key,'players/1345266890/a.webp');
});

test('historical split never borrows current key, explicit avatar or UID image; ordinary rename stays continuous', () => {
  const current={...fixtures.players,data:{...fixtures.players.data,photo_asset_key:'players/1345266890/new.webp'}};
  const profiles=statisticalProfiles([current]);
  const historical=profiles.find(p=>p.id.includes('--before-'));
  assert.equal(resolveAsset('players',{...historical,data:{...historical.data,...current.data}}).src,'/players/default.webp');
  assert.equal(resolveAsset('players',historical).reference,null);
  assert.equal(resolveAsset('players',matchPlayerProfile([current],current.id,'clash-for-glory-s1')).src,'/players/default.webp');
  assert.equal(resolveAsset('players',current).src,'/players/current.webp');
  const rename={id:'1083796629',data:{uid:'1083796629',ign:'HWL,DANILTVJ',photo_asset_key:'players/1083796629/new.webp'}};
  assert.equal(resolveAsset('players',matchPlayerProfile([current,rename],'1083796629','clash-for-glory-s1')).src,'/players/1083796629.webp');
});

test('local assets and all four terminal fallbacks remain usable', () => {
  const files=new Set(['/logos/CTM.webp','/maps/island.webp','/tournaments/clash-for-glory-s1.webp','/tournaments/clash-for-glory-s2.webp']);
  assert.equal(resolveAsset('teams',fixtures.teams,{localFiles:files}).src,'/logos/CTM.webp');
  assert.equal(resolveAsset('players',{id:'missing',data:{uid:'missing'}},{localFiles:files}).src,'/players/default.webp');
  assert.equal(resolveAsset('maps',fixtures.maps,{localFiles:files}).src,'/maps/island.webp');
  assert.equal(resolveAsset('maps',{id:'missing'},{localFiles:files}).src,'/maps/placeholder.svg');
  for(const id of ['clash-for-glory-s1','clash-for-glory-s2']) assert.equal(resolveAsset('tournaments',{id},{localFiles:files}).src,`/tournaments/${id}.webp`);
  assert.equal(resolveAsset('tournaments',{id:'new-cup',poster_asset_key:'tournaments/new/poster.webp'},{localFiles:files}).src,null);
});

test('Thumbnail optimizes bundled paths and preserves future media/HTTPS with fallback', () => {
  assert.equal(thumbnailSource('/players/real.webp','/players/default.webp',true),'/players/real.webp');
  assert.equal(thumbnailSource('/players/missing.webp','/players/default.webp',false),'/players/default.webp');
  assert.equal(thumbnailSource('/media/players/1/a.webp','/players/default.webp',false),'/media/players/1/a.webp');
  assert.equal(thumbnailSource('https://example.com/photo.webp','/players/default.webp',false),'https://example.com/photo.webp');
});

test('Randomizer and Veto receive resolved map sources from the same resolver', () => {
  const randomizer=readFileSync('src/components/tools/MapRandomizerTool.astro','utf8');
  const veto=readFileSync('src/components/tools/VetoTool.astro','utf8');
  assert.match(randomizer,/resolveAsset\('maps', map\)\.src/);
  assert.match(veto,/resolveAsset\('maps', map\)\.src/);
  assert.doesNotMatch(randomizer+veto,/\/maps\/\$\{/);
});

test('0009 upgrades populated 0008 additively; fresh 0001–0009 is FK clean and statistics unchanged', () => {
  execFileSync(process.execPath,['scripts/generate-d1-seed.mjs'],{stdio:'pipe'});
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    const migrations=readdirSync('migrations').filter(name=>/^000[1-9]_.*\.sql$/.test(name)).sort();
    assert.equal(migrations.length,9);
    for(const file of migrations.slice(0,8)) db.exec(readFileSync(`migrations/${file}`,'utf8'));
    db.exec(readFileSync('.generated/seed-s1-s2.sql','utf8'));
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
    const before=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));
    db.exec(readFileSync(`migrations/${migrations[8]}`,'utf8'));
    for(const table of tables){
      const after=db.prepare(`SELECT * FROM ${table}`).all();
      if(assetFields[table]){
        assert.ok(after.every(row=>row[assetFields[table]]===null));
        const column=db.prepare(`PRAGMA table_info(${table})`).all().find(col=>col.name===assetFields[table]);
        assert.equal(column.notnull,0);assert.equal(column.dflt_value,null);
        after.forEach(row=>delete row[assetFields[table]]);
      }
      assert.deepEqual(after,before[table],table);
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const report=compareStatistics(data,Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()])));
    assert.deepEqual(report.mismatches,[]);
    for(const [tournament,kda] of [['clash-for-glory-s1',[2726,2731,1185]],['clash-for-glory-s2',[2293,2279,1133]]]){
      const row=db.prepare('SELECT SUM(s.kills) k,SUM(s.deaths) d,SUM(s.assists) a FROM player_round_stats s JOIN matches m ON m.id=s.match_id WHERE m.tournament_id=?').get(tournament);
      assert.deepEqual([row.k,row.d,row.a],kda);
    }
  } finally {db.close();}
});
