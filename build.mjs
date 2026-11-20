// Génère dist/ à partir de src/ : assemble pages + partiels, gère les emplacements photo, sitemap, robots.
// Aucune dépendance : node build.mjs
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const SITE = (process.env.SITE_URL || 'https://espacenordiquedubarioz.fr').replace(/\/$/, '');

const read = (p) => fs.readFile(p, 'utf8');
const exists = async (p) => !!(await fs.stat(p).catch(() => null));

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(a, b);
    else await fs.copyFile(a, b);
  }
}

// ---- illustrations de remplacement (utilisées tant qu'aucune photo n'est fournie) ----
function scene(kind) {
  const trees = (y, n, s, off = 0) =>
    Array.from({ length: n }, (_, i) => {
      const x = off + (i * 480) / n + ((i * 37) % 23);
      const h = s + ((i * 11) % 9);
      return `<path d="M${x} ${y} l${h * 0.28} ${-h} l${h * 0.28} ${h}z" />`;
    }).join('');
  const extras = {
    moon: '<circle cx="360" cy="46" r="20" fill="var(--sky-hi)" opacity=".95"/><circle cx="368" cy="40" r="18" fill="var(--sky-lo)"/>',
    cabin: '<g fill="var(--ink-soft)"><rect x="150" y="150" width="70" height="38"/><path d="M142 152 l43 -34 43 34z"/></g><rect x="176" y="166" width="14" height="22" fill="var(--ember)"/>',
    tracks: '<g stroke="var(--snow-hi)" stroke-width="2" fill="none" opacity=".9"><path d="M-10 214 C120 170 230 214 490 150"/><path d="M-10 226 C120 182 230 226 490 162"/></g>',
    flag: '<g><path d="M300 190 V120" stroke="var(--ink-soft)" stroke-width="3"/><path d="M302 120 h38 l-10 12 10 12 h-38z" fill="var(--ember)"/></g>',
    none: '',
  };
  const map = { foyer: 'cabin', refuge: 'cabin', pistes: 'tracks', soirees: 'moon', evenements: 'flag', scolaires: 'flag', association: 'cabin', acces: 'tracks', hero: 'none' };
  return `<svg class="scene" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" focusable="false">
<defs><linearGradient id="sky-${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--sky-hi)"/><stop offset="1" stop-color="var(--sky-lo)"/></linearGradient></defs>
<rect width="480" height="240" fill="url(#sky-${kind})"/>
${kind === 'soirees' ? '<g fill="var(--snow-hi)" opacity=".85"><circle cx="40" cy="30" r="1.6"/><circle cx="110" cy="60" r="1.2"/><circle cx="230" cy="24" r="1.5"/><circle cx="300" cy="70" r="1.1"/><circle cx="430" cy="90" r="1.4"/></g>' : ''}
<path d="M0 150 L70 96 L120 128 L190 62 L250 118 L310 80 L390 140 L440 104 L480 128 V240 H0z" fill="var(--ridge-far)"/>
<path d="M0 178 L60 140 L130 168 L210 112 L290 160 L360 128 L430 164 L480 146 V240 H0z" fill="var(--ridge-mid)"/>
<g fill="var(--forest)">${trees(196, 22, 30)}</g>
<path d="M0 206 C90 188 170 214 260 198 C350 182 420 206 480 192 V240 H0z" fill="var(--snow-hi)"/>
<g fill="var(--forest)" opacity=".9">${trees(232, 16, 22, 6)}</g>
${extras[map[kind] || 'none']}
</svg>`;
}

async function media(name, alt = '') {
  for (const ext of ['jpg', 'jpeg', 'webp', 'png', 'avif']) {
    const f = path.join(src, 'assets/img/photos', `${name}.${ext}`);
    if (await exists(f)) return `<img class="photo" src="/assets/img/photos/${name}.${ext}" alt="${alt}" loading="lazy" decoding="async">`;
  }
  return scene(name);
}

