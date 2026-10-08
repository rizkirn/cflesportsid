export const MAX_IMAGE_BYTES=5*1024*1024;
export const imageLimits=Object.fromEntries(['teams','players','maps','tournaments'].map(category=>[category,{side:4096,pixels:16777216}]));
export const WEBP_REQUIRED='Please convert your image to WebP before uploading.';
export class ImageValidationError extends Error {
 constructor(message,status=422){super(message);this.status=status;}
}
const invalid=()=>{throw new ImageValidationError('Choose a valid, static WebP image.');};
const ascii=(bytes,offset,length)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
export function inspectWebP(bytes,category,{filename='',mime=''}={}){
 if(!(bytes instanceof Uint8Array)||!bytes.length)invalid();
 if(bytes.length>MAX_IMAGE_BYTES)throw new ImageValidationError('Image must be 5 MiB or smaller.',413);
 if(!Object.hasOwn(imageLimits,category))invalid();
 if(filename&&!/\.webp$/i.test(filename)||mime&&mime!=='image/webp')throw new ImageValidationError(WEBP_REQUIRED);
 if(bytes.length<12||ascii(bytes,0,4)!=='RIFF'||ascii(bytes,8,4)!=='WEBP')throw new ImageValidationError(WEBP_REQUIRED);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(4,true)+8!==bytes.length)invalid();
 let offset=12,width,height,frames=0,extended,alpha=false;
 while(offset<bytes.length){
  if(offset+8>bytes.length)invalid();
  const type=ascii(bytes,offset,4),size=view.getUint32(offset+4,true),start=offset+8;
  if(start+size+(size&1)>bytes.length||size&1&&bytes[start+size]!==0)invalid();
  if(type==='VP8X'){
   if(offset!==12||size!==10||extended||bytes[start]&0xc3||bytes[start+1]||bytes[start+2]||bytes[start+3])invalid();
   extended=[1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16),1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16),bytes[start]];
  }else if(type==='VP8 '){
   if(++frames!==1||size<10||bytes[start]&1||ascii(bytes,start+3,3)!=='\x9d\x01\x2a')invalid();
   width=view.getUint16(start+6,true)&0x3fff;height=view.getUint16(start+8,true)&0x3fff;
  }else if(type==='VP8L'){
   if(++frames!==1||alpha||size<5||bytes[start]!==0x2f)invalid();
   const bits=view.getUint32(start+1,true);if(bits>>>29)invalid();
   width=1+(bits&0x3fff);height=1+((bits>>>14)&0x3fff);
  }else if(type==='ALPH'){
   if(!extended||!(extended[2]&16)||alpha||frames||!size)invalid();alpha=true;
  }else if(!['ICCP','EXIF','XMP '].includes(type)||!extended)invalid();
  offset=start+size+(size&1);
 }
 if(frames!==1||!width||!height||extended&&(extended[0]!==width||extended[1]!==height))invalid();
 const limit=imageLimits[category];
 if(width>limit.side||height>limit.side||width*height>limit.pixels)throw new ImageValidationError('Image exceeds 4096px per side or 16,777,216 pixels.');
 return {format:'webp',mime:'image/webp',extension:'webp',width,height};
}
export async function previewWebP(file,category,{decode=blob=>createImageBitmap(blob)}={}){
 if(file.size>MAX_IMAGE_BYTES)throw new ImageValidationError('Image must be 5 MiB or smaller.',413);
 const info=inspectWebP(new Uint8Array(await file.arrayBuffer()),category,{filename:file.name,mime:file.type});
 let image;
 try{image=await decode(file);if(image.width!==info.width||image.height!==info.height)invalid();}catch{invalid();}finally{image?.close();}
 return info;
}
