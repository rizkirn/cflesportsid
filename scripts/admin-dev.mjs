import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import ts from 'typescript';

const local = process.argv.includes('--local');
const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync('wrangler.jsonc', 'utf8'));
if (parsed.error) throw new Error('Your local wrangler.jsonc is not valid JSONC.');
const config = parsed.config;
const staging = config.d1_databases?.find(db => db.binding === 'cflesportsid_staging' && db.database_name === 'cflesportsid-staging');
if (!staging?.database_id || staging.database_id === 'local-placeholder') {
  throw new Error('Configure cflesportsid_staging for cflesportsid-staging in your local wrangler.jsonc first.');
}
const production = config.d1_databases?.find(db => db.binding === 'DB');
if (production?.database_name === 'cflesportsid' && production.database_id === staging.database_id) {
  throw new Error('Staging must not share the production database ID.');
}
mkdirSync('.generated', { recursive: true });
const configPath = '.generated/admin-dev.json';
writeFileSync(configPath, JSON.stringify({
  name: 'cflesportsid-admin-dev',
  main: config.main,
  compatibility_date: config.compatibility_date,
  compatibility_flags: config.compatibility_flags,
  assets: { ...config.assets, directory: '../dist/client' },
  d1_databases: ['DB', 'cflesportsid_staging'].map(binding => ({
    binding, database_name: 'cflesportsid-staging', database_id: staging.database_id,
    migrations_dir: '../migrations', remote: !local,
  })),
}, null, 2));
console.log(local ? 'Admin uses a local staging database simulation.' : 'Admin writes to remote cflesportsid-staging. Production is not bound.');
const child = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'dev', '--host', '127.0.0.1'], {
  stdio: 'inherit', env: { ...process.env, CFL_ADMIN_CONFIG: configPath },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
