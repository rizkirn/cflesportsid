import {mutationDatabase} from './audit.mjs';
import {AdminError,readAdminForm,tournamentId} from './tournaments.mjs';
export const masterDefinitions={
 teams:{title:'Teams',singular:'Team',fields:['name','tag','region','description','color','logo'],labels:['Name','Tag','Region','Description','Color','Logo URL']},
 players:{title:'Players',singular:'Player',fields:['uid','current_ign','name','current_team_id'],labels:['UID','Current IGN','Name (optional)','Current Team']},
 maps:{title:'Maps',singular:'Map',fields:['name','active','thumbnail'],labels:['Name','Status','Image URL']},
};
function definition(key){const value=masterDefinitions[key];if(!Object.hasOwn(masterDefinitions,key))throw new AdminError('Page not found.',404);return value;}
export function masterRevision(key,row){return JSON.stringify(definition(key).fields.map(field=>row[field]??null));}
export async function readMasterForm(request,key){return readAdminForm(request,{maxBytes:16384,allowedField:field=>['intent','revision',...definition(key).fields].includes(field)});}
function text(value,label,max,required=false){const result=typeof value==='string'?value.normalize('NFKC').trim():'';const checked=label==='Description'?result.replace(/[\r\n]/g,''):result;if(required&&!result||result.length>max||/[\p{Cc}\p{Cf}]/u.test(checked))throw new AdminError(`Enter a valid ${label.toLowerCase()} (max ${max} characters).`);return result;}
function asset(value,label){const result=text(value,label,2048);if(!result)return null;if(result.startsWith('/')&&!result.startsWith('//')&&!result.includes('\\'))return result;try{const url=new URL(result);if(url.protocol==='https:'&&!url.username&&!url.password)return result;}catch{}throw new AdminError(`${label} must be an HTTPS URL or a local asset path.`);}
export async function saveMaster(db,key,id,input){
  db=mutationDatabase(db,(input.intent==='create'?'CREATE_':'EDIT_')+({teams:'TEAM',players:'PLAYER',maps:'MAP'}[key]??'INVALID'),()=>id);
 const config=definition(key);const creating=input.intent==='create';if(!creating&&input.intent!=='edit')throw new AdminError('Unknown master action.');
 const previous=creating?null:await db.prepare(`SELECT * FROM ${key} WHERE id=?`).bind(id).first();
 if(!creating&&!previous)throw new AdminError(`${config.singular} not found.`,404);
 if(previous&&input.revision!==masterRevision(key,previous))throw new AdminError('Record changed. Reload before saving.',409);
 let value;
 if(key==='teams'){
 value={name:text(input.name,'Name',120,true),tag:text(input.tag,'Tag',20,true),region:text(input.region,'Region',32,true),description:text(input.description,'Description',2000)||null,color:text(input.color,'Color',7)||null,logo:asset(input.logo,'Logo URL')};
 if(value.color&&!/^#[0-9a-f]{6}$/i.test(value.color))throw new AdminError('Color must use #RRGGBB.');
 }else if(key==='players'){
 const ign=text(input.current_ign,'Current IGN',120,true);const uid=creating?text(input.uid,'UID',64,true):previous.uid;
 if(previous&&input.uid!==undefined&&input.uid!==(previous.uid??''))throw new AdminError('UID is immutable.');
 const team=text(input.current_team_id,'Current team',120)||null;if(team&&!(await db.prepare('SELECT id FROM teams WHERE id=?').bind(team).first()))throw new AdminError('Select an existing current team.');
 value={uid,current_ign:ign,name:text(input.name,'Name',120)||ign,current_team_id:team};
 }else{
 if(!['0','1'].includes(input.active))throw new AdminError('Select Active or Inactive.');value={name:text(input.name,'Name',120,true),active:Number(input.active),thumbnail:asset(input.thumbnail,'Image URL')};
 }
 const fields=config.fields;const values=fields.map(field=>value[field]);
 try{
 if(creating){id=key==='players'?`player-${crypto.randomUUID()}`:await tournamentId(value.name);const result=await db.prepare(`INSERT INTO ${key}(id,${fields.join(',')}) VALUES(${Array(fields.length+1).fill('?').join(',')})`).bind(id,...values).run();if(!result.success||result.meta.changes!==1)throw new Error('Master create failed');}
 else{const result=await db.prepare(`UPDATE ${key} SET ${fields.map(field=>`${field}=?`).join(',')} WHERE id=? AND ${fields.map(field=>`${field} IS ?`).join(' AND ')}`).bind(...values,id,...fields.map(field=>previous[field]??null)).run();if(!result.success)throw new Error('Master edit failed');if(result.meta.changes!==1)throw new AdminError('Record changed. Reload before saving.',409);}
 }catch(error){if(/UNIQUE constraint failed/.test(String(error?.message)))throw new AdminError('This UID or name identity already exists. Open the existing record.',409);if(/FOREIGN KEY constraint failed/.test(String(error?.message)))throw new AdminError('Current team changed. Reload before saving.',409);throw error;}
 return id;
}
