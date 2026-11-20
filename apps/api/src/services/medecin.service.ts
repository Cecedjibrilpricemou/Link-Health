import { Prisma } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { messageRendezVous } from './message-sortant.service';
import {
    ValiderConsultationDto,
    RepondreReferencementDto,
    MedecinFilters,
    SendMessageDto,
} from '../types/medecin.types';
import { JwtPayload } from '../types/auth.types';
import { assertCanAccessConsultation, buildConsultationWhereForUser } from './access-control.service';
import { avecExpirationEtAlertes } from './ordonnance.service';
import { getIdentitePlateforme, getValeursParametres } from './parametres.service';
import type { OrientationMedecinView, RendezVousMedecinView } from '@baobaoheath/shared-types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { withCache, cacheDel } from '../utils/cache';
import { emitToUser } from '../realtime/socket.server';
import { diffuserRendezVous } from '../realtime/rendez-vous.events';
import { envoyerSmsSimule, notifierSansBloquer } from './notification.service';
import { lancerRecherchePharmacie } from './commande.service';
import { logger } from '../config/logger';

const ADMIN_ROLES = new Set(['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN']);

// Route web ou un clic sur la notification renvoie, selon l'espace du destinataire.
function lienEspace(role: string, sousChemin: string): string {
    const espaces: Record<string, string> = {
        PATIENT: '/patient',
        ASC: '/asc',
        ASC_SUPERVISOR: '/asc',
        MEDECIN: '/medecin',
        PHARMACIEN: '/pharmacien',
    };
    return `${espaces[role] ?? '/'}${sousChemin}`;
}

