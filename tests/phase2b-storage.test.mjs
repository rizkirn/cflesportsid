import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {ROOT,TARGET,MIGRATION_HASH,authorize} from '../scripts/phase2b/guards.mjs';
import {prepareOperation,verifyExport} from '../scripts/phase2b/operations.mjs';
import {validateBackupDirectory,verifyCapacity,CAPACITY_RESERVE,writePrivateFile,syncDirectory} from '../scripts/phase2b/storage.mjs';
import {sha} from '../scripts/phase2b/guards.mjs';

function fixture(t){const root=fs.mkdtempSync('/private/tmp/cfl-storage-test-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true}));return root;}
const report=()=>({status:'PASS',checkedAt:new Date().toISOString(),target:TARGET,migrationHash:MIGRATION_HASH,configHash:'mock-config'});
const payload=parent=>({maintenanceWindowConfirmed:true,outputDirectory:join(parent,'cfl-phase2b-backup-new')});

test('private persistent parent accepts a new explicit backup child',t=>{const parent=fixture(t);assert.equal(validateBackupDirectory(payload(parent).outputDirectory).parent,parent);assert.ok(prepareOperation('backup',report(),payload(parent)).digest);});
test('legacy sticky temporary parent remains supported',()=>assert.equal(validateBackupDirectory('/private/tmp/cfl-phase2b-backup-storage-test').parent,'/private/tmp'));
test('repository destination rejected',()=>assert.throws(()=>validateBackupDirectory(join(ROOT,'cfl-phase2b-backup-test')),/REPOSITORY/));
test('relative, tilde and noncanonical paths rejected',()=>{for(const path of ['backup','~/Documents/cfl-phase2b-backup-test','/private/tmp/../tmp/cfl-phase2b-backup-test'])assert.throws(()=>validateBackupDirectory(path),/DIRECTORY/);});
test('public parent permissions rejected',t=>{const parent=fixture(t);fs.chmodSync(parent,0o755);assert.throws(()=>validateBackupDirectory(payload(parent).outputDirectory),/NOT_PRIVATE/);});
test('missing parent rejected',t=>assert.throws(()=>validateBackupDirectory(join(fixture(t),'missing','cfl-phase2b-backup-new'))));
test('symlink parent and dangling destination rejected',t=>{const root=fixture(t),alias=join(root,'alias');fs.symlinkSync(root,alias);assert.throws(()=>validateBackupDirectory(join(alias,'cfl-phase2b-backup-new')),/SYMLINK/);const dest=payload(root).outputDirectory;fs.symlinkSync(join(root,'missing'),dest);assert.throws(()=>validateBackupDirectory(dest),/ALREADY_EXISTS/);});
test('existing backup never overwritten',t=>{const dest=payload(fixture(t)).outputDirectory;fs.mkdirSync(dest,0o700);assert.throws(()=>validateBackupDirectory(dest),/ALREADY_EXISTS/);});
test('capacity accepts reserve and rejects insufficient space',()=>{const inspect=()=>({bavail:BigInt(CAPACITY_RESERVE+10),bsize:1n});assert.equal(verifyCapacity('/mock',10,inspect),BigInt(CAPACITY_RESERVE+10));assert.throws(()=>verifyCapacity('/mock',11,inspect),/CAPACITY/);assert.throws(()=>verifyCapacity('/mock',-1,inspect),/SIZE/);});
test('private file is exclusive, restrictive and checksum-verifiable',t=>{const root=fixture(t),file=join(root,'synthetic.sql'),bytes=Buffer.from('synthetic storage-test data; no remote export');writePrivateFile(file,bytes);syncDirectory(root);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.throws(()=>writePrivateFile(file,Buffer.from('replacement')),/EEXIST/);const manifest={kind:'cfl-phase2b-backup-v1',target:TARGET,bytes:bytes.length,exportSHA256:sha(bytes)};assert.equal(verifyExport(fs.readFileSync(file),manifest),true);assert.throws(()=>verifyExport(Buffer.from('tampered'),manifest),/CHECKSUM/);});
test('destination is digest-bound and cannot change after approval',t=>{const parent=fixture(t),r=report(),p=payload(parent),plan=prepareOperation('backup',r,p);const now=Date.now();const approval={format:'cfl-phase2b-approval-v1',approved:true,target:TARGET,operation:'backup',planDigest:plan.digest,approvedBy:'in-memory storage test',id:'storage-test-approval-123',issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};authorize(approval,plan);const changed=prepareOperation('backup',r,{...p,outputDirectory:join(parent,'cfl-phase2b-backup-other')});assert.notEqual(changed.digest,plan.digest);assert.throws(()=>authorize(approval,changed),/SCOPE/);assert.throws(()=>authorize(approval,{...plan,payload:changed.payload}),/TAMPERED/);});
