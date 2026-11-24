#!/usr/bin/env node
/**
 * Automated browser qualification of the exported web builds (no server, no real data).
 *
 *   node scripts/qa/web-qa.cjs --preview <dist-preview> --normal <dist> --out <dir>
 *
 * Requires playwright-core (resolved from PLAYWRIGHT_CORE or NODE_PATH, never a
 * project dependency) and a Chromium/Chrome binary (CHROME_PATH or Playwright's).
 *
 * QA Lab matrix: 5 scenarios x widths 360/390/430/large(760 cap) x normal/large layout.
 * Checks: displayed balances, horizontal overflow, clipped text, asymmetric vertical
 * blank space (excess height), fixed bottom navigation, official brand asset,
 * reduced-motion, and isolation (no storage / network / API access).
 * Normal build: Duo Glance before authentication never renders seeded cached amounts.
 * IMPORTANT: a web layout simulation is NOT iOS Dynamic Type nor Android font scaling.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const OUT = path.resolve(args.out || 'qa-out');
fs.mkdirSync(OUT, { recursive: true });

const SCENARIOS = [
  { key: 'normal', label: 'Budget normal', real: '165,00 €', forecast: '165,00 €' },
  { key: 'negative', label: 'Solde négatif', real: '-35,00 €', forecast: '-35,00 €' },
  { key: 'empty', label: 'Compte vide', real: '0,00 €', forecast: '0,00 €' },
  { key: 'future', label: 'Opérations futures', real: '165,00 €', forecast: '125,00 €' },
  { key: 'offline', label: 'Hors ligne simulé', real: '165,00 €', forecast: '165,00 €' },
];
const WIDTHS = [{ label: '360 px', width: 360 }, { label: '390 px', width: 390 }, { label: '430 px', width: 430 }, { label: 'Large (760 px max)', width: 760 }];
const SENTINEL_AMOUNT = '98765';

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(dir, urlPath);
    if (!file.startsWith(path.resolve(dir))) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// Installed before any app script: seeds realistic-looking private keys with sentinel
// values and records every storage / network primitive touched by the page.
const INSTRUMENT = `(() => {
  const log = window.__qaAccess = [];
  const SENT = '${SENTINEL_AMOUNT}';
  try {
    localStorage.setItem('SS_BUDGET_V2_CACHE', JSON.stringify({ members:[{id:'steve',name:'Sentinelle'}], categories:[{id:'weekends',name:'Weekends',monthlyPerPerson:40}], expenses:[{id:'s',label:'SENTINEL',amount:${SENTINEL_AMOUNT}.43,categoryId:'weekends',paidByMemberId:'steve',date:'2026-11-01',status:'done'}], contributions:[], activityLogs:[] }));
    localStorage.setItem('SS_BUDGET_V2_API_URL', 'http://127.0.0.1:9');
    localStorage.setItem('SS_BUDGET_V2_API_SECRET', 'SENTINEL_SECRET');
    localStorage.setItem('SS_BUDGET_V2_AUTH_TOKEN', 'SENTINEL.TOKEN');
    localStorage.setItem('SS_BUDGET_V2_AUTH_EXPIRES_AT', new Date(Date.now() + 3600e3).toISOString());
  } catch (e) {}
  const wrapStorage = (name) => { const s = window[name]; for (const m of ['getItem','setItem','removeItem','key','clear']) { const orig = s[m].bind(s); s[m] = (...a) => { log.push(name + '.' + m + ':' + String(a[0])); return orig(...a); }; } };
  wrapStorage('localStorage'); wrapStorage('sessionStorage');
  const of = window.fetch; window.fetch = (...a) => { log.push('fetch:' + String(a[0] && a[0].url || a[0])); return of(...a); };
  const ox = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u) { log.push('xhr:' + u); return ox.apply(this, arguments); };
  const OW = window.WebSocket; window.WebSocket = function(u) { log.push('ws:' + u); return new OW(u); };
  const oi = indexedDB.open.bind(indexedDB); indexedDB.open = (n, v) => { log.push('indexedDB:' + n); return oi(n, v); };
})();`;

// In-page measurement of the simulated device frame.
function measure({ expectedWidth }) {
  const title = [...document.querySelectorAll('div,span')].find((e) => e.textContent === 'DUO BUDGET · QA LAB · DONNÉES FICTIVES');
  let toolbar = title;
  while (toolbar && !(toolbar.nextElementSibling && Math.abs(toolbar.nextElementSibling.getBoundingClientRect().width - expectedWidth) <= 1)) toolbar = toolbar.parentElement;
  const device = toolbar && toolbar.nextElementSibling;
  if (!device) return { error: 'device frame not found' };
  const d = device.getBoundingClientRect();
  const all = [...device.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const overflow = all.filter((e) => { const r = e.getBoundingClientRect(); return r.right > d.right + 1 || r.left < d.left - 1; })
    .map((e) => ({ text: (e.textContent || '').slice(0, 40), left: Math.round(e.getBoundingClientRect().left - d.left), right: Math.round(e.getBoundingClientRect().right - d.left) }));
  const leafTexts = all.filter((e) => e.children.length === 0 && (e.textContent || '').trim());
  const clipped = leafTexts.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2)
    .filter((e) => getComputedStyle(e).overflow !== 'visible' || getComputedStyle(e).textOverflow === 'ellipsis')
    .map((e) => (e.textContent || '').slice(0, 40));
  // Asymmetric blank space: a box much taller than its content, content top-aligned.
  const excess = all.filter((e) => e.children.length > 0 && getComputedStyle(e).display === 'flex' && getComputedStyle(e).flexDirection === 'column')
    .map((e) => {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      const kids = [...e.children].map((k) => k.getBoundingClientRect()).filter((k) => k.height > 0);
      if (!kids.length) return null;
      const top = Math.min(...kids.map((k) => k.top)) - r.top - parseFloat(cs.paddingTop) - parseFloat(cs.borderTopWidth);
      const bottom = r.bottom - Math.max(...kids.map((k) => k.bottom)) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
      return { e, top, bottom, h: r.height };
    })
    // Ignore scrolled content (children above the box) and boxes whose children overflow.
    .filter((x) => x && x.top >= -1 && x.bottom >= -1 && x.bottom - x.top > 12 && x.h < d.height * 0.9)
    .map((x) => ({ text: (x.e.textContent || '').slice(0, 50), blankBottom: Math.round(x.bottom), blankTop: Math.round(x.top), height: Math.round(x.h) }));
  const tablist = device.querySelector('[role="tablist"]');
  const scroller = all.find((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > 0);
  const nav = tablist && tablist.getBoundingClientRect();
  const tabs = tablist ? [...tablist.children].map((t) => Math.round(t.getBoundingClientRect().width)) : [];
  const tabInner = tablist ? tablist.clientWidth - parseFloat(getComputedStyle(tablist).paddingLeft) - parseFloat(getComputedStyle(tablist).paddingRight) : 0;
  const textOf = (label) => { const el = [...device.querySelectorAll('div,span')].find((e) => e.textContent === label); return el && el.nextElementSibling ? el.nextElementSibling.textContent : null; };
  const imgs = [...device.querySelectorAll('img')].map((i) => i.getAttribute('src') || '').concat([...device.querySelectorAll('div')].map((x) => getComputedStyle(x).backgroundImage).filter((b) => b && b !== 'none'));
  return {
    deviceWidth: Math.round(d.width), deviceHeight: Math.round(d.height),
    horizontalOverflow: overflow.slice(0, 10), horizontalOverflowCount: overflow.length,
    scrollerOverflowX: scroller ? scroller.scrollWidth > scroller.clientWidth + 1 : null,
    clipped: clipped.slice(0, 10),
    excessVertical: excess.slice(0, 10),
    navBottomGap: nav ? Math.round(d.bottom - nav.bottom) : null,
    navTop: nav ? Math.round(nav.top - d.top) : null,
    tabWidths: tabs, tabInnerWidth: Math.round(tabInner),
    real: textOf('Solde réel enregistré'), forecast: textOf('Solde prévisionnel'),
    brand: imgs.some((s) => /duo-mark-blue/.test(s)),
    scrollerMax: scroller ? scroller.scrollHeight - scroller.clientHeight : null,
    bodyText: device.innerText,
  };
}

async function scrollToEnd(page) {
  await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (['auto', 'scroll'].includes(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; });
  await page.waitForTimeout(150);
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), browser: null, qaLab: [], isolation: {}, glance: {}, reducedMotion: {}, failures: [] };
  const fail = (msg) => report.failures.push(msg);
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  report.browser = browser.version();
  try {
    // ---------------- QA Lab (preview build) ----------------
    const { server, base } = await serve(path.resolve(args.preview));
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(INSTRUMENT);
    const page = await ctx.newPage();
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    await page.goto(base + '/');
    await page.getByText('DUO BUDGET · QA LAB · DONNÉES FICTIVES').waitFor();
    let largeState = false;
    for (const s of SCENARIOS) {
      await page.getByText(s.label, { exact: true }).click();
      for (const w of WIDTHS) {
        await page.getByText(w.label, { exact: true }).click();
        for (const large of [false, true]) {
          // The switch is a pure toggle, untouched by scenario/width changes: track it here.
          if (largeState !== large) { await page.getByText('Disposition grande police', { exact: true }).click(); largeState = large; }
          await page.waitForTimeout(120);
          const top = await page.evaluate(measure, { expectedWidth: w.width });
          await scrollToEnd(page);
          const bottom = await page.evaluate(measure, { expectedWidth: w.width });
          const id = `${s.key}-${w.width}${large ? '-large' : ''}`;
          await page.screenshot({ path: path.join(OUT, `qa-lab-${id}-end.png`), clip: { x: (1280 - w.width) / 2, y: 0, width: w.width, height: 1000 } }).catch(() => {});
          const shotTop = path.join(OUT, `qa-lab-${id}.png`);
          await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (['auto', 'scroll'].includes(getComputedStyle(e).overflowY)) e.scrollTop = 0; });
          await page.screenshot({ path: shotTop, clip: { x: (1280 - w.width) / 2, y: 0, width: w.width, height: 1000 } }).catch(() => {});
          const { bodyText, ...rest } = top;
          const row = { id, scenario: s.key, width: w.width, large, ...rest, navStableOnScroll: top.navTop === bottom.navTop && bottom.navBottomGap === 0, horizontalOverflowAtEnd: bottom.horizontalOverflowCount, excessVerticalAtEnd: bottom.excessVertical };
          report.qaLab.push(row);
          if (top.error) { fail(`${id}: ${top.error}`); continue; }
          if (top.real !== s.real) fail(`${id}: real balance ${top.real} != ${s.real}`);
          if (top.forecast !== s.forecast) fail(`${id}: forecast ${top.forecast} != ${s.forecast}`);
          if (top.horizontalOverflowCount || bottom.horizontalOverflowCount || top.scrollerOverflowX) fail(`${id}: horizontal overflow`);
          if (top.clipped.length) fail(`${id}: clipped text ${JSON.stringify(top.clipped)}`);
          if (!row.navStableOnScroll || top.navBottomGap !== 0) fail(`${id}: bottom navigation not fixed (gap ${top.navBottomGap}, top ${top.navTop}->${bottom.navTop})`);
          if (top.excessVertical.length || bottom.excessVertical.length) fail(`${id}: excess vertical space ${JSON.stringify([...top.excessVertical, ...bottom.excessVertical].slice(0, 3))}`);
          if (!top.brand) fail(`${id}: official brand asset not rendered`);
          if (large && top.tabWidths.some((tw) => Math.abs(tw - top.tabInnerWidth / 2) > 2)) fail(`${id}: large tabs not half width ${top.tabWidths}`);
          if (!large && w.width >= 360 && top.tabWidths.length !== 4) fail(`${id}: expected one row of 4 tabs`);
          if (s.key === 'empty' && !/Aucune enveloppe configurée/.test(bodyText)) fail(`${id}: empty notice missing`);
          if (s.key === 'negative' && !/solde réel enregistré est négatif/.test(bodyText)) fail(`${id}: negative notice missing`);
          if (s.key === 'offline' && !/Hors ligne/.test(bodyText)) fail(`${id}: offline notice missing`);
        }
      }
    }
    // Glance inside the QA Lab at each width.
    await page.getByText('Disposition grande police', { exact: true }).click().catch(() => {});
    for (const w of WIDTHS) {
      await page.getByText(w.label, { exact: true }).click();
      await page.getByText('Glance', { exact: true }).click();
      await page.waitForTimeout(150);
      const g = await page.evaluate(measure, { expectedWidth: w.width });
      report.glance[`qa-lab-${w.width}`] = { horizontalOverflowCount: g.horizontalOverflowCount, clipped: g.clipped, brand: g.brand, fictional: /Montants fictifs/.test(g.bodyText) };
      if (g.horizontalOverflowCount) fail(`glance ${w.width}: horizontal overflow`);
      if (!g.brand) fail(`glance ${w.width}: official brand asset not rendered`);
      await page.screenshot({ path: path.join(OUT, `qa-lab-glance-${w.width}.png`), clip: { x: (1280 - w.width) / 2, y: 0, width: w.width, height: 1000 } }).catch(() => {});
      await page.getByText('Accueil', { exact: true }).first().click();
    }
    const access = await page.evaluate(() => window.__qaAccess);
    const external = requests.filter((u) => !u.startsWith(base));
    const nonStatic = requests.filter((u) => u.startsWith(base) && /\/api\//.test(u));
    report.isolation.qaLab = { storageOrNetworkAccess: access, externalRequests: external, apiRequests: nonStatic, totalRequests: requests.length, consoleErrors };
    if (access.length) fail(`QA Lab touched storage/network primitives: ${JSON.stringify(access.slice(0, 10))}`);
    if (external.length || nonStatic.length) fail(`QA Lab made non-static requests: ${JSON.stringify([...external, ...nonStatic].slice(0, 5))}`);
    if (/SENTINEL|98765/.test(await page.evaluate(() => document.body.innerText))) fail('QA Lab rendered seeded private sentinel data');
    await ctx.close();

    // Reduced motion on the Glance (preview build so no server is involved).
    for (const mode of ['no-preference', 'reduce']) {
      const c = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: mode });
      const p = await c.newPage();
      await p.goto(base + '/');
      await p.getByText('Glance', { exact: true }).click();
      await p.waitForTimeout(400);
      const snap = () => p.evaluate(() => [...document.querySelectorAll('div')].map((d) => d.style.transform + '|' + d.style.opacity).join(';'));
      const a = await snap(); await p.waitForTimeout(900); const b = await snap();
      report.reducedMotion[mode] = { stylesChangedOverTime: a !== b };
      await c.close();
    }
    if (!report.reducedMotion['no-preference'].stylesChangedOverTime) fail('control: Glance animation not detected without reduced motion (check is not sensitive)');
    if (report.reducedMotion.reduce.stylesChangedOverTime) fail('Glance keeps animating with prefers-reduced-motion: reduce');
    server.close();

    // ---------------- Normal build: pre-auth privacy ----------------
    // Cached private data is seeded; only the session token state varies.
    if (args.normal) {
      const n = await serve(path.resolve(args.normal));
      const cases = {
        noToken: `localStorage.removeItem('SS_BUDGET_V2_AUTH_TOKEN'); localStorage.removeItem('SS_BUDGET_V2_AUTH_EXPIRES_AT');`,
        expiredToken: `localStorage.setItem('SS_BUDGET_V2_AUTH_EXPIRES_AT', new Date(Date.now() - 60e3).toISOString());`,
        validStoredToken: ``,
      };
      for (const [name, tweak] of Object.entries(cases)) {
        const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await c.addInitScript(INSTRUMENT.replace('wrapStorage(\'localStorage\');', tweak + ' wrapStorage(\'localStorage\');'));
        const p = await c.newPage();
        const reqs = [];
        p.on('request', (r) => reqs.push(r.url()));
        await p.goto(n.base + '/');
        await p.waitForFunction(() => document.body.innerText.trim().length > 20, null, { timeout: 15000 }).catch(() => {});
        await p.waitForTimeout(1500);
        const text = await p.evaluate(() => document.body.innerText);
        const storage = await p.evaluate(() => ({ token: localStorage.getItem('SS_BUDGET_V2_AUTH_TOKEN'), expires: localStorage.getItem('SS_BUDGET_V2_AUTH_EXPIRES_AT') }));
        report.glance[`normalBuild_${name}`] = {
          glanceShown: /Montants fictifs/.test(text),
          rendersSentinel: /SENTINEL|98765/.test(text),
          requests: [...new Set(reqs.filter((u) => u.startsWith('http://127.0.0.1:9')).map((u) => u.replace('http://127.0.0.1:9', '')))],
          tokenAfterLoad: storage.token ? 'present' : 'absent',
        };
        await p.screenshot({ path: path.join(OUT, `normal-build-${name}-390.png`) });
        if (name !== 'validStoredToken') {
          if (!report.glance[`normalBuild_${name}`].glanceShown) fail(`normal build (${name}): Duo Glance not shown before authentication`);
          if (report.glance[`normalBuild_${name}`].rendersSentinel) fail(`normal build (${name}): cached private data rendered before authentication`);
          if (report.glance[`normalBuild_${name}`].requests.some((r) => r !== '/api/auth/status')) fail(`normal build (${name}): private API called before authentication`);
        }
        await c.close();
      }
      n.server.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'web-qa-report.json'), JSON.stringify(report, null, 2));
  console.log(`web QA: ${report.qaLab.length} QA Lab cells, ${report.failures.length} failure(s); report ${path.join(OUT, 'web-qa-report.json')}`);
  for (const f of report.failures) console.log('  ✗ ' + f);
  process.exitCode = report.failures.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(2); });
