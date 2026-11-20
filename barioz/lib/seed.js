// Contenu initial, repris du site actuel (relevé le 20/11/2026).
// À vérifier / mettre à jour depuis l'espace admin avant la mise en ligne publique.

export const SNOW_STATES = {
  fraiche: 'Neige fraîche',
  humide: 'Neige humide',
  dure: 'Neige dure',
  douce_decaillee: 'Neige douce décaillée',
  douce_damee: 'Neige douce fraîchement damée',
  gelee_raquettes: 'Neige gelée sur itinéraires raquettes',
  froide: 'Neige froide',
};

export const seedConditions = () => ({
  season: 'closed', // open | partial | closed
  updatedAt: null,
  lastGroomedAt: null,
  airTemp: null,
  snowTemp: null,
  humidity: null,
  snowStates: [],
  snowFoyer: null,
  snowRefuge: null,
  avalancheRisk: null,
  message: "Saison pas encore ouverte. L'ouverture dépend de l'enneigement.",
  messageLevel: 'info',
});

const ski = [
  'Piste du refuge', 'Les Ramiettes', 'Crève-Cœur', 'Belle Aiguette (petite boucle)', 'Les Môilles',
  'Le Plateau', 'Le Crêt du Poulet', 'Boucle du Crêt', 'Le Prayet', 'La Grande Teppe',
  'Le Levant', 'Crêt Luisard', 'Les Crêtes',
];
const raq = [
  'Boucle du Crêt du Poulet', 'Belle Aiguette', 'Petite Forêt', 'Le Levant', 'Belvédère de la Croix',
];

export const seedTrails = () => [
  ...ski.map((name, i) => ({ id: `s${i + 1}`, kind: 'ski', num: i + 1, name, status: 'closed', groomedAt: null, note: '' })),
  ...raq.map((name, i) => ({ id: `r${i + 1}`, kind: 'raquette', num: i + 1, name, status: 'closed', groomedAt: null, note: '' })),
];

export const seedEvents = () => {
  const soiree = (id, date, title, subtitle) => ({
    id, kind: 'soiree', date, title, subtitle, description: '', price: '', published: true, link: '',
  });
  return [
    { id: 'e-stage', kind: 'stage', date: '2027-02-15', dateEnd: '2027-02-19', title: 'Stage enfants du canton',
      subtitle: "Vacances d'hiver", description: '', price: '', published: true, link: '' },
    { id: 'e-glisse', kind: 'sport', date: '2027-01-24', title: 'Journée de la glisse « Osez le Nordic »',
      subtitle: '', description: '', price: '', published: true, link: '' },
    { id: 'e-rocher', kind: 'sport', date: '2027-02-07', title: 'Course du Grand Rocher',
      subtitle: '', description: 'Épreuve historique du club : 1100 m de dénivelé à gravir depuis le col du Barioz.', price: '', published: true, link: '' },
    { id: 'e-bia1', kind: 'sport', date: '2027-02-21', title: 'Journée biathlon',
      subtitle: 'Pas de tir des Ramiettes', description: '', price: '', published: true, link: '' },
    { id: 'e-bia2', kind: 'sport', date: '2027-03-07', title: 'Journée biathlon',
      subtitle: 'Pas de tir des Ramiettes', description: '', price: '', published: true, link: '' },
    soiree('m1', '2027-01-29', 'Mex', 'Compositions, chansons françaises'),
    soiree('m2', '2027-02-12', '« Indignez-vous »', "Chansons de révolte et d'espoir"),
    soiree('m3', '2027-02-19', 'Duo Margo', 'Chansons françaises, compositions et reprises'),
    soiree('m4', '2027-03-05', 'Grenoble Klezmer Kollectiv', 'Musique klezmer'),
    soiree('m5', '2027-03-12', 'Celtic Crossroads', 'Musique celtique, irlandaise'),
    soiree('m6', '2027-03-26', 'La Boîte à Boutons', 'Bal folk'),
  ];
};

