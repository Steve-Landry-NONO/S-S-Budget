const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {TABS,ACTIONS,parentRoute,actionsFor} = require('../src/features/navigation/routes.cjs');
test('four primary destinations in approved order', () => {
  assert.deepEqual(TABS.map(x=>x.key), ['dashboard','categories','activity','members']);
});
test('all six legacy destinations remain reachable', () => {
  assert.equal(new Set([...TABS,...ACTIONS].map(x=>x.key)).size,6);
  const app=fs.readFileSync('App.js','utf8');
  for(const {key} of [...TABS,...ACTIONS]) assert.ok(app.includes("tab === '"+key+"'"),key);
});
test('expense and contribution routes belong to home and provide return', () => {
  for(const {key} of ACTIONS) {
    assert.equal(parentRoute(key),'dashboard');
    assert.ok(actionsFor(key).some(x=>x.key==='dashboard'));
    assert.ok(!actionsFor(key).some(x=>x.key===key));
  }
  assert.deepEqual(actionsFor('dashboard'),ACTIONS);
  for(const key of ['categories','activity','members']) assert.deepEqual(actionsFor(key),[]);
});
test('navigation remains behind session gate and outside content scroll', () => {
  const app=fs.readFileSync('App.js','utf8');
  assert.ok(app.indexOf('if (!isSessionValid())') < app.indexOf('<NavigationActions'));
  assert.ok(app.indexOf('<NavigationActions') < app.indexOf('<BottomNavigation'));
  assert.ok(app.includes('</ScrollView>\n      <BottomNavigation'));
  assert.ok(!app.includes('<View style={styles.tabsOuter}>'));
});
