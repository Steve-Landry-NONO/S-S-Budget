#!/usr/bin/env node
/**
 * B-07 — READ-ONLY audit and financial impact simulation. Never writes.
 *
 *   node server/scripts/audit-b07.cjs <path/to/COPY-of-base.sqlite> [--json]
 *
 * Context: the V2.2.1 migration added `status ... DEFAULT 'done'` before the
 * date-based UPDATE, so legacy rows dated in the future were stored as 'done'
 * (realized) instead of 'planned'. Rows created later through the app may also be
 * 'done' with a later date on purpose (the app asks the user), so every candidate
 * needs a human decision: this tool only lists and simulates.
 *
 * Candidate = status 'done' AND operation date > creation date (created_at, UTC day).
 * Simulation = same data with candidates reclassified 'planned', compared month by
 * month through the shared dashboardModel (planned rows leave the real balance and
 * the carry-over of later months, and enter the forecast of their own month).
 *
 * Always run on a COPY of the database. The file is opened with SQLITE_OPEN_READONLY.
 */
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const model = require('../../src/features/dashboard/dashboardModel.cjs');

const all = (db, sql) => new Promise((resolve, reject) => db.all(sql, (e, rows) => (e ? reject(e) : resolve(rows))));

const monthIndex = (key) => { const m = /^(\d{4})-(\d{2})/.exec(String(key || '')); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null; };

function monthView(state, month) {
  const planned = (r) => r.status === 'planned';
  const inMonth = (rows) => rows.filter((r) => String(r.date || '').startsWith(month));
  const before = (rows) => rows.filter((r) => !planned(r) && monthIndex(r.date) !== null && monthIndex(r.date) < monthIndex(month));
  const summary = model.summarizeCategories(state.categories, state.memberCount,
    inMonth(state.expenses).filter((r) => !planned(r)), inMonth(state.contributions).filter((r) => !planned(r)),
    before(state.expenses), before(state.contributions));
  const totals = model.summarizeTotals(summary);
  const plannedTotals = model.summarizePlanned(inMonth(state.expenses).filter(planned), inMonth(state.contributions).filter(planned));
  return { real: model.presentedAmount(totals.cashBalance), carryOver: model.presentedAmount(totals.carryOver), forecast: model.presentedAmount(model.forecastBalance(totals, plannedTotals)) };
}

async function audit(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) throw new Error('Base introuvable : ' + dbPath);
  const db = await new Promise((resolve, reject) => { const d = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (e) => (e ? reject(e) : resolve(d))); });
  try {
    const members = await all(db, 'SELECT id FROM members');
    const categories = (await all(db, 'SELECT id, name, monthly_per_person AS monthlyPerPerson FROM categories WHERE active = 1'));
    const expenses = await all(db, "SELECT id, label, amount, category_id AS categoryId, date, status, created_at AS createdAt, 'expense' AS kind FROM expenses");
    const contributions = await all(db, "SELECT id, amount, category_id AS categoryId, date, status, created_at AS createdAt, 'contribution' AS kind FROM contributions");
    const isCandidate = (r) => r.status === 'done' && String(r.date || '') > String(r.createdAt || '').slice(0, 10);
    const candidates = [...expenses, ...contributions].filter(isCandidate)
      .map(({ kind, id, label, amount, categoryId, date, createdAt }) => ({ kind, id, label: label || 'Versement', amount, categoryId, date, createdAt }));
    const ids = new Set(candidates.map((c) => `${c.kind}:${c.id}`));
    const reclass = (rows) => rows.map((r) => (ids.has(`${r.kind}:${r.id}`) ? { ...r, status: 'planned' } : r));
    const current = { categories, memberCount: members.length, expenses, contributions };
    const simulated = { ...current, expenses: reclass(expenses), contributions: reclass(contributions) };
    const months = [...new Set([...expenses, ...contributions].map((r) => String(r.date || '').slice(0, 7)).filter((m) => monthIndex(m) !== null))].sort();
    const impact = months.map((month) => {
      const a = monthView(current, month), b = monthView(simulated, month);
      return { month, real: [a.real, b.real], carryOver: [a.carryOver, b.carryOver], forecast: [a.forecast, b.forecast], realDelta: model.presentedAmount(b.real - a.real) };
    }).filter((m) => m.realDelta !== 0 || m.forecast[0] !== m.forecast[1] || m.carryOver[0] !== m.carryOver[1]);
    return { readOnly: true, database: path.basename(dbPath), rows: expenses.length + contributions.length, candidates, impact };
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

if (require.main === module) {
  const [file, flag] = process.argv.slice(2);
  audit(file).then((report) => {
    if (flag === '--json') return console.log(JSON.stringify(report, null, 2));
    console.log(`B-07 audit (lecture seule) — ${report.database} : ${report.rows} opérations, ${report.candidates.length} candidate(s).`);
    for (const c of report.candidates) console.log(`  ${c.kind} ${c.id} · ${c.date} (créée ${c.createdAt}) · ${model.formatEuro(c.amount)} · ${c.label}`);
    console.log('Impact simulé si les candidates étaient « prévues » (actuel -> simulé) :');
    for (const m of report.impact) console.log(`  ${m.month} · réel ${model.formatEuro(m.real[0])} -> ${model.formatEuro(m.real[1])} · report ${model.formatEuro(m.carryOver[0])} -> ${model.formatEuro(m.carryOver[1])} · prévisionnel ${model.formatEuro(m.forecast[0])} -> ${model.formatEuro(m.forecast[1])}`);
    if (!report.impact.length) console.log('  aucun impact');
  }).catch((e) => { console.error('Audit impossible :', e.message); process.exit(1); });
}

module.exports = { audit };
