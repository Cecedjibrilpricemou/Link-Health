// src/services/admin-structure.service.ts
import { randomInt } from 'crypto';
import { prisma } from '../config/prisma';
import { hashPassword } from '../utils/password.utils';
import { assertMotDePasseConforme } from '../utils/politique-mot-de-passe';
import { Role, TypeStructure } from '../config/generated/client/client';
import { envoyerEmailAdminStructure, envoyerEmailAgent } from './email.service';
import { logger } from '../config/logger';
import type { JwtPayload } from '../types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/app-error';
import { verifierCoordonnees } from '../utils/coordonnees';
import { estStructureHospitaliere } from '../utils/officine.util';
import {
    ecrireFichiers, exigeDesPieces, SOUS_AUTORISATION_DU_PARENT, supprimerFichiers,
    validerIdentifiants, validerPieces,
    type FichierRecu, type IdentifiantsRecus,
} from './piece-agrement.service';

const ROLES_AUTORISES: Role[] = [Role.ASC, Role.ASC_SUPERVISOR, Role.MEDECIN, Role.AGENT_ACCUEIL, Role.TECHNICIEN_LABO];

// ── Générer un mot de passe temporaire ───────────────────────────
/**
 * Mot de passe temporaire d'un compte professionnel.
 *
 * **Different de celui remis au comptoir a un patient** : celui-la est dicte a
 * voix haute dans un hall bruyant, celui-ci se lit sur un ecran ou dans un
 * courriel. Sans O/0 ni I/l malgre tout : ils se confondent a l'ecrit aussi.
 */
//
// **Seize caracteres aleatoires, en quatre groupes** (« Kq7m-Xw3P-… »),
// soit environ 92 bits. L'ancienne forme — un prefixe fixe et public suivi de
// cinq caracteres — n'en avait que 29 : un mot de passe temporaire reste
// valable tant que l'agent ne l'a pas change, et il ouvre un compte
// professionnel. `randomInt` tire sans biais, la ou `octet % 55` favorisait
// les premiers caracteres de l'alphabet.
export function genererMotDePasseTemp(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const groupes: string[] = [];
    for (let g = 0; g < 4; g++) {
        let groupe = '';
        for (let i = 0; i < 4; i++) groupe += chars[randomInt(chars.length)];
        groupes.push(groupe);
    }
    return groupes.join('-');
}

// ── SUPER_ADMIN : créer structure + admin en une transaction ──────
/**
 * Creer une structure, avec son dossier reglementaire s'il en faut un.
 *
 * **Le dossier bloque.** Une clinique ou un laboratoire prive n'entre pas sans
 * ses quatre pieces et ses identifiants : c'est la decision du 2026-10-28. Les
 * structures publiques, elles, n'ont rien a produire et la creation reste un
 * POST JSON ordinaire — exiger un agrement prive d'un CHU serait un obstacle
 * invente.
 *
 * L'ordre des ecritures n'est pas indifferent : les fichiers partent sur le
 * disque **avant** la transaction. Un echec d'ecriture ne laisse alors aucune
 * structure a demi creee, et un echec de transaction ne laisse que des
 * fichiers orphelins, qu'on supprime.
 */
