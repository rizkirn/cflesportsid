import test from 'node:test';
import assert from 'node:assert/strict';
import { validAssetKey, assetMediaPath } from '../src/utils/asset-keys.mjs';
import { serveMedia } from '../src/data-access/media.mjs';
import { resolveAsset, imageFallbackHandler } from '../src/utils/assets.mjs';
const hash='a'.repeat(64);
const key=`teams/familia-nova/logo/${hash}.webp`;
const request=(path=key,method='GET')=>new Request(`https://example.com/media/${path}`,{method});

test('key allowlist accepts exactly the four v1 categories and image extensions',()=>{
  for(const [category,id,kind] of [['teams','familia-nova','logo'],['players','1345266890','avatar'],['maps','island','cover'],['tournaments','clash-for-glory-s2','poster']]){
    for(const ext of ['webp','png','jpg','jpeg']){
      const candidate=`${category}/${id}/${kind}/${hash}.${ext}`;
      assert.equal(validAssetKey(candidate),true);assert.equal(assetMediaPath(candidate,category),`/media/${candidate}`);
      assert.equal(assetMediaPath(candidate,category==='teams'?'maps':'teams'),null);
    }
  }
});
test('traversal, encoded paths, empty segments and arbitrary or non-image keys are rejected',()=>{
  for(const candidate of ['../x','%2e%2e/x','%252e%252e/x','random/path.webp',`teams//logo/${hash}.webp`,`teams/x/logo/${hash}.svg`,`teams/x/logo/${hash}.html`,`teams/x/logo/${hash}.WEBP`,`teams/x/logo/file.webp`,`teams/x/other/${hash}.webp`,`teams/-x/logo/${hash}.webp`,`players/not-uid/avatar/${hash}.webp`,`teams/a%2fb/logo/${hash}.webp`,`teams/a.b/logo/${hash}.webp`,key+'/',key+'/x',null])assert.equal(Boolean(validAssetKey(candidate)),false,String(candidate));
});
test('GET streams only body and safe HTTP headers; HEAD uses metadata only',async()=>{
  let getCalls=0,headCalls=0;
  const bucket={get:async received=>{assert.equal(received,key);getCalls++;return {body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1,2,3]));controller.close();}}),httpEtag:'"etag"',size:3,customMetadata:{secret:'must not leak'}};},head:async()=>{headCalls++;return {httpEtag:'"etag"',size:3};}};
  const get=await serveMedia(request(),bucket);assert.equal(get.status,200);assert.deepEqual([...new Uint8Array(await get.arrayBuffer())],[1,2,3]);
  assert.equal(get.headers.get('Content-Type'),'image/webp');assert.equal(get.headers.get('ETag'),'"etag"');assert.equal(get.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(get.headers.get('Cache-Control'),'public, max-age=31536000, immutable');assert.equal(get.headers.get('secret'),null);
  const head=await serveMedia(request(key,'HEAD'),bucket);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),'3');assert.equal(getCalls,1);assert.equal(headCalls,1);
});
test('every supported extension receives its correct MIME',async()=>{
  for(const [extension,mime] of [['webp','image/webp'],['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg']]){
    const response=await serveMedia(request(`maps/island/cover/${hash}.${extension}`),{get:async()=>({body:'image'})});assert.equal(response.headers.get('Content-Type'),mime);
  }
});
test('missing objects, unavailable binding and R2 failure never use immutable caching',async()=>{
  for(const bucket of [undefined,{get:async()=>null},{get:async()=>{throw Error('secret backend data');}}]){
    const response=await serveMedia(request(),bucket);assert.ok([404,503].includes(response.status));assert.equal(response.headers.get('Cache-Control'),'no-store');assert.doesNotMatch(await response.text(),/secret/);
  }
});
test('invalid requests and all mutation methods do not touch the bucket',async()=>{
  let calls=0;const bucket=new Proxy({},{get(){calls++;throw Error('must not touch');}});
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
    const response=await serveMedia(request(key,method),bucket);assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),'GET, HEAD');assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  for(const path of ['teams//logo/file.webp','random/path.webp','teams/x/logo/file.svg','teams/x/logo/file.html','%252e%252e/x'])assert.equal((await serveMedia(request(path),bucket)).status,400);
  assert.equal(calls,0);
});
test('valid resolver references activate media, invalid or cross-category references stay local',()=>{
  const team={id:'familia-nova',data:{tag:'FNOV',logo_asset_key:key}};
  assert.equal(resolveAsset('teams',team).src,`/media/${key}`);assert.equal(resolveAsset('teams',team).legacy,'/logos/FNOV.webp');
  assert.equal(resolveAsset('teams',team,{mediaEnabled:false}).src,'/logos/FNOV.webp');
  for(const reference of [null,'random/path.webp',`maps/island/cover/${hash}.webp`])assert.equal(resolveAsset('teams',{...team,data:{...team.data,logo_asset_key:reference}}).src,'/logos/FNOV.webp');
});
test('historical split refuses current R2 avatar, current and ordinary renamed players resolve normally',()=>{
  const entry={id:'1345266890',data:{uid:'1345266890',avatar:'/players/current.webp',photo_asset_key:`players/1345266890/avatar/${hash}.webp`}};
  assert.match(resolveAsset('players',entry).src,/^\/media\/players\/1345266890\/avatar\//);
  assert.equal(resolveAsset('players',{...entry,id:'1345266890--before-clash-for-glory-s2'}).src,'/players/default.webp');
  const renamed={id:'1083796629',data:{uid:'1083796629',photo_asset_key:`players/1083796629/avatar/${hash}.webp`}};
  assert.match(resolveAsset('players',renamed).src,/^\/media\/players\/1083796629\/avatar\//);
});
test('browser fallback tries local then default, clears srcset and terminates without a loop',()=>{
  const media='/media/'+key;
  const image={src:media,dataset:{},hidden:false,onerror:()=>{},removed:[],removeAttribute(name){this.removed.push(name);}};
  const error=new Function(imageFallbackHandler(media,['/logos/FNOV.webp','/logos/default.webp']));
  error.call(image);assert.equal(image.src,'/logos/FNOV.webp');error.call(image);assert.equal(image.src,'/logos/default.webp');error.call(image);assert.equal(image.hidden,true);assert.equal(image.onerror,null);assert.deepEqual(image.removed,['srcset','srcset','srcset']);
});
test('fallback handler safely quotes existing legacy URLs and poster can terminate without an image',()=>{
  const image={src:'/media/'+key,dataset:{},removeAttribute(){}};
  new Function(imageFallbackHandler(image.src,["https://example.com/photo's.webp"])).call(image);assert.equal(image.src,"https://example.com/photo's.webp");
  const poster={src:'/media/'+key,dataset:{},removeAttribute(){},hidden:false};new Function(imageFallbackHandler(poster.src,[])).call(poster);assert.equal(poster.hidden,true);
});
