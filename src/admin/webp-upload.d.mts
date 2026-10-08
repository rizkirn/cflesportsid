export const MAX_IMAGE_BYTES:number;
export const imageLimits:Record<string,{side:number;pixels:number}>;
export const WEBP_REQUIRED:string;
export class ImageValidationError extends Error {status:number;constructor(message:string,status?:number);}
export function inspectWebP(bytes:Uint8Array,category:string,options?:{filename?:string;mime?:string}):{format:string;mime:string;extension:string;width:number;height:number};
export function previewWebP(file:File,category:string,options?:{decode?:(file:File)=>Promise<{width:number;height:number;close:()=>void}>}):Promise<ReturnType<typeof inspectWebP>>;
