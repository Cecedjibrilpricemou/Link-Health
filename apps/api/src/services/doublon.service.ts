import { prisma } from '../config/prisma';
import { empreinteRecherche } from '../utils/encryption.utils';
import { JwtPayload } from '../types/auth.types';
import { assertCanAccessPatient } from './access-control.service';
import type { CandidatDoublonView, ParametresPaysView, TraitConcordant } from '@baobaoheath/shared-types';
import { PARAMETRES_PAR_DEFAUT, getValeursParametres } from './parametres.service';

/**
 * Detection de doublons de dossier patient (EF-01-05).
 *
 * **Pourquoi cela compte.** Un patient en double, c'est un dossier medical
 * coupe en deux : l'allergie notee d'un cote n'est pas vue de l'autre. Et
 * c'est un plafond d'assurance consomme deux fois.
 *
 * **Ce que ce service ne fait pas : fusionner.** Il propose des candidats a
 * un agent, qui decide. Une fusion automatique sur un score serait une faute
 * grave — fusionner deux personnes distinctes melange leurs dossiers
 * medicaux, et c'est bien plus dangereux que de laisser un doublon.
 *
 * ## Ce que les donnees reelles ont impose
 *
 * **La date de naissance ne vaut presque rien ici.** Dans la base du
 * 2026-10-04, **9 patients sur 10 portent le 1er janvier 2000** : c'est la
 * valeur que l'on saisit quand on ignore la date, pas une date. Un detecteur
 * qui lui donnerait le poids habituel signalerait ces neuf patients comme
 * doublons les uns des autres, et l'agent apprendrait a ignorer l'alerte —
 * ce qui est pire que pas d'alerte du tout.
 *
 * Ce sont donc **le nom de la mere et le lieu de naissance** qui tranchent,
 * exactement comme dans les registres d'etat civil. Ce sont aussi les deux
 * traits que l'ecran d'accueil recueille (EF-01-04).
 */

/** Au-dela, on parle d'un doublon probable. En deca mais au-dessus de SEUIL_A_VERIFIER, d'un doute. */
export const SEUIL_PROBABLE = 60;
export const SEUIL_A_VERIFIER = 40;

/**
 * Les dates manifestement saisies faute de mieux.
 *
 * Le 1er janvier est la convention quand seule l'annee est connue — parfois
 * meme quand rien n'est connu. On ne peut pas la traiter comme une date.
 */
export function estDateParDefaut(d: Date): boolean {
  return d.getUTCMonth() === 0 && d.getUTCDate() === 1;
}

/**
 * Comparaison de chaines tolerante a ce qui varie sans changer la personne :
 * accents, casse, espaces multiples, traits d'union.
 *
 * « Condé », « CONDE » et « Conde » designent la meme famille.
 */