export async function creerStructureAvecAdmin(dto: {
    nom: string; type: string; prefecture: string; commune: string; quartier?: string;
    adresse?: string; latitude?: number; longitude?: number; telephone?: string;
    admin: { prenom: string; nom: string; telephone: string; email?: string; };
} & IdentifiantsRecus, pieces: readonly FichierRecu[] = [], libelles: Readonly<Record<string, string | undefined>> = {}) {
    const typeValid = Object.values(TypeStructure).includes(dto.type as TypeStructure);
    if (!typeValid) throw new ValidationError(`Type invalide : ${dto.type}`);

    verifierCoordonnees(dto.latitude, dto.longitude);

    // Refuser avant toute ecriture, et avant de consommer un numero de
    // telephone : un dossier incomplet ne doit rien laisser derriere lui.
    const identifiants = validerIdentifiants(dto.type, dto);
    const validees = validerPieces(dto.type, pieces, libelles);

    const existingTel = await prisma.utilisateur.findUnique({ where: { telephone: dto.admin.telephone } });
    if (existingTel) throw new ConflictError('Ce numéro de téléphone est déjà utilisé');

    if (dto.admin.email) {
        const existingEmail = await prisma.utilisateur.findUnique({ where: { email: dto.admin.email } });
        if (existingEmail) throw new ConflictError('Cette adresse email est déjà utilisée');
    }

    const motDePasseTemp = genererMotDePasseTemp();
    const motDePasseHash = await hashPassword(motDePasseTemp);

    const fichiersEcrits = await ecrireFichiers(validees);

    let result;
    try {
    result = await prisma.$transaction(async (tx) => {
        const structure = await tx.structureSante.create({
            data: {
                nom: dto.nom, type: dto.type as TypeStructure,
                prefecture: dto.prefecture, commune: dto.commune.trim(), quartier: dto.quartier?.trim() || null,
                adresse: dto.adresse,
                latitude: dto.latitude, longitude: dto.longitude,
                telephone: dto.telephone, estActive: true,
                ...identifiants,
            }
        });

        if (fichiersEcrits.length > 0) {
            await tx.pieceAgrement.createMany({
                data: fichiersEcrits.map((p) => ({ ...p, idStructure: structure.id })),
            });
        }

        const admin = await tx.utilisateur.create({
            data: {
                telephone: dto.admin.telephone,
                email: dto.admin.email ?? null,
                motDePasseHash,
                prenom: dto.admin.prenom,
                nom: dto.admin.nom,
                role: Role.ADMIN_STRUCTURE,
                idStructure: structure.id,
                doitChangerMotDePasse: true
            }
        });

        return { structure, admin };
    });
    } catch (e) {
        // La structure n'existe pas : ses fichiers ne doivent pas survivre.
        await supprimerFichiers(fichiersEcrits.map((p) => p.fichier));
        throw e;
    }

    if (exigeDesPieces(dto.type)) {
        logger.info('[AGREMENT] structure privee creee avec son dossier', {
            idStructure: result.structure.id, type: dto.type, pieces: fichiersEcrits.length,
        });
    }

    // ── Envoi email si adresse disponible ────────────────────────────
    if (dto.admin.email) {
        try {
            await envoyerEmailAdminStructure({
                destinataire: dto.admin.email,
                prenomNom: `${dto.admin.prenom} ${dto.admin.nom}`,
                nomStructure: dto.nom,
                telephone: dto.admin.telephone,
                motDePasseTemporaire: motDePasseTemp
            });
        } catch (emailError) {
            // L'email échoue silencieusement — le compte est quand même créé
            logger.error('Erreur envoi email admin structure', { error: emailError });
        }
    }

    return {
        structure: result.structure,
        admin: {
            id: result.admin.id,
            telephone: result.admin.telephone,
            email: result.admin.email,
            prenom: result.admin.prenom,
            nom: result.admin.nom,
            role: result.admin.role
        },
        motDePasseTemporaire: motDePasseTemp
    };
}

/**
 * Creer une pharmacie, avec son dossier reglementaire si c'est une officine.
 *
 * **Seule l'officine independante produit un dossier.** Une pharmacie
 * hospitaliere n'a pas d'agrement propre : elle opere sous celui de son
 * hopital. Exiger ses quatre pieces bloquerait un hopital qui ouvre sa
 * pharmacie interne, pour une autorisation qui n'existe pas.
 */
