// Site public : charge /api/public et remplit les blocs [data-*]. Aucun innerHTML avec des données.
const TZ = 'Europe/Paris';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

const fmtDay = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const fmtTime = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d).replace(':', 'h');
function when(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const dayDiff = Math.round((new Date(fmtDay(now).split('/').reverse().join('-')) - new Date(fmtDay(d).split('/').reverse().join('-'))) / 864e5);
  if (dayDiff === 0) return `aujourd’hui à ${fmtTime(d)}`;
  if (dayDiff === 1) return `hier à ${fmtTime(d)}`;
  return `${new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d)} à ${fmtTime(d)}`;
}
const n = (v, unit = '') => (v == null ? '—' : `${String(v).replace('.', ',')}${unit}`);

// ----- menu mobile -----
const btn = $('[data-menu-btn]');
const nav = $('[data-nav-root]');
if (btn && nav) {
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
  });
}

// ----- vidéo (chargée au clic, sans cookie tiers avant) -----
$$('[data-video]').forEach((box) => {
  const b = $('button', box);
  b?.addEventListener('click', () => {
    const id = box.dataset.video;
    const f = h('iframe', { src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&autoplay=1`, title: 'Vidéo de présentation des soirées', allow: 'autoplay; encrypted-media; picture-in-picture', allowfullscreen: true, loading: 'lazy' });
    box.replaceChildren(f);
  });
});

// ----- données -----
let data;
try {
  const r = await fetch('/api/public');
  if (!r.ok) throw new Error(r.status);
  data = await r.json();
} catch {
  $$('[data-fallback]').forEach((el) => { el.hidden = false; });
}

if (data) {
  const { conditions: c, trails, events, tarifs, settings: s, snowStates } = data;

  // textes / liens liés aux réglages
  $$('[data-bind]').forEach((el) => { if (s[el.dataset.bind]) el.textContent = s[el.dataset.bind]; });
  $$('[data-bind-tel]').forEach((el) => { el.href = `tel:${(s.phone || '').replace(/[^\d+]/g, '')}`; });
  $$('[data-bind-href]').forEach((el) => { if (s[el.dataset.bindHref]) el.href = s[el.dataset.bindHref]; });
  $$('[data-video]').forEach((el) => { if (s.youtubeId) el.dataset.video = s.youtubeId; });

  const ski = trails.filter((t) => t.kind === 'ski');
  const raq = trails.filter((t) => t.kind === 'raquette');
  const openSki = ski.filter((t) => t.status === 'open').length;
  const openRaq = raq.filter((t) => t.status === 'open').length;
  const seasonLabel = { open: 'Saison ouverte', partial: 'Ouverture partielle', closed: 'Saison non ouverte' }[c.season] || '';

  // bandeau haut de page
  const bar = $('[data-status-bar]');
  if (bar) {
    bar.hidden = false;
    $('[data-status-dot]', bar).className = `dot ${c.season}`;
    const bits = [seasonLabel];
    if (c.season !== 'closed') {
      bits.push(`${openSki}/${ski.length} pistes de ski ouvertes`);
      if (c.lastGroomedAt) bits.push(`damage ${when(c.lastGroomedAt)}`);
    }
    $('[data-status-text]', bar).textContent = bits.join(' · ');
  }

  // message d'information
  $$('[data-message]').forEach((el) => {
    if (c.message) { el.textContent = c.message; el.hidden = false; el.classList.toggle('alert', c.messageLevel === 'alert'); }
    else el.hidden = true;
  });

  // carte conditions (accueil)
  const card = $('[data-cond-card]');
  if (card) {
    $('[data-card-title]', card).textContent = seasonLabel;
    $('[data-card-dot]', card).className = `dot ${c.season}`;
    const grid = $('[data-card-grid]', card);
    const stat = (v, unit, label) => h('div', { class: 'stat' }, h('div', { class: 'stat__v' }, n(v), v == null ? null : h('small', { text: unit })), h('div', { class: 'stat__l', text: label }));
    grid.replaceChildren(
      stat(c.snowFoyer, 'cm', 'Neige au foyer (1450 m)'),
      stat(c.snowRefuge, 'cm', 'Neige au refuge (1700 m)'),
      stat(c.season === 'closed' ? null : openSki, `/${ski.length}`, 'Pistes de ski ouvertes'),
      stat(c.season === 'closed' ? null : openRaq, `/${raq.length}`, 'Itinéraires raquette ouverts'),
    );
    $('[data-card-foot]', card).textContent = c.lastGroomedAt ? `Dernier damage : ${when(c.lastGroomedAt)}.` : c.updatedAt ? `Mis à jour ${when(c.updatedAt)}.` : 'Les informations seront publiées à l’ouverture.';
  }

  // page conditions
  const full = $('[data-conditions]');
  if (full) {
    const stat = (v, unit, label) => h('div', { class: 'stat' }, h('div', { class: 'stat__v' }, n(v), v == null ? null : h('small', { text: unit })), h('div', { class: 'stat__l', text: label }));
    $('[data-cond-stats]').replaceChildren(
      stat(c.snowFoyer, 'cm', 'Hauteur de neige au foyer (1450 m)'),
      stat(c.snowRefuge, 'cm', 'Hauteur de neige au refuge (1700 m)'),
      stat(c.airTemp, '°C', 'Température de l’air ce matin'),
      stat(c.snowTemp, '°C', 'Température de la neige'),
      stat(c.humidity, '%', 'Humidité de l’air'),
    );
    const risk = $('[data-risk]');
    if (risk) {
      risk.replaceChildren(
        h('span', { class: 'risk', role: 'img', 'aria-label': c.avalancheRisk ? `Niveau ${c.avalancheRisk} sur 5` : 'Non communiqué' }, ...[1, 2, 3, 4, 5].map((i) => h('i', { class: i <= (c.avalancheRisk || 0) ? 'on' : '' }))),
        h('span', { text: c.avalancheRisk ? ` Niveau ${c.avalancheRisk} / 5` : ' Non communiqué' }),
      );
    }
    const states = $('[data-snow-states]');
    if (states) states.replaceChildren(...(c.snowStates?.length ? c.snowStates.map((k) => h('span', { class: 'chip', text: snowStates[k] || k })) : [h('span', { class: 'muted', text: 'État de la neige non renseigné.' })]));
    $('[data-groomed]').textContent = c.lastGroomedAt ? `Dernier damage : ${when(c.lastGroomedAt)}` : 'Aucun damage enregistré pour le moment';
    $('[data-updated]').textContent = c.updatedAt ? `Informations mises à jour ${when(c.updatedAt)}.` : '';
    $('[data-season]').textContent = seasonLabel;
    $('[data-season-dot]').className = `dot ${c.season}`;

    const cam = $('[data-webcam]');
    if (cam && s.webcamUrl) {
      const img = h('img', { src: `${s.webcamUrl}?t=${Math.floor(Date.now() / 60000)}`, alt: 'Webcam du Crêt du Poulet', loading: 'lazy' });
      img.addEventListener('error', () => { cam.hidden = true; });
      cam.replaceChildren(img);
    } else if (cam) cam.hidden = true;
  }

  // listes de pistes
  {
    const row = (t) => h('li', { class: `trail ${t.status}` },
      h('span', { class: 'trail__n', text: t.num }),
      h('span', { class: 'trail__name' }, t.name,
        t.kind === 'ski' && t.status === 'open' && t.groomedAt ? h('span', { class: 'trail__sub', text: `damée ${when(t.groomedAt)}` }) : null,
        t.note ? h('span', { class: 'trail__sub', text: t.note }) : null),
      h('span', { class: `badge ${t.status}`, text: t.status === 'open' ? 'Ouverte' : 'Fermée' }));
    $('[data-trails-ski]')?.replaceChildren(...ski.map(row));
    $('[data-trails-raq]')?.replaceChildren(...raq.map(row));
  }

  // tarifs
  $$('[data-tarifs]').forEach((root) => {
    const only = (root.dataset.tarifs || '').split(',').map((x) => x.trim()).filter(Boolean);
    const tables = tarifs.tables.filter((t) => !only.length || only.includes(t.id));
    root.replaceChildren(...tables.map((t) => h('section', { class: 'table-block', id: t.id },
      h('h3', { text: t.title }),
      t.intro ? h('p', { class: 'intro', text: t.intro }) : null,
      h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': t.title },
        h('table', { class: 'tarif' },
          h('thead', {}, h('tr', {}, ...t.columns.map((col, i) => h('th', { scope: 'col' }, col || h('span', { class: 'sr', text: 'Catégorie' }))))),
          h('tbody', {}, ...t.rows.map((r) => h('tr', {}, ...r.map((cell, i) => (i === 0 ? h('th', { scope: 'row', text: cell, style: 'font-weight:500' }) : h('td', { text: cell && /^[\d,/ ]+$/.test(cell) ? `${cell} €` : cell }))))))),
      ),
      t.note ? h('p', { class: 'note', text: t.note }) : null)));
  });

  // événements
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const KIND = { sport: 'Sport', soiree: 'Soirée', stage: 'Stage', autre: 'Événement' };
  const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00Z`));
  $$('[data-events]').forEach((root) => {
    const kind = root.dataset.kind;
    const limit = Number(root.dataset.limit || 0);
    let list = events.filter((e) => !kind || e.kind === kind);
    if (limit) list = list.slice(0, limit);
    if (!list.length) { root.replaceChildren(h('li', { class: 'muted', text: 'Aucun événement programmé pour le moment. Le programme sera publié ici.' })); return; }
    root.replaceChildren(...list.map((e) => {
      const [, mo, da] = e.date.split('-');
      const range = e.dateEnd ? `Du ${longDate(e.date)} au ${longDate(e.dateEnd)}` : longDate(e.date);
      const link = e.link ? h('a', { href: e.link, rel: 'noopener', text: 'En savoir plus' }) : null;
      return h('li', { class: `event event--${e.kind}` },
        h('div', { class: 'event__date' }, h('b', { text: String(Number(da)) }), h('span', { text: MONTHS[Number(mo) - 1] })),
        h('div', {}, h('h3', { text: e.title }),
          h('p', { text: [range.charAt(0).toUpperCase() + range.slice(1), e.subtitle].filter(Boolean).join(' · ') }),
          e.description ? h('p', { text: e.description }) : null, e.price ? h('p', { text: `Tarif : ${e.price}` }) : null, link),
        h('span', { class: 'event__tag', text: KIND[e.kind] }));
    }));
  });
}
