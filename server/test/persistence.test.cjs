// Persistence, restart, historical database compatibility, error handling and
// SQL parameterisation. Uses only temporary SQLite files and fictional amounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, withDb, tempDir } = require('./helpers.cjs');
const model = require('../../src/features/dashboard/dashboardModel.cjs');

const PIN = '4821';

// Same month/status classification as App.js (selected month, realized vs planned).
function dashboardFromState(state, month) {
  const inMonth = (rows) => rows.filter((r) => String(r.date).startsWith(month));
  const before = (rows) => rows.filter((r) => String(r.date).slice(0, 7) < month && r.status !== 'planned');
  const realized = (rows) => inMonth(rows).filter((r) => r.status !== 'planned');
  const planned = (rows) => inMonth(rows).filter((r) => r.status === 'planned');
  const summary = model.summarizeCategories(state.categories, state.members.length,
    realized(state.expenses), realized(state.contributions), before(state.expenses), before(state.contributions));
  const totals = model.summarizeTotals(summary);
  const plannedTotals = model.summarizePlanned(planned(state.expenses), planned(state.contributions));
  return { totals, forecast: model.forecastBalance(totals, plannedTotals) };
}

test('200 EUR contribution and 35 EUR expense persist across restart with a 165 EUR real balance', async () => {
  const s = await startServer();
  const token = await s.setPinAndLogin('steve', PIN);
  assert.equal((await s.request('POST', '/api/contributions', { token, body: { amount: '200', categoryId: 'weekends', memberId: 'steve', date: '2026-11-20' } })).status, 201);
  assert.equal((await s.request('POST', '/api/expenses', { token, body: { label: 'Courses QA', amount: '35,00', categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-21' } })).status, 201);
  // A planned (future) expense only changes the forecast.
  assert.equal((await s.request('POST', '/api/expenses', { token, body: { label: 'Prévue QA', amount: 40, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-28', status: 'planned' } })).status, 201);
  const before = (await s.request('GET', '/api/state', { token })).body;
  await s.stop();

  const restarted = await startServer({ dbPath: s.dbPath, secret: s.secret });
  try {
    const token2 = await restarted.login('steve', PIN);
    const after = (await restarted.request('GET', '/api/state', { token: token2 })).body;
    const strip = (rows) => rows.map(({ id, amount, date, status, categoryId }) => ({ id, amount, date, status, categoryId }));
    assert.deepEqual(strip(after.expenses), strip(before.expenses));
    assert.deepEqual(strip(after.contributions), strip(before.contributions));
    const d = dashboardFromState(after, '2026-11');
    assert.equal(d.totals.cashBalance, 165);
    assert.equal(d.forecast, 125);
    assert.equal(d.totals.paidIn, 200);
    assert.equal(d.totals.spent, 35);
    // Budget objective (5 seeded envelopes × 2 members) is not cash.
    assert.equal(d.totals.monthlyBudget, (40 + 20 + 50 + 20 + 50) * 2);
  } finally {
    await restarted.stop();
  }
});

test('modification and deletion follow the historical rules and stay persisted', async () => {
  const s = await startServer();
  try {
    const token = await s.setPinAndLogin('steve', PIN);
    const created = await s.request('POST', '/api/expenses', { token, body: { label: 'A modifier', amount: 10, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-10' } });
    const id = created.body.expenses[0].id;
    const updated = await s.request('PUT', `/api/expenses/${id}`, { token, body: { label: 'Modifiée', amount: 12.5, categoryId: 'vacances', paidByMemberId: 'steve', date: '2026-11-11' } });
    assert.equal(updated.status, 200);
    assert.deepEqual(
      (({ label, amount, categoryId, date }) => ({ label, amount, categoryId, date }))(updated.body.expenses[0]),
      { label: 'Modifiée', amount: 12.5, categoryId: 'vacances', date: '2026-11-11' });
    assert.ok(updated.body.activityLogs.some((l) => l.action === 'expense_updated' && l.details.oldAmount === 10 && l.details.newAmount === 12.5));
    assert.equal((await s.request('DELETE', `/api/expenses/${id}`, { token })).status, 200);
    assert.equal((await s.request('DELETE', `/api/expenses/${id}`, { token })).status, 404);
    await s.stop();

    // Rows older than DELETE_WINDOW_DAYS (default 5) can no longer be changed.
    await withDb(s.dbPath, (db) => db.run(
      "INSERT INTO expenses (id,label,amount,category_id,paid_by_member_id,created_by_member_id,date,status,created_at) VALUES ('old_qa','Ancienne',9,'weekends','steve','steve','2026-10-01','done',datetime('now','-10 days'))"));
    const r = await startServer({ dbPath: s.dbPath, secret: s.secret });
    try {
      const t2 = await r.login('steve', PIN);
      assert.equal((await r.request('DELETE', '/api/expenses/old_qa', { token: t2 })).status, 403);
      assert.equal((await r.request('PUT', '/api/expenses/old_qa', { token: t2, body: { label: 'x', amount: 1, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-10-01' } })).status, 403);
    } finally { await r.stop(); }
  } finally { await s.stop(); }
});

test('input validation rejects invalid amounts and labels without writing', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const token = await s.setPinAndLogin('steve', PIN);
  const base = { label: 'QA', categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-01' };
  for (const amount of [0, -5, 'abc', '', null, 'Infinity']) {
    const res = await s.request('POST', '/api/expenses', { token, body: { ...base, amount } });
    assert.equal(res.status, 400, `amount ${amount}`);
  }
  assert.equal((await s.request('POST', '/api/expenses', { token, body: { ...base, label: '   ', amount: 5 } })).status, 400);
  assert.equal((await s.request('POST', '/api/contributions', { token, body: { amount: -1, categoryId: 'weekends', memberId: 'steve', date: '2026-11-01' } })).status, 400);
  const state = await s.request('GET', '/api/state', { token });
  assert.equal(state.body.expenses.length, 0);
  assert.equal(state.body.contributions.length, 0);
});

test('database constraint errors return JSON errors and leave no partial row', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const token = await s.setPinAndLogin('steve', PIN);
  const unknownCategory = await s.request('POST', '/api/expenses', { token, body: { label: 'QA', amount: 5, categoryId: 'nope', paidByMemberId: 'steve', date: '2026-11-01' } });
  assert.equal(unknownCategory.status, 500);
  assert.equal(typeof unknownCategory.body.error, 'string');
  const missingDate = await s.request('POST', '/api/expenses', { token, body: { label: 'QA', amount: 5, categoryId: 'weekends', paidByMemberId: 'steve' } });
  assert.equal(missingDate.status, 500);
  const malformed = await s.request('POST', '/api/expenses', { token, rawBody: '{"label":' });
  assert.ok(malformed.status >= 400, 'malformed JSON is rejected');
  assert.notEqual(malformed.body, null, 'error body stays JSON');
  // Duplicate client id cannot overwrite an existing operation.
  const first = await s.request('POST', '/api/expenses', { token, body: { id: 'dup_qa', label: 'Originale', amount: 5, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-01' } });
  assert.equal(first.status, 201);
  const dup = await s.request('POST', '/api/expenses', { token, body: { id: 'dup_qa', label: 'Ecrasée', amount: 999, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-01' } });
  assert.equal(dup.status, 500);
  const state = await s.request('GET', '/api/state', { token });
  assert.equal(state.body.expenses.length, 1);
  assert.equal(state.body.expenses[0].label, 'Originale');
  assert.equal(state.body.expenses[0].amount, 5);
});

test('SQL metacharacters are stored literally (parameterised queries)', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const token = await s.setPinAndLogin('steve', PIN);
  const label = "Robert'); DROP TABLE expenses;-- \" OR 1=1";
  const res = await s.request('POST', '/api/expenses', { token, body: { label, note: "'; DELETE FROM members;--", amount: 3, categoryId: 'weekends', paidByMemberId: 'steve', date: '2026-11-01' } });
  assert.equal(res.status, 201);
  const state = await s.request('GET', '/api/state', { token });
  assert.equal(state.body.expenses[0].label, label);
  assert.ok(state.body.members.length >= 2);
  const byPath = await s.request('DELETE', "/api/expenses/' OR '1'='1", { token });
  assert.equal(byPath.status, 404);
  assert.equal((await s.request('GET', '/api/state', { token })).body.expenses.length, 1);
});

test('a historical V2.0 database (pre roles/PIN/status) is migrated additively without data loss', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'historical-v2.0.sqlite');
  const legacySchema = fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-v2.0.sql'), 'utf8');
  await withDb(dbPath, async (db) => {
    await db.exec(legacySchema);
    await db.run("INSERT INTO contributions (id,amount,category_id,member_id,date) VALUES ('c_hist',200,'weekends','steve','2026-07-03')");
    await db.run("INSERT INTO expenses (id,label,amount,category_id,paid_by_member_id,date) VALUES ('e_hist','Historique',35,'weekends','sorelle','2026-07-04')");
    await db.run("INSERT INTO expenses (id,label,amount,category_id,paid_by_member_id,date) VALUES ('e_future','Future',50,'weekends','steve','2099-01-01')");
    const cols = await db.all('PRAGMA table_info(members)');
    assert.ok(!cols.some((c) => c.name === 'pin_hash'), 'fixture really is pre-V2.8');
  });
  const s = await startServer({ dbPath });
  try {
    const token = await s.setPinAndLogin('steve', PIN);
    const state = (await s.request('GET', '/api/state', { token })).body;
    assert.equal(state.members.find((m) => m.id === 'steve').role, 'admin');
    assert.equal(state.members.find((m) => m.id === 'sorelle').role, 'member');
    const hist = state.expenses.find((e) => e.id === 'e_hist');
    assert.deepEqual([hist.amount, hist.status, hist.createdByMemberId], [35, 'done', 'sorelle']);
    // Historical V2.2.1 behaviour, kept on purpose (already applied to real bases):
    // ALTER TABLE ... DEFAULT 'done' fills legacy rows before the date-based UPDATE runs,
    // so a legacy future-dated row is migrated as 'done', not 'planned'.
    // See docs/technical-hardening/03_BACKEND_SQLITE_QUALIFICATION.md (finding B-07).
    assert.equal(state.expenses.find((e) => e.id === 'e_future').status, 'done');
    assert.equal(state.contributions.find((c) => c.id === 'c_hist').createdByMemberId, 'steve');
    const d = dashboardFromState(state, '2026-07');
    assert.equal(d.totals.cashBalance, 165);
  } finally { await s.stop(); }
  // Re-opening an already migrated base is idempotent.
  const again = await startServer({ dbPath });
  try {
    const token = await again.login('steve', PIN);
    const state = (await again.request('GET', '/api/state', { token })).body;
    assert.equal(state.expenses.length, 2);
    assert.equal(state.contributions.length, 1);
  } finally { await again.stop(); }
  await withDb(dbPath, async (db) => {
    const integrity = await db.get('PRAGMA integrity_check');
    assert.equal(integrity.integrity_check, 'ok');
  });
});