export async function creerPharmacieAvecPharmacien(auteur: JwtPayload, dto: {
    nom: string; prefecture: string; commune?: string; quartier?: string;
    idStructureParente?: string;
    adresse?: string; latitude?: number; longitude?: number; telephone?: string;
    pharmacien: { prenom: string; nom: string; telephone: string; email?: string; motDePasse?: string; };
} & IdentifiantsRecus, pieces: readonly FichierRecu[] = [], libelles: Readonly<Record<string, string | undefined>> = {}) {
    let idStructureParente: string | null = dto.idStructureParente ?? null;
    verifierCoordonnees(dto.latitude, dto.longitude);

    if (auteur.role === Role.ADMIN_STRUCTURE) {
        const admin = await prisma.utilisateur.findUnique({
            where: { id: auteur.userId },
            select: { idStructure: true, structure: { select: { type: true } } },
        });
        if (!admin?.idStructure || !admin.structure || !estStructureHospitaliere(admin.structure.type)) {
            throw new ForbiddenError('Seul un administrateur hospitalier peut creer une pharmacie hospitaliere');
        }
        if (dto.idStructureParente && dto.idStructureParente !== admin.idStructure) {
            throw new ForbiddenError('Vous ne pouvez creer une pharmacie que dans votre propre structure');
        }
        idStructureParente = admin.idStructure;
    } else if (auteur.role === Role.SUPER_ADMIN) {
        if (idStructureParente) {
            const parent = await prisma.structureSante.findUnique({
                where: { id: idStructureParente },
                select: { id: true, type: true },
            });
            if (!parent) throw new NotFoundError('Structure hospitaliere parente introuvable');
            if (!estStructureHospitaliere(parent.type)) {
                throw new ValidationError('La structure parente doit etre un hopital ou une clinique');
            }
        }
    } else {
        throw new ForbiddenError('Vous ne pouvez pas creer une pharmacie');
    }

    // Apres la resolution du parent : c'est lui qui dit si un dossier est du.
    // Avant toute ecriture : un dossier incomplet ne laisse rien derriere lui.
    const typeDossier = idStructureParente ? SOUS_AUTORISATION_DU_PARENT : TypeStructure.PHARMACIE;
    const identifiants = validerIdentifiants(typeDossier, dto);
    const validees = validerPieces(typeDossier, pieces, libelles);

    let communeFinale: string | undefined;
    let quartierFinal: string | null | undefined;

    if (idStructureParente) {
        const parent = await prisma.structureSante.findUnique({
            where: { id: idStructureParente },
            select: { commune: true, quartier: true },
        });
        if (!parent) throw new NotFoundError('Structure hospitaliere parente introuvable');
        communeFinale = (dto.commune ?? parent.commune ?? '').trim();
        quartierFinal = (dto.quartier ?? parent.quartier ?? '').trim() || null;
    } else {
        communeFinale = dto.commune?.trim();
        if (!communeFinale) {
            throw new ValidationError('La commune est obligatoire : sans elle, la pharmacie ne recevrait aucune ordonnance');
        }
        quartierFinal = dto.quartier?.trim() || null;
    }

    const existingTel = await prisma.utilisateur.findUnique({ where: { telephone: dto.pharmacien.telephone } });
    if (existingTel) throw new ConflictError('Ce numero de telephone est deja utilise');

    if (dto.pharmacien.email) {
        const existingEmail = await prisma.utilisateur.findUnique({ where: { email: dto.pharmacien.email } });
        if (existingEmail) throw new ConflictError('Cette adresse email est deja utilisee');
    }

    if (dto.pharmacien.motDePasse) assertMotDePasseConforme(dto.pharmacien.motDePasse, Role.PHARMACIEN);
    const motDePasseTemp = dto.pharmacien.motDePasse || genererMotDePasseTemp();
    const motDePasseHash = await hashPassword(motDePasseTemp);
    const isTemporaire = !dto.pharmacien.motDePasse;

    const fichiersEcrits = await ecrireFichiers(validees);

    let result;
    try {
    result = await prisma.$transaction(async (tx) => {
        const structure = await tx.structureSante.create({
            data: {
                nom: dto.nom,
                type: TypeStructure.PHARMACIE,
                idStructureParente,
                prefecture: dto.prefecture,
                // Un hopital sans commune connue : pas de chaine vide, qui
                // ressemblerait a une commune ; « inconnue » se dit null.
                commune: communeFinale || null,
                quartier: quartierFinal ?? null,
                adresse: dto.adresse,
                latitude: dto.latitude,
                longitude: dto.longitude,
                telephone: dto.telephone,
                estActive: true,
                ...identifiants,
            }
        });

        if (fichiersEcrits.length > 0) {
            await tx.pieceAgrement.createMany({
                data: fichiersEcrits.map((p) => ({ ...p, idStructure: structure.id })),
            });
        }

        const pharmacien = await tx.utilisateur.create({
            data: {
                telephone: dto.pharmacien.telephone,
                email: dto.pharmacien.email ?? null,
                motDePasseHash,
                prenom: dto.pharmacien.prenom,
                nom: dto.pharmacien.nom,
                role: Role.PHARMACIEN,
                idStructure: structure.id,
                doitChangerMotDePasse: isTemporaire
            }
        });

        await tx.pharmacienProfile.create({
            data: {
                idUtilisateur: pharmacien.id,
                idStructure: structure.id,
                estResponsable: true,
                roleOfficine: 'TITULAIRE'
            }
        });

        return { structure, pharmacien };
    });
    } catch (e) {
        await supprimerFichiers(fichiersEcrits.map((p) => p.fichier));
        throw e;
    }

    if (dto.pharmacien.email && isTemporaire) {
        try {
            await envoyerEmailAgent({
                destinataire: dto.pharmacien.email,
                prenomNom: `${dto.pharmacien.prenom} ${dto.pharmacien.nom}`,
                role: Role.PHARMACIEN,
                nomStructure: dto.nom,
                telephone: dto.pharmacien.telephone,
                motDePasseTemporaire: motDePasseTemp
            });
        } catch (emailError) {
            logger.error('Erreur envoi email pharmacien responsable', { error: emailError });
        }
    }

    return {
        structure: result.structure,
        pharmacien: {
            id: result.pharmacien.id,
            telephone: result.pharmacien.telephone,
            email: result.pharmacien.email,
            prenom: result.pharmacien.prenom,
            nom: result.pharmacien.nom,
            role: result.pharmacien.role
        },
        motDePasseTemporaire: isTemporaire ? motDePasseTemp : undefined
    };
}

