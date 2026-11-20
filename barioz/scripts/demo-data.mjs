// Remplit la base locale avec des conditions d'hiver fictives pour tester l'affichage : npm run demo
// (Ne s'utilise qu'en local : ne touche jamais la base de production.)
import * as db from '../lib/store.js';
if (process.env.VERCEL || process.env.NODE_ENV === 'production') { console.error('Refusé hors local.'); process.exit(1); }
const now = new Date();
const morning = new Date(now); morning.setHours(7, 40, 0, 0);
const c = await db.get('conditions');
await db.set('conditions', { ...(c || {}), season: 'open', updatedAt: now.toISOString(), lastGroomedAt: morning.toISOString(), airTemp: -4, snowTemp: -6, humidity: 70,
  snowStates: ['douce_damee'], snowFoyer: 75, snowRefuge: 130, avalancheRisk: 2, message: 'Soirée musique ce vendredi : départ du foyer à 19h précises.', messageLevel: 'info' });
const trails = await db.get('trails');
const closed = new Set(['s4', 's10', 's11', 'r4']);
for (const t of trails) { t.status = closed.has(t.id) ? 'closed' : 'open'; t.groomedAt = t.kind === 'ski' && t.status === 'open' ? morning.toISOString() : null; }
await db.set('trails', trails);
console.log('Données de démonstration appliquées.');
