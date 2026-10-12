import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {DatabaseSync} from 'node:sqlite';
import {checkData} from '../scripts/data-tools.mjs';
import {seedFixture} from './helpers/seed-fixture.mjs';
import {readPublicData} from '../src/data-access/public-d1.mjs';
import {comparePublicContracts} from '../src/data-access/shadow-contract.mjs';

const data=checkData().data;
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/utils/veto.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const maps=data.maps;
const schemaContext={exports:{},require:name=>{
 if(name==='astro:content')return {z,defineCollection:value=>value};
 if(name==='astro/loaders')return {glob:value=>value};
 throw Error('Unexpected schema import');
}};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/content.config.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,schemaContext);
const raw=id=>JSON.parse(readFileSync(new URL('../src/data/tournaments/'+id+'.json',import.meta.url),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
const withoutPool=t=>({...t,data:{...t.data,stages:t.data.stages.map(s=>{
 const {mapPool,...stage}=s;
 if(stage.veto){const {mapPoolIds,...veto}=stage.veto;stage.veto=veto;}
 return stage;
})}});

test('Astro preserves an explicit top-level stage pool and rejects invalid pool metadata',()=>{
 const source=raw('clash-for-glory-s1'),schema=schemaContext.exports.collections.tournaments.schema;
 source.stages[0].mapPool=[...source.stages[0].veto.mapPoolIds];
 assert.deepEqual(schema.parse(source).stages[0].mapPool,source.stages[0].mapPool);
 for(const field of ['mapPool','mapPoolIds']){
  const copy=structuredClone(source),target=field==='mapPool'?copy.stages[0]:copy.stages[0].veto;
  target[field]=[''];assert.equal(schema.safeParse(copy).success,false);
  target[field]='not-an-array';assert.equal(schema.safeParse(copy).success,false);
 }
});

for(const [id,count] of [['clash-for-glory-s1',10],['clash-for-glory-s2',11]]) {
 test(id+' retains the explicit pool and registration-independent order through Astro schema',()=>{
  const source=raw(id),parsed=data.tournaments.get(id);
  assert.equal(source.stages[0].veto.mapPoolIds.length,count);
  assert.deepEqual(parsed.data.stages[0].veto.mapPoolIds,source.stages[0].veto.mapPoolIds);
  assert.equal(Object.hasOwn(parsed.data.stages[0],'mapPool'),false);
 });
 test(id+' preserves the existing hybrid veto result and active-map behavior',()=>{
  const current=data.tournaments.get(id).data.stages[0];
  const previous=withoutPool(data.tournaments.get(id)).data.stages[0];
  const result=context.exports.resolveVeto(current,maps);
  assert.deepEqual(plain(result),plain(context.exports.resolveVeto(previous,maps)));
  assert.deepEqual(Object.keys(result).sort(),['steps','finalMap','actionSeconds','reserveSeconds','maps'].sort());
  assert.deepEqual(Array.from(result.maps,m=>m.id),[...maps.values()].filter(m=>m.data.active).sort((a,b)=>a.data.name.localeCompare(b.data.name)).map(m=>m.id));
 });
}

test('historical tournaments reproduce two old mismatches and zero corrected D1 projection mismatches',async()=>{
 const sql=new DatabaseSync(':memory:');
 try {
  sql.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>/^00(?:0[1-9]|1[01])_.*\.sql$/.test(f)).sort())sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  sql.exec(seedFixture());
  const binding={prepare:query=>({query}),batch:async items=>items.map(({query})=>({success:true,results:sql.prepare(query).all()}))};
  const projected=(await readPublicData(binding)).tournaments;
  const parsed=[...data.tournaments.values()];
  assert.equal(comparePublicContracts('tournaments',parsed.map(withoutPool),projected).mismatches,2);
  assert.deepEqual(comparePublicContracts('tournaments',parsed,projected),{contract:'tournaments',mismatches:0,fields:[]});
  for(const t of parsed){
   const d=projected.find(p=>p.id===t.id);
   assert.deepEqual(d.data.stages[0].mapPool,t.data.stages[0].veto.mapPoolIds);
   const reordered=structuredClone(d);reordered.data.stages[0].mapPool.reverse();
   assert.equal(comparePublicContracts('tournaments',[t],[reordered]).mismatches,1);
   const changed=structuredClone(d);changed.data.stages[0].mapPool.pop();
   assert.equal(comparePublicContracts('tournaments',[t],[changed]).mismatches,1);
   assert.equal(comparePublicContracts('tournaments',[withoutPool(t)],[withoutPool(d)]).mismatches,0);
  }
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 } finally {sql.close();}
});
