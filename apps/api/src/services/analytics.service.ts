import { NiveauAlerteEpidemique, Prisma } from '../config/generated/client/client';
import { enCsv } from '../utils/csv';
import { prisma } from '../config/prisma';
import {
    AnalyticsFilters,
    HeatmapFilters,
    AlerteEpidemique,
    ExportFilters,
} from '../types/analytics.types';
import { withCache } from '../utils/cache';
import { getValeursParametres } from './parametres.service';

// ─── Dashboard général — statistiques globales ────────────
export async function getDashboardGlobal(filters: AnalyticsFilters) {
    const cacheKey = `analytics:dashboard:${filters.prefecture ?? 'all'}:${filters.debut ?? ''}:${filters.fin ?? ''}`;
    return withCache(cacheKey, 120, () => _getDashboardGlobal(filters));
}

async function _getDashboardGlobal(filters: AnalyticsFilters) {
    const where = buildDateWhere(filters);
    const periode = filters.debut || filters.fin ? buildPeriodFilter(filters) : undefined;
    // La prefecture filtre **tous** les indicateurs, par le lieu de residence
    // du patient (ASC : prefecture de leur structure). Elle ne filtrait que
    // les patients et les consultations : choisir Kindia mettait un nombre de
    // patients de Kindia a cote de vaccinations nationales.
    const patientDeLaPrefecture = filters.prefecture ? { patient: { prefecture: filters.prefecture } } : {};
    const whereVaccination: Prisma.VaccinationWhereInput = {
        ...patientDeLaPrefecture,
        ...(periode ? { administreLe: periode } : {}),
    };

    const [
        totalPatients,
        totalConsultations,
        totalVaccinations,
        patientsVaccines,
        totalReferencements,
        consultationsParStatut,
        topPathologies,
        totalAsc,
    ] = await Promise.all([
        prisma.patientProfile.count({
            where: filters.prefecture ? { prefecture: filters.prefecture } : {},
        }),
        prisma.consultation.count({ where }),
        prisma.vaccination.count({ where: whereVaccination }),
        // Patients vaccines au moins une fois : c'est ce que la jauge
        // rapporte au nombre de patients. Le nombre de doses n'est pas un taux.
        prisma.vaccination.groupBy({ by: ['idPatient'], where: whereVaccination }),
        prisma.referencement.count({
            where: {
                ...(filters.prefecture ? { consultation: patientDeLaPrefecture } : {}),
                ...(periode ? { creeLe: periode } : {}),
            },
        }),
        prisma.consultation.groupBy({
            by: ['statut'],
            _count: { statut: true },
            where,
        }),
        prisma.diagnostic.groupBy({
            by: ['libelle'],
            _count: { libelle: true },
            where: Object.keys(where).length > 0 ? { consultation: where } : {},
            orderBy: { _count: { libelle: 'desc' } },
            take: 10,
        }),
        prisma.ascProfile.count({
            where: filters.prefecture ? { structure: { prefecture: filters.prefecture } } : {},
        }),
    ]);

    return {
        kpis: {
            totalPatients,
            totalConsultations,
            totalVaccinations,
            patientsVaccines: patientsVaccines.length,
            totalReferencements,
            totalAsc,
        },
        consultationsParStatut: consultationsParStatut.map((c) => ({
            statut: c.statut,
            count: c._count.statut,
        })),
        topPathologies: topPathologies.map((d) => ({
            pathologie: d.libelle,
            count: d._count.libelle,
        })),
    };
}

const HEATMAP_MAX = 20_000;

// ─── Données cartographiques (Heatmap) ───────────────────
export async function getHeatmapData(filters: HeatmapFilters) {
    const whereConsultation: Prisma.ConsultationWhereInput = {};

    if (filters.debut || filters.fin) {
        whereConsultation.consulteeLE = buildPeriodFilter(filters);
    }

    if (filters.pathologie) {
        whereConsultation.diagnostics = {
            some: {
                libelle: { contains: filters.pathologie, mode: 'insensitive' },
            },
        };
    }

    const consultations = await prisma.consultation.findMany({
        where: whereConsultation,
        take: HEATMAP_MAX,
        include: {
            patient: {
                select: {
                    prefecture: true,
                    sousPrefecture: true,
                    latitude: true,
                    longitude: true,
                },
            },
            diagnostics: {
                select: { libelle: true },
            },
        },
    });

    const parPrefecture: Record<string, {
        prefecture: string;
        count: number;
        pathologies: Record<string, number>;
        latitude?: number;
        longitude?: number;
    }> = {};

    consultations.forEach((c) => {
        const pref = c.patient.prefecture;
        if (!parPrefecture[pref]) {
            parPrefecture[pref] = {
                prefecture: pref,
                count: 0,
                pathologies: {},
                latitude: c.patient.latitude ?? undefined,
                longitude: c.patient.longitude ?? undefined,
            };
        }
        parPrefecture[pref].count++;
        c.diagnostics.forEach((d) => {
            parPrefecture[pref].pathologies[d.libelle] =
                (parPrefecture[pref].pathologies[d.libelle] ?? 0) + 1;
        });
    });

    return Object.values(parPrefecture);
}

