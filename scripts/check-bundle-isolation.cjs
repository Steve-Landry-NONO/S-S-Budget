#!/usr/bin/env node
/**
 * Static isolation check of the two web exports.
 *   node scripts/check-bundle-isolation.cjs <dist> <dist-preview>
 * The QA Lab export (EXPO_PUBLIC_DUO_PREVIEW=1) must not even contain the
 * authenticated application: no storage keys, no auth headers, no API routes.
 * The normal export must keep the authenticated app and its PIN gate.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function bundleText(dir) {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(dir);
  assert.ok(files.length > 0, `no JavaScript bundle in ${dir}`);
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

const [normalDir, previewDir] = process.argv.slice(2);
assert.ok(normalDir && previewDir, 'usage: check-bundle-isolation.cjs <dist> <dist-preview>');
const normal = bundleText(normalDir);
const preview = bundleText(previewDir);

const PRIVATE_MARKERS = ['SS_BUDGET_V2_AUTH_TOKEN', 'SS_BUDGET_V2_API_SECRET', 'SS_BUDGET_V2_CACHE', 'x-ss-budget-auth-token', 'x-ss-budget-secret', '/api/state', '/api/auth/login'];
let checks = 0;
for (const marker of PRIVATE_MARKERS) {
  assert.ok(!preview.includes(marker), `QA Lab bundle must not contain ${marker}`); checks++;
  assert.ok(normal.includes(marker), `normal bundle lost ${marker} (check is no longer meaningful)`); checks++;
}
assert.ok(preview.includes('QA LAB'), 'QA Lab bundle renders the QA Lab'); checks++;
assert.ok(preview.includes('Montants fictifs'), 'QA Lab bundle keeps the fictional Glance'); checks++;
console.log(`✓ Web bundle isolation: QA Lab export excludes the authenticated app (${checks} checks).`);
