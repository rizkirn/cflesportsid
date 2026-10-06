import webp,{init as initWebp} from '@jsquash/webp/decode.js';
import png,{init as initPng} from '@jsquash/png/decode.js';
import jpeg,{init as initJpeg} from '@jsquash/jpeg/decode.js';
import webpWasm from '@jsquash/webp/codec/dec/webp_dec.wasm?module';
import pngWasm from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm?module';
import jpegWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?module';
const ready:Partial<Record<string,Promise<unknown>>>={};
export async function decodeImage(bytes:Uint8Array,format:string){
 const buffer=bytes.slice().buffer;
 if(format==='webp'){ready.webp??=initWebp(webpWasm);await ready.webp;return webp(buffer);}
 if(format==='png'){ready.png??=initPng(pngWasm);await ready.png;return png(buffer);}
 if(format==='jpeg'){ready.jpeg??=initJpeg(jpegWasm);await ready.jpeg;return jpeg(buffer,{preserveOrientation:true});}
 throw new Error('Unsupported image');
}