// ─── Consultations à valider par le médecin ───────────────
export async function getConsultationsAValider(
    user: JwtPayload,
    filters: MedecinFilters
) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    // **Cette liste n'etait filtree par rien.** `userId` arrivait en premier
    // argument et n'etait jamais lu : la requete ne retenait que le statut, si
    // bien que chaque medecin voyait les consultations terminees de **toutes
    // les structures du pays** — nom du patient, motif, diagnostics et
    // ordonnances. C'est la clause nue que le test P0 croyait avoir retiree de
    // `buildConsultationWhereForUser` : elle avait seulement demenage ici.
    //
    // `validerConsultation` appelle deja `assertCanAccessConsultation`, donc
    // la liste proposait en plus des lignes sur lesquelles le medecin n'avait
    // aucun pouvoir. Le meme filtre des deux cotes remet les deux d'accord.
    const where = {
        AND: [
            await buildConsultationWhereForUser(user),
            {
                statut: 'TERMINEE' as const,
                idMedecinValideur: null,
                ...(filters.prefecture && {
                    patient: { prefecture: filters.prefecture },
                }),
            },
        ],
    };

    const [consultations, total] = await Promise.all([
        prisma.consultation.findMany({
            where,
            skip,
            take: limit,
            include: {
                patient: {
                    include: {
                        utilisateur: {
                            select: { prenom: true, nom: true, telephone: true },
                        },
                    },
                },
                asc: {
                    include: {
                        utilisateur: {
                            select: { prenom: true, nom: true },
                        },
                    },
                },
                constantes: true,
                diagnostics: true,
                ordonnances: {
                    include: {
                        lignes: { include: { medicament: true } },
                        signataire: { select: { prenom: true, nom: true } },
                    },
                },
            },
            orderBy: { consulteeLE: 'desc' },
        }),
        prisma.consultation.count({ where }),
    ]);

    return {
        data: consultations.map((c) => ({
            ...c,
            ordonnances: c.ordonnances.map((o) => avecExpirationEtAlertes(o)),
        })),
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// ─── Valider une consultation ─────────────────────────────
export async function validerConsultation(
    user: JwtPayload,
    idConsultation: string,
    dto: ValiderConsultationDto
) {
    await assertCanAccessConsultation(user, idConsultation);

    const consultation = await prisma.consultation.findUnique({
        where: { id: idConsultation },
        include: {
            ordonnances: true,
            patient: { select: { idUtilisateur: true } },
        },
    });

    if (!consultation) {
        throw new NotFoundError('Consultation non trouvée');
    }

    if (consultation.idMedecinValideur) {
        throw new ValidationError('Consultation déjà validée par un médecin');
    }

    const idOrdonnancesSignees = dto.idOrdonnances ?? [];
    const { prescription } = await getValeursParametres();
    const dureeValiditeJours = prescription.dureeValiditeJours;

    const updated = await prisma.$transaction(async (tx) => {
        const updated = await tx.consultation.update({
            where: { id: idConsultation },
            data: {
                idMedecinValideur: user.userId,
                notesMedecin: dto.notesMedecin,
                signeLe: new Date(),
                // **Valider et signer, c'est terminer l'acte medical.** Seul
                // le `complete` de l'ASC posait `TERMINEE` : une consultation
                // menee par un medecin restait donc EN_COURS pour toujours,
                // et son ordonnance **n'apparaissait jamais au comptoir** —
                // le scan du pharmacien ne retient que les consultations
                // terminees. Idempotent pour le parcours ASC, ou elle l'est
                // deja avant la validation.
                statut: 'TERMINEE',
            },
        });

        if (idOrdonnancesSignees.length > 0) {
            // La validite court a partir de la signature, pas de la redaction :
            // une ordonnance rédigée par l'ASC puis validée trois jours plus
            // tard perdrait sinon trois jours de validité.
            const signeLe = new Date();
            const valideJusquau = new Date(signeLe);
            valideJusquau.setDate(valideJusquau.getDate() + dureeValiditeJours);

            await tx.ordonnance.updateMany({
                where: {
                    id: { in: idOrdonnancesSignees },
                    idConsultation,
                },
                data: {
                    signePar: user.userId,
                    signeLe,
                    valideJusquau,
                },
            });
        }

        await cacheDel(`medecin:dashboard:${user.userId}`);
        return updated;
    });

    // Apres la transaction : la notification ne doit pas pouvoir l'annuler.
    if (idOrdonnancesSignees.length > 0) {
        await notifierSansBloquer({
            idUtilisateur: consultation.patient.idUtilisateur,
            type: 'ORDONNANCE_SIGNEE',
            titre: 'Ordonnance signée par le médecin',
            contenu: 'Votre ordonnance est prête : présentez votre QR code en pharmacie.',
            lienAction: '/patient/qr-code',
            metadonnees: { idConsultation, idOrdonnances: idOrdonnancesSignees },
        });

        // **L'appel aux pharmacies part dès l'ordonnance prête** (addendum du
        // 2026-09-28, point 1). C'est le geste décrit : le patient n'a pas à
        // courir les officines pour savoir laquelle a tout.
        //
        // Hors transaction, et sans bloquer : une pharmacie injoignable, un
        // patient sans quartier renseigné, ou une recherche déjà lancée ne
        // doivent pas défaire une signature. L'ordonnance reste valide et
        // servable au comptoir dans tous les cas.
        for (const idOrdonnance of idOrdonnancesSignees) {
            try {
                await lancerRecherchePharmacie(idOrdonnance);
            } catch (e) {
                logger.warn('[ORDONNANCE] appel aux pharmacies impossible', {
                    idOrdonnance, erreur: (e as Error).message,
                });
            }
        }
    }

    return updated;
}

/**
 * Les patients que l'accueil a orientes vers ce medecin (EF-03-05).
 *
 * L'orientation posait `EpisodeSoins.idResponsable` et creait eventuellement
 * un rendez-vous, mais aucun ecran ne lisait l'un ni l'autre : le patient
 * etait oriente vers quelqu'un qui ne le voyait jamais arriver.
 *
 * Les episodes clos ou annules sont ecartes : ils ne demandent plus rien.
 */
export async function getOrientations(userId: string): Promise<OrientationMedecinView[]> {
    const episodes = await prisma.episodeSoins.findMany({
        where: {
            idResponsable: userId,
            statut: { notIn: ['CLOS', 'ANNULE'] },
        },
        include: {
            structure: { select: { id: true, nom: true } },
            patient: {
                select: {
                    id: true, dateNaissance: true, sexe: true,
                    utilisateur: { select: { prenom: true, nom: true, telephone: true } },
                },
            },
            // Le rendez-vous encore planifie de cet episode, s'il y en a un.
            rendezVous: {
                where: { statut: 'PLANIFIE' },
                orderBy: { prevuLe: 'asc' },
                take: 1,
                select: { id: true, prevuLe: true, statut: true, motif: true },
            },
        },
        // Ceux qui ont un rendez-vous proche d'abord, puis les plus recents.
        orderBy: { modifieLe: 'desc' },
        take: 50,
    });

    return episodes.map((e) => ({
        idEpisode: e.id,
        numeroEpisode: e.numero,
        statutEpisode: e.statut,
        motif: e.motif,
        service: e.service,
        ouvertLe: e.ouvertLe.toISOString(),
        // `modifieLe` est le moment ou l'orientation a ete posee : c'est elle
        // qui a touche l'episode en dernier.
        orienteLe: e.modifieLe.toISOString(),
        patient: {
            id: e.patient.id,
            prenom: e.patient.utilisateur.prenom,
            nom: e.patient.utilisateur.nom,
            dateNaissance: e.patient.dateNaissance.toISOString(),
            sexe: e.patient.sexe,
            telephone: e.patient.utilisateur.telephone,
        },
        structure: e.structure,
        rendezVous: e.rendezVous[0]
            ? { ...e.rendezVous[0], prevuLe: e.rendezVous[0].prevuLe.toISOString() }
            : null,
    }));
}

// ─── Référencements à traiter ─────────────────────────────
export async function getReferencements(
    userId: string,
    filters: MedecinFilters
) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const medecin = await prisma.utilisateur.findUnique({
        where: { id: userId },
        include: { structure: true },
    });

    const where = {
        ...(filters.statut
            ? { statut: filters.statut }
            : { statut: 'EN_ATTENTE' as const }),
        ...(medecin?.idStructure && {
            idStructureCible: medecin.idStructure,
        }),
    };

    const [referencements, total] = await Promise.all([
        prisma.referencement.findMany({
            where,
            skip,
            take: limit,
            include: {
                consultation: {
                    include: {
                        patient: {
                            include: {
                                utilisateur: {
                                    select: { prenom: true, nom: true, telephone: true },
                                },
                            },
                        },
                        constantes: true,
                        diagnostics: true,
                    },
                },
                structureSource: true,
                structureCible: true,
            },
            orderBy: { creeLe: 'desc' },
        }),
        prisma.referencement.count({ where }),
    ]);

    return {
        data: referencements,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
}

// ─── Répondre à un référencement ──────────────────────────
export async function repondreReferencement(
    user: JwtPayload,
    idReferencement: string,
    dto: RepondreReferencementDto
) {
    const referencement = await prisma.referencement.findUnique({
        where: { id: idReferencement },
    });

    if (!referencement) {
        throw new NotFoundError('Référencement non trouvé');
    }

    if (referencement.statut !== 'EN_ATTENTE') {
        throw new ValidationError('Ce référencement a déjà été traité');
    }

    if (dto.statut === 'REFUSE' && !dto.motifRefus) {
        throw new ValidationError('Le motif de refus est obligatoire');
    }

    if (!ADMIN_ROLES.has(user.role)) {
        const utilisateur = await prisma.utilisateur.findUnique({
            where: { id: user.userId },
            select: { idStructure: true },
        });
        if (!utilisateur?.idStructure || utilisateur.idStructure !== referencement.idStructureCible) {
            throw new ForbiddenError('Vous ne pouvez traiter que les référencements dirigés vers votre structure');
        }
    }

    const referencementTraite = await prisma.referencement.update({
        where: { id: idReferencement },
        data: {
            statut: dto.statut,
            motifRefus: dto.motifRefus,
            idMedecinValideur: user.userId,
            reponduLe: new Date(),
        },
        // Meme forme que getReferencements (ReferencementATraiterView) : la page
        // remplace la ligne traitee par la reponse sans recharger la liste.
        include: {
            consultation: {
                include: {
                    patient: {
                        include: {
                            utilisateur: {
                                select: { id: true, prenom: true, nom: true, telephone: true },
                            },
                        },
                    },
                    constantes: true,
                    diagnostics: true,
                    asc: { select: { idUtilisateur: true } },
                },
            },
            structureSource: true,
            structureCible: true,
        },
    });

    if (dto.statut === 'ACCEPTE' || dto.statut === 'REFUSE') {
        const { consultation, structureCible } = referencementTraite;
        const accepte = dto.statut === 'ACCEPTE';
        const type = accepte ? 'REFERENCEMENT_ACCEPTE' : 'REFERENCEMENT_REFUSE';
        const titre = accepte
            ? `Transfert vers ${structureCible.nom} accepté`
            : `Transfert vers ${structureCible.nom} refusé`;

        // Le patient et l'ASC qui a initie le referencement sont prevenus.
        await notifierSansBloquer({
            idUtilisateur: consultation.patient.utilisateur.id,
            type,
            titre,
            contenu: accepte
                ? 'Présentez-vous à la structure avec votre QR code.'
                : `Motif : ${dto.motifRefus}. Contactez votre ASC pour la suite.`,
            lienAction: '/patient/dashboard',
            metadonnees: { idReferencement, idConsultation: consultation.id },
        });

        if (consultation.asc) {
            await notifierSansBloquer({
                idUtilisateur: consultation.asc.idUtilisateur,
                type,
                titre,
                contenu: accepte
                    ? `Patient ${consultation.patient.utilisateur.prenom} ${consultation.patient.utilisateur.nom} attendu à ${structureCible.nom}.`
                    : `Motif : ${dto.motifRefus}`,
                lienAction: `/asc/consultations/${consultation.id}`,
                metadonnees: { idReferencement, idConsultation: consultation.id },
            });
        }
    }

    return referencementTraite;
}

// ─── Messagerie — envoyer un message ─────────────────────
export async function sendMessage(userId: string, dto: SendMessageDto) {
    const destinataire = await prisma.utilisateur.findUnique({
        where: { id: dto.idDestinataire },
    });

    if (!destinataire) {
        throw new NotFoundError('Destinataire non trouvé');
    }

    const message = await prisma.message.create({
        data: {
            idExpediteur: userId,
            idDestinataire: dto.idDestinataire,
            contenu: dto.contenu,
            ...(dto.idConsultation && { idConsultation: dto.idConsultation }),
        },
        include: {
            expediteur: {
                select: { prenom: true, nom: true, photoUrl: true },
            },
            destinataire: {
                select: { prenom: true, nom: true, photoUrl: true },
            },
        },
    });

    emitToUser(dto.idDestinataire, 'message:new', message);

    // Le destinataire peut ne pas etre sur la page messagerie : la cloche
    // prend le relais de l'evenement message:new.
    await notifierSansBloquer({
        idUtilisateur: dto.idDestinataire,
        type: 'NOUVEAU_MESSAGE',
        titre: `Nouveau message de ${message.expediteur.prenom} ${message.expediteur.nom}`,
        contenu: dto.contenu.length > 120 ? `${dto.contenu.slice(0, 117)}...` : dto.contenu,
        lienAction: destinataire.role === 'MEDECIN' ? '/medecin/messagerie' : undefined,
        metadonnees: { idMessage: message.id, idExpediteur: userId },
    });

    return message;
}

// ─── Messagerie — récupérer les messages ─────────────────
export async function getMessages(userId: string) {
    const messages = await prisma.message.findMany({
        where: {
            OR: [
                { idExpediteur: userId },
                { idDestinataire: userId },
            ],
        },
        include: {
            expediteur: {
                select: { prenom: true, nom: true, photoUrl: true, role: true },
            },
            destinataire: {
                select: { prenom: true, nom: true, photoUrl: true, role: true },
            },
        },
        orderBy: { envoyeLe: 'desc' },
    });

    await prisma.message.updateMany({
        where: {
            idDestinataire: userId,
            lu: false,
        },
        data: { lu: true, luLe: new Date() },
    });

    return messages;
}

// ─── Dashboard médecin — statistiques globales ────────────
export async function getDashboardStats(userId: string) {
    return withCache(`medecin:dashboard:${userId}`, 60, () => _getDashboardStats(userId));
}

async function _getDashboardStats(userId: string) {
    const medecin = await prisma.utilisateur.findUnique({
        where: { id: userId },
        include: { structure: true },
    });

    const [
        consultationsValidees,
        consultationsEnAttente,
        referencementsEnAttente,
        messagesNonLus,
    ] = await Promise.all([
        prisma.consultation.count({
            where: { idMedecinValideur: userId },
        }),
        prisma.consultation.count({
            where: {
                statut: 'TERMINEE',
                idMedecinValideur: null,
                ...(medecin?.idStructure && {
                    asc: { idStructure: medecin.idStructure },
                }),
            },
        }),
        prisma.referencement.count({
            where: {
                statut: 'EN_ATTENTE',
                ...(medecin?.idStructure && {
                    idStructureCible: medecin.idStructure,
                }),
            },
        }),
        prisma.message.count({
            where: {
                idDestinataire: userId,
                lu: false,
            },
        }),
    ]);

    return {
        consultationsValidees,
        consultationsEnAttente,
        referencementsEnAttente,
        messagesNonLus,
        structure: medecin?.structure ?? null,
    };
}

// ── Rendez-vous (addendum du 2026-09-28, points 3 et 8) ──────────────
//
// C'est le medecin qui fixe le creneau : jusqu'ici l'accueil posait une
// convocation que le medecin subissait, sans connaitre son agenda.

/** Le medecin pose le creneau d'un patient qui lui a ete oriente. */
export async function fixerRendezVous(
    userId: string,
    idEpisode: string,
    dto: { prevuLe: string; motif?: string }
): Promise<RendezVousMedecinView> {
    const prevuLe = new Date(dto.prevuLe);
    if (Number.isNaN(prevuLe.getTime())) throw new ValidationError('Date de rendez-vous invalide');

    const episode = await prisma.episodeSoins.findFirst({
        where: { id: idEpisode, idResponsable: userId },
        select: { id: true, numero: true, motif: true, statut: true, idPatient: true, structure: { select: { nom: true } } },
    });
    if (!episode) throw new NotFoundError('Aucun patient ne vous est oriente sur cet episode');
    if (episode.statut === 'CLOS' || episode.statut === 'ANNULE') throw new ConflictError('Cet episode est termine');

    const rdv = await prisma.$transaction(async (tx) => {
        // Un seul rendez-vous en vigueur par episode : deplacer le creneau
        // remplace le precedent, il ne s'y ajoute pas.
        await tx.rendezVous.updateMany({
            where: { idEpisode, statut: 'PLANIFIE' },
            data: { statut: 'ANNULE' },
        });
        return tx.rendezVous.create({
            data: {
                idPatient: episode.idPatient,
                idMedecin: userId,
                idEpisode,
                prevuLe,
                motif: dto.motif?.trim() || episode.motif,
                statut: 'PLANIFIE',
            },
            include: RDV_MEDECIN_INCLUDE,
        });
    });

    // Maintenant seulement le patient apprend une heure : elle est confirmee.
    const patientUser = await prisma.utilisateur.findFirst({
        where: { patientProfile: { id: episode.idPatient } },
        select: { id: true, telephone: true },
    });
    if (patientUser) {
        const quand = prevuLe.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        await notifierSansBloquer({
            idUtilisateur: patientUser.id,
            type: 'RAPPEL_RENDEZ_VOUS',
            titre: 'Votre rendez-vous est fixe',
            contenu: `Rendez-vous a ${episode.structure.nom} le ${quand}. Presentez-vous a l'accueil.`,
            lienAction: '/patient/parcours',
            metadonnees: { idEpisode, idRendezVous: rdv.id },
        });
        const { nomCourt } = await getIdentitePlateforme();
        // Par le constructeur : un nom d'etablissement revelateur est retire,
        // et le patient le retrouve dans son espace.
        await envoyerSmsSimule(patientUser.telephone, messageRendezVous(nomCourt, quand, episode.structure.nom));
    }

    return versRendezVousMedecin(rdv);
}

/** L'agenda du medecin, du plus proche au plus lointain. */
export async function getAgenda(userId: string, filtres: { du?: string; au?: string } = {}): Promise<RendezVousMedecinView[]> {
    const du = filtres.du ? new Date(filtres.du) : debutDuJour(new Date());
    const au = filtres.au ? new Date(filtres.au) : null;

    const rdvs = await prisma.rendezVous.findMany({
        where: {
            idMedecin: userId,
            // Un rendez-vous annule ne dit plus rien de la journee.
            statut: { not: 'ANNULE' },
            prevuLe: { gte: du, ...(au ? { lte: au } : {}) },
        },
        include: RDV_MEDECIN_INCLUDE,
        orderBy: { prevuLe: 'asc' },
        take: 200,
    });
    return rdvs.map(versRendezVousMedecin);
}

/** Le medecin prend le patient, le termine, ou constate son absence. */
export async function changerStatutRendezVous(
    userId: string,
    idRendezVous: string,
    statut: 'EN_CONSULTATION' | 'TERMINE' | 'ABSENT'
): Promise<RendezVousMedecinView> {
    const rdv = await prisma.rendezVous.findFirst({ where: { id: idRendezVous, idMedecin: userId } });
    if (!rdv) throw new NotFoundError('Rendez-vous introuvable');
    if (rdv.statut === 'ANNULE') throw new ConflictError('Ce rendez-vous est annule');

    const maj = await prisma.rendezVous.update({
        where: { id: idRendezVous },
        data: { statut },
        include: RDV_MEDECIN_INCLUDE,
    });
    // L'accueil voit aussitot que le patient a ete appele, ou qu'il est parti :
    // il sait vers quel bureau l'orienter, et qui attend encore.
    await diffuserRendezVous(idRendezVous);
    return versRendezVousMedecin(maj);
}

function debutDuJour(d: Date): Date {
    const j = new Date(d);
    j.setHours(0, 0, 0, 0);
    return j;
}

const RDV_MEDECIN_INCLUDE = {
    patient: {
        select: {
            id: true, dateNaissance: true, sexe: true,
            utilisateur: { select: { prenom: true, nom: true, telephone: true } },
        },
    },
    episode: { select: { id: true, numero: true } },
} satisfies Prisma.RendezVousInclude;

type RdvMedecinRow = Prisma.RendezVousGetPayload<{ include: typeof RDV_MEDECIN_INCLUDE }>;

function versRendezVousMedecin(r: RdvMedecinRow): RendezVousMedecinView {
    return {
        id: r.id,
        prevuLe: r.prevuLe.toISOString(),
        statut: r.statut,
        motif: r.motif,
        arriveeLe: r.arriveeLe?.toISOString() ?? null,
        patient: {
            id: r.patient.id,
            prenom: r.patient.utilisateur.prenom,
            nom: r.patient.utilisateur.nom,
            dateNaissance: r.patient.dateNaissance.toISOString(),
            sexe: r.patient.sexe,
            telephone: r.patient.utilisateur.telephone,
        },
        idEpisode: r.episode?.id ?? null,
        numeroEpisode: r.episode?.numero ?? null,
    };
}
