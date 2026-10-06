export const MAX_IMAGE_BYTES:number;
export const imageLimits:Record<string,{side:number;pixels:number}>;
export function inspectImage(bytes:Uint8Array,category:string):{format:string;mime:string;extension:string;width:number;height:number};
export function validateImage(bytes:Uint8Array,category:string,options:{filename?:string;mime?:string;decode:(bytes:Uint8Array,format:string)=>Promise<{width:number;height:number;data:Uint8Array|Uint8ClampedArray}>}):Promise<ReturnType<typeof inspectImage>>;
