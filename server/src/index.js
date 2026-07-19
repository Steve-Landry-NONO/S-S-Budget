require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { openDb, absoluteDbPath } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3001);
const appSecret = process.env.APP_SECRET || '';
const DELETE_WINDOW_DAYS = Number(process.env.DELETE_WINDOW_DAYS || 5);

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function normalizeAmount(value) {
  const amount = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeActionStatus(date, status) {
  if (status === 'planned' || status === 'done') return status;
  return String(date || '') > todayKey() ? 'planned' : 'done';
}


function parseDbDate(value) {
  if (!value) return new Date();
  return new Date(String(value).replace(' ', 'T'));
}

function isWithinDeleteWindow(row) {
  const created = parseDbDate(row?.created_at);
  const diffDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  return Number.isFinite(diffDays) && diffDays <= DELETE_WINDOW_DAYS;
}

async function getCurrentUser(req) {
  const requestedId = String(req.headers['x-ss-budget-user-id'] || 'steve');
  let member = await db.get('SELECT id, name, role FROM members WHERE id = ?', [requestedId]);
  if (!member) member = await db.get("SELECT id, name, role FROM members WHERE id = 'steve'");
  return member || { id: 'steve', name: 'Steve', role: 'admin' };
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getCurrentUser(req);
    if (user.role !== 'admin') return res.status(403).json({ error: 'Action réservée à un administrateur.' });
    req.currentUser = user;
    next();
  } catch (error) { next(error); }
}

function requireSecret(req, res, next) {
  if (!appSecret || appSecret === 'change-moi-avec-une-phrase-longue') return next();
  const provided = req.headers['x-ss-budget-secret'];
  if (provided !== appSecret) return res.status(401).json({ error: 'Secret API invalide.' });
  next();
}

app.use('/api', requireSecret);

let db;

async function getState() {
  const [members, categories, expenses, contributions] = await Promise.all([
    db.all('SELECT id, name, role, created_at, updated_at FROM members ORDER BY created_at ASC'),
    db.all(`SELECT id, name, monthly_per_person AS monthlyPerPerson, description, locked, active, created_at, updated_at
            FROM categories WHERE active = 1 ORDER BY created_at ASC`),
    db.all(`SELECT id, label, amount, category_id AS categoryId, paid_by_member_id AS paidByMemberId, created_by_member_id AS createdByMemberId, date, note, status, created_at, updated_at
            FROM expenses ORDER BY date DESC, created_at DESC`),
    db.all(`SELECT id, amount, category_id AS categoryId, member_id AS memberId, created_by_member_id AS createdByMemberId, date, note, status, created_at, updated_at
            FROM contributions ORDER BY date DESC, created_at DESC`),
  ]);
  return {
    members,
    categories: categories.map((c) => ({ ...c, locked: Boolean(c.locked), active: Boolean(c.active) })),
    expenses,
    contributions,
    serverTime: new Date().toISOString(),
  };
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, name: 'S&S Budget Server', dbPath: absoluteDbPath, time: new Date().toISOString() });
});

app.get('/api/state', async (req, res, next) => {
  try { res.json(await getState()); } catch (error) { next(error); }
});

