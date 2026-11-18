// R15 : le patient demande la correction de son identite ; l'accueil decide.
//
// Ce que ces cas tiennent : le patient ne reecrit jamais son identite lui-meme,
// une demande qui ne change rien est refusee, une seule demande attend a la
// fois, l'agent ne traite que les patients de son perimetre, accepter passe
// par la correction tracee, refuser exige une reponse, et le patient est
// prevenu dans les deux cas.
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    patientProfile: { findUnique: jest.fn() },
    demandeCorrectionIdentite: {
      count: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(),
    },
  },
}));
jest.mock('../src/services/access-control.service', () => ({
  assertCanAccessPatient: jest.fn(),
  buildPatientWhereForUser: jest.fn(),
}));
jest.mock('../src/services/notification.service', () => ({ notifierSansBloquer: jest.fn() }));
jest.mock('../src/services/identite.service', () => {
  const vrai = jest.requireActual('../src/services/identite.service');
  return { ...vrai, corrigerIdentite: jest.fn() };
});

type M = jest.Mock;
const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    patientProfile: { findUnique: M };
    demandeCorrectionIdentite: { count: M; create: M; findMany: M; findUnique: M; updateMany: M };
  };
};
const { assertCanAccessPatient, buildPatientWhereForUser } = jest.requireMock('../src/services/access-control.service') as {
  assertCanAccessPatient: M; buildPatientWhereForUser: M;
};
const { notifierSansBloquer } = jest.requireMock('../src/services/notification.service') as { notifierSansBloquer: M };
const { corrigerIdentite } = jest.requireMock('../src/services/identite.service') as { corrigerIdentite: M };

import {
  accepterDemande, demanderCorrection, demandesEnAttente, mesDemandes, refuserDemande,
} from '../src/services/demande-correction.service';

const MAINTENANT = new Date('2026-11-12T10:00:00.000Z');
const AGENT = { userId: 'agent-1', role: 'AGENT_ACCUEIL' as const, sessionId: 's1' };
const RAISON = "Mon prenom est mal ecrit depuis l'inscription";
const MOTIF = 'Acte de naissance presente au comptoir';

const DOSSIER = {
  id: 'p1', sexe: 'F', dateNaissance: new Date('2002-03-15T00:00:00.000Z'),
  utilisateur: { prenom: 'Mariama', nom: 'Bah' },
};
const LIGNE = {
  id: 'd1', statut: 'EN_ATTENTE', prenom: 'Mariame', nom: null, sexe: null, dateNaissance: null,
  justification: RAISON, reponse: null, creeLe: MAINTENANT, traiteeLe: null, traitePar: null,
};
const A_TRAITER = {
  id: 'd1', statut: 'EN_ATTENTE', prenom: 'Mariame', nom: null, sexe: 'M', dateNaissance: '2002-03-16',
  justification: RAISON, idPatient: 'p1', patient: { idUtilisateur: 'u-pat' },
};

/** Le patient connecte a son propre dossier, non fusionne. */
function patientConnecte(dossier = DOSSIER, fusionneDans: string | null = null) {
  prisma.patientProfile.findUnique
    .mockResolvedValueOnce({ id: 'p1', idFusionneDans: fusionneDans })
    .mockResolvedValueOnce(dossier);
}

beforeEach(() => {
  jest.resetAllMocks();
  prisma.demandeCorrectionIdentite.count.mockResolvedValue(0);
  prisma.demandeCorrectionIdentite.create.mockImplementation(({ data }) => Promise.resolve({ ...LIGNE, ...data }));
  // Premier appel : la demande a traiter ; ensuite : la relecture pour la vue.
  prisma.demandeCorrectionIdentite.findUnique
    .mockResolvedValueOnce(A_TRAITER)
    .mockResolvedValue({ ...LIGNE, statut: 'ACCEPTEE', traiteeLe: MAINTENANT, traitePar: { prenom: 'Awa', nom: 'Sow' } });
  prisma.demandeCorrectionIdentite.updateMany.mockResolvedValue({ count: 1 });
  corrigerIdentite.mockResolvedValue({});
  assertCanAccessPatient.mockResolvedValue(undefined);
});

