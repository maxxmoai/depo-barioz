// Toute l'API, indépendante de l'hébergeur : handle(req) -> { status, json, headers }
import * as db from './store.js';
import { storageMode } from './store.js';
import {
  PERMISSIONS, ROLES, MATRIX_ROLES, DEFAULT_MATRIX, DEVICE_ALLOWED, LOCKED_ADMIN, can, permsOf, isReadOnly,
} from './perms.js';
import { getEstimate } from './weather.js';
import {
  hashPassword, verifyPassword, createSession, readSession, parseCookies, sessionCookie,
  COOKIE_NAME, sha256, newId, newDeviceToken,
} from './auth.js';
import {
  SNOW_STATES, seedConditions, seedTrails, seedEvents, seedSettings, seedTarifs,
} from './seed.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const forbidden = () => new HttpError(403, "Vous n'avez pas l'autorisation de faire cette modification.");

const SEEDS = {
  conditions: seedConditions, trails: seedTrails, events: seedEvents, settings: seedSettings,
  tarifs: seedTarifs, users: () => [], tokens: () => [], audit: () => [],
  perms: () => structuredClone(DEFAULT_MATRIX),
};

// Ces blocs reçoivent les nouveaux champs par défaut sans toucher aux valeurs déjà enregistrées.
const MERGE_DEFAULTS = new Set(['settings', 'conditions']);

async function load(key) {
  let v = await db.get(key);
  if (v === undefined) {
    v = SEEDS[key]();
    await db.set(key, v);
  } else if (MERGE_DEFAULTS.has(key)) {
    v = { ...SEEDS[key](), ...v };
    // ancienne adresse de la webcam (jamais modifiée à la main) -> nouvelle adresse
    if (key === 'settings' && v.webcamUrl === 'https://cretdupoulet.epok.network/camera/cret_du_poulet.jpg') v.webcamUrl = SEEDS.settings().webcamUrl;
  }
  return v;
}

