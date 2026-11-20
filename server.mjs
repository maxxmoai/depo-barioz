// Serveur local : sert dist/ et l'API. Usage : npm run dev  (build puis http://localhost:3000)
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, seedDemoUsers } from './lib/api.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.pdf': 'application/pdf',
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return undefined; }
}

async function serveStatic(urlPath, res) {
  let p = decodeURIComponent(urlPath);
  if (p.includes('..')) { res.writeHead(400).end(); return; }
  const candidates = [p, path.join(p, 'index.html'), `${p}.html`];
  for (const c of candidates) {
    const file = path.join(root, c);
    try {
      const st = await fs.stat(file);
      if (st.isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(await fs.readFile(file));
        return;
      }
    } catch { /* suivant */ }
  }
  try {
    const nf = await fs.readFile(path.join(root, '404.html'));
    res.writeHead(404, { 'Content-Type': TYPES['.html'] }).end(nf);
  } catch {
    res.writeHead(404).end('Introuvable');
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      const out = await handle({
        method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body: await readBody(req), ip: req.socket.remoteAddress,
      });
      res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8', ...(out.headers || {}) });
      res.end(JSON.stringify(out.json));
      return;
    }
    await serveStatic(u.pathname, res);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seedDemoUsers();
  createServer().listen(port, () => {
    console.log(`Barioz : http://localhost:${port}`);
    console.log('Comptes démo (local uniquement) : admin@ / foyer@ / dameur@ / benevole@barioz.local  —  mot de passe : barioz-demo-2026');
  });
}