export const seedSettings = () => ({
  phone: '04 76 71 06 47',
  address: 'Espace Nordique du Barioz, Mairie, 38830 Crêts en Belledonne',
  hours: 'Tous les jours de 9h à 17h',
  refugeHours: 'Week-ends et vacances scolaires',
  reservationUrl: 'https://barioz.epok.network/',
  webcamUrl: 'https://cretdupoulet.epok.network/camera/cret_du_poulet.jpg',
  forfaitsUrl: 'https://skipass.les7laux.com/fr/cart',
  nationalPassUrl: 'https://www.nordic-isere.fr/pass-national/',
  meteoUrl: 'https://www.meteoblue.com/fr/meteo/semaine/les-sept-laux-le-pleynet_france_8426489',
  meteoLocalUrl: 'http://mto38.free.fr/',
  sevenLauxUrl: 'http://www.co7lauxnordique.fr',
  planPistesPdf: 'https://espacenordiquedubarioz.fr/onewebmedia/plan%20piste%20%20t%C3%A9l%C3%A9charger.pdf',
  planRaquettePdf: 'https://espacenordiquedubarioz.fr/onewebmedia/parcours%20raquette.pdf',
  youtubeId: 'qIFUVNOOClM',
  paymentNote: 'Règlement par CB, chèque ou espèces',
});

export const seedTarifs = () => ({
  tables: [
    {
      id: 'forfaits',
      title: 'Redevance accès pistes',
      intro: 'Support magnétique obligatoire.',
      columns: ['', 'Annuel national*', 'Annuel Isère-Drôme*', 'Annuel Barioz-Beldina-Col de Marcieu**', 'Carte site**', '2 jours', '1 jour'],
      rows: [
        ['Juniors (6 à 16 ans inclus)', '90', '61', '', '21,50 / 36', '10', '6'],
        ['Adultes (+ de 16 ans)', '250', '172', '62 / 80', '37 / 62', '16', '9'],
        ['Tarif réduit (étudiant, + de 70 ans)', '', '', '', '', '', '6,50'],
        ['Seniors (à partir de 76 ans)', '', '95', '', '', '', '3'],
      ],
      note: '* En vente uniquement en ligne sur nordic-isere.fr. ** En vente en ligne en prévente avant le 19/12 sur skipass.les7laux.com (le second prix est le tarif hors prévente).',
    },
    {
      id: 'raquettes',
      title: 'Ticket raquettes',
      intro: 'Participez à la pérennité du site : le ticket raquette soutient l’entretien des itinéraires.',
      columns: ['', 'Tarif'],
      rows: [['Ticket raquettes', '2,50']],
      note: 'Cours particuliers : renseignements au foyer.',
    },
    {
      id: 'location',
      title: "Location d'équipement",
      intro: '',
      columns: ['', '½ journée', 'Journée'],
      rows: [
        ['Alternatif (skis + chaussures + bâtons) · Junior 6-16 ans / Senior 71+', '8', '10'],
        ['Alternatif · Adulte 17-70 ans', '10', '12'],
        ['Alternatif · Groupe (+ de 10 pers., 1 règlement)', '9', '11'],
        ['Skating (skis + chaussures + bâtons) · Junior 6-16 ans / Senior 71+', '10', '12'],
        ['Skating · Adulte 17-70 ans', '13', '15'],
        ['Skating · Groupe (+ de 10 pers., 1 règlement)', '12', '14'],
        ['Raquettes (+ bâtons) · Baby', '3', '3'],
        ['Raquettes (+ bâtons) · Adulte', '6', '8'],
        ['À l’unité · Bâtons', '', '4'],
        ['À l’unité · Skis alternatif / skating', '', '7,50 / 9'],
        ['À l’unité · Chaussures alternatif / skating', '', '6,50 / 8'],
      ],
      note: 'Règlement par CB, chèque ou espèces.',
    },
    {
      id: 'refuge',
      title: 'Refuge, demi-pension',
      intro: 'Fondue savoyarde ou croziflette, salade et dessert.',
      columns: ['', 'Adultes et jeunes', '6 à 11 ans', "Jusqu'à 5 ans"],
      rows: [['Demi-pension', '47', '33', '10']],
      note: '+ 0,50 € de taxe de séjour à partir de 18 ans. Dortoir de 23 couchages.',
    },
    {
      id: 'soiree',
      title: 'Soirées musique au refuge',
      intro: 'Prêt de raquettes, vin chaud, repas ; animation au chapeau.',
      columns: ['', 'Tarif'],
      rows: [['La soirée', '43'], ['Avec nuitée et petit-déjeuner', '58']],
      note: '',
    },
  ],
});
