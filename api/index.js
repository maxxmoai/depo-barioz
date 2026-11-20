// Fonction Vercel unique : toutes les routes /api/* y sont réécrites (voir vercel.json).
import { handle } from '../lib/api.js';

export default async function handler(req, res) {
  const fromQuery = req.query?.path;
  const path = Array.isArray(fromQuery) ? fromQuery.join('/') : fromQuery ?? new URL(req.url, 'http://x').pathname;
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress;
  const { path: _p, ...query } = req.query || {};
  const out = await handle({
    method: req.method,
    path,
    query,
    headers: req.headers,
    body: req.body && typeof req.body === 'object' ? req.body : undefined,
    ip,
  });
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.status(out.status).json(out.json);
}
