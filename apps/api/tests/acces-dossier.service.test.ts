// L'acces du medecin a l'historique du patient, sur son accord.
//
// Le medecin soigne la visite qu'il recoit sans rien demander ; au-dela,
// c'est le patient qui ouvre son histoire, pour ce medecin et cet episode,
// jusqu'a la cloture plus trente jours. Ces tests disent les deux portes
// (l'accord, le bris de glace), et qu'il n'y en a pas de troisieme.
import {
  accorderAcces,
  assertHistoriqueSiMedecin,
  demanderAccesDossier,
  etatAcces,
  expireLe,
  filtreAutorisationActive,
  filtrePatientsLisibles,
  historiquePatient,
  mesAutorisations,
  peutLireHistorique,
  refuserAcces,
  relancerDemande,
  retirerAcces,
} from '../src/services/acces-dossier.service';
import { JwtPayload } from '../src/types/auth.types';
import { ConflictError, ForbiddenError, NotFoundError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    autorisationAccesDossier: {
      findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
      create: jest.fn(), update: jest.fn(),
    },
    brisDeGlace: { findFirst: jest.fn() },
    patientProfile: { findUnique: jest.fn() },
    consultation: { findMany: jest.fn() },
    vaccination: { findMany: jest.fn() },
  },
}));
jest.mock('../src/services/notification.service', () => ({ notifierSansBloquer: jest.fn() }));
jest.mock('../src/services/email.service', () => ({ envoyerDemandeAccesDossier: jest.fn() }));
jest.mock('../src/services/laboratoire.service', () => ({ examensSuivisDuPatient: jest.fn() }));

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    autorisationAccesDossier: { findUnique: M; findUniqueOrThrow: M; findFirst: M; findMany: M; create: M; update: M };
    brisDeGlace: { findFirst: M };
    patientProfile: { findUnique: M };
    consultation: { findMany: M };
    vaccination: { findMany: M };
  };
};
const { notifierSansBloquer } = jest.requireMock('../src/services/notification.service') as { notifierSansBloquer: M };
const { envoyerDemandeAccesDossier } = jest.requireMock('../src/services/email.service') as { envoyerDemandeAccesDossier: M };
const { examensSuivisDuPatient } = jest.requireMock('../src/services/laboratoire.service') as { examensSuivisDuPatient: M };

const JOUR = 24 * 60 * 60 * 1000;
const MAINTENANT = new Date('2026-11-20T10:00:00Z');
const medecin = { userId: 'med-1', role: 'MEDECIN', sessionId: 's' } as JwtPayload;
const asc = { userId: 'asc-1', role: 'ASC', sessionId: 's' } as JwtPayload;

/** Une ligne telle que la lit `VUE_SELECT`. */
function ligne(o: Partial<{ id: string; statut: string; closLe: Date | null; sansEpisode: boolean; relanceeLe: Date | null; demandeeLe: Date }> = {}) {
  return {
    id: o.id ?? 'aut-1',
    statut: o.statut ?? 'DEMANDEE',
    demandeeLe: o.demandeeLe ?? new Date('2026-11-18T08:00:00Z'),
    decideeLe: null,
    retireeLe: null,
    relanceeLe: o.relanceeLe ?? null,
    medecin: { prenom: 'Ibrahima', nom: 'Sow' },
    episode: o.sansEpisode ? null : { closLe: o.closLe ?? null, structure: { nom: 'Hopital Donka' } },
    rendezVous: { prevuLe: new Date('2026-11-22T09:00:00Z') },
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  prisma.patientProfile.findUnique.mockResolvedValue({ id: 'pat-1' });
});

// ── La regle ─────────────────────────────────────────────────────────

describe('filtreAutorisationActive — accordee, et episode pas clos depuis trente jours', () => {
  it('borne a la cloture plus trente jours, episode en cours compris', () => {
    const f = filtreAutorisationActive(MAINTENANT);
    expect(f.statut).toBe('ACCORDEE');
    expect(f.episode).toEqual({
      is: { OR: [{ closLe: null }, { closLe: { gt: new Date(MAINTENANT.getTime() - 30 * JOUR) } }] },
    });
  });

  it('expireLe : rien tant que l episode court, trente jours apres sa cloture', () => {
    expect(expireLe(null)).toBeNull();
    expect(expireLe(new Date('2026-11-01T00:00:00Z'))).toEqual(new Date('2026-12-01T00:00:00Z'));
  });
});

