import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePublicMode, publicSitemapPaths} from '../src/data-access/public-mode.mjs';
const bindings = {CFL_PUBLIC_MODE:'shadow',CFL_PUBLIC_LOCAL:'phase1c-disposable',CFL_PUBLIC_DATABASE_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
test('hybrid remains the default',()=>assert.equal(resolvePublicMode({},false,new URL('https://cflesports.com')),'hybrid'));
test('shadow and D1 require isolated local development',()=>{
  for(const mode of ['shadow','d1']) assert.equal(resolvePublicMode({...bindings,CFL_PUBLIC_MODE:mode},true,new URL('http://127.0.0.1')),mode);
  for(const [env,dev,url] of [[bindings,false,'http://127.0.0.1'],[bindings,true,'https://cflesports.com'],[{...bindings,CFL_PUBLIC_LOCAL:undefined},true,'http://127.0.0.1'],[{...bindings,CFL_PUBLIC_DATABASE_ID:'efded3c4-1cf9-46a9-823e-d0f2d17c683a'},true,'http://127.0.0.1'],[{...bindings,CFL_PUBLIC_DATABASE_ID:'4ba57de7-5fda-4703-a956-b1936546986a'},true,'http://127.0.0.1']])assert.throws(()=>resolvePublicMode(env,dev,new URL(url)),/LOCAL_PUBLIC_MODE_REQUIRED/);
});
test('sitemap retains canonical historical paths',()=>assert.deepEqual(publicSitemapPaths({teams:[{id:'team'}],players:[{id:'uid--before-season'}],maps:[{id:'a b'}],matches:[],tournaments:[]}),['/maps/a%20b/','/players/uid--before-season/','/teams/team/']));
