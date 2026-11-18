// src/services/referentiel.service.ts
//
// Import des referentiels (EF-12-03).
//
// Pourquoi ce bloc conditionne les autres : `interactions_medicaments` est
// **vide**. `trouverInteraction` interroge donc une table sans ligne, et
// l'alerte d'interaction de `analyserPrescription` ne peut structurellement
// jamais se declencher — une securite qui existe en code et reste
// decorative. Sans import, elle le restera.
//
// La regle qui gouverne tout ce fichier vient de la feuille de route :
// **« un import qui echoue en silence sur trois lignes est pire que pas
// d'import »**. Chaque ligne recoit donc un verdict, et l'appelant peut
// demander une **simulation** qui valide sans rien ecrire.
import { CategorieProduit, NiveauInteraction } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { ValidationError } from '../utils/app-error';
import { empreinteCatalogue } from '../utils/catalogue';
import { normaliser } from './prescription-securite.service';
import type { LigneImportView, RapportImportView, TypeReferentiel } from '@baobaoheath/shared-types';

/** Ce qu'une ligne de CSV donne apres analyse : ses colonnes, par en-tete. */
export type LigneCsv = Record<string, string>;

/**
 * Une ligne de donnees et **son rang dans le fichier de l'operateur**.
 *
 * Le rang ne peut pas se deduire de la position dans le tableau : Excel laisse
 * des lignes vides, qu'on ignore, et un champ entre guillemets peut occuper
 * plusieurs lignes physiques. Sans ce numero, le rapport renvoie l'operateur a
 * la mauvaise ligne de son tableur — d'autant plus loin qu'il y a de trous.
 * Un rapport qui designe la mauvaise ligne est pire qu'un rapport muet : on
 * corrige une ligne saine et on laisse la fautive.
 */
export type EnregistrementCsv = {
  /** 1 pour l'en-tete, donc 2 pour la premiere donnee d'un fichier sans trou. */
  numero: number;
  champs: LigneCsv;
};

export type Csv = {
  separateur: string;
  entetes: string[];
  lignes: EnregistrementCsv[];
};

/**
 * Analyse un CSV.
 *
 * Trois details qui font echouer un import reel et qu'on traite ici :
 *
 *   - **le BOM UTF-8** qu'Excel ajoute en tete de fichier. Il tombe avec le
 *     `trim()` des en-tetes : en JavaScript, U+FEFF compte comme une espace,
 *     donc `'﻿code'.trim()` vaut `'code'`. Aucun nettoyage explicite
 *     n'est necessaire — un sabotage l'a montre, en ne faisant echouer aucun
 *     test. Tant qu'un `trim()` global rognait aussi le texte entier, les deux
 *     protegeaient en double et aucun sabotage ne pouvait faire tomber le test
 *     du BOM ; ce `trim()` global a ete retire pour ne pas decaler les numeros
 *     de ligne, et le `trim()` des en-tetes est desormais seul a tenir ;
 *   - **le separateur** : Excel en francais exporte en point-virgule, les
 *     outils anglophones en virgule. On le deduit de la ligne d'en-tete ;
 *   - **les guillemets** : un libelle peut contenir le separateur. Un
 *     guillemet double a l'interieur represente un guillemet.
 */
