// Delivrance en pharmacie : c'est ici qu'un stock est decremente et qu'une
// ordonnance sort de circulation. Les invariants a proteger : jamais plus que
// prescrit, jamais sans stock, jamais deux fois, jamais sur une allergie
// passee sous silence.
import {
  delivrerLigneOrdonnance,
  getMedicaments,
  getMedicamentsPrescriptibles,
  getOrdonnances,
  reapprovisionnerStock,
  creerProduitOfficine,
  modifierProduitOfficine,
  desactiverProduitOfficine,
  scanPatient,
  verifierOrdonnance,
  getHorairesOfficine,
  definirHorairesOfficine,
  getPositionOfficine,
  definirPositionOfficine,
} from '../src/services/pharmacien.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../src/utils/app-error';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    utilisateur: { findUnique: jest.fn() },
    patientProfile: { findUnique: jest.fn() },
    ordonnance: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    ligneOrdonnance: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    medicament: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
    stock: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    lotStock: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    // P6-b : l'acte de delivrance, nominatif, qui porte la quantite remise.
    acteDelivrance: { create: jest.fn(), aggregate: jest.fn() },
    mouvementStock: { create: jest.fn() },
    structureSante: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock('../src/services/parametres.service', () => ({ getValeursParametres: jest.fn() }));
jest.mock('../src/utils/password.utils', () => ({ hashPassword: jest.fn() }));

const { prisma } = jest.requireMock('../src/config/prisma') as {
  prisma: {
    utilisateur: { findUnique: jest.Mock };
    patientProfile: { findUnique: jest.Mock };
    ordonnance: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    ligneOrdonnance: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    medicament: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock; findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock; findFirst: jest.Mock };
    stock: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    lotStock: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    acteDelivrance: { create: jest.Mock; aggregate: jest.Mock };
    mouvementStock: { create: jest.Mock };
    structureSante: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
};
const { getValeursParametres } = jest.requireMock('../src/services/parametres.service') as { getValeursParametres: jest.Mock };

const PHARMACIEN = {
  id: 'ph-u', idStructure: 'pharma-1',
  structure: { id: 'pharma-1', type: 'PHARMACIE', prefecture: 'Kindia' },
  pharmacienProfile: { idStructure: 'pharma-1' },
};
const PARACETAMOL = { id: 'm-1', idStructure: null, dci: 'Paracetamol', nomCommercial: 'Doliprane', forme: 'cp', dosage: '500mg', prixUnitaireGnf: 1000, estReglemente: false, estActif: true };

const PARAMETRES = {
  prescription: {
    dureeValiditeJours: 90, longueurCodeVerification: 6, signatureObligatoire: false,
    dureeValiditeReglementeJours: 28, renouvellementsMax: 6,
  },
  facturation: { margePct: 15 },
};

const DANS_30_JOURS = new Date(Date.now() + 30 * 24 * 3600 * 1000);
const IL_Y_A_10_JOURS = new Date(Date.now() - 10 * 24 * 3600 * 1000);

/** Ordonnance signee et encore valide : le cas nominal du comptoir. */
type EtatOrdonnance = {
  renouvellementsAutorises: number;
  renouvellementsUtilises: number;
  id: string;
  numero: string;
  statut: string;
  codeVerification: string;
  valideJusquau: Date;
  signeLe: Date | null;
  signePar: string | null;
  creeLe: Date;
};

const ORD_VALIDE: EtatOrdonnance = {
  renouvellementsAutorises: 0,
  renouvellementsUtilises: 0,
  id: 'ord-1',
  numero: 'OR-2026-000001',
  statut: 'EN_ATTENTE',
  codeVerification: 'A7D27Y',
  valideJusquau: DANS_30_JOURS,
  signeLe: new Date('2026-09-01'),
  signePar: 'med-1',
  creeLe: new Date('2026-09-01'),
};

function pharmacienValide() {
  prisma.utilisateur.findUnique.mockResolvedValue(PHARMACIEN);
}
function titulaireValide() {
  prisma.utilisateur.findUnique.mockResolvedValue({
    ...PHARMACIEN,
    pharmacienProfile: { roleOfficine: 'TITULAIRE' },
  });
}

afterEach(() => jest.resetAllMocks());

// Le stock se detaille en lots depuis le 2026-09-30 : entrees comme sorties
// passent par une transaction. Le defaut ci-dessous la rend transparente ;
// le bloc « delivrance » l'affine pour suivre la consommation des lots.
const actesEcrits: number[] = [];

