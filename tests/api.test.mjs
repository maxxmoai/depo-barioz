// Tests de l'API et de la table des autorisations (sans dépendance : node tests/api.test.mjs)
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.DATA_FILE = path.join(mkdtempSync(path.join(os.tmpdir(), 'barioz-')), 'db.json');
process.env.SETUP_TOKEN = 'test-setup';
delete process.env.VERCEL;
const { handle, seedDemoUsers } = await import('../lib/api.js');
await seedDemoUsers();

let n = 0;
const ok = (name) => console.log(`  ok ${++n} ${name}`);
const call = (method, p, { body, cookie, bearer } = {}) =>
  handle({
    method, path: p, ip: '127.0.0.1', body,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
  });
const login = async (who) => {
  const r = await call('POST', '/api/login', { body: { email: `${who}@barioz.local`, password: 'barioz-demo-2026' } });
  assert.equal(r.status, 200, `login ${who}`);
  return r.headers['Set-Cookie'].split(';')[0];
};

// public
let r = await call('GET', '/api/public');
assert.equal(r.status, 200);
assert.equal(r.json.trails.filter((t) => t.kind === 'ski').length, 13);
assert.equal(r.json.trails.filter((t) => t.kind === 'raquette').length, 5);
assert.ok(r.json.tarifs.tables.length >= 4);
ok('GET /public : 13 pistes, 5 raquettes, tarifs');

// non connecté
r = await call('PUT', '/api/conditions', { body: { snowFoyer: 50 } });
assert.equal(r.status, 401);
ok('modification sans connexion refusée (401)');

r = await call('POST', '/api/login', { body: { email: 'admin@barioz.local', password: 'faux' } });
assert.equal(r.status, 401);
ok('mauvais mot de passe refusé');

const admin = await login('admin');
const foyer = await login('foyer');
const dameur = await login('dameur');
const benevole = await login('benevole');

// matrice de droits par défaut
r = await call('PUT', '/api/conditions', { cookie: benevole, body: { snowRefuge: 130 } });
assert.equal(r.status, 200); assert.equal(r.json.snowRefuge, 130);
r = await call('PUT', '/api/conditions', { cookie: benevole, body: { snowFoyer: 75 } });
assert.equal(r.status, 403);
ok('bénévole : neige refuge oui, neige foyer non');

r = await call('PUT', '/api/conditions', { cookie: dameur, body: { snowFoyer: 75, airTemp: -4, snowStates: ['fraiche'] } });
assert.equal(r.status, 200); assert.equal(r.json.airTemp, -4);
r = await call('PUT', '/api/conditions', { cookie: dameur, body: { avalancheRisk: 2 } });
assert.equal(r.status, 403);
r = await call('PUT', '/api/conditions', { cookie: foyer, body: { avalancheRisk: 2, season: 'open' } });
assert.equal(r.status, 200); assert.equal(r.json.avalancheRisk, 2); assert.equal(r.json.season, 'open');
ok('dameur : mesures oui, avalanche non ; foyer : avalanche + saison oui');

r = await call('PUT', '/api/conditions', { cookie: foyer, body: { snowFoyer: 'abc' } });
assert.equal(r.status, 400);
r = await call('PUT', '/api/conditions', { cookie: foyer, body: { snowStates: ['nimportequoi'] } });
assert.equal(r.status, 400);
ok('valeurs invalides refusées (400)');

// pistes + damage
r = await call('PATCH', '/api/trails/s1', { cookie: dameur, body: { status: 'open' } });
assert.equal(r.status, 200);
await call('PATCH', '/api/trails/s2', { cookie: dameur, body: { status: 'open' } });
r = await call('POST', '/api/trails/groomed', { cookie: dameur, body: { all: true } });
assert.equal(r.status, 200); assert.equal(r.json.groomed, 2);
r = await call('POST', '/api/trails/groomed', { cookie: benevole, body: { all: true } });
assert.equal(r.status, 403);
ok('dameur : ouvre des pistes et déclare un damage ; bénévole non');

