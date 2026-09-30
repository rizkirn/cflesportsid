import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkData, root } from './data-tools.mjs';
import { compareStatistics } from './d1-parity.mjs';
import { matchReadQueries, readD1Matches } from '../src/data-access/matches.mjs';
import { compareReadMatches } from './d1-read-parity.mjs';

const saveReport = report => {
  mkdirSync(new URL('../.generated/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../.generated/d1-parity.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2) + '\n');
};

try {
  const { values } = parseArgs({ options: { 'persist-to': { type: 'string' } }, strict: true });
  const { data, errors } = checkData();
  if (errors.length) throw new Error(`Invalid legacy data:\n${errors.join('\n')}`);
  const tables = ['players', 'teams', 'maps', 'tournaments', 'matches', 'match_maps', 'player_match_entries', 'player_round_stats'];
  const queries = [...tables.map(table => `SELECT * FROM ${table}`), 'PRAGMA foreign_key_check', ...matchReadQueries];
  const args = [fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'd1', 'execute', 'cflesportsid', '--local', '--json', '--command', queries.join(';') + ';'];
  if (values['persist-to']) args.push('--persist-to', values['persist-to']);
  let response;
  try {
    response = JSON.parse(execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }));
  } catch (error) {
    throw new Error(`Cannot read local D1. Apply local migrations and import the seed first; no parity result was produced.\n${error.message}`);
  }
  if (!Array.isArray(response) || response.length !== queries.length || response.some(r => r.success !== true || !Array.isArray(r.results))) throw new Error('Unexpected D1 query response; no parity result was produced.');
  const db = Object.fromEntries(tables.map((name, i) => [name, response[i].results]));
  const report = compareStatistics(data, db);
  const output = await readD1Matches({ prepare: sql => sql, batch: async () => response.slice(tables.length + 1) }, [...data.matches.values()]);
  const readMismatches = compareReadMatches([...data.matches.values()], output);
  report.readLayer = { matches: output.length, mismatches: readMismatches.length };
  report.mismatches.push(...readMismatches);
  console.log(`Read layer: ${output.length} matches; ${readMismatches.length} field/statistics mismatches`);
  for (const row of response[tables.length].results) report.mismatches.push({ path: 'import.foreign_key_check', expected: 'no violations', actual: row });
  report.database = { mode: 'local', persistTo: values['persist-to'] ?? '.wrangler/state', counts: Object.fromEntries(tables.map(t => [t, db[t].length])) };
  saveReport({ status: report.mismatches.length ? 'failed' : 'passed', ...report });
  for (const s of report.scopes) console.log(`${s.name}: ${s.players} players, ${s.teams} teams, ${s.maps} map types; K/D/A ${s.totals.kills}/${s.totals.deaths}/${s.totals.assists}; ${s.totals.matchesPlayed} matches, ${s.totals.mapsPlayed} maps; ${s.mismatches} statistical mismatches`);
  for (const m of report.mismatches) console.error(`${m.path}: legacy=${JSON.stringify(m.expected)} D1=${JSON.stringify(m.actual)}`);
  console.log(`${report.mismatches.length} mismatches. Full report: .generated/d1-parity.json`);
  if (report.mismatches.length) process.exitCode = 1;
} catch (error) {
  saveReport({ status: 'error', error: error.message });
  console.error(error.message); process.exitCode = 1;
}