export function analyserCsv(contenu: string): Csv {
  // On normalise les fins de ligne sans rien couper en tete : un `trim()`
  // global supprimerait les lignes vides initiales et decalerait tous les
  // numeros rendus a l'operateur. Seule la fin est rognee, pour qu'un retour
  // final ne compte pas comme une ligne de donnees.
  const texte = contenu.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (!texte.trim()) throw new ValidationError('Le fichier est vide');

  // La ligne d'en-tete est la premiere ligne non vide, pas la premiere ligne
  // du fichier : sinon un fichier commencant par une ligne blanche verrait son
  // separateur deduit du vide, et l'en-tete entier deviendrait une seule
  // colonne. Trouve en ecrivant le test des lignes vides en tete.
  const premiereLigne = texte.split('\n').find((l) => l.trim() !== '') ?? '';
  // Le separateur est celui qui apparait le plus dans l'en-tete. A egalite,
  // le point-virgule gagne : c'est ce qu'exporte Excel en francais.
  const virgules = (premiereLigne.match(/,/g) ?? []).length;
  const pointsVirgules = (premiereLigne.match(/;/g) ?? []).length;
  const separateur = pointsVirgules >= virgules && pointsVirgules > 0 ? ';' : ',';

  const lignesBrutes = decouperLignes(texte, separateur);
  const estVide = (champs: string[]) => champs.every((c) => c.trim() === '');

  // L'en-tete est le premier enregistrement non vide : un fichier qui commence
  // par une ligne blanche reste lisible, et les numeros restent justes.
  const indexEntete = lignesBrutes.findIndex((e) => !estVide(e.champs));
  const entetes = (lignesBrutes[indexEntete]?.champs ?? []).map((e) => e.trim().toLowerCase());
  if (entetes.length === 0 || entetes.every((e) => !e)) {
    throw new ValidationError("La premiere ligne doit porter les noms de colonnes");
  }

  const lignes: EnregistrementCsv[] = [];
  for (const brute of lignesBrutes.slice(indexEntete + 1)) {
    // Une ligne entierement vide est ignoree : Excel en laisse souvent une.
    // Son rang, lui, n'est pas reattribue a la ligne suivante.
    if (estVide(brute.champs)) continue;
    const champs: LigneCsv = {};
    entetes.forEach((entete, i) => {
      champs[entete] = (brute.champs[i] ?? '').trim();
    });
    lignes.push({ numero: brute.numero, champs });
  }

  return { separateur, entetes, lignes };
}

/**
 * Decoupe en respectant les guillemets, y compris sur plusieurs lignes, et
 * rend pour chaque enregistrement **la ligne physique ou il commence**.
 *
 * Le compteur avance a chaque saut de ligne, y compris a l'interieur d'un
 * champ entre guillemets : un enregistrement etale sur trois lignes decale
 * bien de trois celui qui le suit.
 */
function decouperLignes(texte: string, separateur: string): { numero: number; champs: string[] }[] {
  const lignes: { numero: number; champs: string[] }[] = [];
  let champs: string[] = [];
  let courant = '';
  let entreGuillemets = false;
  let ligneCourante = 1;
  let debut = 1;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];

    if (entreGuillemets) {
      if (c === '"') {
        // Un guillemet double represente un guillemet litteral.
        if (texte[i + 1] === '"') {
          courant += '"';
          i++;
        } else {
          entreGuillemets = false;
        }
      } else {
        // Un saut de ligne a l'interieur des guillemets fait partie du champ,
        // mais compte pour la numerotation : l'operateur le voit dans son
        // tableur.
        if (c === '\n') ligneCourante++;
        courant += c;
      }
      continue;
    }

    if (c === '"') { entreGuillemets = true; continue; }
    if (c === separateur) { champs.push(courant); courant = ''; continue; }
    if (c === '\n') {
      champs.push(courant);
      lignes.push({ numero: debut, champs });
      champs = [];
      courant = '';
      ligneCourante++;
      debut = ligneCourante;
      continue;
    }
    courant += c;
  }

  champs.push(courant);
  lignes.push({ numero: debut, champs });
  return lignes;
}

/** Les colonnes attendues par referentiel, pour refuser tot et clairement. */
const COLONNES: Record<TypeReferentiel, { obligatoires: string[]; cle: string }> = {
  examens: { obligatoires: ['codeloinc', 'libelle', 'categorie', 'specimen'], cle: 'codeloinc' },
  interactions: { obligatoires: ['dcia', 'dcib', 'niveau', 'description'], cle: 'dcia + dcib' },
  medicaments: { obligatoires: ['libelle'], cle: 'libelle' },
};

function verifierColonnes(type: TypeReferentiel, entetes: string[]): void {
  const manquantes = COLONNES[type].obligatoires.filter((c) => !entetes.includes(c));
  if (manquantes.length > 0) {
    throw new ValidationError(
      `Colonnes manquantes pour « ${type} » : ${manquantes.join(', ')}. ` +
        `Colonnes attendues : ${COLONNES[type].obligatoires.join(', ')}.`
    );
  }
}

