#!/usr/bin/env node
/**
 * EAS Android Preview configuration guardrails.
 * Run: node scripts/check-android-preview.js
 * No EAS credentials, emulators or API secrets required.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const eas = JSON.parse(fs.readFileSync('eas.json', 'utf8'));
const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
assert.equal(eas.build.preview.distribution, 'internal');
assert.equal(eas.build.preview.android.buildType, 'apk');
assert.equal(eas.build.preview.env.APP_VARIANT, 'preview');
assert.equal(eas.build.production.android.buildType, 'app-bundle');
assert.equal(app.android.package, 'com.ss.budgetcouple', 'Never change legacy package implicitly');
assert.equal(app.ios.bundleIdentifier, 'com.ss.budgetcouple');

function configFor(variant) {
  return JSON.parse(execFileSync(process.execPath, ['-e', `
    const fn = require('./app.config.js');
    process.stdout.write(JSON.stringify(fn({ config: {} })));
  `], { env: { ...process.env, APP_VARIANT: variant }, encoding: 'utf8' }));
}
const normal = configFor('');
const preview = configFor('preview');
assert.equal(normal.name, app.name);
assert.equal(normal.android.package, app.android.package);
assert.equal(preview.android.package, 'com.ss.budgetcouple.preview');
assert.equal(preview.name, 'Duo Budget Preview');
assert.notEqual(preview.android.package, normal.android.package);
assert.equal(preview.extra.appVariant, 'preview');
assert.equal(normal.extra.appVariant, 'standard');
assert.equal(preview.slug, app.slug);
assert.equal(preview.icon, app.icon);

console.log('✓ Android preview EAS profile and independent package validated (15 assertions).');