// ── SUPER_ADMIN : lister toutes les structures ────────────────────
/**
 * Liste ouverte, servie sans authentification : elle alimente le choix de
 * structure preferee cote patient.
 *
 * Deux raisons de ne pas reutiliser getStructures() :
 *  - elle renvoie aussi les structures desactivees, que le patient pouvait
 *    donc selectionner avant de se voir refuser par l'API ;
 *  - elle joint le nom et le telephone de l'administrateur de chaque
 *    structure, qui n'ont rien a faire sur un endpoint public.
 */
/**
 * Les structures ou l'on peut etre recu en consultation.
 *
 * **Une pharmacie, un laboratoire et une compagnie d'assurance n'en sont
 * pas.** Ce sont des structures de la plateforme, actives, et la liste les
 * renvoyait donc au patient : son ecran de demande de rendez-vous proposait
 * « Pharmacie Pricemou » et « Pricemou & Frere Assurances » comme lieux de
 * consultation. On ne prend pas rendez-vous chez un pharmacien.
 *
 * A ne pas confondre avec `TYPES_RECEVEURS` de `plateau-technique.service`,
 * qui dit qui recoit une **demande d'analyse** : une pharmacie ne recoit ni
 * l'un ni l'autre, mais un laboratoire independant recoit des analyses sans
 * recevoir de consultation.
 */
const TYPES_DE_SOIN = ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU', 'CLINIQUE'] as const;

export async function getStructuresPubliques() {
    return prisma.structureSante.findMany({
        where: { estActive: true, type: { in: [...TYPES_DE_SOIN] } },
        orderBy: { nom: 'asc' },
        select: {
            id: true,
            nom: true,
            type: true,
            prefecture: true,
            adresse: true,
            telephone: true,
        },
    });
}

// ── SUPER_ADMIN : liste complete, structures desactivees comprises ────
export async function getStructures() {
    return prisma.structureSante.findMany({
        orderBy: { creeLe: 'desc' },
    });
}

