require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDb, absoluteDbPath } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3001);
const appSecret = process.env.APP_SECRET || '';
const DELETE_WINDOW_DAYS = Number(process.env.DELETE_WINDOW_DAYS || 5);
const serverRoot = path.join(__dirname, '..');
const backupsDir = path.join(serverRoot, 'backups');

// --- V2.8 : authentification par PIN ---
const PIN_MAX_ATTEMPTS = Number(process.env.PIN_MAX_ATTEMPTS || 5);
const PIN_LOCK_MINUTES = Number(process.env.PIN_LOCK_MINUTES || 15);
const AUTH_TOKEN_TTL_HOURS = Number(process.env.AUTH_TOKEN_TTL_HOURS || 12);
const DEV_FALLBACK_AUTH_SECRET = 'ss-budget-dev-insecure-secret-changez-moi';
const authSigningSecret = appSecret && appSecret !== 'change-moi-avec-une-phrase-longue' ? appSecret : DEV_FALLBACK_AUTH_SECRET;
if (authSigningSecret === DEV_FALLBACK_AUTH_SECRET) {
  console.warn(
    "[S&S Budget] APP_SECRET non défini (ou laissé à sa valeur d'exemple) : les jetons de connexion sont signés avec une clé de développement non sécurisée et prévisible. Définissez APP_SECRET dans server/.env avant tout usage réel."
  );
}

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

const PIN_FORMAT = /^\d{4,8}$/;

function isValidPinFormat(pin) {
  return PIN_FORMAT.test(String(pin || ''));
}

function generatePinSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(String(pin), String(salt), 100000, 64, 'sha512').toString('hex');
}

