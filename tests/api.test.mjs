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

// setup
r = await call('POST', '/api/setup', { body: { setupToken: 'test-setup', email: 'a@b.fr', name: 'x', password: '1234567890' } });
assert.equal(r.status, 409);
ok('/setup désactivé une fois des comptes créés');

console.log(`\n${n} groupes de vérifications réussis`);