export async function getPharmaciesStructure(adminId: string) {
    const admin = await prisma.utilisateur.findUnique({
        where: { id: adminId },
        select: { idStructure: true, structure: { select: { type: true } } },
    });
    if (!admin?.idStructure || !admin.structure || !estStructureHospitaliere(admin.structure.type)) {
        throw new ForbiddenError('La gestion des pharmacies est reservee aux structures hospitalieres');
    }

    return prisma.structureSante.findMany({
        where: { idStructureParente: admin.idStructure, type: TypeStructure.PHARMACIE },
        orderBy: { creeLe: 'desc' },
    });
}

// ── SUPER_ADMIN : modifier une structure ──────────────────────────
export async function modifierStructure(id: string, dto: {
    nom?: string; type?: string; prefecture?: string; commune?: string; quartier?: string;
    adresse?: string; latitude?: number; longitude?: number;
    telephone?: string; estActive?: boolean;
}) {
    if (dto.latitude !== undefined || dto.longitude !== undefined) {
        verifierCoordonnees(dto.latitude, dto.longitude);
    }
    if (dto.type) {
        const typeValid = Object.values(TypeStructure).includes(dto.type as TypeStructure);
        if (!typeValid) throw new ValidationError(`Type invalide : ${dto.type}`);

        const structure = await prisma.structureSante.findUnique({
            where: { id },
            select: {
                idStructureParente: true,
                _count: { select: { structuresEnfants: true } },
            },
        });
        if (!structure) throw new NotFoundError('Structure introuvable');
        const nouveauType = dto.type as TypeStructure;
        if (structure.idStructureParente && nouveauType !== TypeStructure.PHARMACIE) {
            throw new ValidationError('Une pharmacie hospitaliere doit rester de type PHARMACIE');
        }
        if (structure._count.structuresEnfants > 0 && !estStructureHospitaliere(nouveauType)) {
            throw new ValidationError('Une structure parente de pharmacie doit rester hospitaliere');
        }
    }
    const { type, ...rest } = dto;
    return prisma.structureSante.update({
        where: { id },
        data: { ...rest, ...(type ? { type: type as TypeStructure } : {}) }
    });
}

// ── SUPER_ADMIN : désactiver une structure ────────────────────────
export async function supprimerStructure(id: string) {
    return prisma.structureSante.update({
        where: { id },
        data: { estActive: false }
    });
}

// ── ADMIN_STRUCTURE : lister ses agents ──────────────────────────
export async function getAgentsStructure(adminId: string) {
    const admin = await prisma.utilisateur.findUnique({
        where: { id: adminId }, include: { structure: true }
    });
    if (!admin?.idStructure) throw new ForbiddenError('Aucune structure assignée');
    if (admin.structure?.type === TypeStructure.PHARMACIE) {
        throw new ForbiddenError('La gestion des comptes de pharmacie est réservée au pharmacien titulaire');
    }

    const agents = await prisma.utilisateur.findMany({
        where: { idStructure: admin.idStructure, role: { in: ROLES_AUTORISES }, estActif: true },
        select: {
            id: true, telephone: true, email: true, prenom: true, nom: true, role: true,
            creeLe: true, derniereConnexion: true,
            // Le bureau n'existe que pour un medecin, et il est souvent nul.
            medecinProfile: { select: { bureau: true } },
        },
        orderBy: { creeLe: 'desc' }
    });

    return agents.map(({ medecinProfile, ...a }) => ({
        ...a,
        bureau: medecinProfile?.bureau ?? null,
    }));
}

