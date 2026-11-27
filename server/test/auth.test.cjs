// Authentication, session and authorization qualification (temporary SQLite only).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startServer, sleep } = require('./helpers.cjs');

const PIN_A = '4821';
const PIN_B = '7350';

test('API secret is enforced when APP_SECRET is configured', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const missing = await s.request('GET', '/api/auth/status', { noSecret: true });
  assert.equal(missing.status, 401);
  const wrong = await s.request('GET', '/api/auth/status', { noSecret: true, headers: { 'x-ss-budget-secret': 'wrong' } });
  assert.equal(wrong.status, 401);
  const ok = await s.request('GET', '/api/auth/status');
  assert.equal(ok.status, 200);
  // Status exposes neither hashes nor salts.
  assert.ok(ok.body.members.length >= 2);
  for (const m of ok.body.members) {
    assert.deepEqual(Object.keys(m).sort(), ['id', 'locked', 'lockedUntil', 'name', 'pinSet', 'role']);
  }
});

test('unauthenticated, forged and mismatched sessions are rejected', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  for (const route of ['/api/state', '/api/activity-logs']) {
    const res = await s.request('GET', route);
    assert.equal(res.status, 401, route);
    assert.equal(res.body.code, 'AUTH_REQUIRED');
    assert.equal(res.body.members, undefined, 'no data leaks in 401 body');
  }
  const write = await s.request('POST', '/api/expenses', { body: { label: 'x', amount: 1, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-01' } });
  assert.equal(write.status, 401);

  const token = await s.setPinAndLogin('sorelle', PIN_B);
  // Forged payload: elevate to admin "steve" while keeping the old signature.
  const [, signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ memberId: 'steve', role: 'admin', iat: Date.now(), exp: Date.now() + 3600e3 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal((await s.request('GET', '/api/state', { token: `${forgedPayload}.${signature}` })).status, 401);
  // Token signed with another key.
  const otherSig = crypto.createHmac('sha256', 'attacker').update(forgedPayload).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal((await s.request('GET', '/api/state', { token: `${forgedPayload}.${otherSig}` })).status, 401);
  // Garbage tokens.
  for (const bad of ['abc', 'a.b', '.', token + 'x']) assert.equal((await s.request('GET', '/api/state', { token: bad })).status, 401, bad);
  // Valid token with an x-ss-budget-user-id header naming someone else.
  assert.equal((await s.request('GET', '/api/state', { token, userId: 'steve' })).status, 401);
  assert.equal((await s.request('GET', '/api/state', { token, userId: 'sorelle' })).status, 200);
  // The user-id header alone never authenticates.
  assert.equal((await s.request('GET', '/api/state', { userId: 'steve' })).status, 401);
});

test('correct PIN logs in, wrong PIN is refused, format is validated', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const notSet = await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: PIN_A } });
  assert.equal(notSet.status, 400);
  assert.equal(notSet.body.code, 'PIN_NOT_SET');

  const token = await s.setPinAndLogin('steve', PIN_A);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const state = await s.request('GET', '/api/state', { token });
  assert.equal(state.status, 200);
  assert.ok(Array.isArray(state.body.expenses));

  const wrong = await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: '0000' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, 'PIN_INVALID');
  assert.equal(wrong.body.authToken, undefined);

  for (const pin of ['123', '123456789', 'abcd', '12 34', '']) {
    const res = await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin } });
    assert.equal(res.status, 400, `pin "${pin}"`);
  }
  const unknown = await s.request('POST', '/api/auth/login', { body: { memberId: 'nobody', pin: PIN_A } });
  assert.equal(unknown.status, 404);

  // Changing an existing PIN requires the current PIN.
  const noCurrent = await s.request('POST', '/api/auth/set-pin', { body: { memberId: 'steve', pin: '9999' } });
  assert.equal(noCurrent.status, 401);
  assert.equal(noCurrent.body.code, 'CURRENT_PIN_INVALID');
  const changed = await s.request('POST', '/api/auth/set-pin', { body: { memberId: 'steve', pin: '9999', currentPin: PIN_A } });
  assert.equal(changed.status, 200);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: PIN_A } })).status, 401);
  await s.login('steve', '9999');
});

