PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
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
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
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
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_contributions_date ON contributions(date);
CREATE INDEX IF NOT EXISTS idx_contributions_category ON contributions(category_id);

INSERT OR IGNORE INTO members (id, name) VALUES
  ('steve', 'Steve'),
  ('sorelle', 'Sorelle');

INSERT OR IGNORE INTO categories (id, name, monthly_per_person, description, locked, active) VALUES
  ('weekends', 'Weekends', 40, 'Courses, transports, sorties, etc.', 0, 1),
  ('ecole', 'Semaines écoles', 20, 'Repas, transports, sorties pendant les semaines école.', 0, 1),
  ('vacances', 'Vacances', 50, 'Vacances 1 à 3 fois par an.', 0, 1),
  ('cadeaux', 'Cadeaux proches', 20, 'Cadeaux faits aux proches au nom du couple.', 0, 1),
  ('epargne', 'Épargne bloquée', 50, 'Réserve mutuelle pour imprévus majeurs.', 1, 1);