// ── ADMIN_STRUCTURE : créer un agent avec MDP temporaire ─────────
export async function creerAgent(adminId: string, dto: {
    telephone: string; email?: string; motDePasse?: string;
    prenom: string; nom: string; role: Role;
    /** Facultatif, et seulement pour un medecin. */
    bureau?: string;
}) {
    if (!dto.email?.trim()) {
        throw new ValidationError('Une adresse email professionnelle est obligatoire pour se connecter');
    }

    const admin = await prisma.utilisateur.findUnique({
        where: { id: adminId },
        include: { structure: true }
    });
    if (!admin?.idStructure) throw new ForbiddenError('Aucune structure assignée');
    if (dto.role === Role.PHARMACIEN) {
        throw new ForbiddenError('Creez une pharmacie pour rattacher son administrateur pharmacien');
    }
    if (admin.structure?.type === TypeStructure.PHARMACIE) {
        throw new ForbiddenError('La gestion des comptes de pharmacie est réservée au pharmacien titulaire');
    }

    if (!ROLES_AUTORISES.includes(dto.role)) {
        throw new ForbiddenError(`Vous ne pouvez pas créer un compte de type ${dto.role}`);
    }

    const existingTel = await prisma.utilisateur.findUnique({ where: { telephone: dto.telephone } });
    if (existingTel) throw new ConflictError('Ce numéro de téléphone est déjà utilisé');

    if (dto.email) {
        const existingEmail = await prisma.utilisateur.findUnique({ where: { email: dto.email } });
        if (existingEmail) throw new ConflictError('Cette adresse email est déjà utilisée');
    }

    if (dto.motDePasse) assertMotDePasseConforme(dto.motDePasse, dto.role);
    const motDePasseTemp = dto.motDePasse || genererMotDePasseTemp();
    const motDePasseHash = await hashPassword(motDePasseTemp);
    const isTemporaire = !dto.motDePasse;

    const user = await prisma.$transaction(async (tx) => {
        const u = await tx.utilisateur.create({
            data: {
                telephone: dto.telephone, email: dto.email ?? null,
                motDePasseHash, prenom: dto.prenom, nom: dto.nom,
                role: dto.role, idStructure: admin.idStructure,
                doitChangerMotDePasse: isTemporaire
            }
        });

        if (dto.role === Role.ASC || dto.role === Role.ASC_SUPERVISOR) {
            await tx.ascProfile.create({ data: { idUtilisateur: u.id, idStructure: admin.idStructure } });
        }
        if (dto.role === Role.MEDECIN) {
            await tx.medecinProfile.create({
                data: {
                    idUtilisateur: u.id,
                    idStructure: admin.idStructure,
                    // Facultatif : sans numerotation de bureaux, l'agent accompagne.
                    bureau: dto.bureau?.trim() || null,
                },
            });
        }
        if (dto.role === Role.PHARMACIEN) {
            await tx.pharmacienProfile.create({ data: { idUtilisateur: u.id, idStructure: admin.idStructure } });
        }

        return u;
    });

    // ── Envoi email si adresse disponible ────────────────────────────
    if (dto.email && isTemporaire) {
        try {
            await envoyerEmailAgent({
                destinataire: dto.email,
                prenomNom: `${dto.prenom} ${dto.nom}`,
                role: dto.role,
                nomStructure: admin.structure?.nom ?? 'votre structure',
                telephone: dto.telephone,
                motDePasseTemporaire: motDePasseTemp
            });
        } catch (emailError) {
            logger.error('Erreur envoi email agent', { error: emailError });
        }
    }

    return {
        agent: { id: user.id, telephone: user.telephone, prenom: user.prenom, nom: user.nom, role: user.role },
        motDePasseTemporaire: isTemporaire ? motDePasseTemp : undefined
    };
}

// ── ADMIN_STRUCTURE : désactiver un agent ────────────────────────
export async function desactiverAgent(adminId: string, agentId: string) {
    const admin = await prisma.utilisateur.findUnique({
        where: { id: adminId },
        include: { structure: true },
    });
    if (!admin?.idStructure) throw new ForbiddenError('Aucune structure assignée');
    if (admin.structure?.type === TypeStructure.PHARMACIE) {
        throw new ForbiddenError('La gestion des comptes de pharmacie est réservée au pharmacien titulaire');
    }

    const agent = await prisma.utilisateur.findUnique({ where: { id: agentId } });
    if (!agent || agent.idStructure !== admin.idStructure) {
        throw new ForbiddenError('Cet agent n\'appartient pas à votre structure');
    }

    return prisma.utilisateur.update({ where: { id: agentId }, data: { estActif: false } });
}

