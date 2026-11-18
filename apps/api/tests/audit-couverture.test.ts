// Ce que le journal d'audit enregistre, et ce qu'il laisse passer.
//
// `shouldAudit` est une liste de chemins. Une liste se complete par oubli :
// le scan du QR n'y figurait pas avant le 2026-09-29, et la recherche dans le
// journal lui-meme n'y figurait pas avant le 2026-10-03. Ce fichier nomme ce
// qui doit y etre, pour qu'un oubli devienne visible.
import type { AuthRequest } from '../src/middlewares/auth.middleware';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    journalAudit: { create: jest.fn().mockResolvedValue({}) },
    patientProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    consultation: { findUnique: jest.fn().mockResolvedValue(null) },
    episodeSoins: { findUnique: jest.fn().mockResolvedValue(null) },
    vaccination: { findUnique: jest.fn().mockResolvedValue(null) },
    ordonnance: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/config/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));
jest.mock('../src/utils/request-context', () => ({ getRequestId: () => 'req-test' }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: { journalAudit: { create: M } };
};

import { auditRequest } from '../src/services/audit.service';

/**
 * Fait passer une requete par le middleware et dit si une ligne a ete ecrite.
 *
 * Le middleware journalise dans `res.on('finish')`, puis attend la resolution
 * du patient concerne : on laisse donc tourner la file de micro-taches avant
 * de regarder.
 */
async function journalise(methode: string, originalUrl: string, options: {
  connecte?: boolean;
  statut?: number;
  body?: Record<string, unknown>;
} = {}): Promise<boolean> {
  const { connecte = true, statut = 200, body = {} } = options;
  const ecouteurs: (() => void)[] = [];
  const req = {
    method: methode,
    originalUrl,
    path: originalUrl.replace(/^\/api\/v1\/[^/?]+/, '') || '/',
    params: {},
    query: {},
    body,
    get: () => undefined,
    ip: '10.0.0.1',
    ...(connecte ? { user: { userId: 'u1', role: 'MEDECIN', sessionId: 's1' } } : {}),
  } as unknown as AuthRequest;
  const res = {
    statusCode: statut,
    on: (evenement: string, f: () => void) => { if (evenement === 'finish') ecouteurs.push(f); },
  } as unknown as Parameters<typeof auditRequest>[1];

  auditRequest(req, res, () => undefined);
  for (const f of ecouteurs) f();
  await new Promise((r) => setImmediate(r));
  return prisma.journalAudit.create.mock.calls.length > 0;
}

beforeEach(() => jest.clearAllMocks());

// ── Ce qui doit laisser une trace ────────────────────────────────────

describe('les lectures qui doivent etre tracees', () => {
  it.each([
    ['une fiche patient', '/api/v1/patients/p1'],
    ['une consultation', '/api/v1/consultations/c1'],
    ['un export FHIR', '/api/v1/fhir/Patient/p1'],
    ['un export de donnees', '/api/v1/analytics/export?format=CSV'],
    // Scanner un QR, c'est consulter un dossier. Absent de la liste jusqu'au
    // 2026-09-29 : ni le comptoir pharmacie ni celui du laboratoire ne
    // laissaient de trace.
    ['un scan au laboratoire', '/api/v1/laboratoire/scan/QR-1'],
    ['un scan en pharmacie', '/api/v1/pharmacien/scan/QR-1'],
    // Consulter le journal, c'est voir les dossiers de tous les patients a la
    // fois. Absent de la liste jusqu'au 2026-10-03 : le seul endroit d'ou
    // l'on voit tout etait le seul qu'on ne voyait pas.
    ['la recherche dans le journal', '/api/v1/journal?idPatient=p1'],
    ["l'export du journal", '/api/v1/journal/export?du=2026-01-01'],
  ])('%s', async (_nom, url) => {
    expect(await journalise('GET', url)).toBe(true);
  });

  // Une ecriture est tracee quelle que soit la route : c'est la regle large,
  // et elle n'a pas a etre enumeree.
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s est trace partout', async (methode) => {
    expect(await journalise(methode, '/api/v1/parametres/systeme')).toBe(true);
  });

  // Un refus est une tentative : c'est souvent plus interessant qu'un succes.
  it('trace aussi un acces refuse', async () => {
    expect(await journalise('GET', '/api/v1/patients/p1', { statut: 403 })).toBe(true);
    const [args] = prisma.journalAudit.create.mock.calls[0] as [{ data: { statutHttp: number } }];
    expect(args.data.statutHttp).toBe(403);
  });
});