describe('demanderCorrection', () => {
  it('enregistre seulement les traits qui changent', async () => {
    patientConnecte();
    const vue = await demanderCorrection('u-pat', {
      prenom: ' Mariame ', nom: 'Bah', sexe: 'F', dateNaissance: '2002-03-15', justification: RAISON,
    }, MAINTENANT);

    const { data } = prisma.demandeCorrectionIdentite.create.mock.calls[0][0];
    expect(data).toEqual({
      prenom: 'Mariame', nom: null, sexe: null, dateNaissance: null,
      justification: RAISON, idPatient: 'p1', creeLe: MAINTENANT,
    });
    expect(vue.demande).toEqual({ prenom: 'Mariame' });
    expect(vue.statut).toBe('EN_ATTENTE');
  });

  it('garde une date de naissance differente, au format du jour', async () => {
    patientConnecte();
    await demanderCorrection('u-pat', { dateNaissance: '2002-03-16', justification: RAISON }, MAINTENANT);
    expect(prisma.demandeCorrectionIdentite.create.mock.calls[0][0].data.dateNaissance).toBe('2002-03-16');
  });

  it('refuse une demande qui ne change rien', async () => {
    patientConnecte();
    await expect(demanderCorrection('u-pat', {
      prenom: 'Mariama', sexe: 'F', dateNaissance: '2002-03-15', justification: RAISON,
    }, MAINTENANT)).rejects.toThrow(ValidationError);
    expect(prisma.demandeCorrectionIdentite.create).not.toHaveBeenCalled();
  });

  it('exige une raison', async () => {
    await expect(demanderCorrection('u-pat', { prenom: 'Mariame', justification: '  court   ' }, MAINTENANT))
      .rejects.toThrow(ValidationError);
    expect(prisma.patientProfile.findUnique).not.toHaveBeenCalled();
  });

  it('refuse une date de naissance dans le futur', async () => {
    patientConnecte();
    await expect(demanderCorrection('u-pat', { dateNaissance: '2027-01-01', justification: RAISON }, MAINTENANT))
      .rejects.toThrow(ValidationError);
    expect(prisma.demandeCorrectionIdentite.create).not.toHaveBeenCalled();
  });

  it("n'en laisse attendre qu'une a la fois", async () => {
    patientConnecte();
    prisma.demandeCorrectionIdentite.count.mockResolvedValue(1);
    await expect(demanderCorrection('u-pat', { prenom: 'Mariame', justification: RAISON }, MAINTENANT))
      .rejects.toThrow(ConflictError);
    expect(prisma.demandeCorrectionIdentite.count).toHaveBeenCalledWith({
      where: { idPatient: 'p1', statut: 'EN_ATTENTE' },
    });
    expect(prisma.demandeCorrectionIdentite.create).not.toHaveBeenCalled();
  });

  it('apres une fusion, porte sur le dossier principal', async () => {
    patientConnecte({ ...DOSSIER, id: 'p-principal' }, 'p-principal');
    await demanderCorrection('u-pat', { prenom: 'Mariame', justification: RAISON }, MAINTENANT);
    expect(prisma.patientProfile.findUnique.mock.calls[1][0].where).toEqual({ id: 'p-principal' });
    expect(prisma.demandeCorrectionIdentite.create.mock.calls[0][0].data.idPatient).toBe('p-principal');
  });

  it("un utilisateur sans dossier patient n'a rien a demander", async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(demanderCorrection('u-x', { prenom: 'Mariame', justification: RAISON }, MAINTENANT))
      .rejects.toThrow(NotFoundError);
  });
});

describe('mesDemandes', () => {
  it('rend les dernieres demandes de son dossier', async () => {
    patientConnecte();
    prisma.demandeCorrectionIdentite.findMany.mockResolvedValue([
      { ...LIGNE, statut: 'REFUSEE', reponse: 'Venez avec votre piece', traiteeLe: MAINTENANT, traitePar: { prenom: 'Awa', nom: 'Sow' } },
    ]);
    const vues = await mesDemandes('u-pat');
    expect(prisma.demandeCorrectionIdentite.findMany.mock.calls[0][0]).toMatchObject({
      where: { idPatient: 'p1' }, orderBy: { creeLe: 'desc' }, take: 10,
    });
    expect(vues[0]).toMatchObject({ statut: 'REFUSEE', reponse: 'Venez avec votre piece', traitePar: 'Awa Sow' });
  });
});

describe('demandesEnAttente', () => {
  it("ne montre que les demandes en attente du perimetre de l'agent", async () => {
    buildPatientWhereForUser.mockResolvedValue({ idStructurePreferee: 's1' });
    prisma.demandeCorrectionIdentite.findMany.mockResolvedValue([{ ...LIGNE, patient: { ...DOSSIER } }]);
    const vues = await demandesEnAttente(AGENT);
    expect(prisma.demandeCorrectionIdentite.findMany.mock.calls[0][0].where).toEqual({
      statut: 'EN_ATTENTE', patient: { idStructurePreferee: 's1' },
    });
    expect(vues[0].patient).toEqual({ id: 'p1', prenom: 'Mariama', nom: 'Bah', sexe: 'F', dateNaissance: '2002-03-15' });
  });
});