async function optimg(name, alt = '') {
  for (const ext of ['jpg', 'jpeg', 'webp', 'png', 'avif']) {
    const f = path.join(src, 'assets/img/photos', `${name}.${ext}`);
    if (await exists(f)) return `<img class="plan-img" src="/assets/img/photos/${name}.${ext}" alt="${alt}" loading="lazy" decoding="async">`;
  }
  return '';
}

const pages = [];
async function build() {
  await fs.rm(dist, { recursive: true, force: true });
  await fs.mkdir(dist, { recursive: true });
  await copyDir(path.join(src, 'assets'), path.join(dist, 'assets'));
  const partials = {};
  for (const f of await fs.readdir(path.join(src, 'partials'))) {
    partials[f.replace('.html', '')] = await read(path.join(src, 'partials', f));
  }

  for (const f of (await fs.readdir(path.join(src, 'pages'))).filter((x) => x.endsWith('.html'))) {
    let html = await read(path.join(src, 'pages', f));
    const m = html.match(/^<!--meta:(.*?)-->\s*/s);
    if (!m) throw new Error(`${f} : bloc <!--meta:{...}--> manquant`);
    const meta = JSON.parse(m[1]);
    html = html.slice(m[0].length);

    const page = partials.layout
      .replace('{{head-title}}', meta.path === '/' ? meta.title : `${meta.title} · Espace Nordique du Barioz`)
      .replaceAll('{{desc}}', meta.desc)
      .replaceAll('{{canonical}}', `${SITE}${meta.path === '/' ? '' : meta.path}`)
      .replace('{{robots}}', meta.noindex ? 'noindex, nofollow' : 'index, follow')
      .replace('{{header}}', meta.bare ? '' : partials.header)
      .replace('{{footer}}', meta.bare ? '' : partials.footer)
      .replace('{{body-class}}', meta.bodyClass || '')
      .replace('{{content}}', html)
      .replace('{{scripts}}', meta.scripts || '<script type="module" src="/assets/js/site.js"></script>');

    let out = page.replace(new RegExp(`data-nav="${meta.nav}"`, 'g'), `data-nav="${meta.nav}" aria-current="page"`);
    const tokens = [...out.matchAll(/\{\{media:([\w-]+)(?:\|([^}]*))?\}\}/g)];
    for (const t of tokens) out = out.replace(t[0], await media(t[1], t[2] || ''));
    for (const t of [...out.matchAll(/\{\{optimg:([\w-]+)(?:\|([^}]*))?\}\}/g)]) out = out.replace(t[0], await optimg(t[1], t[2] || ''));

    const target = meta.path === '/' ? path.join(dist, 'index.html') : path.join(dist, meta.path.slice(1), 'index.html');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, out);
    if (!meta.noindex) pages.push(meta.path);
  }

  const notFound = partials.layout
    .replace('{{head-title}}', 'Page introuvable · Espace Nordique du Barioz')
    .replaceAll('{{desc}}', 'Page introuvable')
    .replaceAll('{{canonical}}', SITE)
    .replace('{{robots}}', 'noindex')
    .replace('{{header}}', partials.header)
    .replace('{{footer}}', partials.footer)
    .replace('{{body-class}}', '')
    .replace('{{scripts}}', '<script type="module" src="/assets/js/site.js"></script>')
    .replace('{{content}}', '<main id="main" class="wrap section"><h1>Page introuvable</h1><p>Cette page n’existe pas ou a été déplacée.</p><p><a class="btn" href="/">Retour à l’accueil</a></p></main>');
  await fs.writeFile(path.join(dist, '404.html'), notFound);

  const urls = pages.sort().map((p) => `<url><loc>${SITE}${p === '/' ? '' : p}</loc></url>`).join('');
  await fs.writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  await fs.writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`build OK : ${pages.length} pages -> dist/`);
}

await build();