const ALERTES_DIAGNOSTICS_MAX = 50_000;

// ─── Alertes épidémiques ──────────────────────────────────
export async function getAlertesEpidemiques(): Promise<AlerteEpidemique[]> {
    const ilyA30Jours = new Date();
    ilyA30Jours.setDate(ilyA30Jours.getDate() - 30);

    const diagnostics = await prisma.diagnostic.findMany({
        where: {
            creeLe: { gte: ilyA30Jours },
        },
        take: ALERTES_DIAGNOSTICS_MAX,
        include: {
            consultation: {
                include: {
                    patient: { select: { prefecture: true } },
                },
            },
        },
    });

    const compteurs: Record<string, Record<string, number>> = {};
    diagnostics.forEach((d) => {
        const pathologie = d.libelle;
        const prefecture = d.consultation.patient.prefecture;
        if (!compteurs[pathologie]) compteurs[pathologie] = {};
        compteurs[pathologie][prefecture] =
            (compteurs[pathologie][prefecture] ?? 0) + 1;
    });

    const alertes: AlerteEpidemique[] = [];
    // Paludisme et Ebola sont reglables depuis la page Parametres du
    // super-admin ; les autres seuils restent fixes pour l'instant.
    const { alertes: seuilsConfigures } = await getValeursParametres();
    const SEUILS: Record<string, number> = {
        'Paludisme': seuilsConfigures.seuilPaludisme,
        'Ebola': seuilsConfigures.seuilEbola,
        'Choléra': 5,
        'Méningite': 3,
        'Rougeole': 5,
        'Fièvre jaune': 2,
    };

    Object.entries(compteurs).forEach(([pathologie, prefectures]) => {
        const seuil = SEUILS[pathologie] ?? 15;
        Object.entries(prefectures).forEach(([prefecture, nombre]) => {
            if (nombre >= seuil * 0.7) {
                alertes.push({
                    pathologie,
                    prefecture,
                    nombre,
                    seuil,
                    niveau:
                        nombre >= seuil * 1.5
                            ? 'URGENCE'
                            : nombre >= seuil
                                ? 'ALERTE'
                                : 'ATTENTION',
                    dateDetection: new Date(),
                });
            }
        });
    });

    return alertes.sort((a, b) => {
        const ordre = { URGENCE: 0, ALERTE: 1, ATTENTION: 2 };
        return ordre[a.niveau] - ordre[b.niveau];
    });
}

export async function detecterEtPersisterAlertesEpidemiques() {
    const alertes = await getAlertesEpidemiques();

    const persisted = await prisma.$transaction(
        alertes.map((alerte) =>
            prisma.alerteEpidemique.upsert({
                where: {
                    pathologie_prefecture_fenetreJours_statut: {
                        pathologie: alerte.pathologie,
                        prefecture: alerte.prefecture,
                        fenetreJours: 30,
                        statut: 'ACTIVE',
                    },
                },
                update: {
                    nombre: alerte.nombre,
                    seuil: alerte.seuil,
                    niveau: alerte.niveau as NiveauAlerteEpidemique,
                    dateDetection: new Date(),
                    metadonnees: { source: 'analytics-job' },
                },
                create: {
                    pathologie: alerte.pathologie,
                    prefecture: alerte.prefecture,
                    nombre: alerte.nombre,
                    seuil: alerte.seuil,
                    niveau: alerte.niveau as NiveauAlerteEpidemique,
                    metadonnees: { source: 'analytics-job' },
                },
            })
        )
    );

    return { total: persisted.length, alertes: persisted };
}

// ─── Taux de couverture vaccinale ─────────────────────────
export async function getCouvertureVaccinale(filters: AnalyticsFilters) {
    const wherePatient = filters.prefecture
        ? { prefecture: filters.prefecture }
        : {};

    const [totalPatients, vaccinations] = await Promise.all([
        prisma.patientProfile.count({ where: wherePatient }),
        prisma.vaccination.findMany({
            where: filters.prefecture
                ? { patient: { prefecture: filters.prefecture } }
                : {},
            select: { vaccinNom: true, idPatient: true },
        }),
    ]);

    const parVaccin: Record<string, Set<string>> = {};
    vaccinations.forEach((v) => {
        if (!parVaccin[v.vaccinNom]) parVaccin[v.vaccinNom] = new Set();
        parVaccin[v.vaccinNom].add(v.idPatient);
    });

    const couverture = Object.entries(parVaccin).map(([vaccin, patients]) => ({
        vaccin,
        patientsVaccines: patients.size,
        totalPatients,
        tauxCouverture:
            totalPatients > 0
                ? Math.round((patients.size / totalPatients) * 100)
                : 0,
    }));

    return {
        totalPatients,
        couverture: couverture.sort((a, b) => b.tauxCouverture - a.tauxCouverture),
        prefecture: filters.prefecture ?? 'toutes',
    };
}

