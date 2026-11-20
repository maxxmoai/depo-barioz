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

// Renvoie l'estimation en cache (30 min) ou la rafraîchit ; null si indisponible. Ne lève jamais d'erreur.
export async function getEstimate(settings) {
  if (!weatherEnabled()) return null;
  const lat = Number(settings.lat);
  const lng = Number(settings.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let cached;
  try { cached = await db.get(KEY); } catch { cached = undefined; }
  const sameSpot = cached && cached.lat === lat && cached.lng === lng;
  if (sameSpot && Date.now() - Date.parse(cached.at) < TTL_MS) return cached;
  try {
    const est = await fetchEstimate({ lat, lng });
    const out = { ...est, lat, lng };
    try { await db.set(KEY, out); } catch { /* cache facultatif */ }
    return out;
  } catch {
    return sameSpot ? cached : null; // en cas de panne, on garde la dernière estimation connue
  }
}
