// Financial non-regression for the extracted dashboard model.
// Deterministic data only (seeded PRNG, fictional amounts). No business rule is
// asserted here that is not already the V2 behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/features/dashboard/dashboardModel.cjs');
const { v2Aggregate } = require('./fixtures/v2-reference-aggregation.cjs');
const { buildScenario, format } = require('../src/features/preview/fixtures.cjs');

const MEMBERS = [{ id: 'a', name: 'Partenaire A' }, { id: 'b', name: 'Partenaire B' }];
const CATS = [
  { id: 'weekends', name: 'Weekends', monthlyPerPerson: 40 },
  { id: 'vacances', name: 'Vacances', monthlyPerPerson: 50 },
  { id: 'epargne', name: 'Épargne', monthlyPerPerson: 0 },
];

// Same classification as App.js: month prefix, planned status, strictly earlier month.
const monthIndex = (key) => { const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').slice(0, 7)); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null; };
function classify(rows, month) {
  const planned = (r) => r.status === 'planned';
  const inMonth = rows.filter((r) => String(r.date || '').startsWith(month));
  return {
    realized: inMonth.filter((r) => !planned(r)),
    planned: inMonth.filter(planned),
    previous: rows.filter((r) => !planned(r) && monthIndex(r.date) !== null && monthIndex(r.date) < monthIndex(month)),
  };
}
function dashboard({ categories = CATS, members = MEMBERS, expenses = [], contributions = [] }, month = '2026-11') {
  const e = classify(expenses, month), c = classify(contributions, month);
  const summary = model.summarizeCategories(categories, members.length, e.realized, c.realized, e.previous, c.previous);
  const totals = model.summarizeTotals(summary);
  const plannedTotals = model.summarizePlanned(e.planned, c.planned);
  return { summary, totals, plannedTotals, forecast: model.forecastBalance(totals, plannedTotals) };
}
const exp = (amount, date = '2026-11-10', categoryId = 'weekends', status = 'done', id) => ({ id: id || `e${amount}${date}${status}`, label: 'Dépense QA', amount, date, categoryId, paidByMemberId: 'a', status });
const con = (amount, date = '2026-11-05', categoryId = 'weekends', status = 'done', id) => ({ id: id || `c${amount}${date}${status}`, amount, date, categoryId, memberId: 'a', status });

test('200 EUR paid in, 35 EUR spent: real balance 165 EUR, target budget stays distinct', () => {
  const d = dashboard({ expenses: [exp(35)], contributions: [con(200)] });
  assert.equal(d.totals.cashBalance, 165);
  assert.equal(d.totals.monthlyBudget, (40 + 50 + 0) * 2);
  assert.equal(d.totals.availableBudget, 180);
  assert.notEqual(d.totals.availableBudget, d.totals.cashBalance, 'objective is not money available');
  assert.equal(d.forecast, 165);
});

test('carry-over: positive, negative and zero', () => {
  const positive = dashboard({ expenses: [exp(20, '2026-10-03')], contributions: [con(100, '2026-10-01')] });
  assert.equal(positive.totals.carryOver, 80);
  assert.equal(positive.totals.cashBalance, 80);
  assert.equal(positive.totals.availableBudget, 260);
  const negative = dashboard({ expenses: [exp(60, '2026-10-03')], contributions: [con(10, '2026-10-01')] });
  assert.equal(negative.totals.carryOver, -50);
  assert.equal(negative.totals.cashBalance, -50);
  assert.equal(negative.totals.availableBudget, 130);
  const zero = dashboard({ expenses: [exp(25, '2026-10-03')], contributions: [con(25, '2026-10-01')] });
  assert.equal(zero.totals.carryOver, 0);
  // Planned rows of previous months never enter the carry-over.
  const plannedPast = dashboard({ expenses: [exp(500, '2026-09-03', 'weekends', 'planned')] });
  assert.equal(plannedPast.totals.carryOver, 0);
});

test('real vs forecast: future operations only move the forecast', () => {
  const d = dashboard({
    expenses: [exp(35), exp(50, '2026-11-28', 'weekends', 'planned')],
    contributions: [con(200), con(10, '2026-11-29', 'vacances', 'planned')],
  });
  assert.equal(d.totals.cashBalance, 165);
  assert.deepEqual(d.plannedTotals, { spent: 50, paidIn: 10 });
  assert.equal(d.forecast, 125);
  // A planned operation in a later month does not affect this month at all.
  const later = dashboard({ expenses: [exp(35), exp(999, '2026-12-01', 'weekends', 'planned')], contributions: [con(200)] });
  assert.equal(later.forecast, 165);
});

test('month change: the same history yields consistent month-by-month balances', () => {
  const data = {
    contributions: [con(200, '2026-10-01'), con(200, '2026-11-01'), con(200, '2026-12-01')],
    expenses: [exp(35, '2026-10-15'), exp(80, '2026-11-15'), exp(500, '2026-12-15')],
  };
  const oct = dashboard(data, '2026-10'), nov = dashboard(data, '2026-11'), dec = dashboard(data, '2026-12');
  assert.equal(oct.totals.cashBalance, 165);
  assert.equal(nov.totals.carryOver, oct.totals.cashBalance);
  assert.equal(nov.totals.cashBalance, 285);
  assert.equal(dec.totals.carryOver, nov.totals.cashBalance);
  assert.equal(dec.totals.cashBalance, -15);
  assert.equal(dashboard(data, '2027-01').totals.carryOver, -15);
  assert.equal(dashboard(data, '2026-09').totals.cashBalance, 0);
});

test('decimal amounts and comma input keep cent precision on display', () => {
  const d = dashboard({ expenses: [exp(0.1), exp(0.2, '2026-11-11')], contributions: [con(10.05), con('19,99'.replace(',', '.'), '2026-11-06')] });
  assert.equal(format(d.totals.cashBalance), '29,74 €');
  assert.equal(format(0.1 + 0.2), '0,30 €');
  assert.equal(format(1234.5), '1234,50 €');
  assert.equal(format(-35), '-35,00 €');
});

test('empty envelopes and envelopes with zero budget', () => {
  const none = dashboard({ categories: [] });
  assert.deepEqual(none.totals, { monthlyBudget: 0, availableBudget: 0, carryOver: 0, spent: 0, paidIn: 0, cashBalance: 0 });
  assert.equal(model.dashboardNotices({ totals: none.totals, forecast: 0, summary: none.summary, connected: true })[0].key, 'empty');
  const zeroBudget = dashboard({ expenses: [exp(5, '2026-11-10', 'epargne')] });
  const ep = zeroBudget.summary.find((c) => c.id === 'epargne');
  assert.equal(ep.monthlyBudget, 0);
  assert.equal(ep.overBudget, true);
  assert.equal(model.envelopePresentation(ep).usage, null, 'no percentage without a positive available budget');
});

test('over-budget and needs-funding states are independent', () => {
  const over = dashboard({ expenses: [exp(100)], contributions: [con(300)] }).summary.find((c) => c.id === 'weekends');
  assert.deepEqual([over.overBudget, over.needsFunding, over.cashBalance], [true, false, 200]);
  assert.equal(model.envelopePresentation(over).status, 'Dépassement');
  assert.equal(model.envelopePresentation(over).usage, 100);
  const unfunded = dashboard({ expenses: [exp(30)] }).summary.find((c) => c.id === 'weekends');
  assert.deepEqual([unfunded.overBudget, unfunded.needsFunding], [false, true]);
  assert.equal(model.envelopePresentation(unfunded).status, 'À alimenter');
});

test('editing or deleting an operation changes balances exactly by its amount', () => {
  const rows = [exp(35, '2026-11-10', 'weekends', 'done', 'x'), exp(15, '2026-11-12', 'vacances', 'done', 'y')];
  const base = dashboard({ expenses: rows, contributions: [con(200)] });
  const deleted = dashboard({ expenses: rows.filter((r) => r.id !== 'y'), contributions: [con(200)] });
  assert.equal(deleted.totals.cashBalance - base.totals.cashBalance, 15);
  const edited = dashboard({ expenses: rows.map((r) => (r.id === 'x' ? { ...r, amount: 40 } : r)), contributions: [con(200)] });
  assert.equal(base.totals.cashBalance - edited.totals.cashBalance, 5);
  // Moving an operation to the previous month turns it into carry-over without changing cash.
  const moved = dashboard({ expenses: rows.map((r) => (r.id === 'x' ? { ...r, date: '2026-10-30' } : r)), contributions: [con(200)] });
  assert.equal(moved.totals.cashBalance, base.totals.cashBalance);
  assert.equal(moved.totals.carryOver, -35);
  // Marking a realized expense as planned moves it from real to forecast only.
  const planned = dashboard({ expenses: rows.map((r) => (r.id === 'x' ? { ...r, status: 'planned' } : r)), contributions: [con(200)] });
  assert.equal(planned.totals.cashBalance, base.totals.cashBalance + 35);
  assert.equal(planned.forecast, base.forecast);
});

test('model is pure: inputs are not mutated', () => {
  const expenses = [exp(35)], contributions = [con(200)];
  const snapshot = JSON.stringify([CATS, expenses, contributions]);
  dashboard({ expenses, contributions });
  model.recentOperations(expenses, contributions, CATS, MEMBERS);
  assert.equal(JSON.stringify([CATS, expenses, contributions]), snapshot);
});

// --- Differential parity with the frozen V2 implementation --------------------
function prng(seed) { // mulberry32
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function randomDataset(rand) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const cats = CATS.slice(0, 1 + Math.floor(rand() * CATS.length)).map((c) => ({ ...c, monthlyPerPerson: pick([0, 20, 40, 12.5, '30']) }));
  const months = ['2026-09', '2026-10', '2026-11', '2026-12'];
  const amount = () => pick([Math.round(rand() * 50000) / 100, 0.1, 0.2, 0.3, 35, 200, '12.34', 0]);
  const row = (kind, i) => {
    const date = `${pick(months)}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`;
    const base = { id: `${kind}${i}`, amount: amount(), date, categoryId: rand() < 0.9 ? pick(cats).id : 'orphan', status: rand() < 0.25 ? 'planned' : 'done' };
    return kind === 'e' ? { ...base, label: 'QA', paidByMemberId: pick(MEMBERS).id } : { ...base, memberId: pick(MEMBERS).id };
  };
  const n = Math.floor(rand() * 30);
  return { categories: cats, members: MEMBERS.slice(0, 1 + Math.floor(rand() * 2)), expenses: Array.from({ length: n }, (_, i) => row('e', i)), contributions: Array.from({ length: Math.floor(rand() * 30) }, (_, i) => row('c', i)), month: pick(months) };
}

test('differential: dashboardModel equals the frozen V2 aggregation on 2000 seeded datasets', () => {
  const rand = prng(20261124);
  for (let i = 0; i < 2000; i++) {
    const ds = randomDataset(rand);
    const e = classify(ds.expenses, ds.month), c = classify(ds.contributions, ds.month);
    const oracle = v2Aggregate({ categories: ds.categories, members: ds.members, monthExpenses: e.realized, monthContributions: c.realized, previousExpenses: e.previous, previousContributions: c.previous, plannedMonthExpenses: e.planned, plannedMonthContributions: c.planned });
    const summary = model.summarizeCategories(ds.categories, ds.members.length, e.realized, c.realized, e.previous, c.previous);
    const totals = model.summarizeTotals(summary);
    const plannedTotals = model.summarizePlanned(e.planned, c.planned);
    // Strict equality including floating point residue: same arithmetic, same order.
    assert.deepEqual(summary, oracle.summary, `dataset ${i}`);
    assert.deepEqual(totals, oracle.totals, `dataset ${i}`);
    assert.deepEqual(plannedTotals, oracle.plannedTotals, `dataset ${i}`);
    assert.equal(model.forecastBalance(totals, plannedTotals), oracle.forecastCashBalance, `dataset ${i}`);
  }
});

test('QA Lab scenarios reproduce the five approved balances', () => {
  const expected = { normal: [165, 165], negative: [-35, -35], empty: [0, 0], future: [165, 125], offline: [165, 165] };
  for (const [key, [real, forecast]] of Object.entries(expected)) {
    const d = buildScenario(key);
    assert.equal(d.totals.cashBalance, real, key);
    assert.equal(d.forecastCashBalance, forecast, key);
    assert.equal(format(d.totals.cashBalance), `${real.toFixed(2).replace('.', ',')} €`);
  }
});

// F-01 (fixed in presentation only): a balance that is zero in cents is neither shown
// nor flagged as negative. Raw totals stay exactly the V2 floating values.
const legacyFormat = (value) => `${Number(value || 0).toFixed(2).replace('.', ',')} €`;

test('F-01: a balance that is zero in cents is neither shown nor flagged as negative', () => {
  const d = dashboard({ expenses: [exp(0.1), exp(0.2, '2026-11-11')], contributions: [con(0.3)] });
  assert.ok(d.totals.cashBalance < 0, 'raw V2 total keeps its floating residue (aggregation untouched)');
  assert.equal(legacyFormat(d.totals.cashBalance), '-0,00 €', 'defect reproduced with the former formatter');
  assert.equal(model.formatEuro(d.totals.cashBalance), '0,00 €');
  assert.equal(format(d.totals.cashBalance), '0,00 €', 'QA Lab uses the same formatter');
  const notices = model.dashboardNotices({ totals: d.totals, forecast: d.forecast, summary: d.summary, connected: true });
  assert.ok(!notices.some((n) => n.key === 'negative' || n.key === 'forecast'));
  assert.equal(model.envelopePresentation(d.summary.find((c) => c.id === 'weekends')).status, null);
  assert.equal(d.summary.find((c) => c.id === 'weekends').needsFunding, true, 'V2 flag itself unchanged');
});

test('F-01: boundaries around zero and the half cent follow the displayed value', () => {
  const cases = [
    [-5.551115123125783e-17, '0,00 €', 0], [-0.004, '0,00 €', 0], [0.004, '0,00 €', 0], [-0, '0,00 €', 0],
    [-0.005, '-0,01 €', -0.01], [0.005, '0,01 €', 0.01], [-0.006, '-0,01 €', -0.01], [-0.01, '-0,01 €', -0.01],
    [1.005, '1,00 €', 1], [-35, '-35,00 €', -35], [165, '165,00 €', 165], [undefined, '0,00 €', 0], [null, '0,00 €', 0],
  ];
  for (const [value, text, shown] of cases) {
    assert.equal(model.formatEuro(value), text, String(value));
    assert.ok(Object.is(model.presentedAmount(value), shown), `${value} -> ${shown}`);
    const flagged = model.dashboardNotices({ totals: { cashBalance: value }, forecast: value, summary: [{}], connected: true }).map((n) => n.key);
    assert.equal(flagged.includes('negative'), text.startsWith('-'), `alert matches display for ${value}`);
    assert.equal(flagged.includes('forecast'), text.startsWith('-'));
  }
  // Over-budget compared in displayed cents: residue does not create a false overrun.
  assert.equal(model.envelopePresentation({ availableBudget: 0.3, spent: 0.1 + 0.2, cashBalance: 0 }).status, null);
  assert.equal(model.envelopePresentation({ availableBudget: 0.3, spent: 0.31, cashBalance: 0 }).status, 'Dépassement');
  assert.equal(model.envelopePresentation({ availableBudget: 10, spent: 1, cashBalance: -0.004 }).status, null);
  assert.equal(model.envelopePresentation({ availableBudget: 10, spent: 1, cashBalance: -0.01 }).status, 'À alimenter');
});

test('F-01: display text is identical to the historical formatter except negative zero', () => {
  const rand = prng(424242);
  for (let i = 0; i < 20000; i++) {
    const magnitude = [1e-3, 1, 100, 1e5][i % 4];
    const value = (rand() - 0.5) * 2 * magnitude;
    const before = legacyFormat(value);
    const after = model.formatEuro(value);
    assert.equal(after, before === '-0,00 €' ? '0,00 €' : before, String(value));
  }
});
