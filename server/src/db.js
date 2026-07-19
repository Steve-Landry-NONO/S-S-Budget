const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const rootDir = path.join(__dirname, '..');
const dbPath = process.env.DB_PATH || './data/ss-budget.sqlite';
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.join(rootDir, dbPath);
const schemaPath = path.join(rootDir, 'schema.sql');

async function openDb() {
  fs.mkdirSync(path.dirname(absoluteDbPath), { recursive: true });
  const db = await open({ filename: absoluteDbPath, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON;');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await db.exec(schema);
  return db;
}

module.exports = { openDb, absoluteDbPath };