// ---------- validation ----------
const num = (v, name, min, max) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} : valeur invalide`);
  return n;
};
const str = (v, name, max = 200) => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw bad(`${name} : texte attendu`);
  const s = v.trim();
  if (s.length > max) throw bad(`${name} : trop long`);
  return s;
};
const url = (v, name) => {
  const s = str(v, name, 500);
  if (s && !/^https?:\/\//i.test(s)) throw bad(`${name} : l'adresse doit commencer par http(s)://`);
  return s;
};
const isoDate = (v, name) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} : date invalide`);
  return v;
};

// ---------- identité ----------
async function principalOf(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer bzd_')) {
    const hash = sha256(auth.slice(7).trim());
    const tokens = await load('tokens');
    const t = tokens.find((x) => x.hash === hash && !x.revoked);
    if (!t) throw new HttpError(401, 'Jeton invalide');
    t.lastUsedAt = new Date().toISOString();
    await db.set('tokens', tokens);
    return { kind: 'device', id: t.id, name: t.name, perms: t.perms };
  }
  const cookies = parseCookies(req.headers.cookie);
  const s = readSession(cookies[COOKIE_NAME]);
  if (!s) return null;
  const users = await load('users');
  const u = users.find((x) => x.id === s.uid && x.active);
  return u ? { kind: 'user', id: u.id, name: u.name, email: u.email, role: u.role } : null;
}

const need = (p, perm, matrix) => {
  if (!p) throw new HttpError(401, 'Connexion requise');
  if (!can(p, perm, matrix)) throw forbidden();
};
// Lecture d'un écran de l'espace équipe : droit concerné OU compte visiteur (lecture seule).
const needView = (p, perm, matrix) => {
  if (!p) throw new HttpError(401, 'Connexion requise');
  if (isReadOnly(p)) return;
  need(p, perm, matrix);
};
const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1•••$2');

async function audit(p, action, detail) {
  const log = await load('audit');
  log.unshift({
    at: new Date().toISOString(),
    by: p.kind === 'device' ? `accès auto : ${p.name}` : p.name,
    role: p.kind === 'device' ? 'device' : p.role,
    action,
    detail: detail || '',
  });
  await db.set('audit', log.slice(0, 500));
}

// ---------- limitation des tentatives de connexion (best effort) ----------
const attempts = new Map();
function throttle(key) {
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  if (a.length >= 8) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  a.push(now);
  attempts.set(key, a);
}

// ---------- vues ----------
function publicSettings(s) {
  return s;
}

function userView(u, mask = false) {
  return { id: u.id, name: u.name, email: mask ? maskEmail(u.email) : u.email, role: u.role, active: u.active, lastLogin: u.lastLogin || null };
}

// ---- valeurs affichées au public : saisie de l'équipe si elle est récente, sinon estimation météo ----
const MANUAL_VALID_MS = 30 * 3600e3;
function effectiveConditions(c, est, now = Date.now()) {
  const out = { ...c };
  const sources = {};
  const estimates = {};
  const pick = (key, estimate) => {
    if (estimate != null) estimates[key] = estimate;
    const at = c.at?.[key] || c.updatedAt;
    const hasManual = c[key] != null;
    const fresh = hasManual && at && now - Date.parse(at) < MANUAL_VALID_MS;
    if (fresh) { sources[key] = 'manual'; return; }
    if (estimate != null) { out[key] = estimate; sources[key] = 'meteo'; return; }
    sources[key] = hasManual ? 'old' : null;
  };
  pick('snowFoyer', est?.foyer?.snow);
  pick('snowRefuge', est?.refuge?.snow);
  pick('airTemp', est?.foyer?.temp);
  pick('humidity', est?.foyer?.humidity);
  delete out.at;
  return { ...out, sources, estimates, estimateAt: est?.at || null };
}

async function sessionInfo(p) {
  const matrix = await load('perms');
  if (!p) return { user: null };
  return {
    user: p.kind === 'user' ? { id: p.id, name: p.name, email: isReadOnly(p) ? maskEmail(p.email) : p.email, role: p.role, roleLabel: ROLES[p.role]?.label } : null,
    perms: isReadOnly(p) ? Object.keys(PERMISSIONS) : permsOf(p, matrix), // le visiteur VOIT tout (l'interface est en lecture seule, le serveur refuse toute écriture)
    readOnly: isReadOnly(p),
  };
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern}$`), fn });

route('GET', '/health', async () => ({
  json: { ok: true, storage: storageMode(), persistent: storageMode() !== 'memory', time: new Date().toISOString() },
}));

