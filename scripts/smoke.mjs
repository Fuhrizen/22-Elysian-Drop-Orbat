import assert from 'node:assert/strict';
const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';
const origin = process.env.SITE_ORIGIN;
assert.ok(origin, 'SITE_ORIGIN is required');
const get = (path, headers = {}) => fetch(base + path, { headers, signal: AbortSignal.timeout(10000) });
const post = (body, source = origin, token = '') => fetch(base + '/api/regiment', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: source,
    ...(token ? { Authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
});
const health = await get('/api/health');
assert.equal(health.status, 200);
const data = await health.json();
assert.equal(data.status, 'ok');
if (process.env.EXPECT_REVISION) assert.equal(data.revision, process.env.EXPECT_REVISION);
assert.equal((await get('/')).status, 200);
assert.equal((await get('/api/regiment')).status, 200);
assert.equal((await post({ action: 'login', key: 'invalid' }, 'https://invalid.example')).status, 403);
// Even a request that matches the internal server address must respect SITE_ORIGIN.
assert.equal((await post({ action: 'login', key: 'invalid' }, base)).status, 403);
assert.equal((await post({ action: 'register', name: 'Forbidden smoke record' })).status,
  process.env.SMOKE_MAINTENANCE === 'true' ? 503 : 401);
// CI only: a disposable database verifies login and host-only Secure cookies.
if (process.env.SMOKE_LOGIN === 'true') {
  const response = await post({ action: 'login', key: process.env.ADMIN_ACCESS_KEY });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
  const { sessionToken } = await response.json();
  const state = await (await get('/api/regiment', { Authorization: 'Bearer ' + sessionToken })).json();
  assert.equal(state.admin, true);
  if (process.env.ORBAT_DISABLE_AUTO_RENEW === 'true') assert.equal(state.countdown.autoRenew, false);
  assert.equal((await post({ action: 'logout' }, origin, sessionToken)).status, 200);
  assert.equal((await (await get('/api/regiment', { Authorization: 'Bearer ' + sessionToken })).json()).admin, false);
}
console.log('Smoke checks passed: readiness, database, origin and access controls' + (process.env.SMOKE_LOGIN === 'true' ? ', login/cookie/logout' : ''));
