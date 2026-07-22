PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
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

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_contributions_date ON contributions(date);
CREATE INDEX IF NOT EXISTS idx_contributions_category ON contributions(category_id);


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

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON activity_logs(actor_member_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);

-- Seed compatible avec les anciennes bases : ne référence pas la colonne role ici.
-- Les rôles sont appliqués ensuite dans server/src/db.js par la migration automatique.
INSERT OR IGNORE INTO members (id, name) VALUES
  ('steve', 'Steve'),
  ('sorelle', 'Sorelle');

INSERT OR IGNORE INTO categories (id, name, monthly_per_person, description, locked, active) VALUES
  ('weekends', 'Weekends', 40, 'Courses, transports, sorties, etc.', 0, 1),
  ('ecole', 'Semaines écoles', 20, 'Repas, transports, sorties pendant les semaines école.', 0, 1),
  ('vacances', 'Vacances', 50, 'Vacances 1 à 3 fois par an.', 0, 1),
  ('cadeaux', 'Cadeaux proches', 20, 'Cadeaux faits aux proches au nom du couple.', 0, 1),
  ('epargne', 'Épargne bloquée', 50, 'Réserve mutuelle pour imprévus majeurs.', 1, 1);
