// Estimation météo de secours (Open-Meteo : gratuit, sans clé) pour les valeurs que l'équipe a oublié de saisir.
// C'est une ESTIMATION de modèle (maille d'environ 2 à 11 km) : elle peut s'écarter de la mesure réelle en montagne.
import * as db from './store.js';

const TTL_MS = 30 * 60e3;
const KEY = 'weather';

export const weatherEnabled = () => process.env.WEATHER_DISABLED !== '1';

function parisHourKey(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:00`;
}

export async function fetchEstimate({ lat, lng, elevation = 1450 }) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: String(lat), longitude: String(lng), elevation: String(elevation),
    hourly: 'snow_depth,temperature_2m,relative_humidity_2m', timezone: 'Europe/Paris', forecast_days: '1',
  }).toString();
  const r = await fetch(u, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = await r.json();
  const times = j.hourly?.time || [];
  let i = times.indexOf(parisHourKey());
  if (i < 0) i = Math.max(0, times.length - 1);
  const snowM = j.hourly?.snow_depth?.[i];
  const t = j.hourly?.temperature_2m?.[i];
  const h = j.hourly?.relative_humidity_2m?.[i];
  return {
    snow: Number.isFinite(snowM) ? Math.max(0, Math.round(snowM * 100)) : null, // mètres -> cm
    temp: Number.isFinite(t) ? Math.round(t * 10) / 10 : null,
    humidity: Number.isFinite(h) ? Math.round(h) : null,
    at: new Date().toISOString(),
  };
}

// Points d'estimation : foyer (réglages lat/lng) et refuge (latRefuge/lngRefuge, 1700 m). Chacun est interrogé avec ses propres coordonnées.
export function spots(settings) {
  const mk = (lat, lng, elevation) => (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat !== '' && lng !== '' ? { lat: Number(lat), lng: Number(lng), elevation } : null);
  const foyer = mk(settings.lat, settings.lng, 1450);
  const refuge = mk(settings.latRefuge, settings.lngRefuge, 1700) || foyer && { ...foyer, elevation: 1700 };
  return { foyer, refuge };
}

// Renvoie { foyer, refuge, at } (cache 30 min) ou null si tout est indisponible. Ne lève jamais d'erreur.
export async function getEstimate(settings) {
  if (!weatherEnabled()) return null;
  const sp = spots(settings);
  if (!sp.foyer) return null;
  const sig = JSON.stringify(sp);
  let cached;
  try { cached = await db.get(KEY); } catch { cached = undefined; }
  const sameSpot = cached && cached.sig === sig;
  if (sameSpot && Date.now() - Date.parse(cached.at) < TTL_MS) return cached;
  const one = async (spot) => { try { return await fetchEstimate(spot); } catch { return null; } };
  const [foyer, refuge] = await Promise.all([one(sp.foyer), one(sp.refuge)]);
  if (!foyer && !refuge) return sameSpot ? cached : null; // panne : on garde la dernière estimation connue
  const out = { foyer: foyer || cached?.foyer || null, refuge: refuge || cached?.refuge || null, at: new Date().toISOString(), sig };
  try { await db.set(KEY, out); } catch { /* cache facultatif */ }
  return out;
}