beforeEach(() => {
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.lotStock.create.mockResolvedValue({ id: 'lot-new' });
  prisma.lotStock.update.mockResolvedValue({ idStock: 's1' });
  prisma.mouvementStock.create.mockResolvedValue({});
  // **L'agregat suit les actes crees.** Dans une transaction reelle, la somme
  // lue apres l'insertion compte l'acte qu'on vient d'ecrire ; une doublure
  // qui renverrait toujours zero ferait croire qu'une ligne n'a jamais rien
  // recu et la laisserait EN_ATTENTE.
  actesEcrits.length = 0;
  prisma.acteDelivrance.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
    actesEcrits.push(Number(args.data['quantite']) || 0);
    return { id: 'acte-1', ...args.data, medicamentDelivre: PARACETAMOL };
  });
  prisma.acteDelivrance.aggregate.mockImplementation(async () => ({
    _sum: { quantite: actesEcrits.reduce((t, q) => t + q, 0) },
  }));
});

describe('garde commune : le compte doit etre rattache a une pharmacie', () => {
  it('refuse un pharmacien sans structure', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ id: 'ph-u', idStructure: null, structure: null });
    await expect(scanPatient('qr-1', 'ph-u')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuse une structure qui n est pas une pharmacie', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({ ...PHARMACIEN, structure: { ...PHARMACIEN.structure, type: 'CENTRE' } });
    await expect(scanPatient('qr-1', 'ph-u')).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuse une structure hospitaliere, meme avec un profil pharmacien', async () => {
    prisma.utilisateur.findUnique.mockResolvedValue({
      ...PHARMACIEN,
      structure: { ...PHARMACIEN.structure, type: 'HOPITAL_PREF' },
    });

    await expect(scanPatient('qr-1', 'ph-u')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('scanPatient', () => {
  beforeEach(() => {
    pharmacienValide();
    getValeursParametres.mockResolvedValue(PARAMETRES);
    prisma.ligneOrdonnance.findFirst.mockResolvedValue(null);
  });

  it('404 sur un QR code inconnu', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue(null);
    await expect(scanPatient('qr-x', 'ph-u')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rend les lignes de chaque ordonnance, calcule le prix et signale une allergie au principe actif', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({
      id: 'p1', qrCode: 'qr-1', dateNaissance: new Date('1990-01-01'), groupeSanguin: 'O+',
      allergies: ['paracetamol'],
      utilisateur: { id: 'u1', prenom: 'Awa', nom: 'Diallo', telephone: 't' },
      consultations: [{
        asc: { utilisateur: { prenom: 'Mamadou', nom: 'Bah' } },
        ordonnances: [
          {
            ...ORD_VALIDE, signataire: null,
            lignes: [
              { id: 'l1', posologie: '1cp', frequence: '3/j', dureeJours: 5, quantite: 15, statut: 'EN_ATTENTE', instructions: null, medicament: PARACETAMOL },
              { id: 'l2', posologie: '1cp', frequence: '1/j', dureeJours: 3, quantite: 3, statut: 'EN_ATTENTE', instructions: null, medicament: { ...PARACETAMOL, id: 'm-2', dci: 'Amoxicilline', nomCommercial: null, prixUnitaireGnf: 2500 } },
            ],
          },
        ],
      }],
    });

    const res = await scanPatient('qr-1', 'ph-u');

    expect(res.patient).toEqual(expect.objectContaining({ prenom: 'Awa', groupeSanguin: 'O+', allergiesCritiques: ['paracetamol'] }));
    expect(res.totalOrdonnances).toBe(1);
    const [ordonnance] = res.ordonnances;
    // Le numero est ce que le pharmacien lit sur le papier : il doit remonter.
    expect(ordonnance).toEqual(expect.objectContaining({ numero: 'OR-2026-000001', expiree: false, medecinNom: 'Mamadou Bah' }));
    const [l1, l2] = ordonnance.lignes;
    expect(l1).toEqual(expect.objectContaining({ id: 'l1', prixTotalGnf: 15_000, alerteAllergie: true }));
    expect(l2).toEqual(expect.objectContaining({ id: 'l2', prixTotalGnf: 7_500, alerteAllergie: false }));
    // Rien n'est encore delivre : le total porte sur les deux lignes.
    expect(ordonnance.totalGnf).toBe(22_500);
  });

  it('ne compte pas dans le total une ligne deja delivree ailleurs', async () => {
    prisma.patientProfile.findUnique.mockResolvedValue({
      id: 'p1', qrCode: 'qr-1', dateNaissance: new Date('1990-01-01'), groupeSanguin: null,
      allergies: [],
      utilisateur: { id: 'u1', prenom: 'Awa', nom: 'Diallo', telephone: 't' },
      consultations: [{
        asc: null,
        ordonnances: [{
          ...ORD_VALIDE, statut: 'PARTIELLEMENT_SERVIE', signataire: { prenom: 'Dr', nom: 'Camara' },
          lignes: [
            { id: 'l1', posologie: '1cp', frequence: '3/j', dureeJours: 5, quantite: 15, statut: 'DELIVREE', instructions: null, medicament: PARACETAMOL },
            { id: 'l2', posologie: '1cp', frequence: '1/j', dureeJours: 3, quantite: 3, statut: 'EN_ATTENTE', instructions: null, medicament: { ...PARACETAMOL, id: 'm-2', prixUnitaireGnf: 2500 } },
          ],
        }],
      }],
    });

    const [ordonnance] = (await scanPatient('qr-1', 'ph-u')).ordonnances;

    // Facturer 22 500 ferait payer deux fois le traitement deja delivre.
    expect(ordonnance.totalGnf).toBe(7_500);
  });
});

describe('delivrerLigneOrdonnance', () => {
  const LIGNE = {
    id: 'l1', statut: 'EN_ATTENTE', quantite: 10,
    idMedicament: 'm-1', idOrdonnance: 'ord-1',
    medicament: PARACETAMOL, ordonnance: ORD_VALIDE,
  };

  /** Ligne rattachee a une ordonnance dans l'etat decrit. */
  function ligneAvecOrdonnance(etat: Partial<EtatOrdonnance>) {
    return { ...LIGNE, ordonnance: { ...ORD_VALIDE, ...etat } };
  }

  beforeEach(() => {
    pharmacienValide();
    getValeursParametres.mockResolvedValue(PARAMETRES);
    prisma.ligneOrdonnance.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      stock: { updateMany: prisma.stock.updateMany, update: prisma.stock.update, create: prisma.stock.create },
      // La delivrance sort desormais du lot le plus proche de sa peremption.
      lotStock: {
        findMany: prisma.lotStock.findMany,
        findFirst: prisma.lotStock.findFirst,
        create: prisma.lotStock.create,
        update: prisma.lotStock.update,
      },
      ligneOrdonnance: { update: prisma.ligneOrdonnance.update },
      ordonnance: { findUnique: prisma.ordonnance.findUnique, update: prisma.ordonnance.update },
      // P6-b : l'acte nominatif s'ecrit dans la meme transaction que la
      // sortie de stock. Les deux doivent tomber ensemble, sinon le stock et
      // la trace divergeraient.
      acteDelivrance: {
        create: prisma.acteDelivrance.create,
        aggregate: prisma.acteDelivrance.aggregate,
      },
      mouvementStock: { create: prisma.mouvementStock.create },
    }));
    // Un lot disponible, largement suffisant, pour que la sortie aboutisse.
    prisma.lotStock.findMany.mockResolvedValue([
      { id: 'lot-1', quantite: 1000, datePeremption: new Date('2030-01-01') },
    ]);
    prisma.lotStock.update.mockResolvedValue({});
    prisma.lotStock.create.mockResolvedValue({});
    // Etat du document relu par recalculerStatut apres la sortie de stock.
    prisma.ordonnance.findUnique.mockResolvedValue({
      ...ORD_VALIDE,
      lignes: [{ statut: 'DELIVREE' }],
    });
  });

  // ── Controles portes par le document (EF-05-07/08) ────────────────
  // Ils passent avant tout : rien ne doit sortir du stock sur une ordonnance
  // qui n'est pas opposable.

  // Decision D2 non tranchee : par defaut, une ordonnance d'ASC se delivre.
  it('refuse une ordonnance non signee quand la signature est imposee', async () => {
    getValeursParametres.mockResolvedValue({
      prescription: { ...PARAMETRES.prescription, signatureObligatoire: true },
    });
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(ligneAvecOrdonnance({ signeLe: null }));

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).rejects.toThrow(/non signee/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('delivre une ordonnance d ASC non signee tant que la signature n est pas imposee', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(ligneAvecOrdonnance({ signeLe: null }));
    prisma.stock.findFirst.mockResolvedValue(
      { id: 's1', quantite: 50, margeGnf: 0, medicament: { prixUnitaireGnf: 1000 } });
    prisma.stock.updateMany.mockResolvedValue({ count: 1 });
    prisma.ligneOrdonnance.update.mockResolvedValue({ ...LIGNE, statut: 'DELIVREE' });

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).resolves.toBeDefined();
  });

  it('refuse une ordonnance expiree', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(
      ligneAvecOrdonnance({ valideJusquau: IL_Y_A_10_JOURS })
    );

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).rejects.toThrow(/expiree/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // EF-05-12 : le caractere reglemente se juge sur l'ordonnance entiere. Une
  // autre ligne peut porter le stupefiant que celle qu'on delivre.
  it('refuse un produit reglemente non signe par un medecin', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(ligneAvecOrdonnance({ signeLe: null }));
    prisma.ligneOrdonnance.findFirst.mockResolvedValue({ id: 'autre-ligne' });

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).rejects.toThrow(/reglemente/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // EF-05-09 : une ordonnance servie reste servable s'il reste un cycle.
  it('delivre une ordonnance servie qui garde un renouvellement', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(
      ligneAvecOrdonnance({ statut: 'SERVIE', renouvellementsAutorises: 2, renouvellementsUtilises: 0 })
    );
    prisma.stock.findFirst.mockResolvedValue(
      { id: 's1', quantite: 50, margeGnf: 0, medicament: { prixUnitaireGnf: 1000 } });
    prisma.stock.updateMany.mockResolvedValue({ count: 1 });
    prisma.ligneOrdonnance.update.mockResolvedValue({ ...LIGNE, statut: 'DELIVREE' });

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).resolves.toBeDefined();
  });

  it('refuse une ordonnance annulee', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(ligneAvecOrdonnance({ statut: 'ANNULEE' }));

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).rejects.toThrow(/annulee/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Controles portes par la ligne ─────────────────────────────────

  it('refuse un medicament deja delivre', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue({ ...LIGNE, statut: 'DELIVREE' });
    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse de delivrer plus que la quantite prescrite', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(LIGNE);
    await expect(delivrerLigneOrdonnance('l1', 'ph-u', { quantiteDelivree: 11 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuse sans ligne de stock dans CETTE pharmacie', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(LIGNE);
    prisma.stock.findFirst.mockResolvedValue(null);

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).rejects.toBeInstanceOf(ValidationError);
    // L'`include` est nouveau : l'acte fige le prix de ce qui est remis, donc
    // la requete lit le produit de la ligne de stock.
    expect(prisma.stock.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { idMedicament: 'm-1', idStructure: 'pharma-1' },
    }));
  });

  it('echoue si le stock a baisse entre la lecture et le decrement (check-and-decrement atomique)', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(LIGNE);
    prisma.stock.findFirst.mockResolvedValue(
      { id: 's1', quantite: 10, margeGnf: 0, medicament: { prixUnitaireGnf: 1000 } });
    prisma.stock.updateMany.mockResolvedValue({ count: 0 });

    await expect(delivrerLigneOrdonnance('l1', 'ph-u', {})).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.ligneOrdonnance.update).not.toHaveBeenCalled();
  });

  it('decremente le stock, passe la ligne a DELIVREE et facture la quantite reellement delivree', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(LIGNE);
    prisma.stock.findFirst.mockResolvedValue(
      { id: 's1', quantite: 50, margeGnf: 0, medicament: { prixUnitaireGnf: 1000 } });
    prisma.stock.updateMany.mockResolvedValue({ count: 1 });
    prisma.ligneOrdonnance.update.mockResolvedValue({ ...LIGNE, statut: 'DELIVREE' });

    const res = await delivrerLigneOrdonnance('l1', 'ph-u', { quantiteDelivree: 6 });

    expect(prisma.stock.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', quantite: { gte: 6 } },
      data: { quantite: { decrement: 6 } },
    });
    // **Six unites sur dix ne ferment pas la ligne.** L'ancienne version de ce
    // test attendait `DELIVREE` : elle encodait le defaut. La quantite remise
    // n'etait pas enregistree, la ligne se fermait quand meme, et les quatre
    // unites restantes ne pouvaient plus etre servies — ni la, ni ailleurs.
    expect(prisma.ligneOrdonnance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'PARTIELLEMENT_SERVIE' } }));
    expect(res.quantiteDelivree).toBe(6);
    expect(res.montantGnf).toBe(6_000);
    expect(prisma.mouvementStock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'SORTIE', quantite: -6, reference: 'acte-1',
        idStructure: 'pharma-1', idMedicament: 'm-1', idStock: 's1',
        idLot: 'lot-1', idUtilisateur: 'ph-u',
      }),
    });
  });

  it('passe le document a SERVIE quand sa derniere ligne sort', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(LIGNE);
    prisma.stock.findFirst.mockResolvedValue(
      { id: 's1', quantite: 50, margeGnf: 0, medicament: { prixUnitaireGnf: 1000 } });
    prisma.stock.updateMany.mockResolvedValue({ count: 1 });
    prisma.ligneOrdonnance.update.mockResolvedValue({ ...LIGNE, statut: 'DELIVREE' });

    await delivrerLigneOrdonnance('l1', 'ph-u', {});

    expect(prisma.ordonnance.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ord-1' }, data: { statut: 'SERVIE' } })
    );
  });

  it('laisse le document PARTIELLEMENT_SERVIE tant qu il reste un medicament', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(LIGNE);
    prisma.stock.findFirst.mockResolvedValue(
      { id: 's1', quantite: 50, margeGnf: 0, medicament: { prixUnitaireGnf: 1000 } });
    prisma.stock.updateMany.mockResolvedValue({ count: 1 });
    prisma.ligneOrdonnance.update.mockResolvedValue({ ...LIGNE, statut: 'DELIVREE' });
    prisma.ordonnance.findUnique.mockResolvedValue({
      ...ORD_VALIDE,
      lignes: [{ statut: 'DELIVREE' }, { statut: 'EN_ATTENTE' }],
    });

    await delivrerLigneOrdonnance('l1', 'ph-u', {});

    expect(prisma.ordonnance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { statut: 'PARTIELLEMENT_SERVIE' } })
    );
  });

  it('delivre la quantite prescrite par defaut', async () => {
    prisma.ligneOrdonnance.findUnique.mockResolvedValue(LIGNE);
    prisma.stock.findFirst.mockResolvedValue(
      { id: 's1', quantite: 50, margeGnf: 0, medicament: { prixUnitaireGnf: 1000 } });
    prisma.stock.updateMany.mockResolvedValue({ count: 1 });
    prisma.ligneOrdonnance.update.mockResolvedValue({ ...LIGNE, statut: 'DELIVREE' });

    const res = await delivrerLigneOrdonnance('l1', 'ph-u', {});
    expect(res.quantiteDelivree).toBe(10);
    expect(res.montantGnf).toBe(10_000);
  });
});