test('repeated wrong PINs lock the profile, then the lock expires', async (t) => {
  const s = await startServer({ env: { PIN_MAX_ATTEMPTS: '3', PIN_LOCK_MINUTES: '0.03' } });
  t.after(() => s.stop());
  await s.setPinAndLogin('steve', PIN_A);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: '0001' } })).status, 401);
  assert.equal((await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: '0002' } })).status, 401);
  const locked = await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: '0003' } });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.code, 'PIN_LOCKED');
  // Even the right PIN is refused while locked.
  const stillLocked = await s.request('POST', '/api/auth/login', { body: { memberId: 'steve', pin: PIN_A } });
  assert.equal(stillLocked.status, 423);
  const status = await s.request('GET', '/api/auth/status');
  assert.equal(status.body.members.find((m) => m.id === 'steve').locked, true);
  await sleep(2100);
  await s.login('steve', PIN_A);
});

test('session tokens expire and are invalidated by a new signing secret', async (t) => {
  const s = await startServer({ env: { AUTH_TOKEN_TTL_HOURS: String(1.5 / 3600) } });
  const token = await s.setPinAndLogin('steve', PIN_A);
  assert.equal((await s.request('GET', '/api/state', { token })).status, 200);
  await sleep(1700);
  const expired = await s.request('GET', '/api/state', { token });
  assert.equal(expired.status, 401);
  assert.equal(expired.body.code, 'AUTH_REQUIRED');
  await s.stop();

  // Same database, rotated APP_SECRET: previously issued tokens are rejected.
  const first = await startServer({ dbPath: s.dbPath });
  const token2 = await first.login('steve', PIN_A);
  await first.stop();
  const rotated = await startServer({ dbPath: s.dbPath });
  t.after(() => rotated.stop());
  assert.equal((await rotated.request('GET', '/api/state', { token: token2 })).status, 401);
});

test('member role cannot perform admin actions nor edit the other member operations', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const admin = await s.setPinAndLogin('steve', PIN_A);
  const member = await s.setPinAndLogin('sorelle', PIN_B);

  const cat = await s.request('POST', '/api/categories', { token: member, body: { name: 'Interdite', monthlyPerPerson: 10 } });
  assert.equal(cat.status, 403);
  assert.equal((await s.request('POST', '/api/members', { token: member, body: { name: 'Intrus' } })).status, 403);
  assert.equal((await s.request('GET', '/api/export/json', { token: member })).status, 403);
  assert.equal((await s.request('POST', '/api/reset', { token: member })).status, 403);
  assert.equal((await s.request('GET', '/api/backups', { token: member })).status, 403);

  const created = await s.request('POST', '/api/expenses', { token: admin, body: { label: 'Courses QA', amount: 35, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-23' } });
  assert.equal(created.status, 201);
  const id = created.body.expenses[0].id;
  const edit = await s.request('PUT', `/api/expenses/${id}`, { token: member, body: { label: 'Piratée', amount: 1, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-23' } });
  assert.equal(edit.status, 403);
  assert.equal((await s.request('DELETE', `/api/expenses/${id}`, { token: member })).status, 403);
  const after = await s.request('GET', '/api/state', { token: admin });
  assert.equal(after.body.expenses[0].label, 'Courses QA');
  assert.equal(after.body.expenses[0].amount, 35);

  // A member keeps control of the operations they paid or created.
  const own = await s.request('POST', '/api/expenses', { token: member, body: { label: 'Mienne', amount: 12, categoryId: 'weekends', paidByMemberId: 'sorelle', date: '2026-11-23' } });
  const ownId = own.body.expenses.find((e) => e.label === 'Mienne').id;
  assert.equal((await s.request('DELETE', `/api/expenses/${ownId}`, { token: member })).status, 200);
});
