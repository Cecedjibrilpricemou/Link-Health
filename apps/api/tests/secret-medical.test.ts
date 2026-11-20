// Le secret medical, pour ceux qui ne soignent pas.
//
// L'administrateur d'une structure dirige tout, sauf le soin : il suit le
// parcours (admissions, episodes, avancement des analyses) sans en lire le
// contenu. Ce fichier tient trois choses :
//   - le filtre retire les valeurs et les commentaires, et garde le reste ;
//   - pose sur l'accueil et le laboratoire, il vaut pour TOUTES leurs
//     reponses : verifie ici par de vrais appels HTTP ;
//   - les actes de soin et les lectures medicales ne lui sont plus ouverts.
process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://test:test@127.0.0.1:5432/test';

import express from 'express';
import type { AddressInfo } from 'net';
import type { Role } from '../src/config/generated/client/client';
import { masquerValeursAnalyse } from '../src/middlewares/secret-medical.middleware';

jest.mock('../src/config/prisma', () => ({ prisma: {} }));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/config/sentry', () => ({ captureError: jest.fn() }));
// L'identite vient d'un en-tete : on teste le filtre, pas la session.
jest.mock('../src/middlewares/auth.middleware', () => ({
  authenticate: (req: { headers: Record<string, string>; user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { userId: 'u-1', role: req.headers['x-role'], sessionId: 's' };
    next();
  },
}));
jest.mock('../src/services/laboratoire.service', () => ({
  getDemande: jest.fn(), tableauDeBord: jest.fn(), fileDuLabo: jest.fn(),
}));
jest.mock('../src/services/hopital.service', () => ({ getEpisode: jest.fn() }));

type M = jest.Mock;
const labo = jest.requireMock('../src/services/laboratoire.service') as { getDemande: M; tableauDeBord: M };
const hopital = jest.requireMock('../src/services/hopital.service') as { getEpisode: M };

/* eslint-disable @typescript-eslint/no-require-imports */
const routesLabo = require('../src/routes/laboratoire.routes').default;
const routesHopital = require('../src/routes/hopital.routes').default;
const routesMedecin = require('../src/routes/medecin.routes').default;
const routesConsultation = require('../src/routes/consultation.routes').default;
const routesPatient = require('../src/routes/patient.routes').default;
const routesResultats = require('../src/routes/resultats.routes').default;
const routesFhir = require('../src/routes/fhir.routes').default;
const routesSync = require('../src/routes/sync.routes').default;
const routesVaccination = require('../src/routes/vaccination.routes').default;
const routesNotification = require('../src/routes/notification.routes').default;

/** Une demande d'analyse validee, avec sa valeur et ses commentaires. */
function demande() {
  return {
    id: 'da-1', numero: 'DA-2026-000001', statut: 'VALIDEE', urgence: 'ROUTINE',
    indicationClinique: 'Fievre', commentaireLaboratoire: 'Hemolyse legere', commentaireMedecin: 'A recontroler',
    libereePar: { id: 'm', prenom: 'F', nom: 'C' }, valideeLe: '2026-11-20T10:00:00.000Z',
    lignes: [{ id: 'l1', examen: { libelle: 'Hemoglobine', codeLoinc: '718-7' }, resultat: { valeur: '7.1', interpretation: 'CRITIQUE' } }],
  };
}

// ── Le filtre ────────────────────────────────────────────────────────

describe('masquerValeursAnalyse', () => {
  it('retire valeurs et commentaires, garde examens, statut et dates', () => {
    const m = masquerValeursAnalyse(demande());
    expect(m.lignes[0]).toEqual({ id: 'l1', examen: { libelle: 'Hemoglobine', codeLoinc: '718-7' }, resultat: null });
    expect([m.commentaireLaboratoire, m.commentaireMedecin, m.libereePar]).toEqual([null, null, null]);
    expect([m.statut, m.numero, m.valideeLe, m.indicationClinique]).toEqual(['VALIDEE', 'DA-2026-000001', '2026-11-20T10:00:00.000Z', 'Fievre']);
  });

  it('a toute profondeur : episode, listes, tableau de bord', () => {
    const corps = {
      success: true,
      data: { episode: { demandesAnalyse: [demande(), demande()] }, file: { items: [demande()] } },
    };
    const m = masquerValeursAnalyse(corps);
    const toutes = [...m.data.episode.demandesAnalyse, ...m.data.file.items];
    expect(toutes.every((d) => d.lignes.every((l) => l.resultat === null) && d.commentaireMedecin === null)).toBe(true);
  });

  it('ne touche ni l original, ni ce qui n est pas une analyse', () => {
    const original = demande();
    masquerValeursAnalyse(original);
    expect(original.lignes[0]!.resultat).not.toBeNull();
    const ordonnance = { lignes: [{ posologie: '1 cp' }], commentaireMedecin: 'garde' };
    expect(masquerValeursAnalyse(ordonnance)).toEqual(ordonnance);
    const date = new Date('2026-01-01');
    expect(masquerValeursAnalyse({ le: date }).le).toBe(date);
  });
});

// ── Pose sur les routeurs : de vrais appels ──────────────────────────

let base = '';
let serveur: ReturnType<express.Express['listen']>;
beforeAll((fait) => {
  const app = express();
  app.use(express.json());
  app.use('/laboratoire', routesLabo);
  app.use('/hopital', routesHopital);
  serveur = app.listen(0, () => {
    base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    fait();
  });
});
afterAll((fait) => { serveur.close(() => fait()); });
beforeEach(() => {
  jest.clearAllMocks();
  labo.getDemande.mockResolvedValue(demande());
  labo.tableauDeBord.mockResolvedValue({ aRecevoir: 1, fileUrgente: [demande()], prochainsPrelevements: [] });
  hopital.getEpisode.mockResolvedValue({ id: 'ep-1', statut: 'EN_COURS', demandesAnalyse: [demande()] });
});

async function lire(chemin: string, role: Role) {
  const r = await fetch(base + chemin, { headers: { 'x-role': role } });
  return { statut: r.status, corps: (await r.json()) as { data: Record<string, unknown> } };
}
const valeurs = (corps: unknown) => JSON.stringify(corps).includes('"valeur":"7.1"');

describe('l administration suit le parcours, sans en lire le contenu', () => {
  it('laboratoire : la demande et le tableau de bord, sans valeurs', async () => {
    const d = await lire('/laboratoire/demandes/da-1', 'ADMIN_STRUCTURE');
    expect(d.statut).toBe(200);
    expect(valeurs(d.corps)).toBe(false);
    expect(JSON.stringify(d.corps)).toContain('Hemoglobine');

    const t = await lire('/laboratoire/tableau-de-bord', 'ADMIN_STRUCTURE');
    expect(t.statut).toBe(200);
    expect(valeurs(t.corps)).toBe(false);
  });

  it('le laborantin, lui, voit les valeurs qu il produit', async () => {
    const d = await lire('/laboratoire/demandes/da-1', 'TECHNICIEN_LABO');
    expect(valeurs(d.corps)).toBe(true);
  });

  it('accueil de l hopital : la fiche d episode, sans valeurs, pour l admin comme pour l accueil', async () => {
    for (const role of ['ADMIN_STRUCTURE', 'AGENT_ACCUEIL'] as const) {
      const e = await lire('/hopital/episodes/ep-1', role);
      expect(e.statut).toBe(200);
      expect(valeurs(e.corps)).toBe(false);
    }
    expect(valeurs((await lire('/hopital/episodes/ep-1', 'MEDECIN')).corps)).toBe(true);
  });
});

// ── Les gardes : ce qui n'est plus ouvert a l'administration ─────────

type Couche = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] }; handle?: unknown };
function rolesPour(routeur: { stack: Couche[] }, methode: string, chemin: string): string[] | null {
  const globales: string[][] = [];
  for (const c of routeur.stack) {
    if (!c.route) {
      const r = (c.handle as { roles?: readonly string[] })?.roles;
      if (r) globales.push([...r]);
      continue;
    }
    if (c.route.path !== chemin || !c.route.methods[methode]) continue;
    const propres = c.route.stack.map((x) => (x.handle as { roles?: readonly string[] })?.roles).filter((r): r is readonly string[] => !!r).map((r) => [...r]);
    const toutes = [...globales, ...propres];
    return toutes.length ? toutes.reduce((a, b) => a.filter((x) => b.includes(x))) : [];
  }
  return null;
}

