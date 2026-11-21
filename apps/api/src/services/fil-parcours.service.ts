// Le fil du parcours (P5, EF-06-01) : chaque etape d'une visite, datee, du
// rendez-vous demande a la livraison.
//
// **Pourquoi un fil, et pas une frise de plus.** La page « Mon parcours »
// montrait les analyses et les rendez-vous ; l'ordonnance, la commande, le
// paiement et la livraison vivaient chacun sur leur ecran, et la frise les
// annoncait « bientot ». Le patient ne savait pas ou en etait sa visite sans
// ouvrir quatre pages. Le fil les met bout a bout, avec l'heure de chaque pas.
//
// **Rien de medical n'y passe.** Un fil dit qu'une analyse a ete prescrite,
// prelevee, que ses resultats sont disponibles - jamais une valeur. Les
// resultats n'y apparaissent qu'une fois diffuses au patient, comme sur le
// reste de la page.
import { prisma } from '../config/prisma';
import type { EtapeFilView, TypeEtapeFil } from '@baobaoheath/shared-types';

/** Ce que le fil lit d'une visite : des dates, des numeros, des noms de structures. */
export const FIL_SELECT = {
  id: true, statut: true, ouvertLe: true, closLe: true,
  demandeRendezVous: { select: { creeLe: true } },
  rendezVous: { select: { prevuLe: true, arriveeLe: true, statut: true } },
  demandesAnalyse: {
    select: {
      numero: true, statut: true, creeLe: true, preleveeLe: true, diffuseePatientLe: true, annuleeLe: true,
      laboratoire: { select: { nom: true } },
    },
  },
  consultations: {
    select: {
      creeLe: true, signeLe: true, statut: true,
      ordonnances: {
        select: {
          numero: true, creeLe: true,
          commandes: {
            select: {
              numero: true, statut: true, modeRemise: true, creeLe: true, modifieLe: true,
              priseEnChargeLe: true, preteLe: true, remiseLe: true,
              pharmacie: { select: { nom: true } },
              facture: { select: { payeeLe: true } },
              courses: { select: { attribueeLe: true, livreeLe: true } },
            },
          },
        },
      },
    },
  },
} as const;

type Date_ = Date | null | undefined;

export interface VisitePourFil {
  statut: string;
  ouvertLe: Date;
  closLe: Date_;
  demandeRendezVous?: { creeLe: Date } | null;
  rendezVous: { prevuLe: Date; arriveeLe: Date_; statut: string }[];
  demandesAnalyse: {
    numero: string; statut: string; creeLe: Date; preleveeLe: Date_; diffuseePatientLe: Date_; annuleeLe: Date_;
    laboratoire: { nom: string };
  }[];
  consultations: {
    creeLe: Date; signeLe: Date_; statut: string;
    ordonnances: {
      numero: string; creeLe: Date;
      commandes: {
        numero: string; statut: string; modeRemise: string | null; creeLe: Date; modifieLe: Date;
        priseEnChargeLe: Date_; preteLe: Date_; remiseLe: Date_;
        pharmacie: { nom: string } | null;
        facture: { payeeLe: Date_ } | null;
        courses: { attribueeLe: Date_; livreeLe: Date_ }[];
      }[];
    }[];
  }[];
}

/**
 * Le fil d'une visite, dans l'ordre du temps. Fonction pure : la requete est
 * faite par l'appelant, une seule fois pour toutes les visites du patient.
 */
export function construireFil(v: VisitePourFil, maintenant = new Date()): EtapeFilView[] {
  const etapes: EtapeFilView[] = [];
  const ajouter = (type: TypeEtapeFil, le: Date_, detail: string | null = null) => {
    if (le) etapes.push({ type, le: le.toISOString(), detail, ...(le > maintenant ? { aVenir: true } : {}) });
  };

  ajouter('DEMANDE_RDV', v.demandeRendezVous?.creeLe);
  ajouter('VISITE_OUVERTE', v.ouvertLe);
  for (const r of v.rendezVous) {
    // Un rendez-vous remplace n'est plus le sien : il ne figure pas au fil.
    if (r.statut === 'ANNULE') continue;
    ajouter('RENDEZ_VOUS', r.prevuLe);
    ajouter('ARRIVEE', r.arriveeLe);
  }
  for (const d of v.demandesAnalyse) {
    ajouter('ANALYSE_PRESCRITE', d.creeLe, d.laboratoire.nom);
    ajouter('PRELEVEMENT', d.preleveeLe, d.laboratoire.nom);
    // Les resultats ne se montrent qu'une fois diffuses au patient.
    ajouter('RESULTATS', d.diffuseePatientLe, d.laboratoire.nom);
    ajouter('ANALYSE_ANNULEE', d.annuleeLe, d.numero);
  }
  for (const c of v.consultations) {
    if (c.statut === 'ANNULEE') continue;
    // A son ouverture : la signature vient a la fin, apres l'ordonnance, et la
    // dater ainsi mettait l'ordonnance avant la consultation qui l'a produite.
    ajouter('CONSULTATION', c.creeLe);
    for (const o of c.ordonnances) {
      ajouter('ORDONNANCE', o.creeLe, o.numero);
      for (const k of o.commandes) {
        ajouter('COMMANDE', k.creeLe, k.numero);
        ajouter('PHARMACIE_TROUVEE', k.priseEnChargeLe, k.pharmacie?.nom ?? null);
        if (k.statut === 'SANS_PHARMACIE') ajouter('SANS_PHARMACIE', k.modifieLe, k.numero);
        ajouter('PAIEMENT', k.facture?.payeeLe, k.numero);
        ajouter('PRETE', k.preteLe, k.modeRemise === 'LIVRAISON' ? 'LIVRAISON' : 'RETRAIT');
        if (k.modeRemise === 'LIVRAISON') {
          ajouter('REMISE_LIVREUR', k.remiseLe);
          const course = k.courses.find((x) => x.livreeLe) ?? k.courses[0];
          ajouter('LIVREE', course?.livreeLe);
        } else {
          ajouter('RETIREE', k.remiseLe, k.pharmacie?.nom ?? null);
        }
        if (k.statut === 'ANNULEE') ajouter('COMMANDE_ANNULEE', k.modifieLe, k.numero);
      }
    }
  }
  if (v.statut === 'ANNULE') ajouter('VISITE_ANNULEE', v.closLe);
  else ajouter('VISITE_CLOSE', v.closLe);

  // L'ordre du temps ; a egalite, l'ordre d'insertion, qui est celui du parcours.
  return etapes
    .map((e, i) => ({ e, i }))
    .sort((a, b) => new Date(a.e.le).getTime() - new Date(b.e.le).getTime() || a.i - b.i)
    .map(({ e }) => e);
}

/** Le fil de chacune des visites du patient, en une requete. */
export async function filsDesVisites(idsEpisodes: string[]): Promise<Map<string, EtapeFilView[]>> {
  if (idsEpisodes.length === 0) return new Map();
  const visites = await prisma.episodeSoins.findMany({ where: { id: { in: idsEpisodes } }, select: FIL_SELECT });
  const maintenant = new Date();
  return new Map(visites.map((v) => [v.id, construireFil(v, maintenant)]));
}