describe('peutLireHistorique — deux portes, et deux seulement', () => {
  it('l accord du patient, encore valable', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue({ id: 'aut-1' });
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    await expect(peutLireHistorique(medecin, 'pat-1', MAINTENANT)).resolves.toBe(true);
    expect(prisma.autorisationAccesDossier.findFirst.mock.calls[0][0].where).toMatchObject({
      idPatient: 'pat-1', idMedecin: 'med-1', statut: 'ACCORDEE',
    });
  });

  it('un bris de glace en cours, ouvert par lui', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(null);
    prisma.brisDeGlace.findFirst.mockResolvedValue({ id: 'bdg-1' });
    await expect(peutLireHistorique(medecin, 'pat-1', MAINTENANT)).resolves.toBe(true);
    expect(prisma.brisDeGlace.findFirst.mock.calls[0][0].where).toEqual({
      idPatient: 'pat-1', idAuteur: 'med-1', refermeLe: null, expireLe: { gt: MAINTENANT },
    });
  });

  it('ni l un ni l autre : non, meme s il le suit', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(null);
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    await expect(peutLireHistorique(medecin, 'pat-1', MAINTENANT)).resolves.toBe(false);
  });
});

describe('assertHistoriqueSiMedecin — le garde des lectures existantes', () => {
  it('refuse un medecin sans accord, en nommant le bris de glace', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(null);
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    const e = await assertHistoriqueSiMedecin(medecin, 'pat-1').catch((x) => x);
    expect(e).toBeInstanceOf(ForbiddenError);
    expect(e.message).toMatch(/bris de glace/);
  });

  it('laisse passer un medecin autorise', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue({ id: 'aut-1' });
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    await expect(assertHistoriqueSiMedecin(medecin, 'pat-1')).resolves.toBeUndefined();
  });

  it('ne touche pas aux autres roles : ils gardent leurs regles', async () => {
    await expect(assertHistoriqueSiMedecin(asc, 'pat-1')).resolves.toBeUndefined();
    expect(prisma.autorisationAccesDossier.findFirst).not.toHaveBeenCalled();
  });
});

describe('filtrePatientsLisibles — la meme regle, pour une liste', () => {
  it('un medecin : l accord actif ou le bris de glace en cours', () => {
    const f = filtrePatientsLisibles(medecin, MAINTENANT);
    expect(f.OR).toEqual([
      { autorisationsAcces: { some: { idMedecin: 'med-1', ...filtreAutorisationActive(MAINTENANT) } } },
      { brisDeGlace: { some: { idAuteur: 'med-1', refermeLe: null, expireLe: { gt: MAINTENANT } } } },
    ]);
  });

  it('les autres roles : aucun filtre ajoute', () => {
    expect(filtrePatientsLisibles(asc, MAINTENANT)).toEqual({});
  });
});

// ── La demande ───────────────────────────────────────────────────────

