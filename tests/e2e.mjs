// Vérifications de bout en bout dans un vrai navigateur (Chromium via Playwright).
// Usage : SHOTS=/chemin/captures node tests/e2e.mjs
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/home/claude/.npm-global/lib/node_modules/playwright'); }

process.env.DATA_FILE = path.join(mkdtempSync(path.join(os.tmpdir(), 'barioz-e2e-')), 'db.json');
delete process.env.VERCEL;
const shots = process.env.SHOTS || path.join(os.tmpdir(), 'barioz-shots');
mkdirSync(shots, { recursive: true });

const db = await import('../lib/store.js');
const { seedDemoUsers } = await import('../lib/api.js');
const { createServer } = await import('../server.mjs');
await seedDemoUsers();
// mêmes données que `npm run demo`
{
  const { handle } = await import('../lib/api.js');
  await handle({ method: 'GET', path: '/api/public', headers: {} }); // déclenche le semis
  const now = new Date(); const m = new Date(now); m.setHours(7, 40, 0, 0);
  const c = await db.get('conditions');
  await db.set('conditions', { ...c, season: 'open', updatedAt: now.toISOString(), lastGroomedAt: m.toISOString(), airTemp: -4, snowTemp: -6, humidity: 70, snowStates: ['douce_damee'], snowFoyer: 75, snowRefuge: 130, avalancheRisk: 2, message: 'Soirée musique ce vendredi : départ du foyer à 19h précises.', messageLevel: 'info' });
  const trails = await db.get('trails');
  const closed = new Set(['s4', 's10', 's11', 'r4']);
  for (const t of trails) { t.status = closed.has(t.id) ? 'closed' : 'open'; t.groomedAt = t.kind === 'ski' && t.status === 'open' ? m.toISOString() : null; }
  await db.set('trails', trails);
}

const server = createServer();
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const browser = await playwright.chromium.launch();

const PAGES = ['/', '/conditions', '/pistes', '/foyer', '/refuge', '/soirees', '/evenements', '/scolaires', '/association', '/acces'];
const problems = [];
let checks = 0;
const ok = (m) => console.log(`  ok ${++checks} ${m}`);

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  for (const p of PAGES) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/epok\.network|ERR_|Failed to load resource/.test(m.text() + (m.location()?.url || ''))) errs.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) errs.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.route(/epok\.network/, (r) => r.abort());
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-status-bar]:not([hidden])');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) errs.push(`débordement horizontal de ${overflow}px`);
    if (!(await page.locator('h1').count())) errs.push('pas de <h1>');
    const slug = p === '/' ? 'accueil' : p.slice(1);
    await page.screenshot({ path: path.join(shots, `${label}-${slug}.png`), fullPage: true });
    if (errs.length) problems.push(`${label} ${p}: ${errs.join(' | ')}`);
    await page.close();
  }
  await ctx.close();
}
assert.deepEqual(problems, [], `Problèmes détectés :\n${problems.join('\n')}`);
ok(`${PAGES.length} pages × 2 formats : aucune erreur JS/HTTP, aucun débordement horizontal`);

// ---- contenu dynamique ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route(/epok\.network/, (r) => r.abort());
  await page.goto(`${base}/conditions`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('[data-trails-ski] .trail').count(), 13);
  assert.equal(await page.locator('[data-trails-raq] .trail').count(), 5);
  assert.equal(await page.locator('[data-trails-ski] .badge.closed').count(), 3);
  assert.match(await page.locator('.stats4').innerText(), /75/);
  ok('page conditions : 13 pistes + 5 raquettes, 3 pistes ski fermées, neige 75 cm');
  await page.goto(`${base}/foyer`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('table.tarif').count(), 3);
  assert.match(await page.locator('#location').innerText(), /Skating/);
  ok('page foyer : 3 tableaux de tarifs rendus');
  await page.goto(`${base}/soirees`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.event--soiree').count(), 6);
  ok('page soirées : 6 concerts');
  // menu mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.click('[data-menu-btn]');
  assert.ok(await page.locator('#nav.open').isVisible());
  await page.click('#nav a[data-nav="refuge"]');
  await page.waitForURL(/\/refuge/);
  ok('menu mobile : ouverture + navigation');
  await page.close();
}

// ---- espace équipe : dameur ----
async function loginAs(who, viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage({ viewport });
  await page.route(/epok\.network/, (r) => r.abort());
  await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await page.fill('input[name=email]', `${who}@barioz.local`);
  await page.fill('input[name=password]', 'barioz-demo-2026');
  await page.click('button[type=submit]');
  await page.waitForSelector('.tabs');
  return page;
}
{
  const page = await loginAs('dameur');
  await page.screenshot({ path: path.join(shots, 'mobile-admin-dameur.png'), fullPage: true });
  const tabs = await page.locator('.tabs button').allInnerTexts();
  assert.deepEqual(tabs, ['Aujourd’hui']);
  ok('dameur : voit seulement l’onglet « Aujourd’hui »');
  assert.ok(await page.locator('select[name=avalancheRisk]').isDisabled());
  assert.ok(!(await page.locator('input[name=airTemp]').isDisabled()));
  ok('dameur : risque d’avalanche verrouillé, mesures modifiables');
  await page.fill('input[name=snowFoyer]', '82');
  await page.click('button:has-text("Enregistrer les conditions")');
  await page.waitForSelector('.toast');
  const pub = await (await fetch(`${base}/api/public`)).json();
  assert.equal(pub.conditions.snowFoyer, 82);
  ok('dameur : la neige saisie sur téléphone apparaît dans l’API publique');
  await page.click('button:has-text("J’ai damé")');
  await page.waitForSelector('.toast:has-text("Damage enregistré")');
  ok('dameur : bouton « J’ai damé » fonctionne');
  const pub2 = await (await fetch(`${base}/api/public`)).json();
  const first = pub2.trails.find((t) => t.id === 's1');
  assert.ok(Date.now() - new Date(first.groomedAt).getTime() < 60000);
  ok('damage horodaté à l’instant');
  await page.close();
}
// ---- admin ----
{
  const page = await loginAs('admin', { width: 1280, height: 900 });
  const tabs = await page.locator('.tabs button').allInnerTexts();
  assert.deepEqual(tabs, ['Aujourd’hui', 'Événements', 'Tarifs', 'Infos du site', 'Équipe & droits', 'Journal']);
  await page.click('button:has-text("Équipe & droits")');
  await page.waitForSelector('text=Table des autorisations');
  await page.screenshot({ path: path.join(shots, 'desktop-admin-equipe.png'), fullPage: true });
  assert.ok((await page.locator('table.adm-t input[type=checkbox]').count()) > 40);
  ok('admin : onglet Équipe & droits avec la table des autorisations');
  await page.click('button:has-text("Journal")');
  await page.waitForSelector('text=Dernières modifications');
  assert.ok((await page.locator('table.adm-t tbody tr').count()) >= 2);
  ok('admin : journal des modifications');
  await page.click('button:has-text("Tarifs")');
  await page.waitForSelector('text=Enregistrer les tarifs');
  ok('admin : éditeur de tarifs');
  await page.close();
}
// ---- mauvais mot de passe ----
{
  const page = await browser.newPage();
  await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await page.fill('input[name=email]', 'admin@barioz.local');
  await page.fill('input[name=password]', 'mauvais');
  await page.click('button[type=submit]');
  await page.waitForSelector('.notice.alert:not([hidden])');
  ok('connexion : message d’erreur sur mauvais mot de passe');
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${checks} vérifications navigateur réussies. Captures : ${shots}`);
process.exit(0);