// EF-07-01 : le comptoir doit pouvoir controler une ordonnance papier sans le
// QR du patient.
describe('verifierOrdonnance', () => {
  const PATIENT = {
    allergies: [], dateNaissance: new Date('1990-01-01'), sexe: 'F', groupeSanguin: null,
    utilisateur: { prenom: 'Awa', nom: 'Diallo' },
  };

  function ordonnanceComplete(etat: Partial<EtatOrdonnance> = {}) {
    return {
      ...ORD_VALIDE, ...etat,
      signataire: { prenom: 'Dr', nom: 'Camara' },
      lignes: [{ id: 'l1', posologie: '1cp', frequence: '3/j', dureeJours: 5, quantite: 15, statut: 'EN_ATTENTE', instructions: null, medicament: PARACETAMOL }],
      consultation: { asc: null, patient: PATIENT },
    };
  }

  beforeEach(() => {
    pharmacienValide();
    getValeursParametres.mockResolvedValue(PARAMETRES);
    prisma.ligneOrdonnance.findFirst.mockResolvedValue(null);
  });

  it('accepte le bon couple numero + code', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnanceComplete());

    const res = await verifierOrdonnance('ph-u', { numero: 'OR-2026-000001', codeVerification: 'A7D27Y' });

    expect(res.valide).toBe(true);
    expect(res.motif).toBeUndefined();
    expect(res.ordonnance?.numero).toBe('OR-2026-000001');
    expect(res.patient?.nom).toBe('Diallo');
  });

  it('tolere la casse et les espaces de la saisie au comptoir', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnanceComplete());

    const res = await verifierOrdonnance('ph-u', { numero: ' or-2026-000001 ', codeVerification: ' a7d27y ' });

    expect(res.valide).toBe(true);
  });

  // Un code faux et un numero inconnu doivent etre indiscernables : sinon on
  // peut enumerer les numeros valides en observant la difference.
  it('donne la meme reponse pour un code faux et pour un numero inconnu', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnanceComplete());
    const codeFaux = await verifierOrdonnance('ph-u', { numero: 'OR-2026-000001', codeVerification: 'ZZZZZZ' });

    prisma.ordonnance.findUnique.mockResolvedValue(null);
    const numeroInconnu = await verifierOrdonnance('ph-u', { numero: 'OR-2026-999999', codeVerification: 'A7D27Y' });

    expect(codeFaux).toEqual(numeroInconnu);
    expect(codeFaux.valide).toBe(false);
    expect(codeFaux.ordonnance).toBeUndefined();
  });

  it('refuse une ordonnance expiree en donnant la date', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnanceComplete({ valideJusquau: IL_Y_A_10_JOURS }));

    const res = await verifierOrdonnance('ph-u', { numero: 'OR-2026-000001', codeVerification: 'A7D27Y' });

    expect(res.valide).toBe(false);
    expect(res.motif).toMatch(/expiree/i);
    // L'ordonnance reste renvoyee : le pharmacien doit pouvoir l'expliquer au
    // patient, pas seulement lui opposer un refus.
    expect(res.ordonnance?.numero).toBe('OR-2026-000001');
  });

  it('refuse une ordonnance deja entierement servie', async () => {
    prisma.ordonnance.findUnique.mockResolvedValue(ordonnanceComplete({ statut: 'SERVIE' }));

    const res = await verifierOrdonnance('ph-u', { numero: 'OR-2026-000001', codeVerification: 'A7D27Y' });

    expect(res.valide).toBe(false);
    expect(res.motif).toMatch(/servie/i);
  });
});

