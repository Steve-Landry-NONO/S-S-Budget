// Concurrent requests against ONE server sharing ONE SQLite connection.
// Every acknowledged write (2xx) must be persisted; every refused write (5xx)
// must leave no partial rows. Verified after a full restart of the server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers.cjs');

const PIN = '4821';

async function reopenState(s) {
  await s.stop();
  const r = await startServer({ dbPath: s.dbPath, secret: s.secret });
  try {
    const token = await r.login('steve', PIN);
    return (await r.request('GET', '/api/state', { token })).body;
  } finally { await r.stop(); }
}

test('parallel single writes are all persisted', async () => {
  const s = await startServer();
  const token = await s.setPinAndLogin('steve', PIN);
  const N = 40;
  const results = await Promise.all(Array.from({ length: N }, (_, i) => s.request('POST', '/api/expenses', {
    token, body: { label: `QA ${i}`, amount: 1.25, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-02' },
  })));
  assert.deepEqual([...new Set(results.map((r) => r.status))], [201]);
  const state = await reopenState(s);
  assert.equal(state.expenses.length, N);
  assert.equal(state.expenses.reduce((n, e) => n + e.amount, 0), N * 1.25);
});

test('transactions do not swallow or roll back concurrent writes', async () => {
  for (let round = 0; round < 3; round++) {
    const s = await startServer();
    const token = await s.setPinAndLogin('steve', PIN);
    const categories = (await s.request('GET', '/api/state', { token })).body.categories.length;
    const jobs = [];
    for (let i = 0; i < 3; i++) jobs.push(s.request('POST', '/api/auto-contributions', { token, body: { memberIds: ['steve', 'sorelle'], date: '2026-11-01', monthsCount: 1 } }));
    for (let i = 0; i < 20; i++) jobs.push(s.request('POST', '/api/expenses', { token, body: { label: `QA ${i}`, amount: 1, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-02' } }));
    for (let i = 0; i < 3; i++) jobs.push(s.request('POST', '/api/activity-logs/read-all', { token }));
    const res = await Promise.all(jobs);
    const autoOk = res.slice(0, 3).filter((r) => r.status === 201).length;
    const expOk = res.slice(3, 23).filter((r) => r.status === 201).length;
    const errors = res.filter((r) => r.status >= 500).map((r) => r.body && r.body.error);
    const state = await reopenState(s);
    assert.deepEqual(errors, [], `round ${round}: no transaction error`);
    assert.equal(state.expenses.length, expOk, `round ${round}: every acknowledged expense persisted`);
    assert.equal(state.contributions.length, autoOk * 2 * categories, `round ${round}: no partial auto-contribution batch`);
  }
});
