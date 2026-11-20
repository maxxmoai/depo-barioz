// Espace équipe : application d'une seule page, sans dépendance.
// Les droits affichés viennent de /api/me ; le serveur revérifie TOUT (l'interface n'est qu'un confort).
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

async function api(method, path, body) {
  const r = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `Erreur ${r.status}`); e.status = r.status; throw e; }
  return j;
}

let toastTimer;
function toast(msg, err = false) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: `toast${err ? ' err' : ''}`, role: 'status', text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}
const guard = (fn) => async (...a) => {
  try { return await fn(...a); } catch (e) {
    if (e.status === 401) { me = null; await boot(); return; }
    toast(e.message, true);
  }
};

const TZ = 'Europe/Paris';
const dt = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');

let me = null;
let pub = null;
let tab = 'today';
const can = (p) => me?.perms?.includes(p);
const readOnly = () => !!me?.readOnly;

// File d'attente : les écritures partent une par une, dans l'ordre (pas de mises à jour perdues).
let queue = Promise.resolve();
const enqueue = (fn) => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };
const loadPub = async () => (await fetch(`/api/public?fresh=1&t=${Date.now()}`, { cache: 'no-store' })).json();
const SRC_LABEL = { meteo: 'estimation météo', old: 'ancienne saisie' };

// ---------------- connexion ----------------
function loginView() {
  const err = h('p', { class: 'notice alert', hidden: true, role: 'alert' });
  const form = h('form', { class: 'card login stack', onsubmit: guard(async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      await api('POST', '/login', { email: form.email.value, password: form.password.value });
      await boot();
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  }) },
  h('h1', { text: 'Espace équipe', style: 'font-size:1.8rem' }),
  h('p', { class: 'muted', text: 'Réservé à l’équipe du foyer, aux dameurs et aux bénévoles.' }),
  err,
  h('label', { class: 'f' }, 'E-mail', h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true })),
  h('label', { class: 'f' }, 'Mot de passe', h('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true })),
  h('button', { class: 'btn big', type: 'submit', text: 'Se connecter' }),
  h('a', { href: '/', text: '← Retour au site', style: 'text-align:center' }));
  app.replaceChildren(form);
  form.email.focus();
}