// ─── Tendances temporelles ────────────────────────────────
export async function getTendances(filters: AnalyticsFilters) {
    const moisCount = 6;
    const tendances = [];

    for (let i = moisCount - 1; i >= 0; i--) {
        const debut = new Date();
        debut.setMonth(debut.getMonth() - i);
        debut.setDate(1);
        debut.setHours(0, 0, 0, 0);

        const fin = new Date(debut);
        fin.setMonth(fin.getMonth() + 1);
        fin.setDate(0);
        fin.setHours(23, 59, 59, 999);

        const whereBase = {
            ...(filters.prefecture && {
                patient: { prefecture: filters.prefecture },
            }),
        };

        const [consultations, vaccinations, referencements] = await Promise.all([
            prisma.consultation.count({
                where: { ...whereBase, consulteeLE: { gte: debut, lte: fin } },
            }),
            prisma.vaccination.count({
                where: {
                    ...(filters.prefecture && { patient: { prefecture: filters.prefecture } }),
                    administreLe: { gte: debut, lte: fin },
                },
            }),
            prisma.referencement.count({
                where: { creeLe: { gte: debut, lte: fin } },
            }),
        ]);

        tendances.push({
            mois: debut.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
            consultations,
            vaccinations,
            referencements,
        });
    }

    return tendances;
}

const EXPORT_MAX_LIMIT = 5_000;

// ─── Export données DHIS2 / CSV ───────────────────────────
export async function exporterDonnees(filters: ExportFilters) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 1_000, EXPORT_MAX_LIMIT);
    const skip = (page - 1) * limit;

    const where = {
        ...(filters.prefecture && {
            patient: { prefecture: filters.prefecture },
        }),
        ...(filters.debut || filters.fin
            ? { consulteeLE: buildPeriodFilter(filters) }
            : {}),
    };

    const [consultations, total] = await Promise.all([
        prisma.consultation.findMany({
            where,
            skip,
            take: limit,
            include: {
                patient: {
                    include: {
                        utilisateur: { select: { prenom: true, nom: true } },
                    },
                },
                diagnostics: true,
                constantes: true,
            },
            orderBy: { consulteeLE: 'desc' },
        }),
        prisma.consultation.count({ where }),
    ]);

    const meta = { total, page, limit, totalPages: Math.ceil(total / limit) };

    if (filters.format === 'CSV') {
        // Cet export joignait les champs sur une virgule, sans guillemets ni
        // echappement : un motif de consultation comme « Fievre, toux »
        // decalait toutes les colonnes suivantes — et le fichier s'ouvrait
        // quand meme, donc personne ne le voyait. Il n'avait pas non plus de
        // BOM, et Excel en francais affichait « PrÃ©fecture ».
        //
        // `enCsv` echappe, pose le BOM et separe par des points-virgules, ce
        // qu'attend Excel en francais. Trouve le 2026-10-03 en ecrivant
        // l'export du journal d'audit (EF-12-05).
        const contenu = enCsv(
            ['Date', 'Patient', 'Prefecture', 'Motif', 'Diagnostics', 'Temperature', 'SpO2', 'Statut'],
            consultations.map((c) => [
                c.consulteeLE.toISOString().split('T')[0],
                `${c.patient.utilisateur.prenom} ${c.patient.utilisateur.nom}`,
                c.patient.prefecture,
                c.motifPrincipal,
                c.diagnostics.map((d) => d.libelle).join(' | '),
                c.constantes?.temperature ?? '',
                c.constantes?.spo2 ?? '',
                c.statut,
            ])
        );

        return { format: 'CSV', contenu, meta };
    }

    if (filters.format === 'DHIS2') {
        const dataValues = consultations.flatMap((c) =>
            c.diagnostics.map((diagnostic) => ({
                dataElement: diagnostic.codeIcd11 ?? diagnostic.libelle,
                orgUnit: c.patient.prefecture,
                period: c.consulteeLE.toISOString().slice(0, 10).replace(/-/g, ''),
                value: 1,
                categoryOptionCombo: 'default',
                comment: c.motifPrincipal,
            }))
        );

        return {
            format: 'DHIS2',
            contenu: {
                dataSet: 'BAOBAOHEALTH_MORBIDITE',
                completeDate: new Date().toISOString().slice(0, 10),
                dataValues,
            },
            meta,
        };
    }

    return {
        format: 'JSON',
        contenu: consultations,
        meta,
    };
}

// ─── Helpers ──────────────────────────────────────────────
function buildDateWhere(filters: AnalyticsFilters): Prisma.ConsultationWhereInput {
    const where: Prisma.ConsultationWhereInput = {};
    if (filters.prefecture) {
        where.patient = { prefecture: filters.prefecture };
    }
    if (filters.debut || filters.fin) {
        where.consulteeLE = buildPeriodFilter(filters);
    }
    return where;
}

function buildPeriodFilter(filters: { debut?: string; fin?: string }): Prisma.DateTimeFilter {
    const periode: Prisma.DateTimeFilter = {};
    if (filters.debut) periode.gte = new Date(filters.debut);
    if (filters.fin) periode.lte = new Date(filters.fin);
    return periode;
}
