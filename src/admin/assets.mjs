import {AdminError} from './tournaments.mjs';
import {MAX_IMAGE_BYTES,validateImage} from './image-validation.mjs';
import {validAssetKey} from '../utils/asset-keys.mjs';
import {resolveAsset} from '../utils/assets.mjs';
const categories={teams:{column:'logo_asset_key',kind:'logo'},players:{column:'photo_asset_key',kind:'avatar'},maps:{column:'image_asset_key',kind:'cover'},tournaments:{column:'poster_asset_key',kind:'poster'}};
export async function assetEntity(db,category,id){
 if(!Object.hasOwn(categories,category)||!/^[a-z0-9][a-z0-9-]{0,119}$/.test(id))throw new AdminError('Asset not found.',404);
 const row=await db.prepare(`SELECT * FROM ${category} WHERE id=?`).bind(id).first();if(!row)throw new AdminError('Asset not found.',404);
 if(category==='players'&&!/^[0-9]{1,20}$/.test(row.uid))throw new AdminError('Player requires a valid UID before upload.',422);
 return row;
}
export async function readAssetRequest(request){
 if(request.headers.get('origin')!==new URL(request.url).origin||(request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'))throw new AdminError('Reload and submit from this admin page.',403);
 if(!/^multipart\/form-data; boundary=/.test(request.headers.get('content-type')??''))throw new AdminError('Choose an image.',415);
 const reader=request.body?.getReader();if(!reader)throw new AdminError('Choose an image.');let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_IMAGE_BYTES+65536){await reader.cancel();throw new AdminError('Image must be 5 MiB or smaller.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let o=0;for(const c of chunks){bytes.set(c,o);o+=c.length;}
 let form;try{form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')}}).formData();}catch{throw new AdminError('Invalid image form.');}
 for(const key of form.keys())if(!['intent','expected','image'].includes(key)||form.getAll(key).length!==1)throw new AdminError('Unexpected image form fields.');
 const intent=form.get('intent'),expected=form.get('expected');if(!['upload','revert'].includes(intent)||typeof expected!=='string')throw new AdminError('Invalid image action.');
 const file=form.get('image');if(intent==='upload'&&(!file||typeof file==='string'))throw new AdminError('Choose an image.');if(intent==='revert'&&file)throw new AdminError('Unexpected image.');
 return {intent,expected:expected||null,file};
}
export async function saveAsset(db,bucket,category,id,input,decode){
 const row=await assetEntity(db,category,id),config=categories[category],previous=row[config.column]??null;
 if(!Object.hasOwn(row,config.column))throw new AdminError('Image uploads require staging migration 0009.',503);
 if(input.expected!==previous)throw new AdminError('Image changed. Reload before saving.',409);
 if(previous!==null&&!validAssetKey(previous,category))throw new AdminError('Existing image reference is invalid.',409);
 let key=null;
 if(input.intent==='upload'){
 if(!bucket)throw new AdminError('Image storage is unavailable.',503);
 if(input.file.size>MAX_IMAGE_BYTES)throw new AdminError('Image must be 5 MiB or smaller.',413);
 const bytes=new Uint8Array(await input.file.arrayBuffer());const info=await validateImage(bytes,category,{filename:input.file.name,mime:input.file.type,decode});
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
 key=`${category}/${category==='players'?row.uid:id}/${config.kind}/${hash}.${info.extension}`;if(!validAssetKey(key,category))throw new AdminError('Invalid asset identity.',422);
 if(key===previous)throw new AdminError('Choose a different image to replace the current one.',409);
 try{if(!await bucket.head(key))await bucket.put(key,bytes,{httpMetadata:{contentType:info.mime}});}catch{throw new AdminError('Image upload failed. Previous image kept.',503);}
 }else if(input.intent!=='revert')throw new AdminError('Invalid image action.');
 const result=await db.prepare(`UPDATE ${category} SET ${config.column}=? WHERE id=? AND ${config.column} IS ?${category==='players'?' AND uid IS ?':''}`).bind(key,id,previous,...(category==='players'?[row.uid]:[])).run();
 if(!result.success)throw new AdminError('Could not save image. Previous image kept.',503);if(result.meta.changes!==1)throw new AdminError('Image changed. Reload before saving.',409);
 const asset=resolveAsset(category,{...row,id,[config.column]:key});return {key,src:asset.src,legacy:asset.legacy,fallback:asset.fallback};
}