// ---------------- onglet Aujourd'hui ----------------
function todayView() {
  const c = pub.conditions;
  const wrap = h('div', { class: 'stack' });
  const stateOf = (k) => (can(k) ? {} : { disabled: true });
  const lock = (k) => (can(k) ? '' : 'locked');

  const repaints = [];
  const syncTop = () => repaints.forEach((fn) => fn());
  if (can('trails.groomed')) {
    const lastP = h('p', { class: 'hint' });
    const allBtn = h('button', { class: 'btn btn--ember big', type: 'button',
      onclick: guard(async () => {
        const ids = pub.trails.filter((t) => t.kind === 'ski' && t.status === 'open').map((t) => t.id);
        if (!ids.length) return;
        allBtn.disabled = true;
        try {
          await enqueue(() => api('POST', '/trails/groomed', { all: true }));
          const now = new Date().toISOString();
          pub.trails.forEach((t) => { if (ids.includes(t.id)) t.groomedAt = now; });
          c.lastGroomedAt = now;
          syncTop(); toast('Damage enregistré');
        } finally { syncTop(); }
      }) });
    repaints.push(() => {
      const openSki = pub.trails.filter((t) => t.kind === 'ski' && t.status === 'open').length;
      lastP.textContent = c.lastGroomedAt ? `Dernier damage enregistré : ${dt(c.lastGroomedAt)}` : 'Aucun damage enregistré.';
      allBtn.disabled = openSki === 0;
      allBtn.textContent = openSki ? `J’ai damé les ${openSki} pistes ouvertes` : 'Ouvrez d’abord des pistes (ci-dessous)';
    });
    wrap.append(h('div', { class: 'card' }, h('h2', { text: 'Damage' }), lastP, allBtn,
      h('p', { class: 'hint', text: 'Pour une seule piste, utilisez le bouton « Damée » dans la liste plus bas.' })));
    syncTop();
  }

  // champ de mesure : valeur manuelle récente préremplie, sinon vide + estimation météo en indication
  const mField = (key, label, attrs, perm) => {
    const src = c.sources?.[key];
    const est = c.estimates?.[key];
    const input = h('input', { name: key, type: 'number', inputmode: 'decimal', ...attrs,
      value: src === 'manual' ? c[key] : (src === 'old' ? c[key] : ''), placeholder: est != null ? `estimation météo : ${est}` : '',
      oninput: (e) => { e.target.dataset.touched = '1'; }, ...stateOf(perm) });
    const note = src === 'manual' ? null : src === 'meteo' ? `Affiché sur le site : ${c[key]} (estimation météo)` : src === 'old' ? 'Ancienne saisie (plus de 30 h)' : null;
    return h('label', { class: 'f' }, label, input, note ? h('span', { class: 'mini', text: note }) : null);
  };

  // conditions
  const snowStates = Object.entries(pub.snowStates);
  const f = h('form', { class: 'card stack', onsubmit: guard(async (e) => {
    e.preventDefault();
    const body = {};
    // Seuls les champs touchés sont envoyés : une valeur ancienne non modifiée ne reçoit pas une date « fraîche ».
    const dirty = (el) => el.dataset.touched === '1';
    if (can('conditions.season')) body.season = f.season.value;
    if (can('conditions.snowFoyer') && dirty(f.snowFoyer)) body.snowFoyer = f.snowFoyer.value;
    if (can('conditions.snowRefuge') && dirty(f.snowRefuge)) body.snowRefuge = f.snowRefuge.value;
    if (can('conditions.measures')) {
      if (dirty(f.airTemp)) body.airTemp = f.airTemp.value;
      body.snowTemp = f.snowTemp.value;
      if (dirty(f.humidity)) body.humidity = f.humidity.value;
      body.snowStates = [...f.querySelectorAll('input[name=ss]:checked')].map((x) => x.value);
    }
    if (can('conditions.avalanche')) body.avalancheRisk = f.avalancheRisk.value;
    if (can('conditions.message')) { body.message = f.message.value; body.messageLevel = f.messageLevel.value; }
    await enqueue(() => api('PUT', '/conditions', body));
    pub = await loadPub();
    await render();
    toast('Conditions enregistrées');
  }) },
  h('h2', { text: 'Conditions du matin' }),
  h('div', { class: `grid2 ${lock('conditions.season')}` },
    h('label', { class: 'f' }, 'Saison', h('select', { name: 'season', ...stateOf('conditions.season') },
      ...[['closed', 'Non ouverte'], ['partial', 'Ouverture partielle'], ['open', 'Ouverte']].map(([v, l]) => h('option', { value: v, text: l, selected: c.season === v }))))),
  h('div', { class: 'grid2' },
    h('div', { class: lock('conditions.snowFoyer') }, mField('snowFoyer', 'Neige au foyer (cm)', { min: 0 }, 'conditions.snowFoyer')),
    h('div', { class: lock('conditions.snowRefuge') }, mField('snowRefuge', 'Neige au refuge (cm)', { min: 0 }, 'conditions.snowRefuge'))),
  h('p', { class: 'hint auto-hint', text: 'Champ vide = le site affiche automatiquement une estimation météo. Une valeur saisie reste affichée 30 h, puis l’estimation reprend si elle n’est pas mise à jour.' }),
  h('div', { class: `grid2 ${lock('conditions.measures')}` },
    mField('airTemp', 'Température de l’air (°C)', { step: '0.5' }, 'conditions.measures'),
    h('label', { class: 'f' }, 'Température de la neige (°C)', h('input', { name: 'snowTemp', type: 'number', inputmode: 'decimal', step: '0.5', value: c.snowTemp ?? '', ...stateOf('conditions.measures') })),
    mField('humidity', 'Humidité (%)', { min: 0, max: 100 }, 'conditions.measures')),
  h('div', { class: lock('conditions.measures') }, h('p', { class: 'mini', style: 'margin:0 0 8px;font-weight:600', text: 'État de la neige' }),
    h('div', { class: 'chips-sel' }, ...snowStates.map(([k, l]) => h('label', {}, h('input', { type: 'checkbox', name: 'ss', value: k, checked: c.snowStates?.includes(k), ...stateOf('conditions.measures') }), l)))),
  h('div', { class: `grid2 ${lock('conditions.avalanche')}` },
    h('label', { class: 'f' }, 'Risque d’avalanche', h('select', { name: 'avalancheRisk', ...stateOf('conditions.avalanche') },
      h('option', { value: '', text: 'Non communiqué' }), ...[1, 2, 3, 4, 5].map((n) => h('option', { value: n, text: `${n} / 5`, selected: c.avalancheRisk === n }))))),
  h('div', { class: lock('conditions.message') },
    h('label', { class: 'f' }, 'Message affiché sur le site', h('textarea', { name: 'message', maxlength: 400, ...stateOf('conditions.message') }, c.message || '')),
    h('label', { class: 'f', style: 'margin-top:10px;max-width:240px' }, 'Type de message', h('select', { name: 'messageLevel', ...stateOf('conditions.message') },
      h('option', { value: 'info', text: 'Information', selected: c.messageLevel !== 'alert' }), h('option', { value: 'alert', text: 'Alerte (rouge)', selected: c.messageLevel === 'alert' })))),
  h('button', { class: 'btn big', type: 'submit', text: 'Enregistrer les conditions' }));
  wrap.append(f);

  // pistes : l'écran change immédiatement, l'envoi se fait en arrière-plan (retour arrière + message si échec)
  const trailRow = (t) => {
    const sub = h('span', { class: 'sub' });
    const sw = h('button', { type: 'button', disabled: !can('trails.status') });
    const gr = t.kind === 'ski' && can('trails.groomed') ? h('button', { type: 'button', class: 'btn sm', text: 'Damée' }) : null;
    let busy = false;
    const paint = () => {
      const open = t.status === 'open';
      sw.className = `switch ${open ? 'on' : 'off'}${busy ? ' pending' : ''}`;
      sw.textContent = open ? 'Ouverte' : 'Fermée';
      sw.setAttribute('aria-label', `${t.name} : ${open ? 'ouverte' : 'fermée'}, cliquer pour changer`);
      sub.textContent = t.kind === 'ski' && t.groomedAt ? `damée ${dt(t.groomedAt)}` : '';
      if (gr) gr.disabled = !open || busy;
    };
    sw.onclick = () => {
      if (busy) return; // un seul changement à la fois par piste : pas d'aller-retour involontaire
      const prev = t.status; const next = prev === 'open' ? 'closed' : 'open';
      t.status = next; busy = true; paint(); syncTop();
      enqueue(() => api('PATCH', `/trails/${t.id}`, { status: next }))
        .catch(guard(async (e) => { t.status = prev; throw e; }))
        .finally(() => { busy = false; paint(); syncTop(); });
    };
    if (gr) gr.onclick = () => {
      if (busy) return;
      const prev = t.groomedAt; t.groomedAt = new Date().toISOString(); busy = true; paint();
      enqueue(() => api('POST', '/trails/groomed', { ids: [t.id] }))
        .then(() => toast(`${t.name} : damage enregistré`))
        .catch(guard(async (e) => { t.groomedAt = prev; throw e; }))
        .finally(() => { busy = false; paint(); });
    };
    paint();
    repaints.push(paint);
    return h('div', { class: 'trail-row' },
      h('div', { class: 'name' }, `${t.num}. ${t.name}`, sub),
      h('div', { class: 'acts' }, sw, gr),
      can('trails.status') ? h('input', { class: 'note', type: 'text', maxlength: 160, placeholder: 'Remarque (ex. passage délicat, verglas…)', value: t.note || '',
        onchange: guard(async (e) => { await enqueue(() => api('PATCH', `/trails/${t.id}`, { note: e.target.value })); t.note = e.target.value; toast('Remarque enregistrée'); }) }) : null);
  };
  const rows = (kind) => pub.trails.filter((t) => t.kind === kind).map(trailRow);
  wrap.append(h('div', { class: 'card' }, h('h2', { text: 'Pistes de ski' }), ...rows('ski')),
    h('div', { class: 'card' }, h('h2', { text: 'Itinéraires raquette' }), ...rows('raquette')));
  return wrap;
}