describe('getOrdonnances — perimetre', () => {
  it('ne liste que les ordonnances des patients de la prefecture, sans telephone', async () => {
    pharmacienValide();
    getValeursParametres.mockResolvedValue(PARAMETRES);
    prisma.ordonnance.findMany.mockResolvedValue([{
      id: 'ord-1', numero: 'OR-2026-000001', statut: 'EN_ATTENTE',
      valideJusquau: DANS_30_JOURS, creeLe: new Date(), signeLe: new Date('2026-09-01'),
      lignes: [{ medicament: { id: 'm-1', dci: 'Paracetamol', nomCommercial: 'Doliprane', forme: 'cp', dosage: '500mg' } }],
      consultation: { patient: { qrCode: 'qr-1', utilisateur: { prenom: 'Awa', nom: 'Diallo' } } },
    }]);

    const res = await getOrdonnances('ph-u');

    expect(prisma.ordonnance.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        statut: { in: ['EN_ATTENTE', 'PARTIELLEMENT_SERVIE'] },
        consultation: { patient: { prefecture: 'Kindia' } },
      },
    }));
    expect(res).toEqual([expect.objectContaining({
      numero: 'OR-2026-000001',
      expiree: false,
      patient: { prenom: 'Awa', nom: 'Diallo', qrCode: 'qr-1' },
    })]);
    expect(res[0].medicaments).toEqual([expect.objectContaining({ dci: 'Paracetamol' })]);
    expect(JSON.stringify(res)).not.toContain('telephone');
  });
});