/** Entier optionnel : une cellule vide vaut « non renseigne », pas zero. */
function entier(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function decimal(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function booleen(v: string | undefined): boolean {
  return ['1', 'oui', 'true', 'vrai', 'o', 'x'].includes((v ?? '').trim().toLowerCase());
}

/**
 * Importe un referentiel.
 *
 * `simulation` valide tout et n'ecrit rien : c'est ce qu'on lance avant un
 * import reel, pour voir les refus sans toucher a la base.
 *
 * Les lignes valides sont appliquees meme si d'autres sont refusees. Rejeter
 * deux mille bonnes lignes pour trois mauvaises serait pire — mais rien n'est
 * silencieux : chaque refus figure au rapport avec son motif.
 */
export async function importerReferentiel(
  type: TypeReferentiel,
  contenu: string,
  simulation = false
): Promise<RapportImportView> {
  const csv = analyserCsv(contenu);
  verifierColonnes(type, csv.entetes);

  const lignes: LigneImportView[] = [];
  let creees = 0;
  let misesAJour = 0;

  for (const enregistrement of csv.lignes) {
    // Le numero vient du decoupage, pas de la position dans le tableau : il
    // designe la ligne que l'operateur voit dans son tableur, lignes vides et
    // champs multilignes compris.
    const numero = enregistrement.numero;
    const ligne = enregistrement.champs;

    try {
      const resultat = await importerUneLigne(type, ligne, simulation);
      lignes.push({ ligne: numero, cle: resultat.cle, statut: resultat.statut });
      if (resultat.statut === 'CREEE') creees++;
      if (resultat.statut === 'MISE_A_JOUR') misesAJour++;
    } catch (e: unknown) {
      lignes.push({
        ligne: numero,
        cle: cleLisible(type, ligne),
        statut: 'REFUSEE',
        motif: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const refusees = lignes.filter((l) => l.statut === 'REFUSEE').length;
  return {
    type,
    simulation,
    total: lignes.length,
    creees,
    misesAJour,
    refusees,
    lignes,
  };
}

function cleLisible(type: TypeReferentiel, ligne: LigneCsv): string {
  if (type === 'examens') return ligne['codeloinc'] ?? '';
  if (type === 'interactions') return `${ligne['dcia'] ?? ''} / ${ligne['dcib'] ?? ''}`;
  return ligne['libelle'] ?? '';
}

type Resultat = { cle: string; statut: 'CREEE' | 'MISE_A_JOUR' };

async function importerUneLigne(
  type: TypeReferentiel,
  ligne: LigneCsv,
  simulation: boolean
): Promise<Resultat> {
  if (type === 'examens') return importerExamen(ligne, simulation);
  if (type === 'interactions') return importerInteraction(ligne, simulation);
  return importerMedicament(ligne, simulation);
}

const CATEGORIES_PRODUIT = new Set<string>(Object.values(CategorieProduit));

// ── Examens (LOINC) ──────────────────────────────────────────────────

async function importerExamen(ligne: LigneCsv, simulation: boolean): Promise<Resultat> {
  const codeLoinc = (ligne['codeloinc'] ?? '').trim();
  if (!codeLoinc) throw new ValidationError('codeLoinc manquant');
  const libelle = (ligne['libelle'] ?? '').trim();
  if (!libelle) throw new ValidationError('libelle manquant');
  const categorie = (ligne['categorie'] ?? '').trim().toUpperCase();
  if (!categorie) throw new ValidationError('categorie manquante');
  const specimen = (ligne['specimen'] ?? '').trim().toUpperCase();
  if (!specimen) throw new ValidationError('specimen manquant');

  const nombres = {
    prixGnf: entier(ligne['prixgnf']),
    refMin: decimal(ligne['refmin']),
    refMax: decimal(ligne['refmax']),
    critiqueMin: decimal(ligne['critiquemin']),
    critiqueMax: decimal(ligne['critiquemax']),
  };
  for (const [nom, valeur] of Object.entries(nombres)) {
    if (Number.isNaN(valeur)) throw new ValidationError(`${nom} n'est pas un nombre`);
  }

  // Un intervalle inverse passerait inapercu et rendrait tout resultat
  // « anormal » ou aucun : on le refuse a l'import.
  if (nombres.refMin !== null && nombres.refMax !== null && nombres.refMin > nombres.refMax) {
    throw new ValidationError('refMin est superieur a refMax');
  }
  if (nombres.critiqueMin !== null && nombres.critiqueMax !== null && nombres.critiqueMin > nombres.critiqueMax) {
    throw new ValidationError('critiqueMin est superieur a critiqueMax');
  }

  const donnees = {
    libelle,
    categorie,
    specimen,
    unite: (ligne['unite'] ?? '').trim() || null,
    aJeun: booleen(ligne['ajeun']),
    consignes: (ligne['consignes'] ?? '').trim() || null,
    prixGnf: nombres.prixGnf,
    refMin: nombres.refMin,
    refMax: nombres.refMax,
    refTexte: (ligne['reftexte'] ?? '').trim() || null,
    critiqueMin: nombres.critiqueMin,
    critiqueMax: nombres.critiqueMax,
    actif: ligne['actif'] === undefined || ligne['actif'].trim() === '' ? true : booleen(ligne['actif']),
  };

  const existant = await prisma.examen.findUnique({ where: { codeLoinc }, select: { id: true } });
  if (simulation) return { cle: codeLoinc, statut: existant ? 'MISE_A_JOUR' : 'CREEE' };

  await prisma.examen.upsert({
    where: { codeLoinc },
    update: donnees,
    create: { codeLoinc, ...donnees },
  });
  return { cle: codeLoinc, statut: existant ? 'MISE_A_JOUR' : 'CREEE' };
}

// ── Interactions medicamenteuses ─────────────────────────────────────

/**
 * Importe une interaction.
 *
 * **Les DCI sont normalisees et la paire est ordonnee.** C'est ce qui rend
 * l'import utile : `trouverInteraction` normalise ses arguments avant
 * d'interroger, donc une paire stockee « Methotrexate / Aspirine » telle
 * quelle ne serait jamais trouvee. Ordonner evite en plus que (A,B) et (B,A)
 * coexistent, ce que la contrainte d'unicite autoriserait.
 */
async function importerInteraction(ligne: LigneCsv, simulation: boolean): Promise<Resultat> {
  const brutA = (ligne['dcia'] ?? '').trim();
  const brutB = (ligne['dcib'] ?? '').trim();
  if (!brutA || !brutB) throw new ValidationError('dciA et dciB sont obligatoires');

  const a = normaliser(brutA);
  const b = normaliser(brutB);
  if (!a || !b) throw new ValidationError('dciA et dciB sont obligatoires');
  if (a === b) throw new ValidationError('dciA et dciB designent la meme molecule');

  const niveauBrut = (ligne['niveau'] ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!Object.values(NiveauInteraction).includes(niveauBrut as NiveauInteraction)) {
    throw new ValidationError(
      `niveau « ${ligne['niveau'] ?? ''} » inconnu. Attendu : ${Object.values(NiveauInteraction).join(', ')}`
    );
  }

  const description = (ligne['description'] ?? '').trim();
  if (!description) throw new ValidationError('description manquante');

  const [dciA, dciB] = [a, b].sort();
  const donnees = {
    niveau: niveauBrut as NiveauInteraction,
    description,
    conduite: (ligne['conduite'] ?? '').trim() || null,
    source: (ligne['source'] ?? '').trim() || null,
  };

  const existant = await prisma.interactionMedicament.findUnique({
    where: { dciA_dciB: { dciA: dciA!, dciB: dciB! } },
    select: { id: true },
  });
  const cle = `${dciA} / ${dciB}`;
  if (simulation) return { cle, statut: existant ? 'MISE_A_JOUR' : 'CREEE' };

  await prisma.interactionMedicament.upsert({
    where: { dciA_dciB: { dciA: dciA!, dciB: dciB! } },
    update: donnees,
    create: { dciA: dciA!, dciB: dciB!, ...donnees },
  });
  return { cle, statut: existant ? 'MISE_A_JOUR' : 'CREEE' };
}

// ── Catalogue de produits ────────────────────────────────────────────

async function importerMedicament(ligne: LigneCsv, simulation: boolean): Promise<Resultat> {
  const libelle = (ligne['libelle'] ?? '').trim();
  if (!libelle) throw new ValidationError('libelle manquant');

  const categorieBrute = (ligne['categorie'] ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const categorie = (categorieBrute || 'MEDICAMENT') as CategorieProduit;
  if (!CATEGORIES_PRODUIT.has(categorie)) {
    throw new ValidationError(
      `categorie « ${ligne['categorie'] ?? ''} » inconnue. Attendu : ${[...CATEGORIES_PRODUIT].join(', ')}`
    );
  }

  const dci = (ligne['dci'] ?? '').trim() || null;
  const forme = (ligne['forme'] ?? '').trim() || null;
  const dosage = (ligne['dosage'] ?? '').trim() || null;

  // Le meme invariant que la contrainte SQL `medicaments_medicament_complet`,
  // verifie ici pour que l'operateur lise un motif plutot qu'une erreur de
  // base de donnees.
  if (categorie === 'MEDICAMENT' && (!dci || !forme || !dosage)) {
    throw new ValidationError('un MEDICAMENT exige dci, forme et dosage');
  }

  const prix = entier(ligne['prixunitairegnf']);
  if (Number.isNaN(prix)) throw new ValidationError("prixUnitaireGnf n'est pas un nombre");
  if (prix !== null && prix < 0) throw new ValidationError('prixUnitaireGnf est negatif');

  const donnees = {
    categorie,
    dci,
    nomCommercial: (ligne['nomcommercial'] ?? '').trim() || null,
    forme,
    dosage,
    classeTherapeutique: (ligne['classetherapeutique'] ?? '').trim() || null,
    codeAtc: (ligne['codeatc'] ?? '').trim().toUpperCase() || null,
    prixUnitaireGnf: prix ?? 0,
    estReglemente: booleen(ligne['estreglemente']),
    listeEssentielle: booleen(ligne['listeessentielle']),
    contreIndications: (ligne['contreindications'] ?? '')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean),
  };

  // A1 : le texte de recherche suit le produit a chaque import. Sans cela,
  // un catalogue remplace en masse redeviendrait introuvable des qu'on
  // l'ecrit sans accents.
  const avecRecherche = {
    ...donnees,
    rechercheTexte: empreinteCatalogue({ libelle, ...donnees }),
  };

  const existant = await prisma.medicament.findFirst({ where: { libelle }, select: { id: true } });
  if (simulation) return { cle: libelle, statut: existant ? 'MISE_A_JOUR' : 'CREEE' };

  if (existant) {
    await prisma.medicament.update({ where: { id: existant.id }, data: avecRecherche });
    return { cle: libelle, statut: 'MISE_A_JOUR' };
  }
  await prisma.medicament.create({ data: { libelle, ...avecRecherche } });
  return { cle: libelle, statut: 'CREEE' };
}

/** Les colonnes attendues, pour qu'un operateur sache quoi preparer. */
export function colonnesAttendues(type: TypeReferentiel): { obligatoires: string[]; facultatives: string[] } {
  const facultatives: Record<TypeReferentiel, string[]> = {
    examens: ['unite', 'aJeun', 'consignes', 'prixGnf', 'refMin', 'refMax', 'refTexte', 'critiqueMin', 'critiqueMax', 'actif'],
    interactions: ['conduite', 'source'],
    medicaments: ['categorie', 'dci', 'nomCommercial', 'forme', 'dosage', 'classeTherapeutique', 'codeAtc', 'prixUnitaireGnf', 'estReglemente', 'listeEssentielle', 'contreIndications'],
  };
  return { obligatoires: COLONNES[type].obligatoires, facultatives: facultatives[type] };
}
