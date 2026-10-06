import {bindAdminDatabase} from '../../src/admin/audit.mjs';
export const testActor=Object.freeze({sub:'test-admin',email:'test-admin@example.invalid'});
export function testAdminDatabase(raw,sql,actor=testActor,writes=true){
 raw.prepare=query=>{let values=[];const args=()=>/\?\d/.test(query)?[Object.fromEntries(values.map((v,i)=>['?'+(i+1),v]))]:values;return{sql:query,query,bind(...v){values=v;return this;},async all(){const s=sql.prepare(query);const results=s.columns().length?s.all(...args()):[];const changes=results.length?0:s.columns().length?0:Number(s.run(...args()).changes);return{success:true,results,meta:{changes}};},async first(){return (await this.all()).results[0]??null;},async run(){const result=sql.prepare(query).run(...args());return{success:true,results:[],meta:{changes:Number(result.changes)}};}};};
 if(!raw.batch)raw.batch=async items=>{sql.exec('BEGIN');try{const results=[];for(const s of items)results.push(await s.all());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}};
 return bindAdminDatabase(raw,{actor,writes});
}