describe('reapprovisionnerStock', () => {
  beforeEach(() => {
    pharmacienValide();
    prisma.medicament.findUnique.mockResolvedValue(PARACETAMOL);
    getValeursParametres.mockResolvedValue({ facturation: { margePct: 15 } });
  });

  it('refuse une quantite nulle ou negative', async () => {
    await expect(reapprovisionnerStock('ph-u', { idMedicament: 'm-1', quantiteAjoutee: 0 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('incremente une ligne existante sans toucher a sa marge si non fournie', async () => {
    prisma.stock.findFirst.mockResolvedValue({ id: 's1' });
    prisma.stock.update.mockResolvedValue({ id: 's1' });

    await reapprovisionnerStock('ph-u', { idMedicament: 'm-1', quantiteAjoutee: 20 });

    expect(prisma.stock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's1' },
      data: { quantite: { increment: 20 } },
    }));
    expect(prisma.mouvementStock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'ENTREE', quantite: 20, idStructure: 'pharma-1',
        idMedicament: 'm-1', idStock: 's1', idLot: 'lot-new', idUtilisateur: 'ph-u',
      }),
    });
    expect(prisma.stock.create).not.toHaveBeenCalled();
  });

  it('cree une ligne avec la marge par defaut de la plateforme (15 % du prix de reference)', async () => {
    prisma.stock.findFirst.mockResolvedValue(null);
    prisma.stock.create.mockResolvedValue({ id: 's-new' });

    await reapprovisionnerStock('ph-u', { idMedicament: 'm-1', quantiteAjoutee: 20 });

    expect(prisma.stock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ idStructure: 'pharma-1', quantite: 20, margeGnf: 150 }),
    }));
  });

  it('la marge saisie par le pharmacien prime sur la marge par defaut', async () => {
    prisma.stock.findFirst.mockResolvedValue(null);
    prisma.stock.create.mockResolvedValue({ id: 's-new' });

    await reapprovisionnerStock('ph-u', { idMedicament: 'm-1', quantiteAjoutee: 20, margeGnf: 300 });

    expect(prisma.stock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ margeGnf: 300 }),
    }));
  });
});

