import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function seedFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cfl-seed-fixture-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'src'));
    copyFileSync(new URL('../../scripts/generate-d1-seed.mjs', import.meta.url), join(dir, 'scripts/generate-d1-seed.mjs'));
    symlinkSync(fileURLToPath(new URL('../../src/data/', import.meta.url)), join(dir, 'src/data'), 'dir');
    execFileSync(process.execPath, [join(dir, 'scripts/generate-d1-seed.mjs')], {stdio: 'pipe'});
    return readFileSync(join(dir, '.generated/seed-s1-s2.sql'), 'utf8');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