describe('demanderAccesDossier — la demande part avec le rendez-vous', () => {
  const d = { idPatient: 'pat-1', idMedecin: 'med-1', idEpisode: 'ep-1', idRendezVous: 'rdv-1', prevuLe: new Date('2026-11-22T09:00:00Z') };
  const aPrevenir = (email: string | null) => ({
    medecin: { prenom: 'Ibrahima', nom: 'Sow' },
    patient: { utilisateur: { id: 'pat-u', prenom: 'Awa', nom: 'Diallo', email } },
  });

  it('cree la demande, previent le patient dans son espace et par courriel', async () => {
    prisma.autorisationAccesDossier.findUnique.mockResolvedValue(null);
    prisma.autorisationAccesDossier.create.mockResolvedValue({ id: 'aut-1' });
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(aPrevenir('awa@exemple.test'));

    await demanderAccesDossier(d);

    expect(prisma.autorisationAccesDossier.create.mock.calls[0][0].data).toEqual({
      idPatient: 'pat-1', idMedecin: 'med-1', idEpisode: 'ep-1', idRendezVous: 'rdv-1',
    });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'pat-u', type: 'ACCES_DOSSIER_DEMANDE', lienAction: '/patient/acces-dossier',
    }));
    expect(envoyerDemandeAccesDossier).toHaveBeenCalledWith(expect.objectContaining({
      destinataire: 'awa@exemple.test', prenomNom: 'Awa Diallo', medecin: 'Dr Ibrahima Sow',
    }));
  });

  // Un nom d'etablissement peut reveler la nature du soin.
  it('ne nomme pas la structure dans la notification', async () => {
    prisma.autorisationAccesDossier.findUnique.mockResolvedValue(null);
    prisma.autorisationAccesDossier.create.mockResolvedValue({ id: 'aut-1' });
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(aPrevenir(null));
    await demanderAccesDossier(d);
    const n = notifierSansBloquer.mock.calls[0][0];
    expect(`${n.titre} ${n.contenu}`).not.toMatch(/Donka|Hopital/i);
  });

  it('sans adresse : la notification seule', async () => {
    prisma.autorisationAccesDossier.findUnique.mockResolvedValue(null);
    prisma.autorisationAccesDossier.create.mockResolvedValue({ id: 'aut-1' });
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(aPrevenir(null));
    await demanderAccesDossier(d);
    expect(notifierSansBloquer).toHaveBeenCalledTimes(1);
    expect(envoyerDemandeAccesDossier).not.toHaveBeenCalled();
  });

  // Un refus ne se redemande pas, et un rendez-vous deplace ne double pas la demande.
  it('ne refait pas une demande deja posee pour cet episode', async () => {
    prisma.autorisationAccesDossier.findUnique.mockResolvedValue({ id: 'aut-0' });
    await demanderAccesDossier(d);
    expect(prisma.autorisationAccesDossier.findUnique.mock.calls[0][0].where).toEqual({
      idPatient_idMedecin_idEpisode: { idPatient: 'pat-1', idMedecin: 'med-1', idEpisode: 'ep-1' },
    });
    expect(prisma.autorisationAccesDossier.create).not.toHaveBeenCalled();
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });

  it('ne fait jamais echouer la prise du rendez-vous', async () => {
    prisma.autorisationAccesDossier.findUnique.mockRejectedValue(new Error('base indisponible'));
    await expect(demanderAccesDossier(d)).resolves.toBeUndefined();
  });

  it('un courriel en echec n empeche pas la demande', async () => {
    prisma.autorisationAccesDossier.findUnique.mockResolvedValue(null);
    prisma.autorisationAccesDossier.create.mockResolvedValue({ id: 'aut-1' });
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(aPrevenir('awa@exemple.test'));
    envoyerDemandeAccesDossier.mockRejectedValue(new Error('smtp'));
    await expect(demanderAccesDossier(d)).resolves.toBeUndefined();
    expect(notifierSansBloquer).toHaveBeenCalledTimes(1);
  });
});

// ── Cote patient ─────────────────────────────────────────────────────

