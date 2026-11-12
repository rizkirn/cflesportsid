import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const check=(ok,code)=>{if(!ok)throw Error(code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
export const PRODUCTION=Object.freeze({account:'bf6ed4ccd73133871881b47ea58dae3d',database:'efded3c4-1cf9-46a9-823e-d0f2d17c683a',databaseName:'cflesportsid',worker:'cflesportsid',hostname:'cflesports.com'});
export const PRODUCTION_ZONE='c8fed6ca36bcc7f2a22cd1b6aa713091';
export function productionReaderFlags() {
  return {CFL_PUBLIC_MODE:'d1', CFL_PUBLIC_ENVIRONMENT:'production', CFL_PUBLIC_ACCOUNT_ID:PRODUCTION.account,
    CFL_PUBLIC_WORKER:PRODUCTION.worker, CFL_PUBLIC_HOSTNAME:PRODUCTION.hostname, CFL_PUBLIC_DATABASE_ID:PRODUCTION.database};
}
export function inspectProductionBindings(bindings){
 check(Array.isArray(bindings)&&new Set(bindings.map(b=>b.name)).size===bindings.length,'PRODUCTION_BINDINGS_AMBIGUOUS');
 const databases=bindings.filter(b=>b.type==='d1');check(databases.length===1&&databases[0].name==='DB'&&(databases[0].id??databases[0].database_id)===PRODUCTION.database,'PRODUCTION_DATABASE_REJECTED');
 const buckets=bindings.filter(b=>b.type==='r2_bucket');check(buckets.length===1&&buckets[0].name==='CFL_ASSETS'&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(buckets[0].bucket_name)&&!/(staging|uat|test)/i.test(buckets[0].bucket_name),'PRODUCTION_R2_REJECTED');
 check(bindings.filter(b=>b.type==='assets').length===1&&bindings.some(b=>b.type==='assets'&&b.name==='ASSETS'),'PRODUCTION_ASSETS_REJECTED');
 const flags=Object.fromEntries(bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
 const mode=flags.CFL_PUBLIC_MODE??'hybrid';
 check(['hybrid','d1'].includes(mode)&&(!bindings.some(b=>b.name==='CFL_PUBLIC_MODE')||typeof flags.CFL_PUBLIC_MODE==='string'),'PRODUCTION_BASELINE_MODE_REJECTED');
 check(!bindings.some(b=>b.name==='CFL_PUBLIC_LOCAL'),'PRODUCTION_LOCAL_FLAGS_REJECTED');
 for(const [name,value]of Object.entries({CFL_PUBLIC_ACCOUNT_ID:PRODUCTION.account,CFL_PUBLIC_ENVIRONMENT:'production',CFL_PUBLIC_WORKER:PRODUCTION.worker,CFL_PUBLIC_HOSTNAME:PRODUCTION.hostname,CFL_PUBLIC_DATABASE_ID:PRODUCTION.database}))check((mode==='hybrid'&&!bindings.some(b=>b.name===name))||flags[name]===value,'PRODUCTION_FLAGS_REJECTED');
 check(!bindings.some(b=>b.type==='service'||b.type==='dispatch_namespace'||b.type==='queue'||b.type==='durable_object_namespace'),'UNREVIEWED_PRODUCTION_RESOURCE');
 const auth=bindings.filter(b=>b.name.startsWith('ADMIN_')).sort((a,b)=>a.name.localeCompare(b.name));
 return {mode,bucket:buckets[0].bucket_name,bindingsHash:sha(JSON.stringify(bindings)),authenticationFingerprint:sha(JSON.stringify(auth)),authenticationBindingCount:auth.length,secretValuesVerified:false};
}
function normalizeBindingMetadata(binding) {
 if(binding.type!=='d1')return binding;
 const {id,database_id,...rest}=binding;
 return {...rest,id:id??database_id};
}
function differingMetadataFields(a,b) {
 return [...new Set([...Object.keys(a??{}),...Object.keys(b??{})])].sort().filter(key=>
  Object.hasOwn(a??{},key)!==Object.hasOwn(b??{},key)||!isDeepStrictEqual(a?.[key],b?.[key]));
}
export function compareProductionBindingMetadata(activeBindings,currentBindings) {
 check(Array.isArray(activeBindings)&&Array.isArray(currentBindings),'PRODUCTION_SETTINGS_AMBIGUOUS');
 const current=new Map(currentBindings.map(b=>[b.name,b]));
 return activeBindings.flatMap(active=>{
  const other=current.get(active.name);
  const aliasConflict=[active,other].some(b=>b?.type==='d1'&&b.id!==undefined&&b.database_id!==undefined&&b.id!==b.database_id);
  const rawFields=differingMetadataFields(active,other);
  const fields=other?differingMetadataFields(normalizeBindingMetadata(active),normalizeBindingMetadata(other)):rawFields;
  if(!aliasConflict&&other&&fields.length===0&&rawFields.length===0)return [];
  return [{bindingName:active.name,activeType:active.type,currentType:other?.type??null,
   differingFields:aliasConflict?[...new Set([...rawFields,'id','database_id'])].sort():rawFields,
   classification:!aliasConflict&&other&&fields.length===0?'equivalent_d1_identity_alias':other?'semantic_or_unverified':'missing_active_binding',
   normalizedDifferingFields:aliasConflict?['id','database_id']:fields}];
 });
}
export function inspectCurrentSettings(activeBindings, currentBindings) {
 inspectProductionBindings(activeBindings);
 check(Array.isArray(currentBindings)&&new Set(currentBindings.map(b=>b.name)).size===currentBindings.length,'PRODUCTION_SETTINGS_AMBIGUOUS');
 const activeNames=new Set(activeBindings.map(b=>b.name));
 const extras=currentBindings.filter(b=>!activeNames.has(b.name));
 const additionalD1Bindings=extras.filter(b=>b.type==='d1').map(b=>({name:b.name,databaseId:b.id??b.database_id,purpose:(b.id??b.database_id)==='4ba57de7-5fda-4703-a956-b1936546986a'?'known staging database':'unverified database purpose'}));
 const bindingDifferences=compareProductionBindingMetadata(activeBindings,currentBindings);
 const rejected=bindingDifferences.filter(b=>b.classification!=='equivalent_d1_identity_alias');
 if(rejected.length) {
  const error=Error(rejected.some(b=>b.classification==='missing_active_binding')?'PRODUCTION_SETTINGS_MISSING_ACTIVE_BINDING':'PRODUCTION_INHERITED_BINDING_DRIFT');
  error.bindingDifferences=bindingDifferences;error.additionalD1Bindings=additionalD1Bindings;throw error;
 }
 check(extras.every(b=>b.type==='d1'&&typeof(b.id??b.database_id)==='string'&&(b.id===undefined||b.database_id===undefined||b.id===b.database_id)),'PRODUCTION_UNREVIEWED_SETTINGS_BINDING');
 return {currentSettingsHash:sha(JSON.stringify(currentBindings)),additionalD1Bindings,bindingDifferences,activeBindingsPreserved:true};
}