// ── Les deux catalogues ──────────────────────────────────────────────
//
// Depuis le 2026-10-01 le catalogue contient des articles non medicamenteux.
// Le comptoir les vend ; la prescription ne doit pas les proposer, sinon le
// prescripteur choisit un lait infantile et decouvre le refus apres coup.
describe('catalogues', () => {
  it('le comptoir voit tout le catalogue, articles compris', async () => {
    pharmacienValide();
    prisma.medicament.findMany.mockResolvedValue([]);
    await getMedicaments('ph-u');

    const [args] = prisma.medicament.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toEqual({
      estActif: true,
      OR: [{ idStructure: null }, { idStructure: 'pharma-1' }],
    });
    expect(args.where).not.toHaveProperty('categorie');
  });

  it('la prescription ne voit que des medicaments', async () => {
    prisma.medicament.findMany.mockResolvedValue([]);
    await getMedicamentsPrescriptibles();

    const [args] = prisma.medicament.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toEqual({ estActif: true, idStructure: null, categorie: 'MEDICAMENT' });
  });

  it('les deux trient sur le libelle, seul champ toujours renseigne', async () => {
    pharmacienValide();
    prisma.medicament.findMany.mockResolvedValue([]);
    await getMedicaments('ph-u');
    await getMedicamentsPrescriptibles();

    for (const [args] of prisma.medicament.findMany.mock.calls as [{ orderBy: unknown }][]) {
      expect(JSON.stringify(args.orderBy)).toContain('libelle');
    }
  });

  it('cree un produit de comptoir rattache exclusivement a la pharmacie', async () => {
    titulaireValide();
    prisma.medicament.create.mockResolvedValue({
      id: 'local-1', libelle: 'Savon douceur', categorie: 'HYGIENE',
      dci: null, nomCommercial: null, forme: null, dosage: null,
      classeTherapeutique: null, prixUnitaireGnf: 12000, estReglemente: false,
    });

    const produit = await creerProduitOfficine('ph-u', {
      libelle: 'Savon douceur',
      categorie: 'HYGIENE',
      prixUnitaireGnf: 12000,
    });

    expect(prisma.medicament.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        idStructure: 'pharma-1',
        categorie: 'HYGIENE',
        prixUnitaireGnf: 12000,
        estReglemente: false,
      }),
    }));
    expect(prisma.stock.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        idStructure: 'pharma-1',
        idMedicament: 'local-1',
        quantite: 0,
        seuilAlerte: 10,
        margeGnf: 0,
      }),
    }));
    expect(produit.estPropreOfficine).toBe(true);
  });

  it('refuse la modification d un produit ne relevant pas de cette officine', async () => {
    titulaireValide();
    prisma.medicament.updateMany.mockResolvedValue({ count: 0 });

    await expect(modifierProduitOfficine('ph-u', 'shared-product', { prixUnitaireGnf: 15000 }))
      .rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.medicament.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'shared-product', idStructure: 'pharma-1', estActif: true },
    }));
  });

  it('met a jour le seuil et l unite du stock local avec le produit', async () => {
    titulaireValide();
    prisma.medicament.updateMany.mockResolvedValue({ count: 1 });
    prisma.medicament.findUniqueOrThrow.mockResolvedValue({
      id: 'local-1', libelle: 'Savon douceur', categorie: 'HYGIENE',
      dci: null, nomCommercial: null, forme: null, dosage: null,
      classeTherapeutique: null, prixUnitaireGnf: 12000, estReglemente: false,
    });

    await modifierProduitOfficine('ph-u', 'local-1', { seuilAlerte: 5, unite: 'boite' });

    expect(prisma.stock.updateMany).toHaveBeenCalledWith({
      where: { idStructure: 'pharma-1', idMedicament: 'local-1' },
      data: { seuilAlerte: 5, unite: 'boite' },
    });
  });

  it('ne desactive pas un produit qui est encore en stock', async () => {
    titulaireValide();
    prisma.medicament.findFirst.mockResolvedValue({
      id: 'local-1',
      stocks: [{ quantite: 2 }],
    });

    await expect(desactiverProduitOfficine('ph-u', 'local-1')).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.medicament.updateMany).not.toHaveBeenCalled();
  });
});