describe('mesAutorisations — ce que le patient a sous les yeux', () => {
  it('les demandes en attente d abord, et l accord perime dit expire', async () => {
    jest.useFakeTimers().setSystemTime(MAINTENANT);
    try {
      prisma.autorisationAccesDossier.findMany.mockResolvedValue([
        ligne({ id: 'a-refus', statut: 'REFUSEE' }),
        ligne({ id: 'a-vieux', statut: 'ACCORDEE', closLe: new Date(MAINTENANT.getTime() - 31 * JOUR) }),
        ligne({ id: 'a-actif', statut: 'ACCORDEE', closLe: new Date(MAINTENANT.getTime() - 29 * JOUR) }),
        ligne({ id: 'a-attente', statut: 'DEMANDEE' }),
      ]);
      const vues = await mesAutorisations('pat-u', MAINTENANT);
      expect(vues.map((v) => [v.id, v.statut])).toEqual([
        ['a-attente', 'DEMANDEE'], ['a-actif', 'ACCORDEE'], ['a-refus', 'REFUSEE'], ['a-vieux', 'EXPIREE'],
      ]);
      expect(vues[1]!.expireLe).toBe(new Date(MAINTENANT.getTime() + JOUR).toISOString());
      expect(vues[0]).toMatchObject({ medecin: 'Dr Ibrahima Sow', structure: 'Hopital Donka' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('404 sans profil patient', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(mesAutorisations('x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('accorderAcces', () => {
  const aPatient = (statut: string, closLe: Date | null = null, sansEpisode = false) => ({
    id: 'aut-1', statut, idMedecin: 'med-1',
    episode: sansEpisode ? null : { closLe },
    patient: { utilisateur: { prenom: 'Awa', nom: 'Diallo' } },
  });

  it('accorde, et le medecin le sait', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(aPatient('DEMANDEE'));
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(ligne({ statut: 'ACCORDEE' }));

    const vue = await accorderAcces('pat-u', 'aut-1');

    // On ne touche qu'a ses propres demandes.
    expect(prisma.autorisationAccesDossier.findFirst.mock.calls[0][0].where).toEqual({ id: 'aut-1', idPatient: 'pat-1' });
    expect(prisma.autorisationAccesDossier.update.mock.calls[0][0].data).toMatchObject({ statut: 'ACCORDEE', retireeLe: null });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'med-1', type: 'ACCES_DOSSIER_ACCORDE',
    }));
    expect(vue.statut).toBe('ACCORDEE');
  });

  it('le patient peut changer d avis apres un refus ou un retrait', async () => {
    for (const statut of ['REFUSEE', 'RETIREE']) {
      prisma.autorisationAccesDossier.update.mockClear();
      prisma.autorisationAccesDossier.findFirst.mockResolvedValue(aPatient(statut));
      prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(ligne({ statut: 'ACCORDEE' }));
      await accorderAcces('pat-u', 'aut-1');
      expect(prisma.autorisationAccesDossier.update).toHaveBeenCalledTimes(1);
    }
  });

  it('deja accorde : rien a ecrire, personne a prevenir', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(aPatient('ACCORDEE'));
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(ligne({ statut: 'ACCORDEE' }));
    await accorderAcces('pat-u', 'aut-1');
    expect(prisma.autorisationAccesDossier.update).not.toHaveBeenCalled();
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });

  it('refuse un accord mort-ne : episode clos depuis plus de trente jours, ou disparu', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(aPatient('DEMANDEE', new Date(Date.now() - 31 * JOUR)));
    await expect(accorderAcces('pat-u', 'aut-1')).rejects.toBeInstanceOf(ConflictError);
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(aPatient('DEMANDEE', null, true));
    await expect(accorderAcces('pat-u', 'aut-1')).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.autorisationAccesDossier.update).not.toHaveBeenCalled();
  });

  it('accepte un episode clos depuis moins de trente jours', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(aPatient('DEMANDEE', new Date(Date.now() - 29 * JOUR)));
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(ligne({ statut: 'ACCORDEE' }));
    await accorderAcces('pat-u', 'aut-1');
    expect(prisma.autorisationAccesDossier.update).toHaveBeenCalledTimes(1);
  });

  it('404 sur la demande d un autre patient', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(null);
    await expect(accorderAcces('pat-u', 'aut-x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('refuserAcces et retirerAcces', () => {
  const a = (statut: string) => ({
    id: 'aut-1', statut, idMedecin: 'med-1', episode: { closLe: null },
    patient: { utilisateur: { prenom: 'Awa', nom: 'Diallo' } },
  });

  it('refuser : seulement une demande en attente', async () => {
    for (const statut of ['ACCORDEE', 'REFUSEE', 'RETIREE']) {
      prisma.autorisationAccesDossier.findFirst.mockResolvedValue(a(statut));
      await expect(refuserAcces('pat-u', 'aut-1')).rejects.toBeInstanceOf(ConflictError);
    }
    expect(prisma.autorisationAccesDossier.update).not.toHaveBeenCalled();

    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(a('DEMANDEE'));
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(ligne({ statut: 'REFUSEE' }));
    await refuserAcces('pat-u', 'aut-1');
    expect(prisma.autorisationAccesDossier.update.mock.calls[0][0].data).toMatchObject({ statut: 'REFUSEE' });
  });

  it('retirer : seulement un accord donne, avec effet immediat', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(a('DEMANDEE'));
    await expect(retirerAcces('pat-u', 'aut-1')).rejects.toBeInstanceOf(ConflictError);

    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(a('ACCORDEE'));
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue(ligne({ statut: 'RETIREE' }));
    await retirerAcces('pat-u', 'aut-1');
    const data = prisma.autorisationAccesDossier.update.mock.calls[0][0].data;
    expect(data.statut).toBe('RETIREE');
    expect(data.retireeLe).toBeInstanceOf(Date);
  });
});

// ── Cote medecin ─────────────────────────────────────────────────────

describe('etatAcces — ou en est le medecin', () => {
  it('aucune demande', async () => {
    prisma.autorisationAccesDossier.findMany.mockResolvedValue([]);
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    await expect(etatAcces(medecin, 'pat-1', MAINTENANT)).resolves.toEqual({
      etat: 'AUCUNE', expireLe: null, peutRelancer: false, brisDeGlaceJusquau: null, peutLire: false,
    });
  });

  it('l accord actif prime sur une demande plus recente', async () => {
    prisma.autorisationAccesDossier.findMany.mockResolvedValue([
      ligne({ id: 'recente', statut: 'DEMANDEE' }), ligne({ id: 'ancienne', statut: 'ACCORDEE' }),
    ]);
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    const e = await etatAcces(medecin, 'pat-1', MAINTENANT);
    expect(e).toMatchObject({ etat: 'ACCORDEE', peutLire: true, peutRelancer: false });
  });

  it('relancer : une demande sans reponse, pas sollicitee depuis un jour', async () => {
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    prisma.autorisationAccesDossier.findMany.mockResolvedValue([
      ligne({ statut: 'DEMANDEE', demandeeLe: new Date(MAINTENANT.getTime() - 25 * 3600_000) }),
    ]);
    expect((await etatAcces(medecin, 'pat-1', MAINTENANT)).peutRelancer).toBe(true);

    prisma.autorisationAccesDossier.findMany.mockResolvedValue([
      ligne({ statut: 'DEMANDEE', demandeeLe: new Date(MAINTENANT.getTime() - 3 * JOUR), relanceeLe: new Date(MAINTENANT.getTime() - 3600_000) }),
    ]);
    expect((await etatAcces(medecin, 'pat-1', MAINTENANT)).peutRelancer).toBe(false);
  });

  it('un refus ne se relance pas', async () => {
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    prisma.autorisationAccesDossier.findMany.mockResolvedValue([
      ligne({ statut: 'REFUSEE', demandeeLe: new Date(MAINTENANT.getTime() - 5 * JOUR) }),
    ]);
    expect(await etatAcces(medecin, 'pat-1', MAINTENANT)).toMatchObject({ etat: 'REFUSEE', peutRelancer: false, peutLire: false });
  });

  it('le bris de glace ouvre la lecture, et dit jusqu a quand', async () => {
    const jusqua = new Date(MAINTENANT.getTime() + 3600_000);
    prisma.autorisationAccesDossier.findMany.mockResolvedValue([ligne({ statut: 'REFUSEE' })]);
    prisma.brisDeGlace.findFirst.mockResolvedValue({ expireLe: jusqua });
    expect(await etatAcces(medecin, 'pat-1', MAINTENANT)).toMatchObject({
      etat: 'REFUSEE', peutLire: true, brisDeGlaceJusquau: jusqua.toISOString(),
    });
  });

  it('un accord perime ne fait plus lire', async () => {
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    prisma.autorisationAccesDossier.findMany.mockResolvedValue([
      ligne({ statut: 'ACCORDEE', closLe: new Date(MAINTENANT.getTime() - 40 * JOUR) }),
    ]);
    expect(await etatAcces(medecin, 'pat-1', MAINTENANT)).toMatchObject({ etat: 'EXPIREE', peutLire: false });
  });
});

describe('relancerDemande — une fois par jour au plus', () => {
  it('404 sans demande en attente', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(null);
    await expect(relancerDemande(medecin, 'pat-1', MAINTENANT)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuse moins de vingt-quatre heures apres la derniere sollicitation', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue({
      id: 'aut-1', demandeeLe: new Date(MAINTENANT.getTime() - 3 * JOUR),
      relanceeLe: new Date(MAINTENANT.getTime() - 23 * 3600_000), rendezVous: null,
    });
    await expect(relancerDemande(medecin, 'pat-1', MAINTENANT)).rejects.toBeInstanceOf(ConflictError);
    expect(prisma.autorisationAccesDossier.update).not.toHaveBeenCalled();
  });

  it('relance : date la relance et previent le patient de nouveau', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue({
      id: 'aut-1', demandeeLe: new Date(MAINTENANT.getTime() - 2 * JOUR), relanceeLe: null,
      rendezVous: { prevuLe: new Date('2026-11-22T09:00:00Z') },
    });
    prisma.autorisationAccesDossier.findUniqueOrThrow.mockResolvedValue({
      medecin: { prenom: 'Ibrahima', nom: 'Sow' },
      patient: { utilisateur: { id: 'pat-u', prenom: 'Awa', nom: 'Diallo', email: null } },
    });
    prisma.autorisationAccesDossier.findMany.mockResolvedValue([]);
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);

    await relancerDemande(medecin, 'pat-1', MAINTENANT);

    expect(prisma.autorisationAccesDossier.findFirst.mock.calls[0][0].where).toEqual({
      idPatient: 'pat-1', idMedecin: 'med-1', statut: 'DEMANDEE',
    });
    expect(prisma.autorisationAccesDossier.update.mock.calls[0][0]).toEqual({ where: { id: 'aut-1' }, data: { relanceeLe: MAINTENANT } });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({ idUtilisateur: 'pat-u' }));
  });
});