// ── Ce qui n'a pas a laisser de trace ────────────────────────────────

describe('ce qui n est pas trace, et pourquoi', () => {
  // Journaliser chaque appel de confort remplirait la table sans rien
  // apprendre, et noierait les lectures de dossier qui, elles, comptent.
  it.each([
    ['la liste des medicaments', '/api/v1/medicaments'],
    ['les parametres publics', '/api/v1/parametres/publics'],
    ['les notifications', '/api/v1/notifications/me'],
  ])('%s', async (_nom, url) => {
    expect(await journalise('GET', url)).toBe(false);
  });

  // Sans utilisateur, il n'y a personne a inscrire au journal — et la
  // colonne `idUtilisateur` est obligatoire.
  it('ne journalise rien pour une requete non authentifiee', async () => {
    expect(await journalise('GET', '/api/v1/patients/p1', { connecte: false })).toBe(false);
  });
});

// ── Ce que porte la ligne ────────────────────────────────────────────

describe('la ligne ecrite', () => {
  it('porte le code HTTP en colonne, pas seulement dans les metadonnees', async () => {
    await journalise('GET', '/api/v1/patients/p1', { statut: 200 });
    const [args] = prisma.journalAudit.create.mock.calls[0] as [{ data: { statutHttp: number } }];
    expect(args.data.statutHttp).toBe(200);
  });

  it('enregistre la ressource d apres le chemin complet, pas le chemin tronque', async () => {
    await journalise('GET', '/api/v1/laboratoire/scan/QR-1');
    const [args] = prisma.journalAudit.create.mock.calls[0] as [{ data: { ressource: string } }];
    expect(args.data.ressource).toBe('laboratoire');
  });

  it('enregistre l adresse IP, utile a une enquete', async () => {
    await journalise('GET', '/api/v1/patients/p1');
    const [args] = prisma.journalAudit.create.mock.calls[0] as [{ data: { ipAdresse: string } }];
    expect(args.data.ipAdresse).toBe('10.0.0.1');
  });

  it('ne conserve pas les identifiants secrets de validation du titulaire', async () => {
    await journalise('POST', '/api/v1/pharmacien/ventes/vente-1/annuler', {
      body: {
        motif: 'erreur de saisie',
        autorisationTitulaire: { telephone: '620000000', motDePasse: 'secret' },
      },
    });
    const [args] = prisma.journalAudit.create.mock.calls[0] as [{
      data: { metadonnees: { body: Record<string, unknown> } };
    }];
    expect(args.data.metadonnees.body['autorisationTitulaire']).toBe('[REDACTED]');
  });
});

describe('ce que la recherche publique ne laisse pas derriere elle', () => {
  // A1. Ce qu une personne cherche en pharmacie dit souvent ce dont elle
  // souffre. Une ligne « GET /recherche/produits?q=test de grossesse »
  // rattachee a un compte serait une donnee de sante creee par nous, dans
  // une table que personne ne pense a regarder sous cet angle.
  it('ne garde aucune trace d une recherche, meme d un compte connecte', async () => {
    const trace = await journalise('GET', '/api/v1/recherche/produits?q=paracetamol&prefecture=Conakry');
    expect(trace).toBe(false);
  });

  it('n en garde pas davantage pour un visiteur sans compte', async () => {
    const trace = await journalise('GET', '/api/v1/recherche/produits?q=doliprane&prefecture=Conakry', {
      connecte: false,
    });
    expect(trace).toBe(false);
  });
});
