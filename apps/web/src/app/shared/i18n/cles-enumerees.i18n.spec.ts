import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const I18N = join(process.cwd(), 'src', 'app', 'shared', 'i18n');

function fichiers(racine: string, extensions: string[]): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin, extensions));
    else if (extensions.some((extension) => entree.endsWith(extension))) trouves.push(chemin);
  }
  return trouves;
}

function valeur(table: Record<string, unknown>, clef: string): unknown {
  return clef.split('.').reduce<unknown>(
    (noeud, partie) => (
      noeud && typeof noeud === 'object'
        ? (noeud as Record<string, unknown>)[partie]
        : undefined
    ),
    table,
  );
}

const LANGUES = ['fr', 'en'] as const;
const FAMILLES: { prefixe: string; valeurs: readonly string[] }[] = [
  { prefixe: 'LIVREUR.STATUT_', valeurs: ['APPEL_OFFRES', 'ATTRIBUEE', 'EN_COURS', 'LIVREE', 'SANS_MOTARD', 'ANNULEE'] },
  { prefixe: 'PHARMACIEN.TDB.PERIODE_', valeurs: ['JOUR', 'MOIS', 'ANNEE'] },
  { prefixe: 'HOPITAL.IDENTITES.PIECE_', valeurs: ['CARTE_NATIONALE', 'PASSEPORT', 'ACTE_NAISSANCE', 'CARTE_CONSULAIRE', 'PERMIS_CONDUIRE', 'AUTRE'] },
  { prefixe: 'HOPITAL.IDENTITES.TRAIT_', valeurs: ['NOM_IDENTIQUE', 'NOM_PROCHE', 'NOM_VARIANTE', 'MERE_IDENTIQUE', 'LIEU_IDENTIQUE', 'DATE_IDENTIQUE', 'DATE_PAR_DEFAUT', 'TELEPHONE_IDENTIQUE', 'SANS_CONCORDANCE_DE_NOM', 'ORTHOGRAPHE_A_CONFIRMER'] },
  { prefixe: 'HOPITAL.IDENTITES.FUSION_OP_', valeurs: ['DEPLACEMENT', 'RESTRICTION_CONSENTEMENT'] },
  { prefixe: 'HOPITAL.IDENTITES.FUSION_STATUT_', valeurs: ['ACTIVE', 'ANNULEE'] },
  { prefixe: 'HOPITAL.EPISODES.FILTRE_', valeurs: ['TOUS', 'OUVERT', 'EN_COURS', 'CLOS', 'ANNULE'] },
  { prefixe: 'HOPITAL.DEMANDE_STATUT_', valeurs: ['TRANSMISE', 'RECUE', 'PRELEVEE', 'EN_ANALYSE', 'VALIDEE', 'ANNULEE'] },
  { prefixe: 'ADMIN.STRUCTURES.TYPE_', valeurs: ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE', 'PHARMACIE', 'LABORATOIRE', 'ASSURANCE'] },
  { prefixe: 'PATIENT.CONSENTS.SENS_', valeurs: ['ACCORDE', 'RETIRE'] },
  { prefixe: 'PATIENT.CONSENTS.RGPD_TYPE_', valeurs: ['ACCES', 'RECTIFICATION', 'EFFACEMENT', 'PORTABILITE', 'OPPOSITION', 'LIMITATION'] },
  { prefixe: 'PATIENT.CONSENTS.RGPD_EXPLAIN_', valeurs: ['ACCES', 'RECTIFICATION', 'EFFACEMENT', 'PORTABILITE', 'OPPOSITION', 'LIMITATION'] },
  { prefixe: 'PATIENT.CONSENTS.RGPD_STATUT_', valeurs: ['RECUE', 'EN_COURS', 'SATISFAITE', 'REFUSEE'] },
  { prefixe: 'ADMIN.JOURNAL.GRAVITE_', valeurs: ['SIGNAL', 'ALERTE'] },
  { prefixe: 'ADMIN.JOURNAL.ANOMALIE_', valeurs: ['REFUS_REPETES', 'VOLUME_DOSSIERS', 'ADRESSES_MULTIPLES'] },
  { prefixe: 'ADMIN.RGPD.STATUT_', valeurs: ['RECUE', 'EN_COURS', 'SATISFAITE', 'REFUSEE'] },
  { prefixe: 'ADMIN.RGPD.TYPE_', valeurs: ['ACCES', 'RECTIFICATION', 'EFFACEMENT', 'PORTABILITE', 'OPPOSITION', 'LIMITATION'] },
  { prefixe: 'ADMIN.ANALYTICS.ALERTE_NIVEAU_', valeurs: ['ATTENTION', 'ALERTE', 'URGENCE'] },
  { prefixe: 'BRIS_DE_GLACE.MOTIF_', valeurs: ['URGENCE_VITALE', 'PATIENT_HORS_ETAT', 'CONTINUITE_DES_SOINS', 'VERIFICATION_AVANT_PRESCRIPTION', 'AUTRE'] },
  { prefixe: 'BRIS_DE_GLACE.REVUE_', valeurs: ['A_REVOIR', 'JUSTIFIE', 'INJUSTIFIE'] },
  { prefixe: 'MEDECIN.REFERENCEMENTS.FILTRE_', valeurs: ['EN_ATTENTE', 'ACCEPTE', 'REFUSE'] },
  { prefixe: 'MEDECIN.REFERENCEMENTS.URGENCE_', valeurs: ['ROUTINE', 'URGENT', 'URGENCE_VITALE'] },
  { prefixe: 'MEDECIN.REFERENCEMENTS.STATUT_', valeurs: ['EN_ATTENTE', 'ACCEPTE', 'REFUSE', 'COMPLETE'] },
  { prefixe: 'QR_SCANNER.ERR_', valeurs: ['INSECURE', 'PERMISSION', 'NO_CAMERA', 'GENERIC'] },
  { prefixe: 'PHARMACIEN.STOCKS.MOVEMENT_', valeurs: ['ENTREE', 'SORTIE', 'AJUSTEMENT', 'CORRECTION'] },
  { prefixe: 'ASSUREUR.CAT_', valeurs: ['MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE', 'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE'] },
  { prefixe: 'ASSUREUR.MODE_', valeurs: ['MANUEL', 'PORTAIL', 'API'] },
  { prefixe: 'ASSUREUR.STATUT_', valeurs: ['ACTIF', 'SUSPENDU', 'RESILIE', 'EXPIRE'] },
  { prefixe: 'PATIENT.PROFILE.STRUCTURE_TYPE_', valeurs: ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'] },
  { prefixe: 'PATIENT.PAIEMENTS.MODE_', valeurs: ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO'] },
  { prefixe: 'PHARMACIEN.COMMANDES.ETAT_', valeurs: ['RECHERCHE_PHARMACIE', 'PRISE_EN_CHARGE', 'A_PAYER', 'PAYEE', 'EN_PREPARATION', 'PRETE_POUR_RETRAIT', 'PRETE_POUR_LIVRAISON', 'RETIREE', 'CLOTUREE', 'SANS_PHARMACIE', 'ANNULEE'] },
  { prefixe: 'PHARMACIEN.COMMANDES.MODE_', valeurs: ['RETRAIT_PHARMACIE', 'LIVRAISON'] },
  { prefixe: 'PATIENT.COMMANDES.ETAT_', valeurs: ['RECHERCHE_PHARMACIE', 'PRISE_EN_CHARGE', 'A_PAYER', 'PAYEE', 'EN_PREPARATION', 'PRETE_POUR_RETRAIT', 'PRETE_POUR_LIVRAISON', 'RETIREE', 'CLOTUREE', 'SANS_PHARMACIE', 'ANNULEE'] },
  { prefixe: 'PATIENT.COMMANDES.CHOISI_', valeurs: ['RETRAIT_PHARMACIE', 'LIVRAISON'] },
  { prefixe: 'PATIENT.COMMANDES.MODE_', valeurs: ['RETRAIT_PHARMACIE', 'LIVRAISON'] },
  { prefixe: 'ADMIN.ASSURANCE.CAT_', valeurs: ['MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE', 'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE'] },
  { prefixe: 'ADMIN.ASSURANCE.STATUT_', valeurs: ['ACTIF', 'SUSPENDU', 'RESILIE', 'EXPIRE'] },
  { prefixe: 'LANDING.STRUCT_TYPE_', valeurs: ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE', 'PHARMACIE', 'LABORATOIRE', 'ASSURANCE'] },
  // Les trois groupes du choix de laboratoire, et les types que ce choix peut
  // rendre : le badge de l'ecran des conseillees construit sa cle a partir du
  // type renvoye par l'API, donc TYPES_RECEVEURS doit etre couvert en entier.
  { prefixe: 'LABO.CHOIX.GROUPE.', valeurs: ['INTERNE', 'CONSEILLE', 'AUTRE'] },
  // Le gabarit des pieces d'agrement construit `AGREMENT.PIECE.<TYPE>` **et**
  // `AGREMENT.PIECE.<TYPE>_AIDE` a l'execution : un suffixe oublie s'afficherait
  // en clair a l'ecran, au milieu d'un formulaire bloquant.
  { prefixe: 'AGREMENT.PIECE.', valeurs: ['AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE', 'AGREMENT_ASSURANCE', 'EXTRAIT_RCCM', 'PIECE_IDENTITE_RESPONSABLE', 'CERTIFICAT_RESIDENCE_RESPONSABLE', 'AUTRE'] },
  { prefixe: 'AGREMENT.PIECE.', valeurs: ['AGREMENT_CREATION_AIDE', 'AGREMENT_EXPLOITATION_AIDE', 'DIPLOME_RESPONSABLE_AIDE', 'INSCRIPTION_ORDRE_AIDE', 'AGREMENT_ASSURANCE_AIDE', 'EXTRAIT_RCCM_AIDE', 'PIECE_IDENTITE_RESPONSABLE_AIDE', 'CERTIFICAT_RESIDENCE_RESPONSABLE_AIDE', 'AUTRE_AIDE'] },
];

const cheminsLangues = Object.fromEntries(
  fichiers(I18N, ['.json'])
    .filter((chemin) => LANGUES.some((langue) => chemin.endsWith(`${langue}.json`)))
    .map((chemin) => [LANGUES.find((langue) => chemin.endsWith(`${langue}.json`))!, chemin]),
) as Record<(typeof LANGUES)[number], string>;

const tables = Object.fromEntries(
  LANGUES.map((langue) => [langue, JSON.parse(readFileSync(cheminsLangues[langue], 'utf8'))]),
) as Record<(typeof LANGUES)[number], Record<string, unknown>>;

function clesFeuilles(table: Record<string, unknown>, prefixe = ''): string[] {
  return Object.entries(table).flatMap(([clef, element]) => {
    const chemin = prefixe ? `${prefixe}.${clef}` : clef;
    return element && typeof element === 'object' && !Array.isArray(element)
      ? clesFeuilles(element as Record<string, unknown>, chemin)
      : [chemin];
  }).sort();
}

describe('les cles i18n construites a partir de valeurs enumerees', () => {
  it('trouve les deux catalogues sur disque', () => {
    expect(Object.keys(cheminsLangues).sort()).toEqual([...LANGUES].sort());
  });

  for (const langue of LANGUES) {
    it(`contient chaque suffixe dynamique en ${langue}`, () => {
      const manquantes = FAMILLES.flatMap(({ prefixe, valeurs }) =>
        valeurs.flatMap((suffixe) => {
          const clef = `${prefixe}${suffixe}`;
          const texte = valeur(tables[langue], clef);
          return typeof texte === 'string' && texte.trim() ? [] : [clef];
        }),
      );
      expect(manquantes).toEqual([]);
    });
  }

  it('maintient les catalogues francais et anglais a parite exacte', () => {
    expect(clesFeuilles(tables.fr)).toEqual(clesFeuilles(tables.en));
  });
});
