// Run with PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE pointing to local installations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import ts from 'typescript';
import sharp from 'sharp';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const component=readFileSync('src/components/admin/AssetEditor.astro','utf8');
assert.doesNotMatch(component,/optimizeImage|canvas|toBlob/);
assert.match(component,/accept="image\/webp,\.webp"/);
const script=ts.transpile(component.split('<script>')[1].split('</script>')[0].replace('../../admin/webp-upload.mjs','/webp-upload.mjs'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022});
const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/admin.css"><section class="detail-section" data-asset-editor data-asset-category="teams" data-endpoint="/upload"><h3>Logo</h3><img class="master-asset-preview" data-asset-current src="/old.webp"><form class="admin-form" data-asset-expected="old-key"><label>Select logo<input type="file" accept="image/webp,.webp"></label><p class="admin-muted">WebP · up to 5 MiB · 4096 × 4096 px</p><img class="master-asset-preview" data-asset-preview hidden><div class="admin-actions"><button class="admin-button" data-asset-upload disabled>Replace Logo</button><button class="admin-outline" type="button" data-asset-revert>Revert to local</button></div><p role="status" data-asset-status></p></form></section><script type="module">${script}</script>`;
const server=createServer((req,res)=>{
 if(req.url==='/admin.css'){res.setHeader('Content-Type','text/css');res.end(['global','interior','admin'].map(name=>readFileSync(`src/styles/${name}.css`,'utf8')).join('\n'));}
 else if(req.url==='/webp-upload.mjs'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(readFileSync('src/admin/webp-upload.mjs'));}
 else if(req.url.endsWith('.webp')){res.setHeader('Content-Type','image/webp');res.end(readFileSync('public/logos/FNOV.webp'));}
 else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const valid=await sharp({create:{width:1920,height:1080,channels:4,background:{r:255,g:0,b:0,alpha:0.5}}}).webp({lossless:true}).toBuffer();
 const oversized=await sharp({create:{width:4097,height:1,channels:4,background:'red'}}).webp().toBuffer();
 for(const category of ['teams','players','maps','tournaments']){
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-asset-editor]').evaluate((el,value)=>el.dataset.assetCategory=value,category);
  await page.locator('input').setInputFiles({name:'prepared.webp',mimeType:'image/webp',buffer:valid});
  await page.waitForFunction(()=>document.querySelector('[data-asset-status]').textContent.includes('1920 × 1080'),null,{timeout:5000}).catch(async error=>{throw new Error(`${error.message}; status=${await page.locator('[data-asset-status]').textContent()}; pageErrors=${errors.join(';')}`);});
  assert.equal(await page.locator('[data-asset-upload]').isEnabled(),true);
  assert.deepEqual(await page.locator('[data-asset-preview]').evaluate(async image=>{await image.decode();return[image.naturalWidth,image.naturalHeight];}),[1920,1080]);
 }
 let uploaded;await page.route('**/upload',async route=>{uploaded=route.request().postDataBuffer();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Image upload failed. Previous image kept.'})});});
 await page.locator('[data-asset-upload]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]').textContent.includes('Previous image kept'));
 assert.equal(await page.locator('form').getAttribute('data-asset-expected'),'old-key');assert.equal(await page.locator('[data-asset-current]').getAttribute('src'),'/old.webp');
 const start=uploaded.indexOf(Buffer.from('RIFF'));assert.ok(start>0);assert.deepEqual(uploaded.subarray(start,start+valid.length),valid);
 assert.equal(await page.locator('[data-asset-upload]').isEnabled(),true);
 await page.route('**/upload',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({key:'new-key',src:'/saved.webp'})}));
 await page.locator('[data-asset-upload]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]').textContent==='Image saved.');assert.equal(await page.locator('[data-asset-upload]').isEnabled(),false);
 await page.locator('[data-asset-revert]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]').textContent==='Local image restored.');
 for(const [name,mimeType,buffer,message]of [
  ['original.png','image/png',Buffer.from('PNG'),'Please convert your image to WebP before uploading.'],
  ['original.jpg','image/jpeg',Buffer.from('JPEG'),'Please convert your image to WebP before uploading.'],
  ['large.webp','image/webp',Buffer.alloc(5*1024*1024+1),'Image must be 5 MiB or smaller.'],
  ['wide.webp','image/webp',oversized,'Image exceeds 4096px per side or 16,777,216 pixels.'],
  ['truncated.webp','image/webp',valid.subarray(0,30),'Choose a valid, static WebP image.']]){
  await page.locator('input').setInputFiles({name,mimeType,buffer});await page.waitForFunction(expected=>document.querySelector('[data-asset-status]').textContent===expected,message);
  assert.equal(await page.locator('[data-asset-upload]').isEnabled(),false);assert.equal(await page.locator('[data-asset-preview]').isVisible(),false);
 }
 await page.locator('input').setInputFiles({name:'prepared.webp',mimeType:'image/webp',buffer:valid});await page.waitForFunction(()=>document.querySelector('[data-asset-upload]').disabled===false);
 if(process.env.UPLOAD_SCREENSHOT)await page.screenshot({path:process.env.UPLOAD_SCREENSHOT});
 assert.deepEqual(errors,[]);
 console.log('PASS: four-category original preview; dimensions/size; unchanged multipart bytes; failure/retry; save/revert; format/size/dimension/truncation errors; no page errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
