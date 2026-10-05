export function assetEntity(db:any,category:string,id:string):Promise<any>;
export function readAssetRequest(request:Request):Promise<{intent:string;expected:string|null;file:any}>;
export function saveAsset(db:any,bucket:R2Bucket|undefined,category:string,id:string,input:any,decode:any):Promise<{key:string|null;src:string|null}>;
