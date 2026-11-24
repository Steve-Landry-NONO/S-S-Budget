const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {TABS,ACTIONS,parentRoute,actionsFor} = require('../src/features/navigation/routes.cjs');
test('four primary destinations in approved order', () => {
  assert.deepEqual(TABS.map(x=>x.key), ['dashboard','categories','activity','members']);
});
test('all six legacy destinations remain reachable', () => {
  assert.equal(new Set([...TABS,...ACTIONS].map(x=>x.key)).size,6);
  const app=fs.readFileSync('App.js','utf8').replace(/\r\n/g, '\n');
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
  const app=fs.readFileSync('App.js','utf8').replace(/\r\n/g, '\n');
  const gate = app.indexOf('if (!isSessionValid())');
  assert.ok(gate >= 0);
  assert.ok(app.indexOf("{!largeText && tab !== 'dashboard' && renderMainControls()}") > gate);
  assert.ok(app.indexOf("{(largeText || tab === 'dashboard') && renderMainControls()}") > gate);
  assert.equal((app.match(/renderMainControls\(\)/g) || []).length, 2);
  assert.ok(app.slice(app.indexOf('const renderMainControls ='), gate).includes('<NavigationActions'));
  assert.ok(app.indexOf('<NavigationActions') < app.indexOf('<BottomNavigation'));
  assert.ok(app.includes('</ScrollView>\n      <BottomNavigation'));
  assert.ok(!app.includes('<View style={styles.tabsOuter}>'));
});

test('icons are decorative and navigation labels remain available', () => {
  const nav = fs.readFileSync('src/features/navigation/DuoNavigation.js', 'utf8');
  for (const {key} of TABS) assert.ok(nav.includes("route === '"+key+"'"));
  assert.ok(nav.includes('accessibilityElementsHidden'));
  assert.ok(nav.includes('accessibilityState={{ selected: active }}'));
  assert.ok(nav.includes('fontScale >= 1.3'));
});

 test('server configuration remains editable before authentication', () => {
 const source = require('node:fs').readFileSync('App.js','utf8');
 require('node:assert/strict').match(source,/\(!apiUrl \|\| editingServer\)/);
 require('node:assert/strict').match(source,/Modifier la configuration du serveur/);
 require('node:assert/strict').match(source,/apiUrl && !editingServer && !isSessionValid\(\)/);
 });

test('large text keeps main controls in scroll and navigation outside',()=>{const app=fs.readFileSync('App.js','utf8');assert.match(app,/fontScale >= 1\.3/);assert.match(app,/\{\(largeText \|\| tab === 'dashboard'\) && renderMainControls\(\)\}/);assert.match(app,/\{!largeText && tab !== 'dashboard' && renderMainControls\(\)\}/);assert.match(app,/largeText && styles\.stacked/);assert.match(app,/StatusBar style="dark"/);assert.doesNotMatch(app,/allowFontScaling=\{false\}/);});