// ---------------- événements ----------------
async function eventsView() {
  const events = await api('GET', '/events');
  const wrap = h('div', { class: 'stack' });
  const form = h('form', { class: 'card stack', onsubmit: guard(async (e) => {
    e.preventDefault();
    const body = { title: form.title.value, date: form.date.value, dateEnd: form.dateEnd.value || undefined, kind: form.kind.value,
      subtitle: form.subtitle.value, description: form.description.value, price: form.price.value, link: form.link.value, published: form.published.checked };
    if (form.dataset.id) await api('PUT', `/events/${form.dataset.id}`, body); else await api('POST', '/events', body);
    await refresh(); toast('Événement enregistré');
  }) },
  h('h2', { text: 'Ajouter / modifier un événement' }),
  h('div', { class: 'grid2' },
    h('label', { class: 'f' }, 'Titre', h('input', { name: 'title', type: 'text', required: true, maxlength: 140 })),
    h('label', { class: 'f' }, 'Type', h('select', { name: 'kind' }, ...[['sport', 'Sport'], ['soiree', 'Soirée musique'], ['stage', 'Stage'], ['autre', 'Autre']].map(([v, l]) => h('option', { value: v, text: l })))),
    h('label', { class: 'f' }, 'Date', h('input', { name: 'date', type: 'date', required: true })),
    h('label', { class: 'f' }, 'Date de fin (optionnel)', h('input', { name: 'dateEnd', type: 'date' }))),
  h('label', { class: 'f' }, 'Sous-titre (lieu, style de musique…)', h('input', { name: 'subtitle', type: 'text', maxlength: 200 })),
  h('label', { class: 'f' }, 'Description (optionnel)', h('textarea', { name: 'description', maxlength: 1500 })),
  h('div', { class: 'grid2' },
    h('label', { class: 'f' }, 'Tarif (optionnel)', h('input', { name: 'price', type: 'text', maxlength: 60 })),
    h('label', { class: 'f' }, 'Lien « en savoir plus » (optionnel)', h('input', { name: 'link', type: 'url', placeholder: 'https://' }))),
  h('label', { class: 'chips-sel' }, h('label', {}, h('input', { type: 'checkbox', name: 'published', checked: true }), 'Visible sur le site')),
  h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit', text: 'Enregistrer' }),
    h('button', { class: 'btn btn--ghost', type: 'button', text: 'Nouveau', onclick: () => { form.reset(); delete form.dataset.id; form.published.checked = true; } })));
  const fill = (e) => {
    form.dataset.id = e.id;
    form.title.value = e.title; form.kind.value = e.kind; form.date.value = e.date; form.dateEnd.value = e.dateEnd || '';
    form.subtitle.value = e.subtitle || ''; form.description.value = e.description || ''; form.price.value = e.price || ''; form.link.value = e.link || '';
    form.published.checked = e.published; form.scrollIntoView({ behavior: 'smooth' });
  };
  wrap.append(form, h('div', { class: 'card' }, h('h2', { text: 'Programme' }),
    ...events.map((e) => h('div', { class: 'ev-item' },
      h('div', { class: 'd', text: e.date.split('-').reverse().join('/') }),
      h('div', { class: 't' }, e.title, h('small', { text: e.subtitle || '' })),
      h('span', { class: `tag${e.published ? '' : ' off'}`, text: e.published ? e.kind : 'masqué' }),
      h('button', { class: 'btn btn--ghost sm', type: 'button', text: 'Modifier', onclick: () => fill(e) }),
      h('button', { class: 'btn danger sm', type: 'button', text: 'Suppr.', onclick: guard(async () => { if (confirm(`Supprimer « ${e.title} » ?`)) { await api('DELETE', `/events/${e.id}`); await refresh(); toast('Supprimé'); } }) })))));
  return wrap;
}

