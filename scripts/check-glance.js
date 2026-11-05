#!/usr/bin/env node
/**
 * Baseline static regression checks for the very first Duo Budget V3 screen.
 * These guard the pre-auth privacy boundary and wiring, NOT visual/device behavior.
 * Run: node scripts/check-glance.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const screen = fs.readFileSync(path.join(root, 'src/features/glance/DuoGlanceScreen.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'App.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

assert.match(screen, /const DEMO = Object\.freeze\(/, 'Demo values must be intentionally immutable');
assert.match(screen, /Montants fictifs/, 'Public preview needs a visible fake-data label');
assert.match(screen, /Aucun solde personnel n'est accessible avant authentification/, 'Privacy notice is required');
assert.doesNotMatch(screen, /AsyncStorage|fetch\(|\/api\//, 'Public component must not read private storage or API');
assert.match(screen, /PanResponder\.create\(/, 'Swipe gesture must be available');
assert.match(screen, /reduceMotionChanged/, 'Reduced motion must be handled');
assert.match(screen, /onCreateAccount \|\| onSignIn/, 'Configuration entry must remain reachable');
assert.match(app, /showGlance \? \(/, 'Pre-auth entry must render glance first');
assert.match(app, /onSignIn=\{\(\) => setShowGlance\(false\)\}/, 'Sign in must route to the existing auth gate');
assert.match(app, /if \(!isSessionValid\(\)\)/, 'Existing PIN/session guard must remain');
assert.match(app, /renderAuthGate\(\)/, 'Original PIN gate must remain available');
assert.equal(config.expo.name, 'Duo Budget');
assert.equal(config.expo.slug, 'ss-budget-couple', 'Legacy Expo slug must not change without a migration');

console.log('✓ Duo Glance static integration and privacy assertions passed (13 checks).');
