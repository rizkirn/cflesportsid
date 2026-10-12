import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {check,sha,MIGRATION,MIGRATION_HASH,ROOT,same} from './guards.mjs';

export function normalizedSQL(sql){
  return sql.replace(/'(?:''|[^'])*'|"(?:[^"]|"")*"|[^'"]+/g,part=>part.startsWith("'")?part:part.replace(/["\s;]/g,'').toLowerCase());
}
export function verifyMigrationHash(name,bytes,pinned){
  check(sha(bytes)===pinned[name],'MIGRATION_HASH_REJECTED');
  if(name===MIGRATION)check(sha(bytes)===MIGRATION_HASH,'MIGRATION_HASH_REJECTED');
}
export function expectedSchema(version=10){
  check([10,11].includes(version),'SCHEMA_VERSION_REJECTED');
  const pinned=JSON.parse(readFileSync(join(ROOT,'scripts/phase2b/migration-hashes.json'),'utf8'));
  const files=readdirSync(join(ROOT,'migrations')).filter(n=>n.endsWith('.sql')).sort();
  same(files,Object.keys(pinned).sort(),'MIGRATION_FILES_REJECTED');
  const objects=new Map();
  for(const name of files){
    const bytes=readFileSync(join(ROOT,'migrations',name));
    verifyMigrationHash(name,bytes,pinned);
    if(name===MIGRATION&&version===10)continue;
    const source=bytes.toString().replace(/^\s*--.*$/gm,'');
    const statements=source.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW)\s+[\s\S]*?;|CREATE\s+TRIGGER\s+[\s\S]*?\bEND\s*;|DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)\s+[\s\S]*?;|ALTER\s+TABLE\s+[\s\S]*?;/gi)??[];
    for(const statement of statements){
      let m=statement.match(/^CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\s+(\w+)/i);
      if(m){objects.set(m[2],{name:m[2],type:m[1].toLowerCase(),sql:statement});continue;}
      m=statement.match(/^DROP\s+(TABLE|INDEX|TRIGGER|VIEW)\s+(\w+)/i);
      if(m){
        objects.delete(m[2]);
        if(m[1].toLowerCase()==='table')for(const [key,value]of objects)if(value.type==='index'&&new RegExp('ON\\s+'+m[2]+'\\b','i').test(value.sql))objects.delete(key);
        continue;
      }
      m=statement.match(/^ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)\s*;$/i);
      if(m){const item=objects.get(m[1]);check(item,'UNKNOWN_RENAME_TARGET');objects.delete(m[1]);item.name=m[2];item.sql=item.sql.replace(new RegExp('\\b'+m[1]+'\\b','g'),m[2]);objects.set(m[2],item);continue;}
      m=statement.match(/^ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+([\s\S]*?);$/i);
      check(m,'UNSUPPORTED_DDL');
      const item=objects.get(m[1]);check(item,'UNKNOWN_ALTER_TARGET');
      item.sql=m[1]==='matches'?item.sql.replace(/FOREIGN KEY/,m[2]+', FOREIGN KEY'):item.sql.replace(/\)\s*;$/,', '+m[2]+');');
    }
  }
  return {files,objects:[...objects.values()]};
}
export function compareSchema(actual,expected){
  same(actual.map(o=>o.type+':'+o.name).sort(),expected.map(o=>o.type+':'+o.name).sort(),'SCHEMA_OBJECTS_REJECTED');
  for(const object of expected)check(normalizedSQL(actual.find(o=>o.name===object.name).sql)===normalizedSQL(object.sql),'SCHEMA_DEFINITION_REJECTED:'+object.name);
}