// ---------------- tarifs ----------------
function tarifsView() {
  const data = structuredClone(pub.tarifs);
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    wrap.replaceChildren(...data.tables.map((t) => h('div', { class: 'card' },
      h('h2', { text: t.title }),
      h('div', { class: 'grid2' },
        h('label', { class: 'f' }, 'Titre', h('input', { type: 'text', value: t.title, oninput: (e) => { t.title = e.target.value; } })),
        h('label', { class: 'f' }, 'Phrase d’introduction', h('input', { type: 'text', value: t.intro, oninput: (e) => { t.intro = e.target.value; } }))),
      h('div', { class: 'table-scroll' }, h('table', { class: 'adm-t' },
        h('thead', {}, h('tr', {}, ...t.columns.map((col, i) => h('th', {}, h('input', { type: 'text', value: col, 'aria-label': `En-tête colonne ${i + 1}`, oninput: (e) => { t.columns[i] = e.target.value; } })) ), h('th'))),
        h('tbody', {}, ...t.rows.map((r, ri) => h('tr', {}, ...t.columns.map((_, ci) => h('td', {}, h('input', { type: 'text', value: r[ci] ?? '', 'aria-label': `Ligne ${ri + 1}, colonne ${ci + 1}`, oninput: (e) => { r[ci] = e.target.value; } }))),
          h('td', {}, h('button', { class: 'btn danger sm', type: 'button', text: '✕', 'aria-label': 'Supprimer la ligne', onclick: () => { t.rows.splice(ri, 1); draw(); } }))))))),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn btn--ghost sm', type: 'button', text: '+ Ajouter une ligne', onclick: () => { t.rows.push(t.columns.map(() => '')); draw(); } })),
      h('label', { class: 'f', style: 'margin-top:12px' }, 'Note sous le tableau', h('textarea', { oninput: (e) => { t.note = e.target.value; } }, t.note || '')),
      h('p', { class: 'hint', text: 'Saisissez les montants sans le symbole €, il est ajouté automatiquement (ex. 62 / 80).' }))),
    h('button', { class: 'btn big', type: 'button', text: 'Enregistrer les tarifs', onclick: guard(async () => { await api('PUT', '/tarifs', data); await refresh(); toast('Tarifs enregistrés'); }) }));
  };
  draw();
  return wrap;
}

