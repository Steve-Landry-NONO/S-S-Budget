// B-07 read-only audit: finds legacy future-dated rows migrated as 'done', simulates
// their impact, and provably never writes (hash + mtime unchanged, read-only handle).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { startServer, withDb, tempDir } = require('./helpers.cjs');
const { audit } = require('../scripts/audit-b07.cjs');

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('B-07 audit lists candidates, simulates impact and never modifies the base', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'historical-copy.sqlite');
  await withDb(dbPath, async (db) => {
    await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-v2.0.sql'), 'utf8'));
    await db.run("INSERT INTO contributions (id,amount,category_id,member_id,date,created_at) VALUES ('c1',200,'weekends','steve','2026-07-03','2026-07-03 10:00:00')");
    await db.run("INSERT INTO expenses (id,label,amount,category_id,paid_by_member_id,date,created_at) VALUES ('e1','Passée',35,'weekends','steve','2026-07-04','2026-07-04 10:00:00')");
    // Legacy row entered in July for a September date: the V2.2.1 migration makes it 'done'.
    await db.run("INSERT INTO expenses (id,label,amount,category_id,paid_by_member_id,date,created_at) VALUES ('e2','Billet anticipé',50,'weekends','steve','2026-09-10','2026-07-05 10:00:00')");
  });
  const s = await startServer({ dbPath }); // applies the real historical migration
  await s.stop();
  const before = { hash: sha(dbPath), mtime: fs.statSync(dbPath).mtimeMs };

  const report = await audit(dbPath);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.candidates.map((c) => c.id), ['e2']);
  const sept = report.impact.find((m) => m.month === '2026-09');
  assert.deepEqual(sept.real, [115, 165], 'September real balance would no longer include the 50 EUR');
  assert.deepEqual(sept.forecast, [115, 115], 'forecast is identical: the operation stays expected');
  assert.ok(!report.impact.some((m) => m.month === '2026-07'), 'months before the candidate are untouched');

  const cli = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'audit-b07.cjs'), dbPath], { encoding: 'utf8' });
  assert.match(cli, /lecture seule/);
  assert.match(cli, /expense e2 · 2026-09-10/);
  assert.equal(sha(dbPath), before.hash, 'database bytes unchanged');
  assert.equal(fs.statSync(dbPath).mtimeMs, before.mtime, 'database not touched');
});

test('B-07 audit cannot write: the handle is read-only', async () => {
  const sqlite3 = require('sqlite3');
  const dir = tempDir();
  const dbPath = path.join(dir, 'ro.sqlite');
  await withDb(dbPath, (db) => db.exec('CREATE TABLE t (x)'));
  const err = await new Promise((resolve) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, () => db.run('INSERT INTO t VALUES (1)', (e) => { db.close(); resolve(e); }));
  });
  assert.match(String(err && err.code), /SQLITE_READONLY/);
  await assert.rejects(audit(path.join(dir, 'missing.sqlite')), /introuvable/);
});