// accès automatique (appli / capteur)
r = await call('POST', '/api/tokens', { cookie: admin, body: { name: 'Téléphone dameur', perms: ['trails.groomed'] } });
assert.equal(r.status, 201); const token = r.json.token;
assert.match(token, /^bzd_/);
r = await call('POST', '/api/tokens', { cookie: admin, body: { name: 'x', perms: ['users.manage'] } });
assert.equal(r.status, 400);
ok('jeton automatique : droits limités à la liste autorisée');
r = await call('POST', '/api/ingest/grooming', { bearer: token, body: { ids: ['s1'] } });
assert.equal(r.status, 200);
r = await call('POST', '/api/ingest/conditions', { bearer: token, body: { snowFoyer: 99 } });
assert.equal(r.status, 403);
r = await call('POST', '/api/ingest/grooming', { bearer: 'bzd_faux', body: { all: true } });
assert.equal(r.status, 401);
ok('ingest damage OK, ingest conditions refusé (pas dans le périmètre), faux jeton 401');
const list = await call('GET', '/api/tokens', { cookie: admin });
assert.ok(!JSON.stringify(list.json).includes(token) && !JSON.stringify(list.json).includes('"hash"'));
ok('le jeton n’est jamais relisible');
const id = list.json.tokens[0].id;
await call('DELETE', `/api/tokens/${id}`, { cookie: admin });
r = await call('POST', '/api/ingest/grooming', { bearer: token, body: { all: true } });
assert.equal(r.status, 401);
ok('jeton révoqué refusé');

// gestion comptes / droits
r = await call('GET', '/api/users', { cookie: foyer });
assert.equal(r.status, 403);
r = await call('GET', '/api/users', { cookie: admin });
assert.equal(r.status, 200);
ok('gestion des comptes : admin seulement');

let perms = (await call('GET', '/api/perms', { cookie: admin })).json.matrix;
perms.dameur = perms.dameur.filter((p) => p !== 'trails.status');
r = await call('PUT', '/api/perms', { cookie: admin, body: { matrix: perms } });
assert.equal(r.status, 200);
r = await call('PATCH', '/api/trails/s3', { cookie: dameur, body: { status: 'open' } });
assert.equal(r.status, 403);
ok('l’admin retire un droit au dameur : effet immédiat');

// dernier admin protégé
const users = (await call('GET', '/api/users', { cookie: admin })).json.users;
const adm = users.find((u) => u.role === 'admin');
r = await call('PUT', `/api/users/${adm.id}`, { cookie: admin, body: { role: 'foyer' } });
assert.equal(r.status, 400);
ok('impossible de retirer le dernier administrateur');

// événements
const ev = { title: 'Test', date: '2099-01-10', kind: 'sport' };
r = await call('POST', '/api/events', { cookie: dameur, body: ev });
assert.equal(r.status, 403);
r = await call('POST', '/api/events', { cookie: benevole, body: ev });
assert.equal(r.status, 201);
r = await call('POST', '/api/events', { cookie: benevole, body: { ...ev, date: '10/01/2099' } });
assert.equal(r.status, 400);
ok('événements : bénévole oui, dameur non, date invalide refusée');

// tarifs
r = await call('PUT', '/api/tarifs', { cookie: foyer, body: { tables: [] } });
assert.equal(r.status, 403);
ok('tarifs : réservés à l’admin par défaut');

// anti-CSRF
r = await handle({ method: 'PUT', path: '/api/conditions', ip: '1', body: { snowFoyer: 1 }, headers: { 'content-type': 'text/plain', cookie: admin } });
assert.equal(r.status, 400);
ok('écriture sans Content-Type JSON refusée');

// journal
r = await call('GET', '/api/audit', { cookie: admin });
assert.ok(r.json.length > 5);
r = await call('GET', '/api/audit', { cookie: foyer });
assert.equal(r.status, 403);
ok('journal des modifications : admin seulement');

