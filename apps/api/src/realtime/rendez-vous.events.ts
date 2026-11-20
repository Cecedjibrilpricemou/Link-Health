// La file d'attente, en direct.
//
// **Ce qui manquait.** L'accueil pointait l'arrivee d'un patient, et le
// medecin recevait une notification ; mais sa liste ne bougeait pas tant qu'il
// ne rechargeait pas la page. Dans l'autre sens, quand le medecin prenait un
// patient, l'accueil ne le voyait pas : il fallait aller demander qui etait
// passe.
//
// Chaque changement d'un rendez-vous - pointage, appel, fin, absence - part
// donc aux deux bouts : le medecin concerne, et les agents d'accueil de la
// structure. L'evenement ne porte que des identifiants et un etat : l'ecran
// relit ensuite ce qu'il a le droit de voir, par les routes habituelles. Rien
// de medical ne transite par la socket.
import { prisma } from '../config/prisma';
import { logger } from '../config/logger';
import { emitToUser } from './socket.server';

export const EVENEMENT_RENDEZ_VOUS = 'rendez-vous:maj';

export interface RendezVousMajEvent {
  idRendezVous: string;
  statut: string;
  arriveeLe: string | null;
}

/**
 * Prevenir le medecin et l'accueil qu'un rendez-vous a change.
 *
 * **Ne fait jamais echouer le geste qui l'appelle.** Le pointage ou l'appel
 * est deja enregistre : une socket indisponible ne doit pas le faire passer
 * pour rate. Au pire, l'ecran se met a jour au prochain chargement.
 */
export async function diffuserRendezVous(idRendezVous: string): Promise<void> {
  try {
    const rdv = await prisma.rendezVous.findUnique({
      where: { id: idRendezVous },
      select: {
        id: true, statut: true, arriveeLe: true, idMedecin: true,
        episode: { select: { idStructure: true } },
      },
    });
    if (!rdv) return;

    const destinataires = new Set<string>();
    if (rdv.idMedecin) destinataires.add(rdv.idMedecin);

    const idStructure = rdv.episode?.idStructure;
    if (idStructure) {
      const accueil = await prisma.utilisateur.findMany({
        where: { idStructure, role: 'AGENT_ACCUEIL', estActif: true },
        select: { id: true },
      });
      for (const a of accueil) destinataires.add(a.id);
    }

    const evenement: RendezVousMajEvent = {
      idRendezVous: rdv.id,
      statut: rdv.statut,
      arriveeLe: rdv.arriveeLe?.toISOString() ?? null,
    };
    for (const id of destinataires) emitToUser(id, EVENEMENT_RENDEZ_VOUS, evenement);
  } catch (e) {
    logger.warn('[RDV] diffusion en direct impossible', {
      idRendezVous,
      erreur: e instanceof Error ? e.message : String(e),
    });
  }
}