// ---------------- réglages ----------------
async function settingsView() {
  const s = await api('GET', '/settings');
  const fields = [
    ['phone', 'Téléphone du foyer'], ['address', 'Adresse / courrier'], ['hours', 'Horaires du foyer'], ['refugeHours', 'Ouverture du refuge'],
    ['paymentNote', 'Moyens de paiement'], ['reservationUrl', 'Lien de réservation du refuge'], ['webcamUrl', 'Image de la webcam'],
    ['forfaitsUrl', 'Lien prévente forfaits'], ['nationalPassUrl', 'Lien pass national'], ['meteoUrl', 'Lien météo'], ['meteoLocalUrl', 'Lien météo locale'],
    ['sevenLauxUrl', 'Lien CO 7 Laux'], ['planPistesPdf', 'PDF plan des pistes'], ['planRaquettePdf', 'PDF parcours raquette'], ['youtubeId', 'Identifiant vidéo YouTube (soirées)'],
    ['webcamPageUrl', 'Page de la webcam (lien « plein écran »)'], ['planPistesImage', 'Image du plan des pistes (aperçu sur /pistes)'],
    ['lat', 'Latitude (carte + météo de secours)'], ['lng', 'Longitude (carte + météo de secours)'],
  ];
  const f = h('form', { class: 'card stack', onsubmit: guard(async (e) => {
    e.preventDefault();
    await api('PUT', '/settings', Object.fromEntries(fields.map(([k]) => [k, f[k].value])));
    await refresh(); toast('Réglages enregistrés');
  }) }, h('h2', { text: 'Informations du site' }),
  h('div', { class: 'grid2' }, ...fields.map(([k, l]) => h('label', { class: 'f' }, l, h('input', { name: k, type: 'text', value: s[k] || '' })))),
  h('button', { class: 'btn big', type: 'submit', text: 'Enregistrer' }));
  return f;
}

