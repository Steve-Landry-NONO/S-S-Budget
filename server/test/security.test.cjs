// Application security checks. Passing tests are guarantees; `todo` tests are KNOWN
// residual risks reported in docs/technical-hardening/05_APPLICATION_SECURITY.md.
// They stay visible in every run and must not be "fixed" by weakening the assertion:
// each one needs an owner decision because it changes security behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers.cjs');

const PIN = '4821';

test('PIN, PIN hash and session token never appear in server logs', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const token = await s.setPinAndLogin('steve', PIN);
  await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: '0000' } });
  await s.request('GET', '/api/state', { token });
  await s.request('POST', '/api/expenses', { token, body: { label: 'x', amount: 5, categoryId: 'nope', paidByMemberId: 'steve', date: '2026-11-01' } });
  const logs = s.logs();
  assert.ok(logs.includes('POST /api/auth/login'), 'request log is active');
  assert.ok(!logs.includes(PIN) && !logs.includes('0000'), 'no PIN in logs');
  assert.ok(!logs.includes(token) && !logs.includes(token.split('.')[1]), 'no token in logs');
  assert.ok(!logs.includes(s.secret), 'no API secret in logs');
});

test('activity log records security events without secrets', async (t) => {
  const s = await startServer({ env: { PIN_MAX_ATTEMPTS: '2' } });
  t.after(() => s.stop());
  const token = await s.setPinAndLogin('steve', PIN);
  await s.setPinAndLogin('sorelle', '7350');
  await s.request('POST', '/api/auth/login', { body: { memberId: 'sorelle', pin: '0001' } });
  await s.request('POST', '/api/auth/login', { body: { memberId: 'sorelle', pin: '0002' } });
  const logs = (await s.request('GET', '/api/activity-logs', { token })).body.activityLogs;
  const actions = logs.map((l) => l.action);
  for (const a of ['pin_created', 'member_login', 'login_locked']) assert.ok(actions.includes(a), a);
  assert.ok(!JSON.stringify(logs).includes(PIN));
  assert.ok(!JSON.stringify(logs).includes(token));
});

// R-01 (forged token with the public development key, missing secret) is now enforced:
// see config.test.cjs — startup refusal and forged-token rejection.

test('R-02: changing a PIN revokes the sessions issued with the previous PIN', { todo: 'R-02 owner decision: stateless tokens stay valid until expiry (default 12 h)' }, async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const oldToken = await s.setPinAndLogin('steve', PIN);
  await s.request('POST', '/api/auth/set-pin', { body: { memberId: 'steve', pin: '9999', currentPin: PIN } });
  assert.equal((await s.request('GET', '/api/state', { token: oldToken })).status, 401);
});

test('R-03: a member without PIN cannot be claimed by anyone holding the shared API secret', { todo: 'R-03 owner decision: first PIN creation is open by design (V2.8 first-use enrolment)' }, async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const res = await s.request('POST', '/api/auth/set-pin', { body: { memberId: 'sorelle', pin: '1111' } });
  assert.notEqual(res.status, 200);
});

test('R-04: unauthenticated health check does not disclose the absolute database path', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const res = await s.request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.dbPath, undefined);
  assert.deepEqual(Object.keys(res.body).sort(), ['name', 'ok', 'time']);
  assert.ok(!res.text.includes(s.dir), 'no filesystem path in the public response');
});

test('R-05: server errors do not expose SQLite internals and malformed JSON is a 400', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const token = await s.setPinAndLogin('steve', PIN);
  const fk = await s.request('POST', '/api/expenses', { token, body: { label: 'x', amount: 5, categoryId: 'nope', paidByMemberId: 'steve', date: '2026-11-01' } });
  assert.doesNotMatch(fk.body.error, /SQLITE|constraint/i);
  assert.equal(fk.status, 500);
  assert.equal(fk.body.code, 'INTERNAL_ERROR');
  assert.match(s.logs(), /Erreur interne POST \/api\/expenses \[SQLITE_CONSTRAINT\]/, 'server log stays useful');
  const malformed = await s.request('POST', '/api/expenses', { token, rawBody: '{"label":' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'INVALID_JSON');
});

test('R-05: a PIN inside a malformed JSON body never reaches the logs', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const res = await s.request('POST', '/api/auth/login', { rawBody: '{"memberId":"steve","pin":"9137" oops}' });
  assert.equal(res.status, 400);
  assert.ok(!res.text.includes('9137'), 'not echoed to the client');
  assert.match(s.logs(), /corps JSON invalide \(contenu non journalisé\)/);
  assert.ok(!s.logs().includes('9137'), 'not written to the server log');
});

test('API secret comparison rejects near-miss values', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  // (Trailing whitespace is stripped by HTTP header normalisation, so it is not a near miss.)
  for (const v of [s.secret.slice(0, -1), s.secret + 'x', s.secret.toUpperCase(), 'x' + s.secret])
    assert.equal((await s.request('GET', '/api/auth/status', { noSecret: true, headers: { 'x-ss-budget-secret': v } })).status, 401, JSON.stringify(v));
});
