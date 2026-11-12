import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readFileSync,writeFileSync,writeSync,ftruncateSync,fchmodSync,fsyncSync} from 'node:fs';
import {resolve} from 'node:path';

const need=(ok,code)=>{if(!ok)throw Error(code);};
export function privateRecoveryDirectory(directory) {
 const path=resolve(directory);
 need(path.startsWith('/private/tmp/'),'PRIVATE_ISOLATED_WORKSPACE_REQUIRED');
 const stat=lstatSync(path);
 need(realpathSync(path)===path&&!stat.isSymbolicLink()&&stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0,'PRIVATE_ISOLATED_WORKSPACE_REQUIRED');
 return path;
}
export function readRecoveryConfiguration(workspace) {
 const root=privateRecoveryDirectory(workspace),path=root+'/wrangler.production.jsonc';
 const stat=lstatSync(path);
 need(!stat.isSymbolicLink(),'CONFIGURATION_SYMLINK_REJECTED');
 need(stat.isFile()&&stat.nlink===1&&stat.uid===process.getuid(),'RECOVERY_CONFIGURATION_PATH_REJECTED');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {
  const opened=fstatSync(fd);need(opened.dev===stat.dev&&opened.ino===stat.ino,'RECOVERY_CONFIGURATION_CHANGED');
  return {workspace:root,path,dev:opened.dev,ino:opened.ino,bytes:readFileSync(fd)};
 }finally{closeSync(fd);}
}
export function replaceRecoveryConfiguration(snapshot,output,configText) {
 privateRecoveryDirectory(snapshot.workspace);privateRecoveryDirectory(output);
 const current=readRecoveryConfiguration(snapshot.workspace);
 need(current.path===snapshot.path&&current.dev===snapshot.dev&&current.ino===snapshot.ino&&current.bytes.equals(snapshot.bytes),'RECOVERY_CONFIGURATION_CHANGED');
 const fd=openSync(snapshot.path,constants.O_RDWR|constants.O_NOFOLLOW);
 try {
  const stat=fstatSync(fd);
  need(stat.dev===snapshot.dev&&stat.ino===snapshot.ino&&stat.nlink===1&&readFileSync(fd).equals(snapshot.bytes),'RECOVERY_CONFIGURATION_CHANGED');
  writeFileSync(output+'/previous-config.private.json',snapshot.bytes,{mode:0o600,flag:'wx'});
  fchmodSync(fd,0o600);ftruncateSync(fd,0);const bytes=Buffer.from(configText);let offset=0;while(offset<bytes.length)offset+=writeSync(fd,bytes,offset,bytes.length-offset,offset);fsyncSync(fd);
 }finally{closeSync(fd);}
}
