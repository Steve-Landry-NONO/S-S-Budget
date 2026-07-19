const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const rootDir = path.join(__dirname, '..');
const dbPath = process.env.DB_PATH || './data/ss-budget.sqlite';
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.join(rootDir, dbPath);
const schemaPath = path.join(rootDir, 'schema.sql');

async function addColumnIfMissing(db, table, column, definition) {
  const columns = await db.all(`PRAGMA table_info(${table})`);
  if (!columns.some((c) => c.name === column)) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

async function migrateDb(db) {
  await addColumnIfMissing(db, 'members', 'role', "TEXT NOT NULL DEFAULT 'member'");
  await addColumnIfMissing(db, 'expenses', 'created_by_member_id', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, 'contributions', 'created_by_member_id', "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, 'expenses', 'status', "TEXT NOT NULL DEFAULT 'done'");
  await addColumnIfMissing(db, 'contributions', 'status', "TEXT NOT NULL DEFAULT 'done'");

  await db.run("UPDATE members SET role = 'admin' WHERE id = 'steve'");
  await db.run("UPDATE members SET role = 'member' WHERE id <> 'steve' AND (role IS NULL OR role = '')");
  await db.run("UPDATE expenses SET created_by_member_id = paid_by_member_id WHERE created_by_member_id = '' OR created_by_member_id IS NULL");
  await db.run("UPDATE contributions SET created_by_member_id = member_id WHERE created_by_member_id = '' OR created_by_member_id IS NULL");
  await db.run("UPDATE expenses SET status = CASE WHEN date > date('now') THEN 'planned' ELSE 'done' END WHERE status IS NULL OR status = ''");
  await db.run("UPDATE contributions SET status = CASE WHEN date > date('now') THEN 'planned' ELSE 'done' END WHERE status IS NULL OR status = ''");
}

async function openDb() {
  fs.mkdirSync(path.dirname(absoluteDbPath), { recursive: true });
  const db = await open({ filename: absoluteDbPath, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await db.exec(schema);
  await migrateDb(db);
  return db;
}

module.exports = { openDb, absoluteDbPath };
