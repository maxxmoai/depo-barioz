import crypto from 'node:crypto';

const COOKIE = 'bz_session';
const SESSION_DAYS = 14;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET manquant');
  }
  return 'dev-secret-ne-pas-utiliser-en-production';
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [algo, s, h] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(h, 'base64url');
    const actual = crypto.scryptSync(pw, Buffer.from(s, 'base64url'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export function createSession(uid) {
  const payload = b64({ uid, exp: Date.now() + SESSION_DAYS * 864e5 });
  return `${payload}.${mac(payload)}`;
}

export function readSession(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const good = mac(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { clear = false } = {}) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const age = clear ? 0 : SESSION_DAYS * 86400;
  return `${COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}

export const COOKIE_NAME = COOKIE;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newId = (n = 8) => crypto.randomBytes(n).toString('base64url');
export const newDeviceToken = () => `bzd_${crypto.randomBytes(32).toString('base64url')}`;
