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
process.env.WEATHER_DISABLED = '1'; // pas d'appel réseau : valeurs déterministes
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

// Services extérieurs simulés : la webcam est coupée par défaut, la carte et le plan sont servis localement.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function stub(page, { cam = false } = {}) {
  await page.route(/epok\.network/, (r) => (cam ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG }) : r.abort()));
  await page.route(/openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>carte</p>' }));
  await page.route(/usercontent\.one/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
}

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
    await stub(page);
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
  await stub(page);
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
  await stub(page);
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

// ---- webcam, plan et carte intégrés ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await stub(page, { cam: true });
  await page.goto(`${base}/conditions`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.webcam__frame img');
  assert.ok(await page.locator('.webcam__frame').isVisible());
  assert.ok(await page.locator('.webcam__bar a[href*="epok.network"]').isVisible());
  await page.screenshot({ path: path.join(shots, 'desktop-conditions-webcam.png'), fullPage: true });
  assert.ok(!(await page.locator('.webcam__miss').isVisible()), 'pas de message d’erreur quand la webcam répond');
  await page.click('.webcam__frame');
  assert.ok(await page.locator('dialog.lightbox[open]').isVisible());
  await page.keyboard.press('Escape');
  ok('conditions : webcam intégrée (aperçu, lien conservé, agrandissement)');
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('.webcam__frame img');
  assert.ok(await page.locator('.webcam__live').isVisible());
  ok('accueil : webcam « en direct » visible');
  const cam2 = await browser.newPage();
  await stub(cam2); // webcam coupée
  await cam2.goto(`${base}/conditions`, { waitUntil: 'networkidle' });
  assert.ok(await cam2.locator('.webcam__miss').isVisible());
  assert.match(await cam2.locator('.webcam__miss').innerText(), /indisponible/);
  await cam2.close();
  ok('webcam coupée : message clair au lieu d’un bloc vide');
  await page.goto(`${base}/pistes`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.plan__zoom img');
  assert.ok(await page.locator('a:has-text("Plan des pistes à télécharger")').isVisible());
  await page.click('.plan__zoom');
  assert.ok(await page.locator('dialog.lightbox[open] img').isVisible());
  await page.keyboard.press('Escape');
  ok('pistes : image du plan intégrée + bouton PDF conservé');
  await page.goto(`${base}/acces`, { waitUntil: 'networkidle' });
  const src = await page.locator('.map iframe').getAttribute('src');
  assert.match(src, /openstreetmap\.org\/export\/embed\.html\?bbox=.*marker=45\.33/);
  await page.click('.map__tabs button:has-text("Refuge")');
  assert.match(await page.locator('.map iframe').getAttribute('src'), /marker=45\.326060%2C6\.046790/);
  await page.click('.map__tabs button:has-text("Crêt du Poulet")');
  assert.match(await page.locator('.map iframe').getAttribute('src'), /marker=45\.328480%2C6\.060130/);
  await page.screenshot({ path: path.join(shots, 'desktop-acces-carte.png'), fullPage: true });
  ok('accès : carte OpenStreetMap intégrée avec repère');
  await page.close();
}

// ---- boutons réactifs (réseau lent simulé) ----
{
  const page = await loginAs('dameur');
  await page.route('**/api/trails/**', async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
  const row = page.locator('.trail-row', { hasText: 'Les Môilles' });
  const sw = row.locator('.switch');
  const before = (await sw.innerText()).trim();
  const t0 = Date.now();
  await sw.click();
  const after = (await sw.innerText()).trim();
  assert.notEqual(before, after);
  assert.ok(Date.now() - t0 < 600, 'le bouton doit changer immédiatement');
  await sw.click(); // second appui pendant l’envoi : ignoré, pas d’aller-retour
  assert.equal((await sw.innerText()).trim(), after);
  await page.waitForFunction(() => !document.querySelector('.switch.pending'), null, { timeout: 8000 });
  assert.equal((await sw.innerText()).trim(), after);
  const t = (await (await fetch(`${base}/api/public?fresh=1`)).json()).trails.find((x) => x.name === 'Les Môilles');
  assert.equal(t.status === 'open' ? 'Ouverte' : 'Fermée', after);
  ok('ouvrir/fermer : changement instantané, double appui ignoré, état serveur identique');
  // « Damée » instantané
  await page.unroute('**/api/trails/**');
  const open = page.locator('.trail-row').filter({ has: page.locator('.switch.on') }).first();
  await open.locator('button:has-text("Damée")').click();
  assert.match(await open.locator('.sub').innerText(), /damée/);
  ok('bouton « Damée » : mention immédiate');
  await page.close();
}

// ---- visiteur (démo, lecture seule) ----
{
  const page = await loginAs('visiteur', { width: 1280, height: 900 });
  const tabs = await page.locator('.tabs button').allInnerTexts();
  assert.deepEqual(tabs, ['Aujourd’hui', 'Événements', 'Tarifs', 'Infos du site', 'Équipe & droits', 'Journal']);
  assert.ok(await page.locator('.notice.demo').isVisible());
  assert.ok(await page.locator('input[name=snowFoyer]').isDisabled());
  assert.ok(await page.locator('.trail-row .switch').first().isDisabled());
  await page.screenshot({ path: path.join(shots, 'desktop-admin-visiteur.png'), fullPage: true });
  await page.click('button:has-text("Équipe & droits")');
  await page.waitForSelector('text=Table des autorisations');
  assert.equal(await page.locator('table.adm-t input[type=checkbox]:not(:disabled)').count(), 0);
  assert.ok(await page.locator('text=À quoi ça sert').isVisible());
  await page.screenshot({ path: path.join(shots, 'desktop-admin-visiteur-equipe.png'), fullPage: true });
  await page.click('button:has-text("Journal")');
  await page.waitForSelector('text=Dernières modifications');
  ok('visiteur : voit les 6 onglets, tout est verrouillé, bandeau « démonstration »');
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${checks} vérifications navigateur réussies. Captures : ${shots}`);
process.exit(0);