describe('accepterDemande', () => {
  it('corrige par le chemin trace, puis previent le patient', async () => {
    const vue = await accepterDemande(AGENT, 'd1', { motif: MOTIF }, MAINTENANT);

    expect(assertCanAccessPatient).toHaveBeenCalledWith(AGENT, 'p1');
    expect(corrigerIdentite).toHaveBeenCalledWith(AGENT, 'p1', {
      prenom: 'Mariame', sexe: 'M', dateNaissance: '2002-03-16',
      motif: `${MOTIF} (demande du patient : ${RAISON})`,
    }, MAINTENANT);
    expect(prisma.demandeCorrectionIdentite.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', statut: 'EN_ATTENTE' },
      data: { statut: 'ACCEPTEE', traiteeLe: MAINTENANT, idTraitePar: 'agent-1', reponse: MOTIF },
    });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'u-pat', type: 'IDENTITE_DEMANDE_TRAITEE', lienAction: '/patient/profil',
    }));
    expect(vue.id).toBe('d1');
  });

  it('exige que l agent dise ce qu il a verifie', async () => {
    await expect(accepterDemande(AGENT, 'd1', { motif: 'ok' }, MAINTENANT)).rejects.toThrow(ValidationError);
    expect(corrigerIdentite).not.toHaveBeenCalled();
  });

  it('hors perimetre, ne touche a rien', async () => {
    assertCanAccessPatient.mockRejectedValue(new ForbiddenError('Acces refuse'));
    await expect(accepterDemande(AGENT, 'd1', { motif: MOTIF }, MAINTENANT)).rejects.toThrow(ForbiddenError);
    expect(corrigerIdentite).not.toHaveBeenCalled();
    expect(prisma.demandeCorrectionIdentite.updateMany).not.toHaveBeenCalled();
  });

  it('une demande deja traitee ne se rejoue pas', async () => {
    prisma.demandeCorrectionIdentite.findUnique.mockReset().mockResolvedValue({ ...A_TRAITER, statut: 'REFUSEE' });
    await expect(accepterDemande(AGENT, 'd1', { motif: MOTIF }, MAINTENANT)).rejects.toThrow(ConflictError);
    expect(corrigerIdentite).not.toHaveBeenCalled();
  });

  it('deux agents en meme temps : le second ne marque rien', async () => {
    prisma.demandeCorrectionIdentite.updateMany.mockResolvedValue({ count: 0 });
    await expect(accepterDemande(AGENT, 'd1', { motif: MOTIF }, MAINTENANT)).rejects.toThrow(ConflictError);
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });

  it('une demande inconnue est introuvable', async () => {
    prisma.demandeCorrectionIdentite.findUnique.mockReset().mockResolvedValue(null);
    await expect(accepterDemande(AGENT, 'dx', { motif: MOTIF }, MAINTENANT)).rejects.toThrow(NotFoundError);
    expect(assertCanAccessPatient).not.toHaveBeenCalled();
  });

  it('si la correction echoue, la demande reste en attente', async () => {
    corrigerIdentite.mockRejectedValue(new ValidationError('Aucun changement'));
    await expect(accepterDemande(AGENT, 'd1', { motif: MOTIF }, MAINTENANT)).rejects.toThrow(ValidationError);
    expect(prisma.demandeCorrectionIdentite.updateMany).not.toHaveBeenCalled();
  });
});

describe('refuserDemande', () => {
  const REPONSE = "Venez au comptoir avec votre piece d'identite";

  it('enregistre la reponse sans corriger, et previent le patient', async () => {
    await refuserDemande(AGENT, 'd1', { reponse: REPONSE }, MAINTENANT);
    expect(corrigerIdentite).not.toHaveBeenCalled();
    expect(prisma.demandeCorrectionIdentite.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', statut: 'EN_ATTENTE' },
      data: { statut: 'REFUSEE', traiteeLe: MAINTENANT, idTraitePar: 'agent-1', reponse: REPONSE },
    });
    expect(notifierSansBloquer).toHaveBeenCalledWith(expect.objectContaining({
      idUtilisateur: 'u-pat', type: 'IDENTITE_DEMANDE_TRAITEE',
      contenu: expect.stringContaining(REPONSE),
    }));
  });

  it('exige une reponse', async () => {
    await expect(refuserDemande(AGENT, 'd1', { reponse: 'non' }, MAINTENANT)).rejects.toThrow(ValidationError);
    expect(prisma.demandeCorrectionIdentite.updateMany).not.toHaveBeenCalled();
  });

  it('hors perimetre, ne touche a rien', async () => {
    assertCanAccessPatient.mockRejectedValue(new ForbiddenError('Acces refuse'));
    await expect(refuserDemande(AGENT, 'd1', { reponse: REPONSE }, MAINTENANT)).rejects.toThrow(ForbiddenError);
    expect(prisma.demandeCorrectionIdentite.updateMany).not.toHaveBeenCalled();
  });

  it('deux refus en meme temps : le second ne previent pas', async () => {
    prisma.demandeCorrectionIdentite.updateMany.mockResolvedValue({ count: 0 });
    await expect(refuserDemande(AGENT, 'd1', { reponse: REPONSE }, MAINTENANT)).rejects.toThrow(ConflictError);
    expect(notifierSansBloquer).not.toHaveBeenCalled();
  });
});
