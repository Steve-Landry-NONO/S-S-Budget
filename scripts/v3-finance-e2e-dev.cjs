'use strict';
// NEUTRALISÉ (A-05 / G13, 26/11/2026) : ce harnais suppose un transfert cash → envelope sur un duo sans période,
// refusé par la 006 révisée (lot 2 C07). Il s'arrête avant toute lecture d'environnement ou tout appel réseau.
// Remplacement : docs/v3/E2E_AUTH_REPLACEMENT_PLAN.md.
console.error('v3-finance-e2e-dev.cjs est neutralisé (A-05/G13) : harnais obsolète, voir docs/v3/E2E_AUTH_REPLACEMENT_PLAN.md');
process.exit(3);
// Optional, manual end-to-end test against DEV only.
// Requires two real Supabase Auth test accounts and pre-provisioned household/accounts.
// Never commit credentials. Uses native Node 22 fetch; no dependency required.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const url = process.env.DUO_V3_SUPABASE_URL;
const key = process.env.DUO_V3_PUBLISHABLE_KEY;
const emailA = process.env.DUO_V3_TEST_A_EMAIL;
const passwordA = process.env.DUO_V3_TEST_A_PASSWORD;
const emailB = process.env.DUO_V3_TEST_B_EMAIL;
const passwordB = process.env.DUO_V3_TEST_B_PASSWORD;
const household = process.env.DUO_V3_TEST_HOUSEHOLD;
const from = process.env.DUO_V3_TEST_FROM_ACCOUNT;
const to = process.env.DUO_V3_TEST_TO_ACCOUNT;
const expectedProject = 'eetnzdvjfzexgvqbtyrj';

function required(value, name) {
  if (!value) throw new Error('Missing ' + name);
  return value;
}
async function api(path, token, body) {
  const response = await fetch(url + path, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data };
}
async function login(email, password) {
  const response = await api('/auth/v1/token?grant_type=password', key, { email, password });
  assert.equal(response.status, 200, 'Real Auth login failed: ' + JSON.stringify(response.data));
  assert.ok(response.data.access_token);
  return response.data.access_token;
}
async function main() {
  required(url, 'DUO_V3_SUPABASE_URL');
  assert.equal(new URL(url).hostname, expectedProject + '.supabase.co', 'Refusing non-DEV project');
  for (const [name, value] of Object.entries({
    DUO_V3_PUBLISHABLE_KEY: key, DUO_V3_TEST_A_EMAIL: emailA,
    DUO_V3_TEST_A_PASSWORD: passwordA, DUO_V3_TEST_B_EMAIL: emailB,
    DUO_V3_TEST_B_PASSWORD: passwordB, DUO_V3_TEST_HOUSEHOLD: household,
    DUO_V3_TEST_FROM_ACCOUNT: from, DUO_V3_TEST_TO_ACCOUNT: to,
  })) required(value, name);

  const [tokenA, tokenB] = await Promise.all([login(emailA, passwordA), login(emailB, passwordB)]);
  const idempotencyKey = 'e2e-' + randomUUID();
  const params = {
    p_household: household, p_from_account: from, p_to_account: to,
    p_amount_minor: '1', p_currency: 'EUR', p_idempotency_key: idempotencyKey,
  };
  // Independent HTTP requests with the same key, issued concurrently.
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    api('/rest/v1/rpc/duo_v3_post_transfer', tokenA, params)
  ));
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(new Set(results.map(result => result.data)).size, 1, 'Concurrent idempotency mismatch');
  const foreign = await api('/rest/v1/rpc/duo_v3_post_transfer', tokenB,
    { ...params, p_idempotency_key: 'foreign-' + randomUUID() });
  assert.ok(foreign.status >= 400, 'Cross-household transfer was allowed');
  const changed = await api('/rest/v1/rpc/duo_v3_post_transfer', tokenA,
    { ...params, p_amount_minor: '2' });
  assert.ok(changed.status >= 400, 'Reusing key with changed amount was allowed');
  process.stdout.write('PASS: real JWT auth, 8 concurrent calls = one transaction, cross-household denied, mismatched key denied\n');
  process.stdout.write('Created one DEV transfer; delete test fixtures using a reviewed cleanup procedure.\n');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
