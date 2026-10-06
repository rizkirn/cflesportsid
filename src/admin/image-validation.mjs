import {AdminError} from './tournaments.mjs';
export const MAX_IMAGE_BYTES=5*1024*1024;
export const imageLimits={teams:{side:1024,pixels:1048576},players:{side:1024,pixels:1048576},maps:{side:4096,pixels:4194304},tournaments:{side:3072,pixels:4194304}};
const bad=()=>{throw new AdminError('Choose a valid, static WebP, PNG or JPEG image.',422);};
const ascii=(b,o,n)=>String.fromCharCode(...b.subarray(o,o+n));
const crc=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
export function inspectImage(bytes,category){
 if(!(bytes instanceof Uint8Array)||!bytes.length)bad();if(bytes.length>MAX_IMAGE_BYTES)throw new AdminError('Image must be 5 MiB or smaller.',413);
 const limit=imageLimits[category];if(!limit)bad();const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let format,width,height;
 try{
 if(bytes.length>=33&&ascii(bytes,1,3)==='PNG'&&bytes[0]===137&&ascii(bytes,4,4)==='\r\n\x1a\n'){
 format='png';let o=8,ihdr=0,idat=0,end=false;
 while(o<bytes.length){if(o+12>bytes.length)bad();const n=v.getUint32(o),type=ascii(bytes,o+4,4);if(o+12+n>bytes.length)bad();if(crc(bytes.subarray(o+4,o+8+n))!==v.getUint32(o+8+n))bad();
 if(type==='acTL'||type==='fcTL'||type==='fdAT')bad();if(type==='IHDR'){if(o!==8||n!==13||ihdr++)bad();width=v.getUint32(o+8);height=v.getUint32(o+12);}if(type==='IDAT')idat++;if(type==='IEND'){if(n!==0||o+12!==bytes.length)bad();end=true;}o+=12+n;}
 if(ihdr!==1||!idat||!end)bad();
 }else if(bytes.length>=20&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,4)==='WEBP'){
 format='webp';if(v.getUint32(4,true)+8!==bytes.length)bad();let o=12,frames=0,extended;
 while(o<bytes.length){if(o+8>bytes.length)bad();const type=ascii(bytes,o,4),n=v.getUint32(o+4,true),p=o+8;if(p+n+(n&1)>bytes.length)bad();if(type==='ANIM'||type==='ANMF')bad();
 if(type==='VP8X'){if(n!==10||extended||bytes[p]&2)bad();extended=[1+bytes[p+4]+(bytes[p+5]<<8)+(bytes[p+6]<<16),1+bytes[p+7]+(bytes[p+8]<<8)+(bytes[p+9]<<16)];}
 if(type==='VP8 '){if(++frames!==1||n<10||bytes[p]&1||ascii(bytes,p+3,3)!=='\x9d\x01\x2a')bad();width=v.getUint16(p+6,true)&0x3fff;height=v.getUint16(p+8,true)&0x3fff;}
 if(type==='VP8L'){if(++frames!==1||n<5||bytes[p]!==0x2f)bad();const bits=v.getUint32(p+1,true);if(bits>>>29)bad();width=1+(bits&0x3fff);height=1+((bits>>>14)&0x3fff);}
 o=p+n+(n&1);}
 if(frames!==1||extended&&(extended[0]!==width||extended[1]!==height))bad();
 }else if(bytes[0]===255&&bytes[1]===216){
 format='jpeg';let o=2,frames=0,scans=0,end=false;
 while(o<bytes.length){if(bytes[o++]!==255)bad();while(bytes[o]===255)o++;const marker=bytes[o++];if(marker===217){if(o!==bytes.length)bad();end=true;break;}if(marker===216||marker===0||marker>=208&&marker<=215)bad();if(o+2>bytes.length)bad();const n=v.getUint16(o);if(n<2||o+n>bytes.length)bad();
 if(marker===226&&ascii(bytes,o+2,4)==='MPF\0')bad();
 if([192,193,194].includes(marker)){if(++frames!==1||n<8||bytes[o+2]!==8)bad();height=v.getUint16(o+3);width=v.getUint16(o+5);}
 else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))bad();o+=n;
 if(marker===218){scans++;while(o<bytes.length){if(bytes[o]!==255){o++;continue;}if(bytes[o+1]===0||bytes[o+1]>=208&&bytes[o+1]<=215){o+=2;continue;}break;}}
 }if(frames!==1||!scans||!end)bad();
 }else bad();
 }catch(e){if(e instanceof AdminError)throw e;bad();}
 if(!width||!height||width>limit.side||height>limit.side||width*height>limit.pixels)throw new AdminError(`Image exceeds ${limit.side}px per side or ${limit.pixels.toLocaleString('en-US')} pixels.`,422);
 return {format,mime:`image/${format}`,extension:format==='jpeg'?'jpg':format,width,height};
}
export async function validateImage(bytes,category,{filename='',mime='',decode}={}){
 const info=inspectImage(bytes,category);const ext=filename.toLowerCase().split('.').at(-1);
 if(filename&&!({webp:['webp'],png:['png'],jpeg:['jpg','jpeg']}[info.format].includes(ext)))throw new AdminError('Filename extension does not match the image.',422);
 if(mime&&mime!=='application/octet-stream'&&mime!==info.mime)throw new AdminError('Image type does not match its contents.',422);
 try{const image=await decode(bytes,info.format);if(image.width!==info.width||image.height!==info.height||image.data.length!==info.width*info.height*4)bad();}catch{bad();}
 return info;
}