// ---------------- équipe & droits ----------------
async function teamView() {
  const [{ users, roles }, perms, tk] = await Promise.all([api('GET', '/users'), api('GET', '/perms'), can('tokens.manage') ? api('GET', '/tokens') : null]);
  const wrap = h('div', { class: 'stack' });

  // comptes
  const addForm = h('form', { class: 'row', style: 'align-items:end;margin-top:14px', onsubmit: guard(async (e) => {
    e.preventDefault();
    await api('POST', '/users', { name: addForm.name.value, email: addForm.email.value, role: addForm.role.value, password: addForm.password.value });
    toast('Compte créé'); await render();
  }) },
  h('label', { class: 'f' }, 'Nom', h('input', { name: 'name', type: 'text', required: true })),
  h('label', { class: 'f' }, 'E-mail', h('input', { name: 'email', type: 'email', required: true })),
  h('label', { class: 'f' }, 'Rôle', h('select', { name: 'role' }, ...Object.entries(roles).map(([k, r]) => h('option', { value: k, text: r.label, selected: k === 'foyer' })))),
  h('label', { class: 'f' }, 'Mot de passe (10 car. min.)', h('input', { name: 'password', type: 'password', minlength: 10, required: true, autocomplete: 'new-password' })),
  h('button', { class: 'btn', type: 'submit', text: 'Créer le compte' }));
  wrap.append(h('div', { class: 'card' }, h('h2', { text: 'Comptes' }),
    h('div', { class: 'table-scroll' }, h('table', { class: 'adm-t' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Nom' }), h('th', { text: 'E-mail' }), h('th', { text: 'Rôle' }), h('th', { class: 'c', text: 'Actif' }), h('th', { text: 'Dernière connexion' }), h('th'))),
      h('tbody', {}, ...users.map((u) => h('tr', {},
        h('td', { text: u.name }), h('td', { text: u.email }),
        h('td', {}, h('select', { 'aria-label': `Rôle de ${u.name}`, onchange: guard(async (e) => { await api('PUT', `/users/${u.id}`, { role: e.target.value }); toast('Rôle modifié'); await render(); }) },
          ...Object.entries(roles).map(([k, r]) => h('option', { value: k, text: r.label, selected: u.role === k })))),
        h('td', { class: 'c' }, h('input', { type: 'checkbox', checked: u.active, 'aria-label': `${u.name} actif`, onchange: guard(async (e) => { await api('PUT', `/users/${u.id}`, { active: e.target.checked }); toast(e.target.checked ? 'Compte activé' : 'Compte désactivé'); await render(); }) })),
        h('td', { class: 'mini', text: dt(u.lastLogin) }),
        h('td', {}, h('button', { class: 'btn btn--ghost sm', type: 'button', text: 'Nouveau mot de passe', onclick: guard(async () => {
          const pw = prompt(`Nouveau mot de passe pour ${u.name} (10 caractères minimum) :`);
          if (pw) { await api('PUT', `/users/${u.id}`, { password: pw }); toast('Mot de passe modifié'); }
        }) }))))))),
    addForm));

  // matrice
  const matrix = structuredClone(perms.matrix);
  const roleKeys = Object.keys(roles).filter((r) => !roles[r].readOnly);
  const groups = [...new Set(Object.values(perms.permissions).map((p) => p.group))];
  const body = [];
  for (const g of groups) {
    body.push(h('tr', { class: 'grp' }, h('td', { colspan: roleKeys.length + 1, text: g })));
    for (const [key, p] of Object.entries(perms.permissions).filter(([, p2]) => p2.group === g)) {
      body.push(h('tr', {}, h('td', { text: p.label }), ...roleKeys.map((r) => h('td', { class: 'c' },
        h('input', { type: 'checkbox', checked: r === 'admin' ? true : matrix[r].includes(key), disabled: r === 'admin', 'aria-label': `${roles[r].label} : ${p.label}`,
          onchange: (e) => { matrix[r] = e.target.checked ? [...new Set([...matrix[r], key])] : matrix[r].filter((x) => x !== key); } })))));
    }
  }
  wrap.append(h('div', { class: 'card' }, h('h2', { text: 'Table des autorisations' }),
    h('p', { class: 'hint', style: 'margin:0 0 10px', text: 'Cochez ce que chaque rôle a le droit de modifier. L’administrateur a toujours tous les droits. Les changements sont immédiats après enregistrement.' }),
    h('div', { class: 'table-scroll' }, h('table', { class: 'adm-t' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Autorisation' }), ...roleKeys.map((r) => h('th', { class: 'c', text: roles[r].label })))), h('tbody', {}, ...body))),
    h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'btn', type: 'button', text: 'Enregistrer les autorisations', onclick: guard(async () => { await api('PUT', '/perms', { matrix }); toast('Autorisations enregistrées'); }) }))));

  // accès automatiques
  if (tk) {
    const result = h('div');
    const tf = h('form', { class: 'stack', style: 'margin-top:14px', onsubmit: guard(async (e) => {
      e.preventDefault();
      const out = await api('POST', '/tokens', { name: tf.name.value, perms: [...tf.querySelectorAll('input[name=p]:checked')].map((x) => x.value) });
      result.replaceChildren(h('div', { class: 'callout warn' }, h('p', { text: 'Copiez ce jeton maintenant : il ne sera plus jamais affiché.' }),
        h('div', { class: 'secret', text: out.token }),
        h('p', { class: 'mini', style: 'margin-top:10px', text: `Adresse à appeler : ${location.origin}/api/ingest/grooming (méthode POST, en-tête Authorization: Bearer <jeton>, en-tête Content-Type: application/json, contenu {"all":true} pour « toutes les pistes ouvertes » ou {"ids":["s1","s2"]}). Mesures : /api/ingest/conditions. Sur iPhone : app Raccourcis > « Obtenir le contenu de l’URL » ; sur Android : app HTTP Shortcuts ; sur NAS : un simple curl.` })));
      tf.reset();
    }) },
    h('label', { class: 'f' }, 'Nom de l’accès (ex. « Téléphone du dameur »)', h('input', { name: 'name', type: 'text', required: true })),
    h('div', { class: 'chips-sel' }, ...tk.allowed.map((a) => h('label', {}, h('input', { type: 'checkbox', name: 'p', value: a.key, checked: a.key === 'trails.groomed' }), a.label))),
    h('button', { class: 'btn', type: 'submit', text: 'Créer un accès automatique' }));
    wrap.append(h('div', { class: 'card' }, h('h2', { text: 'Accès automatiques' }),
      h('div', { class: 'callout' },
        h('p', { style: 'margin:0 0 6px;font-weight:600', text: 'À quoi ça sert ?' }),
        h('p', { class: 'mini', style: 'margin:0 0 6px', text: 'Normalement, pour enregistrer un damage il faut se connecter et appuyer sur un bouton. Un « accès automatique » est une clé secrète qui permet à un appareil d’envoyer l’information tout seul, sans compte ni mot de passe : un raccourci sur le téléphone du dameur (un seul appui, ou déclenché à la fin de la tournée), un petit script sur un NAS ou un Raspberry, un capteur de neige.' }),
        h('ol', { class: 'mini', style: 'margin:0 0 6px;padding-left:18px' },
          h('li', { text: 'Vous créez l’accès ci-dessous et cochez ce qu’il a le droit de faire (par défaut : enregistrer un damage).' }),
          h('li', { text: 'Le jeton (« bzd_… ») s’affiche une seule fois : copiez-le dans le raccourci ou le script.' }),
          h('li', { text: 'L’appareil envoie une requête sécurisée à l’adresse du site avec ce jeton ; le site enregistre le damage ou les mesures et l’affiche tout de suite.' })),
        h('p', { class: 'mini', style: 'margin:0', text: 'Un jeton ne donne jamais plus que ce que vous avez coché (jamais les tarifs, les comptes, etc.), chaque usage est daté dans la liste, et vous pouvez le révoquer à tout moment. Il ne remplace pas la saisie manuelle : c’est un confort en plus. Les hauteurs de neige oubliées, elles, sont déjà complétées par la météo sans aucun jeton.' })),

      tk.tokens.length ? h('div', { class: 'table-scroll', style: 'margin-top:12px' }, h('table', { class: 'adm-t' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Nom' }), h('th', { text: 'Droits' }), h('th', { text: 'Dernier usage' }), h('th'))),
        h('tbody', {}, ...tk.tokens.map((t) => h('tr', {}, h('td', { text: t.name }), h('td', { class: 'mini', text: t.perms.join(', ') }), h('td', { class: 'mini', text: t.revoked ? 'révoqué' : dt(t.lastUsedAt) }),
          h('td', {}, t.revoked ? null : h('button', { class: 'btn danger sm', type: 'button', text: 'Révoquer', onclick: guard(async () => { if (confirm(`Révoquer « ${t.name} » ?`)) { await api('DELETE', `/tokens/${t.id}`); await render(); } }) }))))))) : null,
      tf, result));
  }
  return wrap;
}

async function auditView() {
  const log = await api('GET', '/audit');
  return h('div', { class: 'card' }, h('h2', { text: 'Dernières modifications' }), h('div', { class: 'table-scroll' }, h('table', { class: 'adm-t' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Quand' }), h('th', { text: 'Qui' }), h('th', { text: 'Action' }), h('th', { text: 'Détail' }))),
    h('tbody', {}, ...log.map((l) => h('tr', {}, h('td', { class: 'mini', text: dt(l.at) }), h('td', { text: l.by }), h('td', { text: l.action }), h('td', { class: 'mini', text: l.detail })))))));
}

// ---------------- structure ----------------
const TABS = [
  { id: 'today', label: 'Aujourd’hui', show: () => ['conditions.season', 'conditions.snowFoyer', 'conditions.snowRefuge', 'conditions.measures', 'conditions.avalanche', 'conditions.message', 'trails.status', 'trails.groomed'].some(can), view: todayView },
  { id: 'events', label: 'Événements', show: () => can('events.edit'), view: eventsView },
  { id: 'tarifs', label: 'Tarifs', show: () => can('tarifs.edit'), view: tarifsView },
  { id: 'settings', label: 'Infos du site', show: () => can('settings.edit'), view: settingsView },
  { id: 'team', label: 'Équipe & droits', show: () => can('users.manage'), view: teamView },
  { id: 'audit', label: 'Journal', show: () => can('audit.read'), view: auditView },
];

// Compte visiteur : tout est visible, rien n'est cliquable (le serveur refuse de toute façon toute écriture).
function lockAll(root) {
  root.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = true; });
  root.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault(), true));
}

