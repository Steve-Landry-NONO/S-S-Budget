-- DDL V2 (server/schema.sql, main @ 8e7f6f66d4094bb0dc88b865042eb9c8c2ae3e40), sans le jeu d'amorçage.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  pin_salt TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL DEFAULT '',
  failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
  pin_locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_per_person REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  locked INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  category_id TEXT NOT NULL,
  paid_by_member_id TEXT NOT NULL,
  created_by_member_id TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (paid_by_member_id) REFERENCES members(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  category_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_by_member_id TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  actor_member_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  amount REAL,
  date TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  read_by_member_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