function pinMatches(pin, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const candidate = Buffer.from(hashPin(pin, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function isPinLocked(member) {
  return Boolean(member.pin_locked_until) && new Date(member.pin_locked_until).getTime() > Date.now();
}

// Base64url manuel : évite de dépendre du support natif de l'encodage 'base64url'
// (ajouté tardivement dans Node), potentiellement absent sur le vieux PC serveur.
function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(input) {
  return toBase64Url(Buffer.from(input, 'utf8'));
}

function fromBase64Url(input) {
  let normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function signAuthToken(member) {
  const payload = {
    memberId: member.id,
    role: member.role,
    iat: Date.now(),
    exp: Date.now() + AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  };
  const payloadPart = base64UrlEncodeString(JSON.stringify(payload));
  const signature = toBase64Url(crypto.createHmac('sha256', authSigningSecret).update(payloadPart).digest());
  return { token: `${payloadPart}.${signature}`, expiresAt: new Date(payload.exp).toISOString() };
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadPart, signature] = token.split('.');
  if (!payloadPart || !signature) return null;
  const expectedSignature = toBase64Url(crypto.createHmac('sha256', authSigningSecret).update(payloadPart).digest());
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const payload = JSON.parse(fromBase64Url(payloadPart));
    if (!payload || !payload.memberId || !payload.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch (_) {
    return null;
  }
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

// V2.8 : le header x-ss-budget-user-id seul n'est plus jamais suffisant pour établir
// l'identité — il doit être accompagné d'un jeton x-ss-budget-auth-token valide,
// obtenu via POST /api/auth/login après vérification du PIN. Voir PATCH_V2_8_AUTH_PROFILS.md.
async function requireAuth(req, res, next) {
  try {
    const token = String(req.headers['x-ss-budget-auth-token'] || '');
    const headerMemberId = String(req.headers['x-ss-budget-user-id'] || '');
    const payload = verifyAuthToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Session invalide ou expirée. Merci de vous reconnecter.', code: 'AUTH_REQUIRED' });
    }
    if (headerMemberId && headerMemberId !== payload.memberId) {
      return res.status(401).json({ error: 'Session invalide.', code: 'AUTH_REQUIRED' });
    }
    const member = await db.get('SELECT id, name, role FROM members WHERE id = ?', [payload.memberId]);
    if (!member) return res.status(401).json({ error: 'Compte introuvable.', code: 'AUTH_REQUIRED' });
    req.currentUser = member;
    next();
  } catch (error) { next(error); }
}

function requireAdminRole(req, res, next) {
  if (!req.currentUser || req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Action réservée à un administrateur.' });
  }
  next();
}


function safeJson(value) {
  try { return JSON.stringify(value || {}); } catch (_) { return '{}'; }
}

function parseReadBy(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
  } catch (_) {
    return [];
  }
}

async function getMemberNameById(id) {
  if (!id) return '';
  const row = await db.get('SELECT name FROM members WHERE id = ?', [id]);
  return row?.name || String(id);
}

async function getCategoryNameById(id) {
  if (!id) return '';
  const row = await db.get('SELECT name FROM categories WHERE id = ?', [id]);
  return row?.name || String(id);
}

async function logActivity(req, payload = {}) {
  try {
    const user = req.currentUser || { id: '', name: '' };
    // L'auteur de l'action est considéré comme ayant déjà "lu" sa propre activité :
    // ça évite qu'il voie son propre journal se marquer "non lu" et garde le badge
    // de non-lus centré sur ce que fait l'AUTRE personne.
    const readByMemberIds = user?.id ? [String(user.id)] : [];
    await db.run(
      `INSERT INTO activity_logs (id, actor_member_id, actor_name, action, entity_type, entity_id, label, amount, date, details, read_by_member_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid('log'),
        user?.id || '',
        user?.name || '',
        String(payload.action || 'activity'),
        String(payload.entityType || ''),
        String(payload.entityId || ''),
        String(payload.label || ''),
        payload.amount === undefined || payload.amount === null ? null : Number(payload.amount),
        payload.date || null,
        safeJson(payload.details || {}),
        JSON.stringify(readByMemberIds),
      ]
    );
  } catch (error) {
    console.error('Journal activité non écrit', error.message || error);
  }
}


function ensureBackupsDir() {
  fs.mkdirSync(backupsDir, { recursive: true });
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function fileInfo(filePath) {
  const stats = fs.statSync(filePath);
  return {
    file: path.basename(filePath),
    sizeBytes: stats.size,
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  };
}

function listBackupFiles() {
  ensureBackupsDir();
  return fs.readdirSync(backupsDir)
    .filter((name) => name.startsWith('ss-budget-'))
    .map((name) => fileInfo(path.join(backupsDir, name)))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function backupDatabase(reason = 'manual') {
  ensureBackupsDir();
  const safeReason = String(reason || 'manual').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  const target = path.join(backupsDir, `ss-budget-backup-${backupTimestamp()}-${safeReason}.sqlite`);
  fs.copyFileSync(absoluteDbPath, target);
  return fileInfo(target);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/"/g, '""');
  return /[",\n;]/.test(text) ? `"${text}"` : text;
}

function rowsToCsv(rows, columns) {
  const header = columns.map((c) => csvEscape(c.label)).join(';');
  const body = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(';')).join('\n');
  return `${header}\n${body}\n`;
}

async function buildExportPayload() {
  const state = await getState();
  return {
    app: 'S&S Budget',
    version: '2.3',
    exportedAt: new Date().toISOString(),
    database: { filename: path.basename(absoluteDbPath) },
    data: state,
  };
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
  const [members, categories, expenses, contributions, activityLogs] = await Promise.all([
    db.all('SELECT id, name, role, created_at, updated_at FROM members ORDER BY created_at ASC'),
    db.all(`SELECT id, name, monthly_per_person AS monthlyPerPerson, description, locked, active, created_at, updated_at
            FROM categories WHERE active = 1 ORDER BY created_at ASC`),
    db.all(`SELECT id, label, amount, category_id AS categoryId, paid_by_member_id AS paidByMemberId, created_by_member_id AS createdByMemberId, date, note, status, created_at, updated_at
            FROM expenses ORDER BY date DESC, created_at DESC`),
    db.all(`SELECT id, amount, category_id AS categoryId, member_id AS memberId, created_by_member_id AS createdByMemberId, date, note, status, created_at, updated_at
            FROM contributions ORDER BY date DESC, created_at DESC`),
    db.all(`SELECT id, actor_member_id AS actorMemberId, actor_name AS actorName, action, entity_type AS entityType, entity_id AS entityId, label, amount, date, details, read_by_member_ids AS readByMemberIds, created_at AS createdAt
            FROM activity_logs ORDER BY created_at DESC LIMIT 100`),
  ]);
  return {
    members,
    categories: categories.map((c) => ({ ...c, locked: Boolean(c.locked), active: Boolean(c.active) })),
    expenses,
    contributions,
    activityLogs: activityLogs.map((log) => ({
      ...log,
      details: (() => { try { return JSON.parse(log.details || '{}'); } catch (_) { return {}; } })(),
      readByMemberIds: parseReadBy(log.readByMemberIds),
    })),
    serverTime: new Date().toISOString(),
  };
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, name: 'S&S Budget Server', dbPath: absoluteDbPath, time: new Date().toISOString() });
});

app.get('/api/state', requireAuth, async (req, res, next) => {
  try { res.json(await getState()); } catch (error) { next(error); }
});

// --- V2.8 : routes d'authentification par PIN ---
// Publiques par nécessité : elles servent justement à obtenir le jeton d'authentification,
// donc ne peuvent pas exiger ce même jeton. Voir PATCH_V2_8_AUTH_PROFILS.md pour le détail
// des raisons et des protections qui restent actives (secret API partagé, hash + sel,
// verrouillage temporaire après plusieurs échecs).
app.get('/api/auth/status', async (req, res, next) => {
  try {
    const rows = await db.all('SELECT id, name, role, pin_hash, pin_locked_until FROM members ORDER BY created_at ASC');
    res.json({
      ok: true,
      members: rows.map((row) => {
        const locked = Boolean(row.pin_locked_until) && new Date(row.pin_locked_until).getTime() > Date.now();
        return {
          id: row.id,
          name: row.name,
          role: row.role,
          pinSet: Boolean(row.pin_hash),
          locked,
          lockedUntil: locked ? row.pin_locked_until : null,
        };
      }),
    });
  } catch (error) { next(error); }
});

app.post('/api/auth/set-pin', async (req, res, next) => {
  try {
    const memberId = String(req.body.memberId || '');
    const pin = String(req.body.pin || '');
    const currentPin = req.body.currentPin !== undefined && req.body.currentPin !== null ? String(req.body.currentPin) : '';
    if (!memberId) return res.status(400).json({ error: 'Profil manquant.' });
    if (!isValidPinFormat(pin)) return res.status(400).json({ error: 'Le PIN doit contenir entre 4 et 8 chiffres.', code: 'PIN_FORMAT' });

    const member = await db.get(
      'SELECT id, name, role, pin_salt, pin_hash, failed_pin_attempts, pin_locked_until FROM members WHERE id = ?',
      [memberId]
    );
    if (!member) return res.status(404).json({ error: 'Profil introuvable.' });

    const hasExistingPin = Boolean(member.pin_hash);

    if (hasExistingPin) {
      if (isPinLocked(member)) {
        return res.status(423).json({ error: 'Profil temporairement verrouillé. Réessaie plus tard.', code: 'PIN_LOCKED' });
      }
      if (!currentPin || !pinMatches(currentPin, member.pin_salt, member.pin_hash)) {
        const attempts = Number(member.failed_pin_attempts || 0) + 1;
        if (attempts >= PIN_MAX_ATTEMPTS) {
          const lockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString();
          await db.run('UPDATE members SET failed_pin_attempts = 0, pin_locked_until = ? WHERE id = ?', [lockedUntil, memberId]);
          req.currentUser = { id: member.id, name: member.name, role: member.role };
          await logActivity(req, { action: 'login_locked', entityType: 'member', entityId: memberId, label: member.name, details: { lockMinutes: PIN_LOCK_MINUTES } });
          return res.status(423).json({ error: `Trop d’essais. Profil verrouillé ${PIN_LOCK_MINUTES} minutes.`, code: 'PIN_LOCKED' });
        }
        await db.run('UPDATE members SET failed_pin_attempts = ? WHERE id = ?', [attempts, memberId]);
        return res.status(401).json({ error: 'PIN actuel incorrect.', code: 'CURRENT_PIN_INVALID' });
      }
    }

    const salt = generatePinSalt();
    const hash = hashPin(pin, salt);
    await db.run(
      'UPDATE members SET pin_salt = ?, pin_hash = ?, failed_pin_attempts = 0, pin_locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [salt, hash, memberId]
    );

    req.currentUser = { id: member.id, name: member.name, role: member.role };
    await logActivity(req, {
      action: hasExistingPin ? 'pin_updated' : 'pin_created',
      entityType: 'member',
      entityId: memberId,
      label: member.name,
    });

    res.json({ ok: true, message: hasExistingPin ? 'PIN modifié.' : 'PIN créé.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const memberId = String(req.body.memberId || '');
    const pin = String(req.body.pin || '');
    if (!memberId) return res.status(400).json({ error: 'Profil manquant.' });
    if (!isValidPinFormat(pin)) return res.status(400).json({ error: 'Le PIN doit contenir entre 4 et 8 chiffres.', code: 'PIN_FORMAT' });

    const member = await db.get(
      'SELECT id, name, role, pin_salt, pin_hash, failed_pin_attempts, pin_locked_until FROM members WHERE id = ?',
      [memberId]
    );
    if (!member) return res.status(404).json({ error: 'Profil introuvable.' });

    if (isPinLocked(member)) {
      return res.status(423).json({ error: 'Profil temporairement verrouillé. Réessaie plus tard.', code: 'PIN_LOCKED' });
    }

    if (!member.pin_hash) {
      return res.status(400).json({ error: 'Aucun PIN défini pour ce profil. Crée-en un d’abord.', code: 'PIN_NOT_SET' });
    }

    if (!pinMatches(pin, member.pin_salt, member.pin_hash)) {
      const attempts = Number(member.failed_pin_attempts || 0) + 1;
      if (attempts >= PIN_MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString();
        await db.run('UPDATE members SET failed_pin_attempts = 0, pin_locked_until = ? WHERE id = ?', [lockedUntil, memberId]);
        req.currentUser = { id: member.id, name: member.name, role: member.role };
        await logActivity(req, { action: 'login_locked', entityType: 'member', entityId: memberId, label: member.name, details: { lockMinutes: PIN_LOCK_MINUTES } });
        return res.status(423).json({ error: `Trop d’essais. Profil verrouillé ${PIN_LOCK_MINUTES} minutes.`, code: 'PIN_LOCKED' });
      }
      await db.run('UPDATE members SET failed_pin_attempts = ? WHERE id = ?', [attempts, memberId]);
      return res.status(401).json({ error: 'PIN incorrect.', code: 'PIN_INVALID' });
    }

    await db.run('UPDATE members SET failed_pin_attempts = 0, pin_locked_until = NULL WHERE id = ?', [memberId]);
    const { token, expiresAt } = signAuthToken(member);

    req.currentUser = { id: member.id, name: member.name, role: member.role };
    await logActivity(req, { action: 'member_login', entityType: 'member', entityId: member.id, label: member.name });

    res.json({ ok: true, member: { id: member.id, name: member.name, role: member.role }, authToken: token, expiresAt });
  } catch (error) { next(error); }
});

app.post('/api/members', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Le nom du membre est obligatoire.' });
    const id = req.body.id || uid('member');
    await db.run('INSERT INTO members (id, name, role) VALUES (?, ?, ?)', [id, name, req.body.role === 'admin' ? 'admin' : 'member']);
    await logActivity(req, { action: 'member_created', entityType: 'member', entityId: id, label: name, details: { role: req.body.role === 'admin' ? 'admin' : 'member' } });
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.put('/api/members/:id', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Le nom du membre est obligatoire.' });
    await db.run('UPDATE members SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, req.params.id]);
    await logActivity(req, { action: 'member_updated', entityType: 'member', entityId: req.params.id, label: name });
    res.json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/members/:id', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    const member = await db.get('SELECT id, name, role FROM members WHERE id = ?', [req.params.id]);
    if (!member) return res.status(404).json({ error: 'Membre introuvable.' });
    const usedInExpenses = await db.get('SELECT COUNT(*) AS count FROM expenses WHERE paid_by_member_id = ?', [req.params.id]);
    const usedInContributions = await db.get('SELECT COUNT(*) AS count FROM contributions WHERE member_id = ?', [req.params.id]);
    if (usedInExpenses.count || usedInContributions.count) {
      return res.status(409).json({ error: 'Impossible de supprimer un membre avec historique.' });
    }
    await db.run('DELETE FROM members WHERE id = ?', [req.params.id]);
    await logActivity(req, { action: 'member_deleted', entityType: 'member', entityId: req.params.id, label: member.name, details: { memberName: member.name, role: member.role } });
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/categories', requireAuth, requireAdminRole, async (req, res, next) => {
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
    await logActivity(req, { action: 'category_created', entityType: 'category', entityId: id, label: name, amount: monthlyPerPerson, details: { locked: Boolean(req.body.locked) } });
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.put('/api/categories/:id', requireAuth, requireAdminRole, async (req, res, next) => {
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
    await logActivity(req, { action: 'category_updated', entityType: 'category', entityId: req.params.id, label: name, amount: monthlyPerPerson, details: { locked: Boolean(req.body.locked) } });
    res.json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/categories/:id', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    const category = await db.get('SELECT id, name, monthly_per_person, locked FROM categories WHERE id = ?', [req.params.id]);
    if (!category) return res.status(404).json({ error: 'Caisse introuvable.' });
    const usedInExpenses = await db.get('SELECT COUNT(*) AS count FROM expenses WHERE category_id = ?', [req.params.id]);
    const usedInContributions = await db.get('SELECT COUNT(*) AS count FROM contributions WHERE category_id = ?', [req.params.id]);
    const details = {
      categoryName: category.name,
      monthlyPerPerson: Number(category.monthly_per_person || 0),
      locked: Boolean(category.locked),
      usedInExpenses: Number(usedInExpenses.count || 0),
      usedInContributions: Number(usedInContributions.count || 0),
    };
    if (usedInExpenses.count || usedInContributions.count) {
      await db.run('UPDATE categories SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
      await logActivity(req, { action: 'category_archived', entityType: 'category', entityId: req.params.id, label: category.name, details });
    } else {
      await db.run('DELETE FROM categories WHERE id = ?', [req.params.id]);
      await logActivity(req, { action: 'category_deleted', entityType: 'category', entityId: req.params.id, label: category.name, details });
    }
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/expenses', requireAuth, async (req, res, next) => {
  try {
    const label = String(req.body.label || '').trim();
    const amount = normalizeAmount(req.body.amount);
    if (!label) return res.status(400).json({ error: 'Le libellé est obligatoire.' });
    if (amount === null || amount <= 0) return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    const id = req.body.id || uid('expense');
    const user = req.currentUser;
    const status = normalizeActionStatus(req.body.date, req.body.status);
    await db.run(
      `INSERT INTO expenses (id, label, amount, category_id, paid_by_member_id, created_by_member_id, date, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, label, amount, req.body.categoryId, req.body.paidByMemberId, user.id, req.body.date, String(req.body.note || ''), status]
    );
    await logActivity(req, {
      action: status === 'planned' ? 'expense_planned' : 'expense_created',
      entityType: 'expense',
      entityId: id,
      label,
      amount,
      date: req.body.date,
      details: {
        categoryId: req.body.categoryId,
        categoryName: await getCategoryNameById(req.body.categoryId),
        paidByMemberId: req.body.paidByMemberId,
        paidByMemberName: await getMemberNameById(req.body.paidByMemberId),
        status,
      },
    });
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.put('/api/expenses/:id', requireAuth, async (req, res, next) => {
  try {
    const user = req.currentUser;
    const row = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Dépense introuvable.' });
    if (!isWithinDeleteWindow(row)) return res.status(403).json({ error: `Modification impossible après ${DELETE_WINDOW_DAYS} jours.` });
    if (user.role !== 'admin' && row.paid_by_member_id !== user.id && row.created_by_member_id !== user.id) {
      return res.status(403).json({ error: 'Un membre ne peut modifier que ses propres dépenses récentes.' });
    }

    const label = String(req.body.label || '').trim();
    const amount = normalizeAmount(req.body.amount);
    if (!label) return res.status(400).json({ error: 'Le libellé est obligatoire.' });
    if (amount === null || amount <= 0) return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    const status = normalizeActionStatus(req.body.date, req.body.status);

    const oldCategoryName = await getCategoryNameById(row.category_id);
    const oldPaidByMemberName = await getMemberNameById(row.paid_by_member_id);
    const newCategoryName = await getCategoryNameById(req.body.categoryId);
    const newPaidByMemberName = await getMemberNameById(req.body.paidByMemberId);

    await db.run(
      `UPDATE expenses
       SET label = ?, amount = ?, category_id = ?, paid_by_member_id = ?, date = ?, note = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [label, amount, req.body.categoryId, req.body.paidByMemberId, req.body.date, String(req.body.note || ''), status, req.params.id]
    );

    await logActivity(req, {
      action: 'expense_updated',
      entityType: 'expense',
      entityId: req.params.id,
      label,
      amount,
      date: req.body.date,
      details: {
        oldLabel: row.label,
        newLabel: label,
        oldAmount: row.amount,
        newAmount: amount,
        oldDate: row.date,
        newDate: req.body.date,
        oldCategoryId: row.category_id,
        newCategoryId: req.body.categoryId,
        oldCategoryName,
        newCategoryName,
        oldPaidByMemberId: row.paid_by_member_id,
        newPaidByMemberId: req.body.paidByMemberId,
        oldPaidByMemberName,
        newPaidByMemberName,
        oldStatus: row.status,
        newStatus: status,
      },
    });

    res.json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/expenses/:id', requireAuth, async (req, res, next) => {
  try {
    const user = req.currentUser;
    const row = await db.get('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Dépense introuvable.' });
    if (!isWithinDeleteWindow(row)) return res.status(403).json({ error: `Suppression impossible après ${DELETE_WINDOW_DAYS} jours.` });
    if (user.role !== 'admin' && row.paid_by_member_id !== user.id && row.created_by_member_id !== user.id) {
      return res.status(403).json({ error: 'Un membre ne peut supprimer que ses propres dépenses récentes.' });
    }
    await db.run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    await logActivity(req, {
      action: 'expense_deleted',
      entityType: 'expense',
      entityId: req.params.id,
      label: row.label,
      amount: row.amount,
      date: row.date,
      details: {
        categoryId: row.category_id,
        categoryName: await getCategoryNameById(row.category_id),
        paidByMemberId: row.paid_by_member_id,
        paidByMemberName: await getMemberNameById(row.paid_by_member_id),
        status: row.status,
      },
    });
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/contributions', requireAuth, async (req, res, next) => {
  try {
    const amount = normalizeAmount(req.body.amount);
    if (amount === null || amount <= 0) return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    const id = req.body.id || uid('contribution');
    const user = req.currentUser;
    const status = normalizeActionStatus(req.body.date, req.body.status);
    await db.run(
      `INSERT INTO contributions (id, amount, category_id, member_id, created_by_member_id, date, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, amount, req.body.categoryId, req.body.memberId, user.id, req.body.date, String(req.body.note || ''), status]
    );
    await logActivity(req, {
      action: status === 'planned' ? 'contribution_planned' : 'contribution_created',
      entityType: 'contribution',
      entityId: id,
      label: 'Versement',
      amount,
      date: req.body.date,
      details: {
        categoryId: req.body.categoryId,
        categoryName: await getCategoryNameById(req.body.categoryId),
        memberId: req.body.memberId,
        memberName: await getMemberNameById(req.body.memberId),
        status,
      },
    });
    res.status(201).json(await getState());
  } catch (error) { next(error); }
});

app.put('/api/contributions/:id', requireAuth, async (req, res, next) => {
  try {
    const user = req.currentUser;
    const row = await db.get('SELECT * FROM contributions WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Versement introuvable.' });
    if (!isWithinDeleteWindow(row)) return res.status(403).json({ error: `Modification impossible après ${DELETE_WINDOW_DAYS} jours.` });
    if (user.role !== 'admin' && row.member_id !== user.id && row.created_by_member_id !== user.id) {
      return res.status(403).json({ error: 'Un membre ne peut modifier que ses propres versements récents.' });
    }

    const amount = normalizeAmount(req.body.amount);
    if (amount === null || amount <= 0) return res.status(400).json({ error: 'Le montant doit être supérieur à 0.' });
    const status = normalizeActionStatus(req.body.date, req.body.status);

    const oldCategoryName = await getCategoryNameById(row.category_id);
    const oldMemberName = await getMemberNameById(row.member_id);
    const newCategoryName = await getCategoryNameById(req.body.categoryId);
    const newMemberName = await getMemberNameById(req.body.memberId);

    await db.run(
      `UPDATE contributions
       SET amount = ?, category_id = ?, member_id = ?, date = ?, note = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [amount, req.body.categoryId, req.body.memberId, req.body.date, String(req.body.note || ''), status, req.params.id]
    );

    await logActivity(req, {
      action: 'contribution_updated',
      entityType: 'contribution',
      entityId: req.params.id,
      label: 'Versement',
      amount,
      date: req.body.date,
      details: {
        oldAmount: row.amount,
        newAmount: amount,
        oldDate: row.date,
        newDate: req.body.date,
        oldCategoryId: row.category_id,
        newCategoryId: req.body.categoryId,
        oldCategoryName,
        newCategoryName,
        oldMemberId: row.member_id,
        newMemberId: req.body.memberId,
        oldMemberName,
        newMemberName,
        oldStatus: row.status,
        newStatus: status,
      },
    });

    res.json(await getState());
  } catch (error) { next(error); }
});

app.delete('/api/contributions/:id', requireAuth, async (req, res, next) => {
  try {
    const user = req.currentUser;
    const row = await db.get('SELECT * FROM contributions WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Versement introuvable.' });
    if (!isWithinDeleteWindow(row)) return res.status(403).json({ error: `Suppression impossible après ${DELETE_WINDOW_DAYS} jours.` });
    if (user.role !== 'admin' && row.member_id !== user.id && row.created_by_member_id !== user.id) {
      return res.status(403).json({ error: 'Un membre ne peut supprimer que ses propres versements récents.' });
    }
    await db.run('DELETE FROM contributions WHERE id = ?', [req.params.id]);
    await logActivity(req, {
      action: 'contribution_deleted',
      entityType: 'contribution',
      entityId: req.params.id,
      label: 'Versement',
      amount: row.amount,
      date: row.date,
      details: {
        categoryId: row.category_id,
        categoryName: await getCategoryNameById(row.category_id),
        memberId: row.member_id,
        memberName: await getMemberNameById(row.member_id),
        status: row.status,
      },
    });
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/auto-contributions', requireAuth, async (req, res, next) => {
  try {
    const memberIds = Array.isArray(req.body.memberIds) && req.body.memberIds.length ? req.body.memberIds : [];
    const date = req.body.date;
    const monthsCount = Math.max(1, parseInt(req.body.monthsCount || '1', 10));
    const status = normalizeActionStatus(date, req.body.status);
    const categories = await db.all('SELECT id, monthly_per_person FROM categories WHERE active = 1 ORDER BY created_at ASC');
    const user = req.currentUser;

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
    await logActivity(req, {
      action: status === 'planned' ? 'auto_contributions_planned' : 'auto_contributions_created',
      entityType: 'contribution',
      label: 'Versements automatiques',
      amount: categories.reduce((sum, category) => sum + Number(category.monthly_per_person || 0), 0) * monthsCount * memberIds.length,
      date,
      details: {
        memberIds,
        memberNames: await Promise.all(memberIds.map((memberId) => getMemberNameById(memberId))),
        monthsCount,
        status,
      },
    });
    res.status(201).json(await getState());
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch (_) {}
    next(error);
  }
});



app.get('/api/activity-logs', requireAuth, async (req, res, next) => {
  try {
    const rows = await db.all(`SELECT id, actor_member_id AS actorMemberId, actor_name AS actorName, action, entity_type AS entityType, entity_id AS entityId, label, amount, date, details, read_by_member_ids AS readByMemberIds, created_at AS createdAt
                               FROM activity_logs ORDER BY created_at DESC LIMIT 200`);
    res.json({
      ok: true,
      activityLogs: rows.map((log) => ({
        ...log,
        details: (() => { try { return JSON.parse(log.details || '{}'); } catch (_) { return {}; } })(),
        readByMemberIds: parseReadBy(log.readByMemberIds),
      })),
    });
  } catch (error) { next(error); }
});

app.post('/api/activity-logs/read-all', requireAuth, async (req, res, next) => {
  try {
    const user = req.currentUser;
    const rows = await db.all('SELECT id, read_by_member_ids FROM activity_logs');
    await db.run('BEGIN TRANSACTION');
    try {
      for (const row of rows) {
        const readBy = parseReadBy(row.read_by_member_ids);
        if (!readBy.includes(user.id)) {
          readBy.push(user.id);
          await db.run('UPDATE activity_logs SET read_by_member_ids = ? WHERE id = ?', [JSON.stringify(readBy), row.id]);
        }
      }
      await db.run('COMMIT');
    } catch (error) {
      await db.run('ROLLBACK');
      throw error;
    }
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/activity-logs/:id/read', requireAuth, async (req, res, next) => {
  try {
    const user = req.currentUser;
    const row = await db.get('SELECT id, read_by_member_ids FROM activity_logs WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Activité introuvable.' });
    const readBy = parseReadBy(row.read_by_member_ids);
    if (!readBy.includes(user.id)) {
      readBy.push(user.id);
      await db.run('UPDATE activity_logs SET read_by_member_ids = ? WHERE id = ?', [JSON.stringify(readBy), req.params.id]);
    }
    res.json(await getState());
  } catch (error) { next(error); }
});

app.post('/api/backups/create', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    const backup = backupDatabase(req.body.reason || 'manual');
    await logActivity(req, { action: 'backup_created', entityType: 'backup', entityId: backup.file, label: backup.file, details: { sizeBytes: backup.sizeBytes } });
    res.status(201).json({ ok: true, backup, backups: listBackupFiles() });
  } catch (error) { next(error); }
});

app.get('/api/backups', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    res.json({ ok: true, backups: listBackupFiles() });
  } catch (error) { next(error); }
});

app.post('/api/export/json', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    ensureBackupsDir();
    const payload = await buildExportPayload();
    const target = path.join(backupsDir, `ss-budget-export-${backupTimestamp()}.json`);
    fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
    const exportInfo = fileInfo(target);
    await logActivity(req, { action: 'export_json_created', entityType: 'export', entityId: exportInfo.file, label: exportInfo.file, details: { sizeBytes: exportInfo.sizeBytes } });
    res.status(201).json({ ok: true, export: exportInfo, backups: listBackupFiles() });
  } catch (error) { next(error); }
});

app.get('/api/export/json', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    res.json(await buildExportPayload());
  } catch (error) { next(error); }
});

app.post('/api/export/csv', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    ensureBackupsDir();
    const [expenseRows, contributionRows] = await Promise.all([
      db.all(`SELECT e.id, e.date, e.status, e.label, e.amount, c.name AS category, m.name AS paid_by, e.note, e.created_at
              FROM expenses e
              LEFT JOIN categories c ON c.id = e.category_id
              LEFT JOIN members m ON m.id = e.paid_by_member_id
              ORDER BY e.date DESC, e.created_at DESC`),
      db.all(`SELECT co.id, co.date, co.status, co.amount, c.name AS category, m.name AS member, co.note, co.created_at
              FROM contributions co
              LEFT JOIN categories c ON c.id = co.category_id
              LEFT JOIN members m ON m.id = co.member_id
              ORDER BY co.date DESC, co.created_at DESC`),
    ]);

    const expensesCsv = rowsToCsv(expenseRows, [
      { key: 'id', label: 'ID' },
      { key: 'date', label: 'Date' },
      { key: 'status', label: 'Statut' },
      { key: 'label', label: 'Libellé' },
      { key: 'amount', label: 'Montant' },
      { key: 'category', label: 'Caisse' },
      { key: 'paid_by', label: 'Payé par' },
      { key: 'note', label: 'Note' },
      { key: 'created_at', label: 'Créé le' },
    ]);
    const contributionsCsv = rowsToCsv(contributionRows, [
      { key: 'id', label: 'ID' },
      { key: 'date', label: 'Date' },
      { key: 'status', label: 'Statut' },
      { key: 'amount', label: 'Montant' },
      { key: 'category', label: 'Caisse' },
      { key: 'member', label: 'Membre' },
      { key: 'note', label: 'Note' },
      { key: 'created_at', label: 'Créé le' },
    ]);

    const stamp = backupTimestamp();
    const expensesPath = path.join(backupsDir, `ss-budget-expenses-${stamp}.csv`);
    const contributionsPath = path.join(backupsDir, `ss-budget-contributions-${stamp}.csv`);
    fs.writeFileSync(expensesPath, expensesCsv, 'utf8');
    fs.writeFileSync(contributionsPath, contributionsCsv, 'utf8');

    const exports = [fileInfo(expensesPath), fileInfo(contributionsPath)];
    await logActivity(req, { action: 'export_csv_created', entityType: 'export', label: 'Exports CSV', details: { files: exports.map((item) => item.file) } });
    res.status(201).json({ ok: true, exports, backups: listBackupFiles() });
  } catch (error) { next(error); }
});

app.post('/api/backups/restore', requireAuth, requireAdminRole, async (req, res, next) => {
  try {
    const requestedFile = path.basename(String(req.body.file || ''));
    if (!requestedFile || !requestedFile.startsWith('ss-budget-backup-') || !requestedFile.endsWith('.sqlite')) {
      return res.status(400).json({ error: 'Fichier de sauvegarde invalide.' });
    }
    const source = path.join(backupsDir, requestedFile);
    if (!fs.existsSync(source)) return res.status(404).json({ error: 'Sauvegarde introuvable.' });

    const safetyBackup = backupDatabase('before-restore');
    await db.close();
    fs.copyFileSync(source, absoluteDbPath);
    db = await openDb();
    await logActivity(req, { action: 'backup_restored', entityType: 'backup', entityId: requestedFile, label: requestedFile, details: { safetyBackup: safetyBackup.file } });
    res.json({ ok: true, restoredFrom: requestedFile, safetyBackup, state: await getState() });
  } catch (error) {
    try { if (!db) db = await openDb(); } catch (_) {}
    next(error);
  }
});

app.post('/api/reset', requireAuth, requireAdminRole, async (req, res, next) => {
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
    await logActivity(req, { action: 'server_reset', entityType: 'system', label: 'Réinitialisation serveur' });
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
