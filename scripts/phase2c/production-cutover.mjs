import {readFileSync} from 'node:fs';
import {check, same, sha} from '../phase2b/guards.mjs';
import {inspectProductionBindings, PRODUCTION} from './production-preflight.mjs';

export function productionReaderFlags() {
  return {CFL_PUBLIC_MODE:'d1', CFL_PUBLIC_ENVIRONMENT:'production', CFL_PUBLIC_ACCOUNT_ID:PRODUCTION.account,
    CFL_PUBLIC_WORKER:PRODUCTION.worker, CFL_PUBLIC_HOSTNAME:PRODUCTION.hostname, CFL_PUBLIC_DATABASE_ID:PRODUCTION.database};
}
export function requireProductionConfigurationCapture({report, version, scriptSettings, routing, subdomain, assets}) {
  same(report.target, PRODUCTION, 'CUTOVER_TARGET_REJECTED');
  check(report.status === 'READ_ONLY_BASELINE_VERIFIED' && report.mode === 'hybrid' && report.schema.version === 11 &&
    report.schema.pending.length === 0 && report.identityState === 'EXACT' && report.traffic === 100, 'CUTOVER_BASELINE_REQUIRED');
  check(typeof report.versionId === 'string' && version?.id === report.versionId && version?.resources?.script_runtime &&
    assets && scriptSettings && routing && subdomain, 'LIVE_CONFIGURATION_CAPTURE_REQUIRED');
  const bindings = inspectProductionBindings(version.resources.bindings);
  same(bindings.bindingsHash, report.bindingsHash, 'CUTOVER_BINDINGS_CHANGED');
  same(bindings.authenticationFingerprint, report.authenticationFingerprint, 'CUTOVER_AUTH_CHANGED');
  same(sha(JSON.stringify(scriptSettings)), report.scriptSettingsHash, 'CUTOVER_SETTINGS_CHANGED');
  same(sha(JSON.stringify([routing.domains, routing.routes])), report.routesHash, 'CUTOVER_ROUTES_CHANGED');
  check(bindings.bucket === 'cflesportsid-assets-production', 'CUTOVER_R2_REJECTED');
  check(typeof subdomain.enabled === 'boolean' && typeof subdomain.previews_enabled === 'boolean', 'CUTOVER_SUBDOMAIN_UNVERIFIED');
  return {bindings, readerFlags:productionReaderFlags(), runtime:version.resources.script_runtime, assets, scriptSettings, routing, subdomain};
}
export function verifyCutoverSourcePaths(repo) {
  const reader = readFileSync(repo + '/src/data-access/frontend-public.ts', 'utf8');
  check(reader.includes("if (mode === 'd1') await context.snapshot") &&
    reader.includes("if (context.mode === 'd1') return (await context.snapshot)[collection]"), 'CUTOVER_NO_FALLBACK_PATH_CHANGED');
  const assetReader = readFileSync(repo + '/src/data-access/frontend-assets.ts', 'utf8');
  check(assetReader.includes('return selectPublicCollection(collection') && readFileSync(repo + '/src/data-access/public-d1.mjs', 'utf8').includes("'photo_asset_key'"), 'CUTOVER_PHOTO_REFERENCE_PATH_CHANGED');
}