route('GET', '/public', async (req) => {
  const [conditions, trails, events, tarifs, settings] = await Promise.all([
    load('conditions'), load('trails'), load('events'), load('tarifs'), load('settings'),
  ]);
  const est = await getEstimate(settings);
  // ?fresh=1 : utilisé par l'espace équipe pour contourner le cache et voir immédiatement ses modifications
  const cache = req.query?.fresh ? 'no-store' : 'public, max-age=0, s-maxage=10, stale-while-revalidate=30';
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .filter((e) => e.published && (e.dateEnd || e.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    headers: { 'Cache-Control': cache },
    json: {
      conditions: effectiveConditions(conditions, est), trails, events: upcoming, tarifs,
      settings: publicSettings(settings), snowStates: SNOW_STATES, serverTime: new Date().toISOString(),
    },
  };
});

route('POST', '/login', async (req) => {
  throttle(req.ip || 'x');
  const email = str(req.body?.email, 'email', 200).toLowerCase();
  const password = str(req.body?.password, 'mot de passe', 200);
  const users = await load('users');
  const u = users.find((x) => x.email === email && x.active);
  // calcul fictif si l'utilisateur n'existe pas, pour ne pas révéler les comptes
  const ok = verifyPassword(password, u ? u.hash : 'scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
  if (!u || !ok) throw new HttpError(401, 'Identifiants incorrects');
  u.lastLogin = new Date().toISOString();
  await db.set('users', users);
  const p = { kind: 'user', id: u.id, name: u.name, email: u.email, role: u.role };
  return { headers: { 'Set-Cookie': sessionCookie(createSession(u.id)) }, json: await sessionInfo(p) };
});

route('POST', '/logout', async () => ({ headers: { 'Set-Cookie': sessionCookie('', { clear: true }) }, json: { ok: true } }));

route('GET', '/me', async (req) => ({ json: await sessionInfo(await principalOf(req)) }));

route('POST', '/setup', async (req) => {
  // Création du premier administrateur : seulement si aucun compte n'existe, et avec SETUP_TOKEN.
  const users = await load('users');
  if (users.length) throw new HttpError(409, 'Déjà initialisé');
  const expected = process.env.SETUP_TOKEN;
  if (!expected || req.body?.setupToken !== expected) throw new HttpError(403, "Jeton d'installation invalide");
  const email = str(req.body?.email, 'email', 200).toLowerCase();
  const name = str(req.body?.name, 'nom', 100);
  const password = str(req.body?.password, 'mot de passe', 200);
  if (!email.includes('@') || !name) throw bad('Nom et email requis');
  if (password.length < 10) throw bad('Mot de passe : 10 caractères minimum');
  users.push({ id: newId(), name, email, role: 'admin', active: true, hash: hashPassword(password), createdAt: new Date().toISOString() });
  await db.set('users', users);
  return { status: 201, json: { ok: true } };
});

// ---- conditions ----
route('PUT', '/conditions', async (req) => {
  const p = await principalOf(req);
  const matrix = await load('perms');
  const b = req.body || {};
  const c = await load('conditions');
  c.at = { ...(c.at || {}) };
  const nowIso = new Date().toISOString();
  const stamp = (key) => { if (c[key] == null) delete c.at[key]; else c.at[key] = nowIso; };
  const changed = [];
  const guard = (keys, perm, apply) => {
    if (!keys.some((k) => k in b)) return;
    need(p, perm, matrix);
    apply();
    changed.push(...keys.filter((k) => k in b));
  };
  guard(['season'], 'conditions.season', () => {
    if (!['open', 'partial', 'closed'].includes(b.season)) throw bad('Saison : valeur invalide');
    c.season = b.season;
  });
  guard(['snowFoyer'], 'conditions.snowFoyer', () => { c.snowFoyer = num(b.snowFoyer, 'Neige foyer', 0, 1000); stamp('snowFoyer'); });
  guard(['snowRefuge'], 'conditions.snowRefuge', () => { c.snowRefuge = num(b.snowRefuge, 'Neige refuge', 0, 1500); stamp('snowRefuge'); });
  guard(['airTemp', 'snowTemp', 'humidity', 'snowStates'], 'conditions.measures', () => {
    if ('airTemp' in b) { c.airTemp = num(b.airTemp, 'Température air', -50, 40); stamp('airTemp'); }
    if ('snowTemp' in b) c.snowTemp = num(b.snowTemp, 'Température neige', -50, 10);
    if ('humidity' in b) { c.humidity = num(b.humidity, 'Humidité', 0, 100); stamp('humidity'); }
    if ('snowStates' in b) {
      if (!Array.isArray(b.snowStates) || b.snowStates.some((s) => !(s in SNOW_STATES))) throw bad('État de la neige invalide');
      c.snowStates = b.snowStates;
    }
  });
  guard(['avalancheRisk'], 'conditions.avalanche', () => { c.avalancheRisk = num(b.avalancheRisk, 'Risque avalanche', 1, 5); });
  guard(['message', 'messageLevel'], 'conditions.message', () => {
    if ('message' in b) c.message = str(b.message, 'Message', 400);
    if ('messageLevel' in b) {
      if (!['info', 'alert'].includes(b.messageLevel)) throw bad('Niveau invalide');
      c.messageLevel = b.messageLevel;
    }
  });
  if (!changed.length) throw bad('Rien à modifier');
  // anciennes valeurs sans horodatage propre : on fige leur date avant de faire avancer updatedAt
  for (const k of ['snowFoyer', 'snowRefuge', 'airTemp', 'humidity']) if (c[k] != null && !c.at[k] && c.updatedAt) c.at[k] = c.updatedAt;
  c.updatedAt = new Date().toISOString();
  await db.set('conditions', c);
  await audit(p, 'Conditions', changed.join(', '));
  return { json: c };
});

// ---- pistes ----
route('PATCH', '/trails/([\\w-]+)', async (req, m) => {
  const p = await principalOf(req);
  const matrix = await load('perms');
  need(p, 'trails.status', matrix);
  const trails = await load('trails');
  const t = trails.find((x) => x.id === m[1]);
  if (!t) throw new HttpError(404, 'Piste inconnue');
  if ('status' in req.body) {
    if (!['open', 'closed'].includes(req.body.status)) throw bad('Statut invalide');
    t.status = req.body.status;
  }
  if ('note' in req.body) t.note = str(req.body.note, 'Note', 160);
  await db.set('trails', trails);
  await audit(p, 'Piste', `${t.name} : ${t.status}${t.note ? ` (${t.note})` : ''}`);
  return { json: t };
});

async function markGroomed(p, req) {
  const matrix = await load('perms');
  need(p, 'trails.groomed', matrix);
  const trails = await load('trails');
  const b = req.body || {};
  let ids;
  if (b.all === true) ids = trails.filter((t) => t.kind === 'ski' && t.status === 'open').map((t) => t.id);
  else if (Array.isArray(b.ids) && b.ids.length) ids = b.ids.map(String);
  else throw bad('Indiquez "all": true ou une liste "ids"');
  let at = new Date();
  if (b.at) {
    at = new Date(b.at);
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 5 * 60e3 || Date.now() - at.getTime() > 3 * 864e5) {
      throw bad('Date de damage invalide');
    }
  }
  const hit = [];
  for (const t of trails) {
    if (ids.includes(t.id) && t.kind === 'ski') { t.groomedAt = at.toISOString(); hit.push(t.name); }
  }
  if (!hit.length) throw bad('Aucune piste de ski correspondante');
  await db.set('trails', trails);
  const c = await load('conditions');
  if (!c.lastGroomedAt || at.toISOString() > c.lastGroomedAt) c.lastGroomedAt = at.toISOString();
  c.updatedAt = new Date().toISOString();
  await db.set('conditions', c);
  await audit(p, 'Damage', hit.join(', '));
  return { json: { ok: true, groomed: hit.length, at: at.toISOString() } };
}
route('POST', '/trails/groomed', async (req) => markGroomed(await principalOf(req), req));
route('POST', '/ingest/grooming', async (req) => {
  const p = await principalOf(req);
  if (!p || p.kind !== 'device') throw new HttpError(401, "Jeton d'accès automatique requis");
  return markGroomed(p, req);
});
route('POST', '/ingest/conditions', async (req) => {
  const p = await principalOf(req);
  if (!p || p.kind !== 'device') throw new HttpError(401, "Jeton d'accès automatique requis");
  req.method = 'PUT';
  return routes.find((r) => r.method === 'PUT' && r.re.test('/conditions')).fn(req, []);
});

// ---- événements ----
function cleanEvent(b, id) {
  const kind = ['sport', 'soiree', 'stage', 'autre'].includes(b.kind) ? b.kind : 'autre';
  const e = {
    id, kind,
    date: isoDate(b.date, 'Date'),
    title: str(b.title, 'Titre', 140),
    subtitle: str(b.subtitle, 'Sous-titre', 200),
    description: str(b.description, 'Description', 1500),
    price: str(b.price, 'Tarif', 60),
    link: url(b.link, 'Lien'),
    published: b.published !== false,
  };
  if (b.dateEnd) e.dateEnd = isoDate(b.dateEnd, 'Date de fin');
  if (!e.title) throw bad('Titre requis');
  return e;
}
route('GET', '/events', async (req) => {
  const p = await principalOf(req);
  needView(p, 'events.edit', await load('perms'));
  return { json: (await load('events')).sort((a, b) => a.date.localeCompare(b.date)) };
});
route('POST', '/events', async (req) => {
  const p = await principalOf(req);
  need(p, 'events.edit', await load('perms'));
  const events = await load('events');
  const e = cleanEvent(req.body || {}, newId(6));
  events.push(e);
  await db.set('events', events);
  await audit(p, 'Événement créé', e.title);
  return { status: 201, json: e };
});
route('PUT', '/events/([\\w-]+)', async (req, m) => {
  const p = await principalOf(req);
  need(p, 'events.edit', await load('perms'));
  const events = await load('events');
  const i = events.findIndex((x) => x.id === m[1]);
  if (i < 0) throw new HttpError(404, 'Événement inconnu');
  events[i] = cleanEvent(req.body || {}, m[1]);
  await db.set('events', events);
  await audit(p, 'Événement modifié', events[i].title);
  return { json: events[i] };
});
route('DELETE', '/events/([\\w-]+)', async (req, m) => {
  const p = await principalOf(req);
  need(p, 'events.edit', await load('perms'));
  const events = await load('events');
  const e = events.find((x) => x.id === m[1]);
  if (!e) throw new HttpError(404, 'Événement inconnu');
  await db.set('events', events.filter((x) => x.id !== m[1]));
  await audit(p, 'Événement supprimé', e.title);
  return { json: { ok: true } };
});

// ---- tarifs & réglages ----
route('PUT', '/tarifs', async (req) => {
  const p = await principalOf(req);
  need(p, 'tarifs.edit', await load('perms'));
  const tables = req.body?.tables;
  if (!Array.isArray(tables) || tables.length > 20) throw bad('Tableaux invalides');
  const clean = tables.map((t, i) => {
    const columns = (t.columns || []).map((c) => str(c, 'Colonne', 80));
    if (!columns.length || columns.length > 10) throw bad('Colonnes invalides');
    const rows = (t.rows || []).slice(0, 60).map((r) => columns.map((_, j) => str((r || [])[j], 'Cellule', 160)));
    return {
      id: str(t.id, 'id', 30) || `t${i}`,
      title: str(t.title, 'Titre', 100), intro: str(t.intro, 'Intro', 300),
      columns, rows, note: str(t.note, 'Note', 500),
    };
  });
  await db.set('tarifs', { tables: clean });
  await audit(p, 'Tarifs modifiés', `${clean.length} tableaux`);
  return { json: { tables: clean } };
});

const SETTINGS_FIELDS = {
  phone: 60, address: 200, hours: 120, refugeHours: 120, paymentNote: 160,
  reservationUrl: 'url', webcamUrl: 'url', forfaitsUrl: 'url', nationalPassUrl: 'url', meteoUrl: 'url',
  meteoLocalUrl: 'url', sevenLauxUrl: 'url', planPistesPdf: 'url', planRaquettePdf: 'url', youtubeId: 20,
  webcamPageUrl: 'url', planPistesImage: 'url', lat: 'lat', lng: 'lng', latRefuge: 'lat', lngRefuge: 'lng', latCret: 'lat', lngCret: 'lng',
};
route('GET', '/settings', async (req) => {
  const p = await principalOf(req);
  needView(p, 'settings.edit', await load('perms'));
  return { json: await load('settings') };
});
route('PUT', '/settings', async (req) => {
  const p = await principalOf(req);
  need(p, 'settings.edit', await load('perms'));
  const s = await load('settings');
  for (const [k, rule] of Object.entries(SETTINGS_FIELDS)) {
    if (!(k in (req.body || {}))) continue;
    if (rule === 'url') s[k] = url(req.body[k], k);
    else if (rule === 'lat') s[k] = String(num(req.body[k], 'Latitude', -90, 90) ?? '');
    else if (rule === 'lng') s[k] = String(num(req.body[k], 'Longitude', -180, 180) ?? '');
    else s[k] = str(req.body[k], k, rule);
  }
  await db.set('settings', s);
  await audit(p, 'Réglages modifiés', '');
  return { json: s };
});

// ---- comptes & autorisations ----
route('GET', '/users', async (req) => {
  const p = await principalOf(req);
  needView(p, 'users.manage', await load('perms'));
  return { json: { users: (await load('users')).map((u) => userView(u, isReadOnly(p))), roles: ROLES } };
});
route('POST', '/users', async (req) => {
  const p = await principalOf(req);
  need(p, 'users.manage', await load('perms'));
  const b = req.body || {};
  const email = str(b.email, 'email', 200).toLowerCase();
  const name = str(b.name, 'nom', 100);
  const password = str(b.password, 'mot de passe', 200);
  if (!email.includes('@') || !name) throw bad('Nom et email requis');
  if (password.length < 10) throw bad('Mot de passe : 10 caractères minimum');
  if (!(b.role in ROLES)) throw bad('Rôle invalide');
  const users = await load('users');
  if (users.some((u) => u.email === email)) throw new HttpError(409, 'Cet email existe déjà');
  const u = { id: newId(), name, email, role: b.role, active: true, hash: hashPassword(password), createdAt: new Date().toISOString() };
  users.push(u);
  await db.set('users', users);
  await audit(p, 'Compte créé', `${name} (${b.role})`);
  return { status: 201, json: userView(u) };
});
route('PUT', '/users/([\\w-]+)', async (req, m) => {
  const p = await principalOf(req);
  need(p, 'users.manage', await load('perms'));
  const users = await load('users');
  const u = users.find((x) => x.id === m[1]);
  if (!u) throw new HttpError(404, 'Compte inconnu');
  const b = req.body || {};
  const admins = users.filter((x) => x.role === 'admin' && x.active);
  const demoting = (b.role && b.role !== 'admin' && u.role === 'admin') || (b.active === false && u.role === 'admin');
  if (demoting && admins.length <= 1) throw bad('Il doit rester au moins un administrateur actif');
  if ('role' in b) { if (!(b.role in ROLES)) throw bad('Rôle invalide'); u.role = b.role; }
  if ('name' in b) u.name = str(b.name, 'nom', 100) || u.name;
  if ('active' in b) u.active = !!b.active;
  if (b.password) {
    const pw = str(b.password, 'mot de passe', 200);
    if (pw.length < 10) throw bad('Mot de passe : 10 caractères minimum');
    u.hash = hashPassword(pw);
  }
  await db.set('users', users);
  await audit(p, 'Compte modifié', `${u.name} (${u.role}${u.active ? '' : ', désactivé'})`);
  return { json: userView(u) };
});

route('GET', '/perms', async (req) => {
  const p = await principalOf(req);
  const matrix = await load('perms');
  needView(p, 'users.manage', matrix);
  return { json: { matrix, permissions: PERMISSIONS, roles: ROLES, locked: LOCKED_ADMIN } };
});
route('PUT', '/perms', async (req) => {
  const p = await principalOf(req);
  need(p, 'users.manage', await load('perms'));
  const m = req.body?.matrix;
  if (!m || typeof m !== 'object') throw bad('Matrice invalide');
  const next = {};
  for (const role of MATRIX_ROLES) {
    const list = Array.isArray(m[role]) ? m[role] : [];
    if (list.some((x) => !(x in PERMISSIONS))) throw bad('Autorisation inconnue');
    next[role] = [...new Set(list)];
  }
  next.admin = Object.keys(PERMISSIONS); // l'administrateur garde tout
  await db.set('perms', next);
  await audit(p, 'Autorisations modifiées', '');
  return { json: { matrix: next } };
});

// ---- accès automatiques ----
route('GET', '/tokens', async (req) => {
  const p = await principalOf(req);
  needView(p, 'tokens.manage', await load('perms'));
  const tokens = (await load('tokens')).map(({ hash, ...t }) => t);
  return { json: { tokens, allowed: DEVICE_ALLOWED.map((k) => ({ key: k, label: PERMISSIONS[k].label })) } };
});
route('POST', '/tokens', async (req) => {
  const p = await principalOf(req);
  need(p, 'tokens.manage', await load('perms'));
  const name = str(req.body?.name, 'nom', 80);
  const perms = Array.isArray(req.body?.perms) ? req.body.perms : [];
  if (!name) throw bad('Nom requis');
  if (!perms.length || perms.some((x) => !DEVICE_ALLOWED.includes(x))) throw bad('Autorisations invalides pour un accès automatique');
  const token = newDeviceToken();
  const tokens = await load('tokens');
  const t = { id: newId(6), name, hash: sha256(token), perms, createdAt: new Date().toISOString(), createdBy: p.name, revoked: false };
  tokens.push(t);
  await db.set('tokens', tokens);
  await audit(p, 'Accès automatique créé', name);
  return { status: 201, json: { id: t.id, name, perms, token } }; // le jeton n'est montré qu'une fois
});
route('DELETE', '/tokens/([\\w-]+)', async (req, m) => {
  const p = await principalOf(req);
  need(p, 'tokens.manage', await load('perms'));
  const tokens = await load('tokens');
  const t = tokens.find((x) => x.id === m[1]);
  if (!t) throw new HttpError(404, 'Accès inconnu');
  t.revoked = true;
  await db.set('tokens', tokens);
  await audit(p, 'Accès automatique révoqué', t.name);
  return { json: { ok: true } };
});

route('GET', '/audit', async (req) => {
  const p = await principalOf(req);
  needView(p, 'audit.read', await load('perms'));
  return { json: (await load('audit')).slice(0, 200) };
});

// ---------- point d'entrée ----------
export async function handle(req) {
  req.query = req.query || {};
  const path = ('/' + String(req.path || '').replace(/^\/+|\/+$/g, '')).replace(/^\/api/, '') || '/';
  try {
    const writes = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (writes) {
      const ct = String(req.headers['content-type'] || '');
      const hasBearer = String(req.headers.authorization || '').startsWith('Bearer ');
      // JSON obligatoire : un formulaire d'un autre site ne peut pas en envoyer (anti-CSRF)
      if (!ct.includes('application/json') && !hasBearer && path !== '/logout') throw bad('Content-Type application/json requis');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const out = await r.fn(req, m);
      return { status: out.status || 200, json: out.json, headers: { 'Cache-Control': 'no-store', ...(out.headers || {}) } };
    }
    return { status: 404, json: { error: 'Route inconnue' }, headers: {} };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, json: { error: e.message }, headers: { 'Cache-Control': 'no-store' } };
    console.error(e);
    return { status: 500, json: { error: 'Erreur serveur' }, headers: {} };
  }
}

// Comptes de démonstration (local uniquement, jamais en production)
export async function seedDemoUsers() {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') return;
  const users = await load('users');
  if (users.length) return;
  const pw = hashPassword('barioz-demo-2026');
  const mk = (name, email, role) => ({ id: newId(), name, email, role, active: true, hash: pw, createdAt: new Date().toISOString() });
  await db.set('users', [
    mk('Admin démo', 'admin@barioz.local', 'admin'),
    mk('Équipe foyer démo', 'foyer@barioz.local', 'foyer'),
    mk('Dameur démo', 'dameur@barioz.local', 'dameur'),
    mk('Bénévole démo', 'benevole@barioz.local', 'benevole'),
    mk('Visiteur démo', 'visiteur@barioz.local', 'visiteur'),
  ]);
}