app.post('/api/members', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Le nom du membre est obligatoire.' });
    const id = req.body.id || uid('member');
    await db.run('INSERT INTO members (id, name, role) VALUES (?, ?, ?)', [id, name, req.body.role === 'admin' ? 'admin' : 'member']);
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.put('/api/members/:id', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Le nom du membre est obligatoire.' });
    await db.run('UPDATE members SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, req.params.id]);
    res.json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/members/:id', requireAdmin, async (req, res, next) => {
  try {
    const usedInExpenses = await db.get('SELECT COUNT(*) AS count FROM expenses WHERE paid_by_member_id = ?', [req.params.id]);
    const usedInContributions = await db.get('SELECT COUNT(*) AS count FROM contributions WHERE member_id = ?', [req.params.id]);
    if (usedInExpenses.count || usedInContributions.count) {
      return res.status(409).json({ error: 'Impossible de supprimer un membre avec historique.' });
    }
    await db.run('DELETE FROM members WHERE id = ?', [req.params.id]);
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/categories', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const monthlyPerPerson = normalizeAmount(req.body.monthlyPerPerson);
    if (!name) return res.status(400).json({ error: 'Le nom de la caisse est obligatoire.' });
    if (monthlyPerPerson === null) return res.status(400).json({ error: 'Le budget doit être positif.' });
    const id = req.body.id || uid('category');
    await db.run(
      `INSERT INTO categories (id, name, monthly_per_person, description, locked, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [id, name, monthlyPerPerson, String(req.body.description || ''), req.body.locked ? 1 : 0]
    );
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.put('/api/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const monthlyPerPerson = normalizeAmount(req.body.monthlyPerPerson);
    if (!name) return res.status(400).json({ error: 'Le nom de la caisse est obligatoire.' });
    if (monthlyPerPerson === null) return res.status(400).json({ error: 'Le budget doit être positif.' });
    await db.run(
      `UPDATE categories
       SET name = ?, monthly_per_person = ?, description = ?, locked = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, monthlyPerPerson, String(req.body.description || ''), req.body.locked ? 1 : 0, req.params.id]
    );
    res.json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/categories/:id', requireAdmin, async (req, res, next) => {
  try {
    const usedInExpenses = await db.get('SELECT COUNT(*) AS count FROM expenses WHERE category_id = ?', [req.params.id]);
    const usedInContributions = await db.get('SELECT COUNT(*) AS count FROM contributions WHERE category_id = ?', [req.params.id]);
    if (usedInExpenses.count || usedInContributions.count) {
      await db.run('UPDATE categories SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    } else {
      await db.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
    }
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/expenses', async (req, res, next) => {
  try {
    const label = String(req.body.label || '').trim();
    const amount = normalizeAmount(req.body.amount);
    if (!label) return res.status(400).json({ error: 'Le libellé est obligatoire.' });
    if (amount === null || amount <= 0) return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    const id = req.body.id || uid('expense');
    const user = await getCurrentUser(req);
    const status = normalizeActionStatus(req.body.date, req.body.status);
    await db.run(
      `INSERT INTO expenses (id, label, amount, category_id, paid_by_member_id, created_by_member_id, date, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, label, amount, req.body.categoryId, req.body.paidByMemberId, user.id, req.body.date, String(req.body.note || ''), status]
    );
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/expenses/:id', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    const row = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Dépense introuvable.' });
    if (!isWithinDeleteWindow(row)) return res.status(403).json({ error: `Suppression impossible après ${DELETE_WINDOW_DAYS} jours.` });
    if (user.role !== 'admin' && row.paid_by_member_id !== user.id && row.created_by_member_id !== user.id) {
      return res.status(403).json({ error: 'Un membre ne peut supprimer que ses propres dépenses récentes.' });
    }
    await db.run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/contributions', async (req, res, next) => {
  try {
    const amount = normalizeAmount(req.body.amount);
    if (amount === null || amount <= 0) return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    const id = req.body.id || uid('contribution');
    const user = await getCurrentUser(req);
    const status = normalizeActionStatus(req.body.date, req.body.status);
    await db.run(
      `INSERT INTO contributions (id, amount, category_id, member_id, created_by_member_id, date, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, amount, req.body.categoryId, req.body.memberId, user.id, req.body.date, String(req.body.note || ''), status]
    );
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/contributions/:id', async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    const row = await db.get('SELECT * FROM contributions WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Versement introuvable.' });
    if (!isWithinDeleteWindow(row)) return res.status(403).json({ error: `Suppression impossible après ${DELETE_WINDOW_DAYS} jours.` });
    if (user.role !== 'admin' && row.member_id !== user.id && row.created_by_member_id !== user.id) {
      return res.status(403).json({ error: 'Un membre ne peut supprimer que ses propres versements récents.' });
    }
    await db.run('DELETE FROM contributions WHERE id = ?', [req.params.id]);
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/auto-contributions', async (req, res, next) => {
  try {
    const memberIds = Array.isArray(req.body.memberIds) && req.body.memberIds.length ? req.body.memberIds : [];
    const date = req.body.date;
    const monthsCount = Math.max(1, parseInt(req.body.monthsCount || '1', 10));
    const status = normalizeActionStatus(date, req.body.status);
    const categories = await db.all('SELECT id, monthly_per_person FROM categories WHERE active = 1 ORDER BY created_at ASC');
    const user = await getCurrentUser(req);

    await db.run('BEGIN TRANSACTION');
    for (const memberId of memberIds) {
      for (const category of categories) {
        const amount = Number(category.monthly_per_person || 0) * monthsCount;
        if (amount <= 0) continue;
        await db.run(
          `INSERT INTO contributions (id, amount, category_id, member_id, created_by_member_id, date, note, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uid('auto'), amount, category.id, memberId, user.id, date, `Versement automatique (${monthsCount} mois)`, status]
        );
      }
    }
    await db.run('COMMIT');
    res.status(201).json(await getState());
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch (_) {}
    next(error);
  }
});

app.post('/api/reset', requireAdmin, async (req, res, next) => {
  try {
    await db.exec(`
      DELETE FROM expenses;
      DELETE FROM contributions;
      DELETE FROM categories;
      DELETE FROM members;
    `);
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await db.exec(schema);
    res.json(await getState());
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Erreur serveur.' });
});

openDb()
  .then((database) => {
    db = database;
    app.listen(port, '0.0.0.0', () => {
      console.log(`S&S Budget API démarrée sur http://0.0.0.0:${port}`);
      console.log(`Base SQLite : ${absoluteDbPath}`);
    });
  })
  .catch((error) => {
    console.error('Impossible de démarrer le serveur', error);
    process.exit(1);
  });
