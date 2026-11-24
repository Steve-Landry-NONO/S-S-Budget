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

function configFor(variant, extraEnv = {}) {
  return JSON.parse(execFileSync(process.execPath, ['-e', `
    const fn = require('./app.config.js');
    process.stdout.write(JSON.stringify(fn({ config: {} })));
  `], { env: { ...process.env, APP_VARIANT: variant, PREVIEW_ALLOW_CLEARTEXT: '', ...extraEnv }, encoding: 'utf8' }));
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


// Hardening (technical-hardening T07): standard build strictly unchanged.
assert.deepEqual(normal.plugins, app.plugins, 'standard plugins unchanged');
assert.equal(normal.android.allowBackup, undefined, 'standard backup behaviour unchanged');
assert.equal(normal.android.blockedPermissions, undefined);
assert.deepEqual(configFor('', { PREVIEW_ALLOW_CLEARTEXT: '1' }).plugins, app.plugins, 'cleartext never applies outside preview');
// Preview: no cloud backup of token/secret/cache, unused permissions blocked.
assert.equal(preview.android.allowBackup, false);
for (const p of ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE']) {
  assert.ok(preview.android.blockedPermissions.includes(p), p);
}
// Cleartext HTTP is an explicit, visible opt-in of the EAS preview profile only.
assert.deepEqual(preview.plugins, app.plugins, 'no cleartext without PREVIEW_ALLOW_CLEARTEXT=1');
assert.equal(eas.build.preview.env.PREVIEW_ALLOW_CLEARTEXT, '1');
assert.equal(eas.build.production.env, undefined, 'production profile never enables preview options');
const previewEas = configFor('preview', { PREVIEW_ALLOW_CLEARTEXT: '1' });
assert.ok(previewEas.plugins.includes('./plugins/withPreviewCleartext'));
assert.ok(fs.existsSync('plugins/withPreviewCleartext.js'));
// No secret may be baked into the build configuration.
const secretLike = /secret|token|password|pin|apikey|api_key|keystore/i;
for (const key of Object.keys(eas.build.preview.env)) assert.doesNotMatch(key, secretLike, key);
assert.doesNotMatch(JSON.stringify(previewEas.extra), secretLike);
assert.ok(!/EXPO_PUBLIC_(?!DUO_PREVIEW)/.test(fs.readFileSync('App.js', 'utf8')), 'only the QA Lab flag is a public build variable');

console.log('✓ Android preview EAS profile, independent package and preview hardening validated (32 assertions).');