// ── ADMIN_STRUCTURE : stats de sa structure ──────────────────────
/**
 * La structure de l'administrateur, et si elle est hospitaliere.
 *
 * C'est tout ce dont le menu a besoin. Il le lisait dans `getStatsStructure`,
 * qui compte agents, consultations et patients : quand ce calcul echouait, les
 * entrees Pharmacies et Assurances disparaissaient. Une seule ligne lue ici.
 */
export async function maStructure(adminId: string) {
    const admin = await prisma.utilisateur.findUnique({
        where: { id: adminId },
        select: { idStructure: true, structure: { select: { id: true, nom: true, type: true } } },
    });
    if (!admin?.idStructure || !admin.structure) throw new ForbiddenError('Aucune structure assignée');
    const { id, nom, type } = admin.structure;
    return { id, nom, type, hospitaliere: estStructureHospitaliere(type) };
}

export async function getStatsStructure(adminId: string) {
    const admin = await prisma.utilisateur.findUnique({
        where: { id: adminId }, include: { structure: true }
    });
    if (!admin?.idStructure) throw new ForbiddenError('Aucune structure assignée');

    const [totalAgents, totalConsultations, totalPatients, structure] = await Promise.all([
        // Meme filtre que la liste "Mes agents" : l'admin de structure n'est
        // pas un agent, le compteur affichait un de plus que la liste.
        prisma.utilisateur.count({ where: { idStructure: admin.idStructure, role: { in: ROLES_AUTORISES }, estActif: true } }),
        prisma.consultation.count({ where: { asc: { idStructure: admin.idStructure } } }),
        prisma.patientProfile.count({ where: { idStructurePreferee: admin.idStructure } }),
        prisma.structureSante.findUnique({ where: { id: admin.idStructure } })
    ]);

    return { structure, totalAgents, totalConsultations, totalPatients };
}

/**
 * Definir — ou effacer — le bureau d'un medecin (EF-03).
 *
 * **Un bureau change** : un medecin demenage, un service est redecoupe.
 * Figer la valeur a la creation du compte aurait rendu le champ faux au bout
 * de quelques mois, et un bureau faux est pire que pas de bureau : le patient
 * y va.
 *
 * `null` efface : c'est le cas de l'hopital qui ne numerote pas ses bureaux et
 * ou l'agent accompagne le patient a pied.
 */
export async function definirBureau(
    auteur: JwtPayload,
    idAgent: string,
    bureau: string | null,
): Promise<{ id: string; nomComplet: string; bureau: string | null }> {
    const admin = await prisma.utilisateur.findUnique({
        where: { id: auteur.userId },
        select: { idStructure: true },
    });
    if (!admin?.idStructure) throw new ForbiddenError('Aucune structure rattachee a ce compte');

    // Un administrateur ne touche qu'aux medecins de sa structure.
    //
    // **L'appartenance se lit sur le compte, pas sur le profil.** Les deux
    // portent un `idStructure`, et ils divergent : `creerAgent` renseigne les
    // deux, mais tout ce qui cree un medecin autrement — le jeu de
    // demonstration, les jeux de test — ne remplit que le compte. La liste des
    // agents, l'orientation et `structureDe()` lisent tous le compte ; se
    // fonder sur le profil faisait echouer le garde sur des medecins
    // parfaitement legitimes.
    const medecin = await prisma.utilisateur.findFirst({
        where: { id: idAgent, role: Role.MEDECIN, idStructure: admin.idStructure },
        select: { prenom: true, nom: true, medecinProfile: { select: { id: true } } },
    });
    if (!medecin) throw new NotFoundError('Medecin introuvable dans cette structure');

    // Un medecin sans profil n'a nulle part ou poser son bureau. Le cas
    // n'arrive que sur des comptes anciens, et le signaler vaut mieux que de
    // laisser l'agent cliquer sans effet.
    const profil = medecin.medecinProfile;
    if (!profil) throw new NotFoundError('Ce compte medecin n a pas de profil ou enregistrer un bureau');

    const valeur = bureau?.trim() || null;
    await prisma.medecinProfile.update({ where: { id: profil.id }, data: { bureau: valeur } });

    return {
        id: idAgent,
        nomComplet: `${medecin.prenom} ${medecin.nom}`,
        bureau: valeur,
    };
}
