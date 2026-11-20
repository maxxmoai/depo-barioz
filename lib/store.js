// Stockage clé/valeur sans dépendance.
//  - production : Redis REST (Upstash / Vercel Marketplace) si UPSTASH_REDIS_REST_* ou KV_REST_API_* sont définies
//  - local      : fichier data/db.json
//  - Vercel sans base : mémoire (NON persistant, signalé par /api/health)
import { promises as fs } from 'node:fs';
import path from 'node:path';

const mem = new Map();
let chain = Promise.resolve();

function kvEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function storageMode() {
  if (kvEnv()) return 'kv';
  if (process.env.VERCEL) return 'memory';
  return 'file';
}

const dataFile = () => process.env.DATA_FILE || path.join(process.cwd(), 'data', 'db.json');

async function readFile() {
  try {
    return JSON.parse(await fs.readFile(dataFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function kv(cmd) {
  const { url, token } = kvEnv();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`KV ${r.status}`);
  return (await r.json()).result;
}

export async function get(key) {
  const mode = storageMode();
  if (mode === 'kv') {
    const raw = await kv(['GET', `barioz:${key}`]);
    return raw == null ? undefined : JSON.parse(raw);
  }
  if (mode === 'memory') return mem.has(key) ? structuredClone(mem.get(key)) : undefined;
  const all = await readFile();
  return all[key];
}

export async function set(key, value) {
  const mode = storageMode();
  if (mode === 'kv') {
    await kv(['SET', `barioz:${key}`, JSON.stringify(value)]);
    return;
  }
  if (mode === 'memory') {
    mem.set(key, structuredClone(value));
    return;
  }
  // écritures fichier sérialisées
  chain = chain.then(async () => {
    const all = await readFile();
    all[key] = value;
    await fs.mkdir(path.dirname(dataFile()), { recursive: true });
    const tmp = `${dataFile()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2));
    await fs.rename(tmp, dataFile());
  });
  return chain;
}
