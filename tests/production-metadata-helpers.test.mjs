import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRODUCTION,productionReaderFlags,inspectProductionBindings,inspectCurrentSettings,compareProductionBindingMetadata} from '../scripts/production/metadata-helpers.mjs';

const bindings=()=>[{name:'DB',type:'d1',id:PRODUCTION.database},{name:'CFL_ASSETS',type:'r2_bucket',bucket_name:'cflesportsid-assets-production'},{name:'ASSETS',type:'assets'},...Object.entries(productionReaderFlags()).map(([name,text])=>({name,type:'plain_text',text}))];
test('pure helpers import only Node builtins and have no migration or filesystem dependency',()=>{
 const source=readFileSync('scripts/production/metadata-helpers.mjs','utf8');
 const imports=[...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m=>m[1]);
 assert.deepEqual(imports,['node:crypto','node:util']);
 assert.doesNotMatch(source,/\b(?:fetch|readFileSync|writeFileSync|expectedSchema)\s*\(/);
});
test('reader flags and production target retain exact project identity',()=>{
 assert.equal(Object.keys(productionReaderFlags()).length,6);
 assert.equal(productionReaderFlags().CFL_PUBLIC_DATABASE_ID,PRODUCTION.database);
 assert.equal(inspectProductionBindings(bindings()).mode,'d1');
});
test('binding comparisons preserve D1 aliases without exposing values',()=>{
 const active=bindings(),current=structuredClone(active);current[0].database_id=current[0].id;delete current[0].id;
 assert.equal(compareProductionBindingMetadata(active,current)[0].classification,'equivalent_d1_identity_alias');
 assert.equal(inspectCurrentSettings(active,current).activeBindingsPreserved,true);
 current[3].text='PRIVATE_SENTINEL';
 assert.throws(()=>inspectCurrentSettings(active,current),e=>!JSON.stringify(e).includes('PRIVATE_SENTINEL'));
});
test('routine tools have no transitive migration dependency',()=>{
 const seen=new Set();
 function inspect(path){
  if(seen.has(path))return;seen.add(path);
  assert.doesNotMatch(path,/\/(?:phase2b|phase2c|migrations)\//);
  const source=readFileSync(new URL(path),'utf8');
  for(const match of source.matchAll(/from\s+['"](\.[^'"]+)['"]/g))inspect(new URL(match[1],path).href);
 }
 for(const name of ['active-configuration','frontend-preflight','reconstruct-config'])inspect(new URL('../scripts/production/'+name+'.mjs',import.meta.url).href);
});