// ── Horaires d'ouverture ─────────────────────────────────────────
//
// Le calcul de l'etat est eprouve dans horaires.test.ts. Ce qui se verifie
// ici est ce que le service ajoute : qui a le droit d'ecrire, ce qu'il refuse
// d'enregistrer, et le fait que rien n'est invente a la lecture.
describe('horaires de l officine', () => {
  const SEMAINE = {
    '1': { ouvre: '08:00', ferme: '20:00' },
    '0': null,
  };

  it('rend les horaires lus en base', async () => {
    pharmacienValide();
    prisma.structureSante.findUniqueOrThrow.mockResolvedValue({ horaires: SEMAINE });

    const vue = await getHorairesOfficine('ph-u');
    expect(vue.horaires).toEqual(SEMAINE);
  });

  it('ne dit ni ouvert ni ferme quand rien n est saisi', async () => {
    // Une officine qui n'a rien rempli ne doit pas apparaitre close.
    pharmacienValide();
    prisma.structureSante.findUniqueOrThrow.mockResolvedValue({ horaires: null });

    const vue = await getHorairesOfficine('ph-u');
    expect(vue.horaires).toBeNull();
    expect(vue.etat.ouvert).toBeNull();
  });

  it('ecarte une forme inattendue venue de la base', async () => {
    pharmacienValide();
    prisma.structureSante.findUniqueOrThrow.mockResolvedValue({ horaires: 'de 8h a 20h' });

    expect((await getHorairesOfficine('ph-u')).horaires).toBeNull();
  });

  it('le titulaire enregistre ses horaires', async () => {
    titulaireValide();
    prisma.structureSante.update.mockResolvedValue({ horaires: SEMAINE });

    const vue = await definirHorairesOfficine('ph-u', { horaires: SEMAINE });
    expect(prisma.structureSante.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { horaires: SEMAINE } }),
    );
    expect(vue.horaires).toEqual(SEMAINE);
  });

  it('refuse un pharmacien qui n est pas titulaire', async () => {
    // Annoncer au public que l'officine est ouverte engage l'etablissement.
    pharmacienValide();

    await expect(definirHorairesOfficine('ph-u', { horaires: SEMAINE }))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });

  it('refuse une fermeture qui precede l ouverture, sans rien ecrire', async () => {
    titulaireValide();

    await expect(
      definirHorairesOfficine('ph-u', { horaires: { '2': { ouvre: '20:00', ferme: '08:00' } } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });
});

// ── Position sur la carte ────────────────────────────────────
//
// Le marqueur envoie des gens a une adresse. Ce qui se verifie ici : qui a le
// droit de le poser, et le refus d'une demi-position, qui ne situe rien.
describe('position de l officine', () => {
  const OFFICINE = { nom: 'Pharmacie Pricemou', adresse: 'Route du Niger', commune: 'Dixinn' };
  const BELLE_VUE = { latitude: 9.545, longitude: -13.682 };

  it('rend la position posee, avec de quoi se reperer', async () => {
    pharmacienValide();
    prisma.structureSante.findUniqueOrThrow.mockResolvedValue({ ...OFFICINE, ...BELLE_VUE });

    const vue = await getPositionOfficine('ph-u');
    expect(vue).toEqual({ ...OFFICINE, ...BELLE_VUE });
  });

  it('rend une position nulle pour une officine jamais situee', async () => {
    // Elle reste trouvable : elle n'apparait simplement pas sur la carte.
    pharmacienValide();
    prisma.structureSante.findUniqueOrThrow.mockResolvedValue({
      ...OFFICINE, latitude: null, longitude: null,
    });

    const vue = await getPositionOfficine('ph-u');
    expect(vue.latitude).toBeNull();
    expect(vue.longitude).toBeNull();
  });

  it('le titulaire pose son officine sur la carte', async () => {
    titulaireValide();
    prisma.structureSante.update.mockResolvedValue({ ...OFFICINE, ...BELLE_VUE });

    const vue = await definirPositionOfficine('ph-u', BELLE_VUE);
    expect(prisma.structureSante.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: BELLE_VUE }),
    );
    expect(vue.latitude).toBe(9.545);
  });

  it('le titulaire peut retirer la position', async () => {
    titulaireValide();
    prisma.structureSante.update.mockResolvedValue({ ...OFFICINE, latitude: null, longitude: null });

    await definirPositionOfficine('ph-u', { latitude: null, longitude: null });
    expect(prisma.structureSante.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { latitude: null, longitude: null } }),
    );
  });

  it('refuse un pharmacien qui n est pas titulaire', async () => {
    pharmacienValide();

    await expect(definirPositionOfficine('ph-u', BELLE_VUE)).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });

  it('refuse une demi-position, sans rien ecrire', async () => {
    // Une latitude seule ne situe rien, et laisserait l'officine a moitie
    // posee sur la carte.
    titulaireValide();

    await expect(
      definirPositionOfficine('ph-u', { latitude: 9.545, longitude: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.structureSante.update).not.toHaveBeenCalled();
  });
});