// ---- météo de secours (Open-Meteo simulé) ----
{
  const store = await import('../lib/store.js');
  const realFetch = globalThis.fetch;
  const pad = (v) => String(v).padStart(2, '0');
  const parisHour = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
  };
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('open-meteo')) return realFetch(url);
    calls++;
    const refuge = new URL(url).searchParams.get('elevation') === '1700'; // le refuge reçoit sa propre estimation
    return { ok: true, json: async () => ({ hourly: { time: [parisHour()], snow_depth: [refuge ? 0.6 : 0.42], temperature_2m: [-3.46], relative_humidity_2m: [81.2] } }) };
  };
  await store.set('weather', null);
  // état « équipe n'a rien saisi » : valeurs vides
  r = await call('PUT', '/api/conditions', { cookie: admin, body: { snowFoyer: '', snowRefuge: '', airTemp: '', humidity: '' } });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/public');
  assert.equal(r.json.conditions.snowFoyer, 42);
  assert.equal(r.json.conditions.snowRefuge, 60);
  assert.equal(r.json.conditions.airTemp, -3.5);
  assert.equal(r.json.conditions.humidity, 81);
  assert.equal(r.json.conditions.sources.snowFoyer, 'meteo');
  assert.ok(!('at' in r.json.conditions));
  ok('neige/température oubliées : complétées par l’estimation météo, marquées « meteo »');
  // saisie récente : prioritaire
  r = await call('PUT', '/api/conditions', { cookie: admin, body: { snowFoyer: 90 } });
  r = await call('GET', '/api/public');
  assert.equal(r.json.conditions.snowFoyer, 90);
  assert.equal(r.json.conditions.sources.snowFoyer, 'manual');
  assert.equal(r.json.conditions.sources.snowRefuge, 'meteo');
  assert.equal(r.json.conditions.estimates.snowFoyer, 42);
  ok('saisie manuelle récente prioritaire, autres champs en estimation');
  // saisie périmée (> 30 h) : l’estimation reprend
  const c = await store.get('conditions');
  c.at.snowFoyer = new Date(Date.now() - 31 * 3600e3).toISOString();
  await store.set('conditions', c);
  r = await call('GET', '/api/public');
  assert.equal(r.json.conditions.snowFoyer, 42);
  assert.equal(r.json.conditions.sources.snowFoyer, 'meteo');
  ok('saisie de plus de 30 h : l’estimation météo reprend');
  assert.equal(calls, 2);
  ok('estimation mise en cache (un appel par point, foyer + refuge, puis plus rien)');
  // panne de la météo : pas d’erreur, valeurs vides
  globalThis.fetch = async (url) => { if (String(url).includes('open-meteo')) throw new Error('réseau'); return realFetch(url); };
  await store.set('weather', null);
  r = await call('GET', '/api/public');
  assert.equal(r.status, 200);
  assert.equal(r.json.conditions.sources.snowRefuge, null);
  ok('météo indisponible : le site fonctionne, valeurs « non renseigné »');
  globalThis.fetch = realFetch;
  // cache HTTP : l’admin peut forcer une lecture fraîche
  r = await call('GET', '/api/public');
  assert.match(r.headers['Cache-Control'], /s-maxage=10/);
  r = await handle({ method: 'GET', path: '/api/public', query: { fresh: '1' }, ip: '1', headers: {} });
  assert.equal(r.headers['Cache-Control'], 'no-store');
  ok('/public?fresh=1 : jamais mis en cache (boutons réactifs)');
}

// ---- compte visiteur (lecture seule) ----
{
  const visiteur = await login('visiteur');
  r = await call('GET', '/api/me', { cookie: visiteur });
  assert.equal(r.json.readOnly, true);
  assert.ok(r.json.perms.includes('users.manage'));
  assert.match(r.json.user.email, /•/);
  for (const p of ['/api/users', '/api/perms', '/api/tokens', '/api/audit', '/api/settings', '/api/events']) {
    r = await call('GET', p, { cookie: visiteur });
    assert.equal(r.status, 200, `visiteur GET ${p}`);
  }
  r = await call('GET', '/api/users', { cookie: visiteur });
  assert.ok(r.json.users.every((u) => u.email.includes('•')));
  ok('visiteur : voit tous les écrans (e-mails masqués)');
  const writes = [
    ['PUT', '/api/conditions', { snowFoyer: 1 }], ['PATCH', '/api/trails/s1', { status: 'open' }], ['POST', '/api/trails/groomed', { all: true }],
    ['PUT', '/api/tarifs', { tables: [] }], ['PUT', '/api/settings', { phone: '0' }], ['PUT', '/api/perms', { matrix: {} }],
    ['POST', '/api/users', { name: 'x', email: 'x@y.fr', role: 'admin', password: '1234567890' }], ['POST', '/api/tokens', { name: 'x', perms: ['trails.groomed'] }],
    ['POST', '/api/events', { title: 'x', date: '2099-01-01', kind: 'sport' }],
  ];
  for (const [m, p, body] of writes) {
    r = await call(m, p, { cookie: visiteur, body });
    assert.equal(r.status, 403, `visiteur ${m} ${p}`);
  }
  ok('visiteur : toutes les écritures refusées (403)');
  r = await call('GET', '/api/perms', { cookie: await login('admin') });
  assert.ok(!('visiteur' in r.json.matrix));
  ok('visiteur absent de la table des autorisations');
}

// setup
r = await call('POST', '/api/setup', { body: { setupToken: 'test-setup', email: 'a@b.fr', name: 'x', password: '1234567890' } });
assert.equal(r.status, 409);
ok('/setup désactivé une fois des comptes créés');

console.log(`\n${n} groupes de vérifications réussis`);