export function normaliser(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** La numerotation du pays installe (parametres, section `pays`). */
export type Numerotation = Pick<ParametresPaysView, 'indicatifTelephone' | 'longueurNumero'>;

/**
 * Le numero national : ses chiffres, sans indicatif ni separateurs.
 * « +224 627 08 26 02 », « 00224627082602 » et « 627082602 » sont le meme
 * numero.
 *
 * R14 : on retire l'indicatif **du pays installe**, et le « 0 » que certains
 * pays mettent devant le numero national (« 0803... » au Nigeria). Garder les
 * 9 derniers chiffres etait une regle guineenne : dans un pays a 10 chiffres,
 * elle tronquait le numero enregistre et confondait deux numeros differents.
 *
 * L'indicatif n'est retire que si le numero est ecrit en international (« + »
 * ou « 00 ») ou s'il a exactement la longueur indicatif + numero : un numero
 * national qui commencerait par les memes chiffres reste intact.
 */
export function normaliserTelephone(v: string, n: Numerotation = PARAMETRES_PAR_DEFAUT.pays): string {
  const brut = (v ?? '').trim();
  let chiffres = brut.replace(/\D/g, '');
  const indicatif = n.indicatifTelephone.replace(/\D/g, '');
  const international = brut.startsWith('+') || chiffres.startsWith('00');
  if (chiffres.startsWith('00')) chiffres = chiffres.slice(2);
  if (indicatif && chiffres.startsWith(indicatif)
    && (international || chiffres.length === indicatif.length + n.longueurNumero)) {
    chiffres = chiffres.slice(indicatif.length);
  }
  if (chiffres.length === n.longueurNumero + 1 && chiffres.startsWith('0')) chiffres = chiffres.slice(1);
  return chiffres;
}

/**
 * Les mots d'un nom complet.
 *
 * **L'ordre n'a pas d'importance** — « Conde Maomou » et « Maomou Conde »
 * designent la meme personne, et c'est frequent : le nom de famille passe
 * devant ou derriere selon le guichet. Mais cette insensibilite ne vient pas
 * d'un tri ici : elle vient de `nomsConcordants`, qui apparie les mots deux a
 * deux sans regarder leur position. Un tri etait present et donnait
 * l'impression de porter cette garantie ; le retirer n'a change aucun
 * resultat, ce qui l'a prouve inutile.
 */
function motsDuNom(prenom: string, nom: string): string[] {
  return normaliser(`${prenom} ${nom}`).split(' ').filter(Boolean);
}

/** Distance d'edition. Combien de lettres separent deux mots. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let coinHautGauche = precedente[0]!;
    precedente[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const avant = precedente[j]!;
      precedente[j] = Math.min(
        precedente[j]! + 1,
        precedente[j - 1]! + 1,
        coinHautGauche + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      coinHautGauche = avant;
    }
  }
  return precedente[b.length]!;
}

/**
 * Deux ecritures du meme nom ?
 *
 * **Pourquoi cette tolerance est indispensable ici.** Les noms sont
 * transcrits a l'oreille, et varient d'un guichet a l'autre : « Conde » et
 * « Konde », « Diallo » et « Dialo », « Maomou » et « Maoumou ». Sans
 * tolerance, « Mamadou Diallo » et « Mamadou Dialo » — une lettre — etaient
 * traites comme deux personnes sans rapport. C'est pourtant ainsi que
 * naissent la plupart des doublons.
 *
 * **Pourquoi elle reste etroite.** Une lettre pour un mot court, deux pour un
 * mot long. Au-dela, on rapprocherait des prenoms reellement distincts, et
 * une fusion a tort melange deux dossiers medicaux.
 */
export function memeMotEcritAutrement(a: string, b: string): boolean {
  if (a === b) return true;
  const tolerance = Math.max(a.length, b.length) > 6 ? 2 : 1;
  // Une difference de longueur superieure a la tolerance ne peut pas se
  // rattraper : on evite le calcul.
  if (Math.abs(a.length - b.length) > tolerance) return false;
  return distance(a, b) <= tolerance;
}

/**
 * Les deux noms designent-ils la meme personne, a l'orthographe pres ?
 *
 * Tous les mots doivent se correspondre, et **un seul** peut varier. Deux
 * variations, ce ne sont plus deux ecritures d'un nom mais deux noms.
 */
function nomsConcordants(motsA: string[], motsB: string[]): 'IDENTIQUE' | 'VARIANTE' | null {
  if (motsA.length !== motsB.length || motsA.length === 0) return null;

  const restants = [...motsB];
  let variations = 0;
  for (const mot of motsA) {
    const exact = restants.indexOf(mot);
    if (exact !== -1) { restants.splice(exact, 1); continue; }

    const proche = restants.findIndex((r) => memeMotEcritAutrement(mot, r));
    if (proche === -1) return null;
    restants.splice(proche, 1);
    variations++;
    if (variations > 1) return null;
  }
  return variations === 0 ? 'IDENTIQUE' : 'VARIANTE';
}

export type PersonneAComparer = {
  prenom: string;
  nom: string;
  telephone: string;
  dateNaissance: Date;
  lieuNaissance?: string | null;
  nomMere?: string | null;
};

/**
 * Le score de ressemblance entre deux personnes, et ce qui l'a produit.
 *
 * Fonction pure, exportee : c'est elle qui decide ce qu'un agent verra, et
 * une erreur ici ne se remarque pas — elle rend simplement moins de
 * candidats, ou trop.
 *
 * Les poids ne sont pas des reglages fins : ils disent un ordre
 * d'importance. Le nom de la mere vaut plus que tout parce que deux
 * personnes sans lien partagent rarement leur mere ; la date vaut peu parce
 * qu'elle est souvent fausse.
 */
export function comparer(
  a: PersonneAComparer,
  b: PersonneAComparer,
  numerotation: Numerotation = PARAMETRES_PAR_DEFAUT.pays,
): { score: number; traits: TraitConcordant[] } {
  const traits: TraitConcordant[] = [];
  let score = 0;

  const motsA = motsDuNom(a.prenom, a.nom);
  const motsB = motsDuNom(b.prenom, b.nom);
  const communs = motsA.filter((m) => motsB.includes(m));

  const concordance = nomsConcordants(motsA, motsB);
  if (concordance === 'IDENTIQUE') {
    // Meme nom, quel que soit l'ordre. « Conde Maomou » et « Maomou Conde ».
    score += 30;
    traits.push('NOM_IDENTIQUE');
  } else if (concordance === 'VARIANTE') {
    // Une seule lettre d'ecart : « Diallo » et « Dialo ». Moins que
    // l'identite, parce que « Mamadou » et « Amadou » tombent aussi dans
    // cette categorie et peuvent etre deux freres.
    score += 22;
    traits.push('NOM_VARIANTE');
  } else if (communs.length > 0 && communs.length >= Math.min(motsA.length, motsB.length)) {
    // L'un est contenu dans l'autre : « Maomou Conde » et « Maomou Aissata Conde ».
    score += 20;
    traits.push('NOM_PROCHE');
  }

  const mereA = a.nomMere ? normaliser(a.nomMere) : '';
  const mereB = b.nomMere ? normaliser(b.nomMere) : '';
  if (mereA && mereA === mereB) {
    // **Le trait le plus discriminant.** Deux personnes sans lien partagent
    // rarement le nom de leur mere.
    score += 45;
    traits.push('MERE_IDENTIQUE');
  }

  const lieuA = a.lieuNaissance ? normaliser(a.lieuNaissance) : '';
  const lieuB = b.lieuNaissance ? normaliser(b.lieuNaissance) : '';
  if (lieuA && lieuA === lieuB) {
    score += 25;
    traits.push('LIEU_IDENTIQUE');
  }

  const memeDate = a.dateNaissance.getTime() === b.dateNaissance.getTime();
  if (memeDate) {
    // Une date par defaut partagee n'apprend presque rien : 9 patients sur 10
    // portent le 1er janvier dans la base du 2026-10-04.
    const parDefaut = estDateParDefaut(a.dateNaissance);
    score += parDefaut ? 5 : 25;
    traits.push(parDefaut ? 'DATE_PAR_DEFAUT' : 'DATE_IDENTIQUE');
  }

  const telA = normaliserTelephone(a.telephone, numerotation);
  const telB = normaliserTelephone(b.telephone, numerotation);
  if (telA && telA === telB) {
    // Fort, mais pas decisif : un telephone familial est partage, et c'est
    // frequent. Une mere qui inscrit ses trois enfants donne son numero trois
    // fois — ce ne sont pas des doublons.
    score += 20;
    traits.push('TELEPHONE_IDENTIQUE');
  }

  // ── La regle qui empeche de fusionner deux freres ─────────────────
  //
  // **Sans concordance de nom, on ne conclut jamais.** Deux freres partagent
  // leur mere, leur lieu de naissance et le telephone familial ; des jumeaux
  // partagent en plus leur date. Tout concorde sauf le prenom — et le score
  // atteignait 115, bien au-dela du seuil « probable ».
  //
  // Fusionner deux freres melangerait leurs dossiers medicaux. C'est
  // exactement le danger que ce service doit eviter, et c'est pourquoi la
  // regle est une borne et non un poids : aucune accumulation de traits
  // familiaux ne doit pouvoir franchir le seuil toute seule.
  //
  // Le cas reste signale — un agent doit le regarder — mais il ne sera jamais
  // annonce comme probable. Trouve par un test ecrit avant la correction.
  // **Une variante d'orthographe ne conclut jamais.** « Aissatou » et
  // « Aissata » : variante d'ecriture, ou deux soeurs ? « Mamadou » et
  // « Amadou » : la meme personne mal transcrite, ou deux freres ? La machine
  // ne peut pas trancher, et personne ne le peut sans regarder le dossier.
  //
  // Sans cette exclusion, deux freres atteignaient 117 et etaient annonces
  // comme doublons probables — verifie avant correction. Fusionner deux
  // freres melangerait leurs dossiers medicaux.
  //
  // Le cas n'est pas tu pour autant : il remonte a 59, en tete de liste, avec
  // tous ses traits affiches. Un agent regarde et decide. L'asymetrie est
  // voulue — manquer un doublon se rattrape, fusionner deux personnes non.
  const nomConcorde = traits.includes('NOM_IDENTIQUE') || traits.includes('NOM_PROCHE');
  if (!nomConcorde) {
    score = Math.min(score, SEUIL_PROBABLE - 1);
    if (score >= SEUIL_A_VERIFIER) {
      // Deux raisons de ne pas conclure, qui ne se disent pas de la meme
      // facon a l'agent. Les confondre lui ferait lire le contraire de ce
      // qu'il a sous les yeux.
      traits.push(
        traits.includes('NOM_VARIANTE') ? 'ORTHOGRAPHE_A_CONFIRMER' : 'SANS_CONCORDANCE_DE_NOM'
      );
    }
  }

  return { score, traits };
}

/**
 * Les dossiers qui pourraient etre la meme personne.
 *
 * On ne compare pas tout le monde a tout le monde : un candidat doit d'abord
 * partager **un mot de nom ou un numero** avec la personne cherchee. Sans ce
 * filtre, chaque creation de dossier balaierait la table entiere, et la
 * ressemblance par date par defaut ferait remonter n'importe qui.
 */
/**
 * Le debut d'un mot, pour retrouver une variante d'ecriture en SQL.
 *
 * **Sans cela, la tolerance d'orthographe etait inatteignable depuis la
 * route.** Le pre-filtre cherchait les mots du nom par egalite de sous-chaine :
 * « Dialo » ne se trouve pas dans « Diallo », donc le candidat n'etait jamais
 * ramene de la base, et `memeMotEcritAutrement` n'avait jamais l'occasion de
 * dire qu'il s'agissait du meme nom. Tout etait vert en test unitaire — les
 * mocks rendaient le candidat — et muet en service. Trouve en appelant la
 * vraie API, le 2026-10-04.
 *
 * Quatre lettres : assez pour que « Mohamed » et « Mohamadou » se croisent,
 * assez peu pour ne pas ramener la table entiere. Un mot plus court est pris
 * en entier.
 */
function debutDeMot(mot: string): string {
  return mot.length <= 4 ? mot : mot.slice(0, 4);
}

export async function chercher(
  personne: PersonneAComparer,
  options: { exclureId?: string; limite?: number } = {}
): Promise<CandidatDoublonView[]> {
  const mots = motsDuNom(personne.prenom, personne.nom);
  const { pays: numerotation } = await getValeursParametres();
  const tel = normaliserTelephone(personne.telephone, numerotation);
  // R4 : le nom de la mere est chiffre en base ; on compare son empreinte.
  // Normalisee sans accents ni casse, elle rapproche aussi « Condé » et « conde ».
  const empreinteMere = empreinteRecherche(personne.nomMere);

  const candidats = await prisma.patientProfile.findMany({
    where: {
      ...(options.exclureId ? { id: { not: options.exclureId } } : {}),
      // Un dossier deja fusionne n'est plus un doublon a traiter : le
      // proposer indefiniment apprendrait a l'agent a ignorer la liste.
      idFusionneDans: null,
      OR: [
        ...mots.map((m) => ({
          utilisateur: {
            OR: [
              { nom: { contains: debutDeMot(m), mode: 'insensitive' as const } },
              { prenom: { contains: debutDeMot(m), mode: 'insensitive' as const } },
            ],
          },
        })),
        ...(tel ? [{ utilisateur: { telephone: { contains: tel } } }] : []),
        // **Le nom de la mere ramene les cas ou plus aucun mot du nom ne
        // correspond** : « Konde Maoumou » et « Conde Maomou » ne partagent
        // aucun debut de mot, la premiere lettre differe. Ce sont pourtant les
        // doublons les plus probables, et le nom de la mere est justement le
        // trait le plus discriminant. Le lieu de naissance, lui, reste hors du
        // pre-filtre : « Conakry » ramenerait presque toute la table.
        ...(empreinteMere ? [{ nomMereEmpreinte: empreinteMere }] : []),
      ],
    },
    select: {
      id: true, dateNaissance: true, lieuNaissance: true, nomMere: true,
      niveauIdentite: true, prefecture: true,
      utilisateur: { select: { prenom: true, nom: true, telephone: true } },
    },
    // Borne de securite : au-dela, ce n'est plus une recherche de doublon
    // mais un balayage, et l'agent ne lira pas cent lignes de toute facon.
    take: 100,
  });

  const vues: CandidatDoublonView[] = [];
  for (const c of candidats) {
    const { score, traits } = comparer(personne, {
      prenom: c.utilisateur.prenom,
      nom: c.utilisateur.nom,
      telephone: c.utilisateur.telephone,
      dateNaissance: c.dateNaissance,
      lieuNaissance: c.lieuNaissance,
      nomMere: c.nomMere,
    }, numerotation);
    if (score < SEUIL_A_VERIFIER) continue;

    vues.push({
      id: c.id,
      nomComplet: `${c.utilisateur.prenom} ${c.utilisateur.nom}`,
      telephone: c.utilisateur.telephone,
      dateNaissance: c.dateNaissance.toISOString(),
      lieuNaissance: c.lieuNaissance,
      nomMere: c.nomMere,
      prefecture: c.prefecture,
      niveauIdentite: c.niveauIdentite,
      score,
      probable: score >= SEUIL_PROBABLE,
      traits,
    });
  }

  // Le plus ressemblant d'abord : c'est celui qu'un agent doit regarder.
  vues.sort((x, y) => y.score - x.score);
  return vues.slice(0, options.limite ?? 10);
}

/**
 * Les doublons d'un dossier existant, depuis l'ecran des identites.
 *
 * **Rend `null` si le dossier n'existe pas**, et non une liste vide : une
 * liste vide se lit « ce patient n'a pas de doublon », ce qui serait affirmer
 * quelque chose de faux sur un dossier qu'on n'a pas trouve. La route en fait
 * un 404. Trouve en appelant la vraie API avec un identifiant invente.
 */
/** Les doublons possibles d'un patient **de sa structure**. */
export async function pourPatient(
  user: JwtPayload,
  idPatient: string,
): Promise<CandidatDoublonView[] | null> {
  // Sans ce controle, la liste des doublons d'un patient de n'importe quel
  // etablissement etait lisible : elle porte nom, telephone et date de
  // naissance de chaque candidat.
  await assertCanAccessPatient(user, idPatient);

  const p = await prisma.patientProfile.findUnique({
    where: { id: idPatient },
    select: {
      id: true, dateNaissance: true, lieuNaissance: true, nomMere: true,
      utilisateur: { select: { prenom: true, nom: true, telephone: true } },
    },
  });
  if (!p) return null;

  return chercher(
    {
      prenom: p.utilisateur.prenom,
      nom: p.utilisateur.nom,
      telephone: p.utilisateur.telephone,
      dateNaissance: p.dateNaissance,
      lieuNaissance: p.lieuNaissance,
      nomMere: p.nomMere,
    },
    { exclureId: p.id }
  );
}
