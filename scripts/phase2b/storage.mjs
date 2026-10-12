import {lstatSync,realpathSync,statfsSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {isAbsolute,resolve,dirname,basename,join,parse} from 'node:path';
import {ROOT,check} from './guards.mjs';

export const CAPACITY_RESERVE=64*1024*1024;
export function validateBackupDirectory(path){
  check(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'BACKUP_DIRECTORY_REJECTED');
  check(path!==ROOT&&!path.startsWith(ROOT+'/'),'BACKUP_REPOSITORY_REJECTED');
  check(/^cfl-phase2b-backup-[a-zA-Z0-9-]+$/.test(basename(path)),'BACKUP_DIRECTORY_REJECTED');
  const parent=dirname(path);
  let current=parse(parent).root;
  for(const part of parent.slice(current.length).split('/').filter(Boolean)){
    current=join(current,part);const stat=lstatSync(current);
    check(stat.isDirectory()&&!stat.isSymbolicLink(),'BACKUP_SYMLINK_REJECTED');
    check((stat.mode&0o022)===0||(stat.uid===0&&(stat.mode&0o1000)!==0),'BACKUP_ANCESTOR_UNSAFE');
  }
  check(realpathSync(parent)===parent,'BACKUP_SYMLINK_REJECTED');
  const stat=lstatSync(parent);
  const legacyTemporary=parent==='/private/tmp'&&(stat.mode&0o1000)!==0;
  check(legacyTemporary||(stat.uid===process.getuid()&&(stat.mode&0o077)===0),'BACKUP_PARENT_NOT_PRIVATE');
  try{lstatSync(path);throw new Error('BACKUP_ALREADY_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
  return {parent,device:stat.dev,inode:stat.ino};
}
export function verifyCapacity(parent,bytes=0,inspect=statfsSync){
  check(Number.isSafeInteger(bytes)&&bytes>=0,'BACKUP_SIZE_REJECTED');
  const stat=inspect(parent,{bigint:true});const available=BigInt(stat.bavail)*BigInt(stat.bsize);
  check(available>=BigInt(bytes)+BigInt(CAPACITY_RESERVE),'BACKUP_CAPACITY_INSUFFICIENT');
  return available;
}
export function writePrivateFile(path,bytes){
  const fd=openSync(path,'wx',0o600);
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
}
export function syncDirectory(path){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
