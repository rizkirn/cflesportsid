'use strict';
const account = 'bf6ed4ccd73133871881b47ea58dae3d';
const worker = 'cflesportsid';
const prefix = '/client/v4/accounts/' + account;
const workerPath = prefix + '/workers/scripts/' + worker;
const servicePath = prefix + '/workers/services/' + worker;
const previewMetadataPath = prefix + '/workers/workers/' + worker;

function rejectionContext(options) {
  const method = ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(options?.method || 'GET') ? options.method || 'GET' : '[invalid-method]';
  let path = '[invalid-path]';
  try {
    const url = new URL(options.path, String(options.origin));
    const publicSegments = new Set(['client','v4','accounts','workers','scripts','services','settings','script-settings','versions','deployments','subdomain','assets-upload-session','assets','upload','d1','database','query','r2','buckets','oauth2','token','secrets',worker,worker+'-uat',account]);
    path = url.pathname.split('/').map(s => s === '' || publicSegments.has(s) ? s : '[redacted]').join('/');
  } catch {}
  return { method, path };
}

// Narrow guard for the installed Wrangler version-upload command only.
// It neither authorizes nor activates a deployment.
function createUploadGuard(delegate, { checkApproval, now = Date.now, deadline, audit = () => {}, reject = () => {} }) {
  let stopped = false, requests = 0, versionUploads = 0, assetSessions = 0, assetUploads = 0;
  function dispatch(options, handler) {
    const context = rejectionContext(options);
    function fail(code) { stopped = true; try { reject({ ...context, category: code }); } catch { throw new Error('UPLOAD_REJECTION_LOG_FAILED'); } throw new Error(code); }
    if (stopped) return fail('UPLOAD_STOPPED_NO_RETRY');
    try { checkApproval(); } catch { return fail('UPLOAD_APPROVAL_REJECTED'); }
    if (now() >= deadline || ++requests > 180) return fail('UPLOAD_BOUND_EXCEEDED');
    let origin, url;
    try { origin = new URL(String(options.origin)); url = new URL(options.path, origin); } catch { return fail('UPLOAD_URL_REJECTED'); }
    const method = options.method || 'GET';
    if (origin.href !== 'https://api.cloudflare.com/' || url.origin !== origin.origin || url.username || url.password) return fail('UPLOAD_ORIGIN_REJECTED');
    if (method === 'GET') {
      const paths = [prefix, servicePath, previewMetadataPath, workerPath + '/secrets', workerPath + '/settings', workerPath + '/script-settings', workerPath + '/versions', workerPath + '/deployments', workerPath + '/subdomain', prefix + '/workers/subdomain'];
      if (url.search || url.hash || (!paths.includes(url.pathname) && !new RegExp('^' + workerPath + '/versions/[a-f0-9-]{36}$').test(url.pathname))) return fail('UPLOAD_GET_REJECTED');
    } else if (method === 'POST' && url.pathname === workerPath + '/assets-upload-session' && !url.search) {
      if (++assetSessions !== 1) return fail('ASSET_SESSION_REPLAY_REJECTED');
    } else if (method === 'POST' && url.pathname === workerPath + '/versions' && url.search === '?bindings_inherit=strict') {
      if (++versionUploads !== 1) return fail('VERSION_REPLAY_REJECTED');
    } else if (method === 'POST' && (url.pathname === prefix + '/workers/assets/upload' && url.search === '?base64=true' || new RegExp('^' + prefix + '/workers/assets/upload/[a-f0-9]{32}$').test(url.pathname) && !url.search)) {
      if (assetSessions !== 1 || ++assetUploads > 147) return fail('ASSET_UPLOAD_REJECTED');
    } else return fail('UPLOAD_ENDPOINT_REJECTED');
    audit({ method, path: url.pathname, startedAt: new Date(now()).toISOString() });
    const wrapped = new Proxy(handler, { get(target, key) {
      if (key === 'onHeaders') return (status, ...args) => {
        if (status < 200 || status >= 300) stopped = true;
        return target.onHeaders(status, ...args);
      };
      if (key === 'onError') return (...args) => { stopped = true; return target.onError(...args); };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }});
    try { return delegate.dispatch(options, wrapped); } catch (error) { stopped = true; throw error; }
  }
  return { dispatch, close: (...args) => delegate.close(...args), destroy: (...args) => delegate.destroy(...args) };
}
module.exports = { createUploadGuard, account, worker, prefix, workerPath, servicePath, previewMetadataPath };
