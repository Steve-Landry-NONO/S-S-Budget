// Black-box harness for the self-hosted SQLite API.
// Every server instance runs in a child process on a throw-away database inside
// os.tmpdir(); the owner's real database, .env and backups are never touched.
// cwd is the temp directory so dotenv cannot pick up a real server/.env.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER_ENTRY = path.join(__dirname, '..', 'src', 'index.js');
const SERVER_NODE_MODULES = path.join(__dirname, '..', 'node_modules');

function tempDir(prefix = 'duo-budget-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function testSecret() {
  return 'test-' + crypto.randomBytes(16).toString('hex');
}

async function startServer({ dbPath, env = {}, secret = testSecret() } = {}) {
  const dir = dbPath ? path.dirname(dbPath) : tempDir();
  const finalDbPath = dbPath || path.join(dir, 'qa.sqlite');
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      TZ: process.env.TZ || 'UTC',
      NODE_PATH: SERVER_NODE_MODULES,
      PORT: String(port),
      DB_PATH: finalDbPath,
      APP_SECRET: secret,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start:\n' + output)), 15000);
    const onData = () => {
      if (output.includes('API démarrée')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited (${code}):\n${output}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const server = {
    base,
    port,
    dbPath: finalDbPath,
    dir,
    secret,
    logs: () => output,
    async stop() {
      if (child.exitCode !== null || child.signalCode) return;
      await new Promise((resolve) => { child.once('exit', resolve); child.kill('SIGTERM'); });
    },
    async request(method, route, { body, token, userId, headers = {}, rawBody, noSecret } = {}) {
      const response = await fetch(base + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(noSecret ? {} : { 'x-ss-budget-secret': secret }),
          ...(token ? { 'x-ss-budget-auth-token': token } : {}),
          ...(userId ? { 'x-ss-budget-user-id': userId } : {}),
          ...headers,
        },
        body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* non JSON body kept in text */ }
      return { status: response.status, body: json, text };
    },
    async login(memberId, pin) {
      const res = await server.request('POST', '/api/auth/login', { body: { memberId, pin } });
      if (res.status !== 200) throw new Error(`login ${memberId} failed ${res.status} ${res.text}`);
      return res.body.authToken;
    },
    async setPinAndLogin(memberId, pin) {
      const set = await server.request('POST', '/api/auth/set-pin', { body: { memberId, pin } });
      if (set.status !== 200) throw new Error(`set-pin ${memberId} failed ${set.status} ${set.text}`);
      return server.login(memberId, pin);
    },
  };
  return server;
}

// Direct SQLite access to the TEMPORARY database only (server must be stopped).
async function withDb(dbPath, fn) {
  const sqlite3 = require(path.join(SERVER_NODE_MODULES, 'sqlite3'));
  const { open } = require(path.join(SERVER_NODE_MODULES, 'sqlite'));
  if (!dbPath.startsWith(os.tmpdir())) throw new Error('Refusing to open a database outside the temp directory: ' + dbPath);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  try { return await fn(db); } finally { await db.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { startServer, withDb, tempDir, testSecret, sleep };