describe('historiquePatient — ce que le patient a choisi de partager', () => {
  it('refuse sans accord ni bris de glace, sans rien lire', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue(null);
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    await expect(historiquePatient(medecin, 'pat-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.consultation.findMany).not.toHaveBeenCalled();
    expect(examensSuivisDuPatient).not.toHaveBeenCalled();
  });

  it('rend la fiche, les consultations de toutes structures, les vaccins et les resultats suivis', async () => {
    prisma.autorisationAccesDossier.findFirst.mockResolvedValue({ id: 'aut-1' });
    prisma.brisDeGlace.findFirst.mockResolvedValue(null);
    prisma.patientProfile.findUnique.mockResolvedValue({
      dateNaissance: new Date('1990-05-01'), sexe: 'F', groupeSanguin: 'O+', allergies: ['Penicilline'], maladiesChroniques: [],
      utilisateur: { prenom: 'Awa', nom: 'Diallo' },
    });
    prisma.consultation.findMany.mockResolvedValue([{
      id: 'c-1', consulteeLE: new Date('2026-06-01T10:00:00Z'), motifPrincipal: 'Fievre', statut: 'CLOTUREE',
      episode: null, asc: { structure: { nom: 'Poste de sante Kaloum' } },
      medecinValideur: { prenom: 'Mariama', nom: 'Bah' },
      diagnostics: [{ libelle: 'Paludisme simple' }],
      ordonnances: [{ lignes: [{ posologie: '1 cp', frequence: '2x/j', dureeJours: 3, quantite: 6, medicament: { libelle: 'Artemether' } }] }],
    }]);
    prisma.vaccination.findMany.mockResolvedValue([{ vaccinNom: 'VAT', administreLe: new Date('2025-01-01'), dateProchaineD: null }]);
    examensSuivisDuPatient.mockResolvedValue([{ codeLoinc: '718-7' }]);

    const h = await historiquePatient(medecin, 'pat-1');

    // Toutes structures : aucun filtre de structure sur les consultations.
    expect(prisma.consultation.findMany.mock.calls[0][0].where).toEqual({ idPatient: 'pat-1' });
    expect(h.patient).toMatchObject({ prenom: 'Awa', allergies: ['Penicilline'], groupeSanguin: 'O+' });
    expect(h.consultations[0]).toMatchObject({
      motif: 'Fievre', structure: 'Poste de sante Kaloum', medecin: 'Dr Mariama Bah', diagnostics: ['Paludisme simple'],
      traitements: [{ produit: 'Artemether', posologie: '1 cp', frequence: '2x/j', dureeJours: 3, quantite: 6 }],
    });
    expect(h.vaccinations).toEqual([{ vaccin: 'VAT', le: new Date('2025-01-01').toISOString(), prochaineDose: null }]);
    expect(h.examensSuivis).toEqual([{ codeLoinc: '718-7' }]);
    expect(examensSuivisDuPatient).toHaveBeenCalledWith('pat-1');
  });
});