async function render() {
  const tabs = TABS.filter((t) => t.show());
  if (!tabs.find((t) => t.id === tab)) tab = tabs[0]?.id;
  const bar = h('div', { class: 'tabs', role: 'tablist' }, ...tabs.map((t) => h('button', { role: 'tab', 'aria-selected': String(t.id === tab), text: t.label, onclick: () => { tab = t.id; render(); } })));
  const content = h('div', { id: 'tab-content' });
  app.replaceChildren(
    h('div', { class: 'adm-top' },
      h('a', { class: 'brand', href: '/' }, h('span', { class: 'brand__text' }, h('strong', { text: 'Espace Nordique du Barioz' }), h('span', { text: 'Espace équipe' }))),
      h('div', { class: 'adm-top__who' }, h('b', { text: me.user?.name }), `${me.user?.roleLabel} · `, h('a', { href: '#', text: 'Se déconnecter', onclick: guard(async (e) => { e.preventDefault(); await api('POST', '/logout'); me = null; await boot(); }) }))),
    readOnly() ? h('p', { class: 'notice demo', role: 'status', text: 'Mode démonstration : vous voyez l’espace équipe comme un administrateur, mais rien ne peut être modifié.' }) : null,
    tabs.length ? bar : h('p', { class: 'notice', text: 'Votre rôle n’a encore aucune autorisation. Demandez à un administrateur.' }), content);
  const t = tabs.find((x) => x.id === tab);
  if (t) { try { content.replaceChildren(await t.view()); } catch (e) { content.replaceChildren(h('p', { class: 'notice alert', text: e.message })); } }
  if (readOnly()) lockAll(content);
}

async function refresh() {
  pub = await loadPub();
  await render();
}

async function boot() {
  me = await api('GET', '/me');
  if (!me.user) { loginView(); return; }
  pub = await loadPub();
  await render();
}
boot();
