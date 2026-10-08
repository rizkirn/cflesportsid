import {AdminError} from './tournaments.mjs';
import {inspectWebP,ImageValidationError} from './webp-upload.mjs';
export {MAX_IMAGE_BYTES,imageLimits} from './webp-upload.mjs';
export function inspectImage(bytes,category,options){
 try{return inspectWebP(bytes,category,options);}catch(error){
  if(error instanceof ImageValidationError)throw new AdminError(error.message,error.status);
  throw error;
 }
}
export async function validateImage(bytes,category,{filename='',mime='',decode}={}){
 const info=inspectImage(bytes,category,{filename,mime});
 try{
  const image=await decode(bytes,info.format);
  if(image.width!==info.width||image.height!==info.height||image.data.length!==info.width*info.height*4)throw new Error('Invalid decoded image');
 }catch{throw new AdminError('Choose a valid, static WebP image.',422);}
 return info;
}
