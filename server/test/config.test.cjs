// R-01: secure-by-default secret handling. Startup cases spawn the real server.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validateAppSecret, secretsEqual } = require('../src/config');
const { startServer, tempDir } = require('./helpers.cjs');

const GOOD = crypto.randomBytes(32).toString('hex');
const OLD_DEV_KEY = 'ss-budget-dev-insecure-secret-changez-moi';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('secret validation rules', () => {
  assert.equal(validateAppSecret(GOOD).ok, true);
  assert.equal(validateAppSecret('Kx9#mP2$vL7qR4tW8zN1cB6yH3jF5dG0').ok, true);
  const refused = {
    absent: undefined,
    empty: '',
    short: 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P', // 31 chars
    example: 'change-moi-avec-une-phrase-longue',
    readme: 'une-phrase-longue-et-privee',
    oldDevKey: OLD_DEV_KEY,
    exampleInLongValue: 'change-moi-avec-une-phrase-longue-2026-duo',
    lowVariety: 'abababababababababababababababababab',
    padded: ` ${GOOD}`,
  };
  for (const [name, value] of Object.entries(refused)) assert.equal(validateAppSecret(value).ok, false, name);
  assert.match(validateAppSecret(refused.short).reason, /^trop court \(31 < 32/);
  assert.equal(validateAppSecret(refused.absent).reason, 'absent');
});

test('secret comparison is exact', () => {
  assert.equal(secretsEqual(GOOD, GOOD), true);
  for (const v of [GOOD.slice(1), GOOD + 'x', GOOD.toUpperCase(), '', undefined]) assert.equal(secretsEqual(v, GOOD), false);
});

function startRaw(env) {
  return new Promise((resolve) => {
    const dir = tempDir();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
      cwd: dir, env: { PATH: process.env.PATH, PORT: '0', DB_PATH: path.join(dir, 'q.sqlite'), ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve({ code: 'TIMEOUT', out }); }, 8000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

test('server refuses to start with an unsafe secret, whatever NODE_ENV, without logging it', async () => {
  const cases = [
    { name: 'absent', env: {} },
    { name: 'example', env: { APP_SECRET: 'change-moi-avec-une-phrase-longue' } },
    { name: 'old dev key', env: { APP_SECRET: OLD_DEV_KEY } },
    { name: 'short', env: { APP_SECRET: 'Zq8-short-secret-XY' } },
    { name: 'short in development', env: { APP_SECRET: 'Zq8-short-secret-XY', NODE_ENV: 'development' } },
    { name: 'absent in production', env: { NODE_ENV: 'production' } },
  ];
  for (const c of cases) {
    const r = await startRaw(c.env);
    assert.equal(r.code, 1, `${c.name}: exit code (${r.out})`);
    assert.match(r.out, /Démarrage refusé : APP_SECRET/, c.name);
    assert.doesNotMatch(r.out, /API démarrée/, c.name);
    if (c.env.APP_SECRET) assert.ok(!r.out.includes(c.env.APP_SECRET), `${c.name}: secret value must not be logged`);
  }
});

test('a token forged with the former public development key is rejected', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  await s.setPinAndLogin('steve', '4821');
  const payload = b64url(JSON.stringify({ memberId: 'steve', role: 'admin', iat: Date.now(), exp: Date.now() + 3600e3 }));
  const sig = b64url(crypto.createHmac('sha256', OLD_DEV_KEY).update(payload).digest());
  assert.equal((await s.request('GET', '/api/state', { token: `${payload}.${sig}` })).status, 401);
  assert.ok(!s.logs().includes(s.secret), 'running server never logs its secret');
});

test('rotation: a new APP_SECRET invalidates every session and the old API secret', async () => {
  const first = await startServer();
  const token = await first.setPinAndLogin('steve', '4821');
  await first.stop();
  const rotated = await startServer({ dbPath: first.dbPath });
  try {
    assert.notEqual(rotated.secret, first.secret);
    assert.equal((await rotated.request('GET', '/api/state', { token })).status, 401, 'old session refused');
    assert.equal((await rotated.request('GET', '/api/auth/status', { noSecret: true, headers: { 'x-ss-budget-secret': first.secret } })).status, 401, 'old API secret refused');
    await rotated.login('steve', '4821'); // PINs survive the rotation
  } finally { await rotated.stop(); }
});