describe('les actes et les lectures de soin sont fermes a l administration', () => {
  it('a l hopital, les actes medicaux sont au seul medecin', () => {
    for (const [m, c] of [
      ['post', '/episodes/:id/cloturer'], ['post', '/episodes/:id/consultation'], ['post', '/episodes/:id/demandes-analyse'],
      ['get', '/demandes-analyse/:id'], ['post', '/demandes-analyse/:id/annuler'], ['get', '/demandes-analyse/:id/document'],
    ] as const) {
      expect({ c, roles: rolesPour(routesHopital, m, c) }).toEqual({ c, roles: ['MEDECIN'] });
    }
  });

  it('au laboratoire, saisir des resultats et imprimer le compte rendu sont au laborantin', () => {
    expect(rolesPour(routesLabo, 'put', '/demandes/:id/resultats')).toEqual(['TECHNICIEN_LABO']);
    expect(rolesPour(routesLabo, 'post', '/demandes/:id/valider')).toEqual(['TECHNICIEN_LABO']);
    expect(rolesPour(routesLabo, 'get', '/demandes/:id/compte-rendu')).toEqual(['TECHNICIEN_LABO']);
    // L'activite reste ouverte a l'administration.
    expect(rolesPour(routesLabo, 'get', '/tableau-de-bord')).toContain('ADMIN_STRUCTURE');
    expect(rolesPour(routesLabo, 'put', '/plateau-technique')).toContain('ADMIN_STRUCTURE');
  });

  it('l espace medecin est au seul medecin', () => {
    for (const [m, c] of [['get', '/dashboard'], ['get', '/consultations'], ['put', '/consultations/:id/valider'], ['put', '/referencements/:id/repondre']] as const) {
      expect(rolesPour(routesMedecin, m, c)).toEqual(['MEDECIN']);
    }
  });

  it('consultations, fiche patient, resultats, export, synchronisation : plus d administration de structure', () => {
    const lectures: [{ stack: Couche[] }, string, string][] = [
      [routesConsultation, 'get', '/'], [routesConsultation, 'get', '/:id'],
      [routesPatient, 'get', '/'], [routesPatient, 'get', '/:id'],
      [routesResultats, 'get', '/alertes'],
      [routesFhir, 'get', '/patients/:id'],
      [routesSync, 'get', '/changes'],
      [routesVaccination, 'get', '/rappels'],
      [routesNotification, 'post', '/referencement/:id'],
    ];
    for (const [routeur, m, c] of lectures) {
      const roles = rolesPour(routeur, m, c);
      expect({ c, roles }).not.toEqual({ c, roles: null });
      expect({ c, admin: roles!.includes('ADMIN_STRUCTURE') }).toEqual({ c, admin: false });
    }
  });
});
