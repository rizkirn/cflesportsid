import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'cfl-admin-types-'));
const path = join(scratch, 'bindings.d.ts');
try {
  execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'types', path, '--env-interface', 'AdminBindings'], { stdio: 'inherit' });
  writeFileSync('src/admin/bindings.d.mts', readFileSync(path, 'utf8') + '\nexport type { AdminBindings, D1Database };\n');
} finally { rmSync(scratch, { recursive: true, force: true }); }
