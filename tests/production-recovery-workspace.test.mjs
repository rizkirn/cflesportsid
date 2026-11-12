import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,symlinkSync,linkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {privateRecoveryDirectory,readRecoveryConfiguration,replaceRecoveryConfiguration} from '../scripts/production/recovery-workspace.mjs';
function fixture(){
 const root=mkdtempSync(tmpdir()+'/cfl-recovery-test-');chmodSync(root,0o700);
 const workspace=root+'/workspace',output=root+'/output';mkdirSync(workspace,{mode:0o700});mkdirSync(output,{mode:0o700});
 const path=workspace+'/wrangler.production.jsonc';writeFileSync(path,'{"name":"cflesportsid"}\n',{mode:0o600});
 return {root,workspace,output,path};
}
test('recovery replacement preserves exact original bytes privately and changes only the reviewed configuration',()=>{
 const f=fixture(),snapshot=readRecoveryConfiguration(f.workspace),text='{"name":"cflesportsid","keep_vars":true}\n';
 replaceRecoveryConfiguration(snapshot,f.output,text);
 assert.equal(readFileSync(f.path,'utf8'),text);assert.deepEqual(readFileSync(f.output+'/previous-config.private.json'),snapshot.bytes);
 assert.equal(statSync(f.output+'/previous-config.private.json').mode&0o777,0o600);assert.equal(statSync(f.path).mode&0o777,0o600);
});
test('recovery rejects configuration drift before replacement or backup',()=>{
 const f=fixture(),snapshot=readRecoveryConfiguration(f.workspace);writeFileSync(f.path,'changed');
 assert.throws(()=>replaceRecoveryConfiguration(snapshot,f.output,'replacement'),/CONFIGURATION_CHANGED/);assert.equal(readFileSync(f.path,'utf8'),'changed');
});
test('recovery rejects public workspace permissions',()=>{
 const f=fixture();chmodSync(f.workspace,0o755);assert.throws(()=>readRecoveryConfiguration(f.workspace),/PRIVATE_ISOLATED/);
});
test('recovery rejects output permissions and preserves source',()=>{
 const f=fixture(),snapshot=readRecoveryConfiguration(f.workspace);chmodSync(f.output,0o755);
 assert.throws(()=>replaceRecoveryConfiguration(snapshot,f.output,'changed'),/PRIVATE_ISOLATED/);assert.deepEqual(readFileSync(f.path),snapshot.bytes);
});
test('recovery rejects configuration symlinks',()=>{
 const f=fixture(),workspace=f.root+'/linked';mkdirSync(workspace,{mode:0o700});symlinkSync(f.path,workspace+'/wrangler.production.jsonc');
 assert.throws(()=>readRecoveryConfiguration(workspace),/SYMLINK_REJECTED/);
});
test('recovery rejects directory aliases and paths outside the temporary boundary',()=>{
 const f=fixture();symlinkSync(f.workspace,f.root+'/alias');assert.throws(()=>privateRecoveryDirectory(f.root+'/alias'),/PRIVATE_ISOLATED/);
 assert.throws(()=>privateRecoveryDirectory('/private'),/PRIVATE_ISOLATED/);
});
test('recovery rejects hard-linked configurations',()=>{
 const f=fixture();linkSync(f.path,f.root+'/hardlink');assert.throws(()=>readRecoveryConfiguration(f.workspace),/PATH_REJECTED/);
});
test('recovery never overwrites an existing private backup',()=>{
 const f=fixture(),snapshot=readRecoveryConfiguration(f.workspace);writeFileSync(f.output+'/previous-config.private.json','existing',{mode:0o600});
 assert.throws(()=>replaceRecoveryConfiguration(snapshot,f.output,'changed'),/EEXIST/);
 assert.deepEqual(readFileSync(f.path),snapshot.bytes);assert.equal(readFileSync(f.output+'/previous-config.private.json','utf8'),'existing');
});
