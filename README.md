# Espace Nordique du Barioz — site + espace équipe

Refonte complète de espacenordiquedubarioz.fr : site public (10 pages) et **espace équipe** (`/admin`) où le dameur, l'équipe du foyer et les bénévoles mettent à jour l'état des pistes, la neige, les événements, etc., chacun selon ses droits.

Aucune dépendance npm (Node ≥ 22). Hébergement prévu : Vercel (pages statiques + 1 fonction `/api`).

## Lancer en local
```bash
npm run dev          # build + http://localhost:3000
npm run demo         # (autre terminal) données d'hiver fictives
npm test             # tests API (19 groupes)
SHOTS=./shots node tests/e2e.mjs   # tests navigateur (nécessite Playwright)
```
Comptes démo (local uniquement) : `admin@`, `foyer@`, `dameur@`, `benevole@`, `visiteur@barioz.local` — mot de passe `barioz-demo-2026`.

## Structure
- `src/pages/*.html` : pages ; `src/partials/` : en-tête, pied de page ; `src/assets/` : CSS/JS/images
- `build.mjs` : assemble `src/` → `dist/` (sitemap, robots inclus)
- `lib/api.js` : toute l'API ; `lib/perms.js` : **table des autorisations** ; `lib/store.js` : stockage
- `api/index.js` : fonction Vercel ; `server.mjs` : serveur local

## Photos
Déposez vos photos dans `src/assets/img/photos/` ; elles remplacent automatiquement les illustrations :
`hero`, `foyer`, `refuge`, `pistes`, `soirees`, `scolaires`, `association` (.jpg/.webp/.png) et `plan-acces` (plan d'accès, affiché seulement s'il existe).

## Déploiement Vercel
1. Importer le dépôt GitHub dans Vercel (build/output déjà définis dans `vercel.json`).
2. **Base de données** : Vercel → Storage → Marketplace → *Upstash Redis* (gratuit), connecter au projet (variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` ajoutées automatiquement). Sans cela, les données ne sont PAS conservées (`/api/health` → `"persistent": false`).
3. Variables d'environnement : `SESSION_SECRET` (longue chaîne aléatoire), `SETUP_TOKEN` (jeton temporaire).
4. Créer le premier administrateur (une seule fois) :
```bash
curl -X POST https://VOTRE-SITE/api/setup -H "Content-Type: application/json" \
  -d '{"setupToken":"<SETUP_TOKEN>","name":"Prénom Nom","email":"vous@exemple.fr","password":"10 caractères minimum"}'
```
Puis supprimer `SETUP_TOKEN`. Les autres comptes se créent dans `/admin` → Équipe & droits.

## Damage automatique
`/admin` → Équipe & droits → *Accès automatiques* : crée un jeton aux droits limités (ex. « damage seulement »). Un raccourci téléphone, un script ou un capteur envoie ensuite :
```bash
curl -X POST https://VOTRE-SITE/api/ingest/grooming -H "Authorization: Bearer bzd_..." \
  -H "Content-Type: application/json" -d '{"all":true}'      # ou {"ids":["s1","s2"]}
```
`/api/ingest/conditions` accepte températures / neige selon les droits du jeton.

## Autorisations par défaut (modifiables dans l'admin)
| Droit | Admin | Équipe foyer | Dameur | Bénévole refuge |
|---|:-:|:-:|:-:|:-:|
| Ouvrir/fermer la saison | ✓ | ✓ | | |
| Neige au foyer | ✓ | ✓ | ✓ | |
| Neige au refuge | ✓ | ✓ | ✓ | ✓ |
| Températures, humidité, état neige | ✓ | ✓ | ✓ | |
| Risque d'avalanche | ✓ | ✓ | | |
| Message d'information | ✓ | ✓ | | |
| Ouvrir/fermer une piste | ✓ | ✓ | ✓ | |
| Déclarer un damage | ✓ | ✓ | ✓ | |
| Événements et soirées | ✓ | ✓ | | ✓ |
| Horaires, téléphone, liens | ✓ | ✓ | | |
| Tarifs | ✓ | | | |
| Comptes, autorisations, accès auto, journal | ✓ | | | |

Sécurité : mots de passe hachés (scrypt), session HttpOnly, droits revérifiés côté serveur, journal de toutes les modifications, limitation des tentatives de connexion, en-têtes CSP.

## Points à vérifier avant ouverture publique
- Tarifs et dates repris de l'ancien site (relevé le 20/11/2026) : les relire dans `/admin` → Tarifs. Les cellules « 62 / 80 » du tableau forfaits (prévente / tarif normal) sont une interprétation de l'ancien tableau.
- PDF des plans de pistes : liens encore vers l'ancien site ; à copier dans le projet avant de couper l'ancien site.


## Nouveautés v2

- **Boutons ouvrir/fermer/damée instantanés** : l'écran change tout de suite, l'envoi part en arrière-plan (file d'attente, un seul changement à la fois par piste, retour arrière + message en cas d'échec). L'admin lit `/api/public?fresh=1` (jamais mis en cache) ; le public garde un cache CDN de 10 s.
- **Météo de secours** (Open-Meteo, gratuit, sans clé) : un champ neige/température/humidité laissé vide, ou saisi il y a plus de 30 h, est complété par une estimation de modèle, affichée « estimation météo ». Coordonnées modifiables dans Infos du site ; `WEATHER_DISABLED=1` désactive. Estimation grossière : la saisie du dameur reste la référence.
- **Webcam intégrée** (accueil + conditions) : rafraîchie chaque minute, clic = agrandir, lien conservé (`webcamPageUrl`), message clair si indisponible.
- **Plan des pistes** intégré sur /pistes (clic = agrandir), boutons PDF conservés. L'image pointe encore vers l'ancien hébergement : avant de couper l'ancien site, déposez `plan-pistes.jpg`/PDF dans ce dépôt et changez les URL dans Infos du site.
- **Carte OpenStreetMap** intégrée sur /acces (repère au col du Barioz, coordonnées modifiables).
- **Compte « Visiteur (démo)»** : voit tous les écrans comme un admin, e-mails masqués, aucune écriture possible (refus serveur 403). Créez-le dans Équipe & droits > Comptes avec le rôle « Visiteur (démo) ».
