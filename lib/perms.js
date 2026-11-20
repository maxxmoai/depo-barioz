// Table des autorisations : une permission = une action précise.
// La matrice rôle -> permissions est stockée en base et modifiable par l'administrateur ;
// ce fichier ne contient que les valeurs par défaut.

export const PERMISSIONS = {
  'conditions.season': { label: "Ouvrir / fermer la saison", group: 'Conditions' },
  'conditions.snowFoyer': { label: 'Hauteur de neige au foyer (1450 m)', group: 'Conditions' },
  'conditions.snowRefuge': { label: 'Hauteur de neige au refuge (1700 m)', group: 'Conditions' },
  'conditions.measures': { label: 'Températures, humidité, état de la neige', group: 'Conditions' },
  'conditions.avalanche': { label: "Risque d'avalanche", group: 'Conditions' },
  'conditions.message': { label: "Message d'information (bandeau)", group: 'Conditions' },
  'trails.status': { label: 'Ouvrir / fermer une piste ou un itinéraire', group: 'Pistes' },
  'trails.groomed': { label: 'Déclarer un damage', group: 'Pistes' },
  'events.edit': { label: 'Gérer les événements et soirées', group: 'Contenu' },
  'tarifs.edit': { label: 'Modifier les tarifs', group: 'Contenu' },
  'settings.edit': { label: 'Horaires, téléphone, liens', group: 'Contenu' },
  'users.manage': { label: 'Gérer les comptes et les autorisations', group: 'Administration' },
  'tokens.manage': { label: 'Gérer les accès automatiques (capteurs, scripts)', group: 'Administration' },
  'audit.read': { label: 'Consulter le journal des modifications', group: 'Administration' },
};

export const ROLES = {
  admin: { label: 'Administrateur', desc: "Bureau de l'association : tous les droits." },
  foyer: { label: 'Équipe du foyer', desc: 'Salariés : conditions, pistes, horaires, événements.' },
  dameur: { label: 'Dameur', desc: 'Damage, ouverture des pistes, mesures du matin.' },
  benevole: { label: 'Bénévole refuge', desc: "Neige au refuge, événements et soirées." },
  visiteur: { label: 'Visiteur (démo)', desc: 'Voit tout l’espace équipe comme un administrateur, mais ne peut rien modifier.', readOnly: true },
};

// Rôles qui ont une colonne dans la table des autorisations (le visiteur n'en a pas : il est toujours en lecture seule).
export const MATRIX_ROLES = Object.keys(ROLES).filter((r) => !ROLES[r].readOnly);

export const DEFAULT_MATRIX = {
  admin: Object.keys(PERMISSIONS),
  foyer: [
    'conditions.season', 'conditions.snowFoyer', 'conditions.snowRefuge', 'conditions.measures',
    'conditions.avalanche', 'conditions.message', 'trails.status', 'trails.groomed',
    'events.edit', 'settings.edit',
  ],
  dameur: [
    'conditions.snowFoyer', 'conditions.snowRefuge', 'conditions.measures',
    'trails.status', 'trails.groomed',
  ],
  benevole: ['conditions.snowRefuge', 'events.edit'],
};

// Un accès automatique (capteur, script, appli du dameur) ne peut recevoir que ces droits.
export const DEVICE_ALLOWED = [
  'trails.groomed', 'conditions.measures', 'conditions.snowFoyer', 'conditions.snowRefuge',
];

// Droits que l'administrateur ne peut pas retirer à son propre rôle (évite de se verrouiller dehors).
export const LOCKED_ADMIN = ['users.manage', 'audit.read', 'tokens.manage'];

export const isReadOnly = (principal) => principal?.kind === 'user' && !!ROLES[principal.role]?.readOnly;

export function can(principal, perm, matrix) {
  if (!principal) return false;
  if (principal.kind === 'device') return principal.perms.includes(perm);
  if (isReadOnly(principal)) return false; // le visiteur ne peut jamais écrire
  if (principal.role === 'admin') return true;
  const list = (matrix && matrix[principal.role]) || DEFAULT_MATRIX[principal.role] || [];
  return list.includes(perm);
}

export function permsOf(principal, matrix) {
  return Object.keys(PERMISSIONS).filter((p) => can(principal, p, matrix));
}
