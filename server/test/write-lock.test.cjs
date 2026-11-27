// Write-lock lifecycle: the lock must follow the REAL end of the SQLite work, not the
// HTTP response lifetime. Disconnections are produced with AbortController.
// A long transaction is obtained with a large (fictional) auto-contribution batch:
// N member ids x 5 seeded envelopes inserts inside BEGIN..COMMIT (~2 s for N = 3000).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, sleep } = require('./helpers.cjs');

const LONG_BATCH = 3000; // x 5 envelopes = 15 000 rows in one transaction
const CATEGORIES = 5;

function send(s, method, route, { token, body, signal } = {}) {
  return fetch(s.base + route, {
    method,
    signal,
    headers: { 'Content-Type': 'application/json', 'x-ss-budget-secret': s.secret, ...(token ? { 'x-ss-budget-auth-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }), (e) => ({ aborted: e.name === 'AbortError', error: e.message }));
}

// Every spawned server is stopped even when an assertion fails (no hanging runs).
const started = [];
test.after(async () => { for (const s of started) await s.stop(); });
async function server(opts) { const s = await startServer(opts); started.push(s); return s; }

async function reopen(s, fn) {
  await s.stop();
  const r = await server({ dbPath: s.dbPath, secret: s.secret });
  try { return await fn(r, await r.login('steve', '4821')); } finally { await r.stop(); }
}

test('client disconnect DURING a transaction does not release the lock early', async () => {
  const s = await server();
  const steve = await s.setPinAndLogin('steve', '4821');
  const sorelle = await s.setPinAndLogin('sorelle', '7350');
  const ctrl = new AbortController();
  const a = send(s, 'POST', '/api/auto-contributions', { token: steve, signal: ctrl.signal, body: { memberIds: Array(LONG_BATCH).fill('steve'), date: '2026-11-01', monthsCount: 1 } });
  await sleep(250);
  ctrl.abort(); // A is inside BEGIN..COMMIT now
  await sleep(20);
  // B is itself transactional: if it overlaps A it fails ("cannot start a transaction
  // within a transaction") and its ROLLBACK destroys A's open transaction.
  const b = await send(s, 'POST', '/api/activity-logs/read-all', { token: sorelle });
  const e = await send(s, 'POST', '/api/expenses', { token: steve, body: { label: 'Après déconnexion', amount: 7, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-02' } });
  assert.equal((await a).aborted, true, 'client really disconnected');
  assert.equal(b.status, 200, `read-all must wait for A: ${JSON.stringify(b.body)}`);
  assert.equal(e.status, 201);
  // Ordering proof: B ran after A's activity entry existed, so sorelle has read it.
  const autoLog = b.body.activityLogs.find((l) => l.action === 'auto_contributions_created');
  assert.ok(autoLog, 'A fully finished (journal written) before B started');
  assert.ok(autoLog.readByMemberIds.includes('sorelle'));
  await reopen(s, async (r, token) => {
    const state = (await r.request('GET', '/api/state', { token })).body;
    assert.equal(state.contributions.length, LONG_BATCH * CATEGORIES, 'A committed atomically');
    assert.equal(state.expenses.length, 1);
  });
});

test('client disconnect WHILE WAITING for the lock: request skipped, queue keeps order', async () => {
  const s = await server();
  const steve = await s.setPinAndLogin('steve', '4821');
  const sorelle = await s.setPinAndLogin('sorelle', '7350');
  const a = send(s, 'POST', '/api/auto-contributions', { token: steve, body: { memberIds: Array(LONG_BATCH).fill('steve'), date: '2026-11-01', monthsCount: 1 } });
  await sleep(150);
  const ctrl = new AbortController();
  const c = send(s, 'POST', '/api/auto-contributions', { token: steve, signal: ctrl.signal, body: { memberIds: Array(400).fill('sorelle'), date: '2026-11-01', monthsCount: 2 } });
  await sleep(100);
  ctrl.abort(); // C never reached the database
  const d = send(s, 'POST', '/api/activity-logs/read-all', { token: sorelle });
  const [ra, rc, rd] = await Promise.all([a, c, d]);
  assert.equal(ra.status, 201);
  assert.equal(rc.aborted, true);
  assert.equal(rd.status, 200, `D must not overlap another transaction: ${JSON.stringify(rd.body)}`);
  const f = await send(s, 'POST', '/api/expenses', { token: steve, body: { label: 'File libre', amount: 3, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-02' } });
  assert.equal(f.status, 201, 'queue not blocked');
  assert.match(s.logs(), /client déconnecté avant exécution/);
  await reopen(s, async (r, token) => {
    const state = (await r.request('GET', '/api/state', { token })).body;
    assert.equal(state.contributions.filter((x) => x.note === 'Versement automatique (2 mois)').length, 0, 'abandoned request wrote nothing');
    assert.equal(state.contributions.length, LONG_BATCH * CATEGORIES);
  });
});

test('error, rollback and invalid-input paths release the lock', async () => {
  const s = await server();
  const token = await s.setPinAndLogin('steve', '4821');
  const results = await Promise.all([
    send(s, 'POST', '/api/expenses', { token, body: { label: 'FK', amount: 1, categoryId: 'nope', paidByMemberId: 'steve', date: '2026-11-01' } }),
    // Unknown member: FOREIGN KEY failure INSIDE the transaction -> ROLLBACK path.
    send(s, 'POST', '/api/auto-contributions', { token, body: { memberIds: ['steve', 'ghost'], date: '2026-11-01', monthsCount: 1 } }),
    fetch(s.base + '/api/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ss-budget-secret': s.secret, 'x-ss-budget-auth-token': token }, body: '{"label":' }).then((r) => ({ status: r.status })),
    send(s, 'POST', '/api/expenses', { token, body: { label: '', amount: 1, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-01' } }),
  ]);
  assert.deepEqual(results.map((r) => r.status >= 400), [true, true, true, true]);
  const ok = await Promise.race([
    send(s, 'POST', '/api/expenses', { token, body: { label: 'Après erreurs', amount: 2, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-01' } }),
    sleep(5000).then(() => ({ status: 'TIMEOUT' })),
  ]);
  assert.equal(ok.status, 201, 'queue not permanently blocked');
  await reopen(s, async (r, t) => {
    const state = (await r.request('GET', '/api/state', { token: t })).body;
    assert.equal(state.contributions.length, 0, 'failed batch fully rolled back');
    assert.deepEqual(state.expenses.map((x) => x.label), ['Après erreurs']);
  });
});
