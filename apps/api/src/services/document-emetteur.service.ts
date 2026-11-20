// L'en-tete des documents imprimes : la structure qui les emet.
//
// **Une ordonnance de l'hopital Donka porte le nom de l'hopital Donka**, son
// logo et ses coordonnees - pas celui de la plateforme. Le patient le montre
// au pharmacien, a l'assurance, au medecin suivant : c'est l'etablissement
// qui engage sa signature.
//
// **Une ligne discrete en pied de page** dit ou verifier le document : le
// code d'une ordonnance se controle sur la plateforme.
//
// Sans structure (une consultation d'agent de sante rattache a aucune), le
// document garde l'identite de la plateforme.
import type { IdentitePlateformeView } from '@baobaoheath/shared-types';
import { prisma } from '../config/prisma';
import { getIdentitePlateforme } from './parametres.service';

/** Ce que les gabarits de documents lisent : nom, logo, coordonnees, pied de page. */
export type IdentiteDocument = Pick<IdentitePlateformeView, 'nom' | 'logoUrl' | 'telephone' | 'emailContact' | 'copyright'>;

/**
 * L'identite qui signe un document. `emailContact` porte ici l'adresse de la
 * structure : les gabarits l'affichent a cote du telephone, en pied de page.
 */
export async function identiteDocument(idStructure: string | null | undefined): Promise<IdentiteDocument> {
  const plateforme = await getIdentitePlateforme();
  if (!idStructure) return plateforme;
  const s = await prisma.structureSante.findUnique({
    where: { id: idStructure },
    select: { nom: true, photoUrl: true, telephone: true, adresse: true, quartier: true, commune: true, prefecture: true },
  });
  if (!s) return plateforme;
  const adresse = [s.adresse, s.quartier, s.commune, s.prefecture]
    .map((v) => (v ?? '').trim())
    .filter((v, i, t) => v && t.indexOf(v) === i)
    .join(', ');
  const verification = plateforme.siteWeb.trim() || plateforme.nom;
  return {
    nom: s.nom,
    logoUrl: s.photoUrl ?? '',
    telephone: s.telephone ?? '',
    emailContact: adresse,
    copyright: `Émis par ${s.nom} · vérifiable sur ${verification}`,
  };
}

/** La structure ou s'est tenue une consultation : l'hopital de l'episode, sinon celle de l'agent. */
export async function structureDeConsultation(idConsultation: string | null | undefined): Promise<string | null> {
  if (!idConsultation) return null;
  const c = await prisma.consultation.findUnique({
    where: { id: idConsultation },
    select: {
      episode: { select: { idStructure: true } },
      asc: { select: { idStructure: true } },
      medecinValideur: { select: { medecinProfile: { select: { idStructure: true } } } },
    },
  });
  return c?.episode?.idStructure ?? c?.asc?.idStructure ?? c?.medecinValideur?.medecinProfile?.idStructure ?? null;
}

/** La structure qui prescrit une analyse : celle de l'episode. */
export async function structureDeDemandeAnalyse(idDemande: string): Promise<string | null> {
  const d = await prisma.demandeAnalyse.findUnique({
    where: { id: idDemande },
    select: { episode: { select: { idStructure: true } } },
  });
  return d?.episode?.idStructure ?? null;
}
