// Le fil du parcours (P5, EF-06-01).
//
// Ce que ce fichier tient :
//   - chaque etape datee d'une visite, de la demande de rendez-vous a la
//     livraison, dans l'ordre du temps ;
//   - les resultats n'y figurent qu'une fois diffuses au patient ;
//   - le mode de remise decide entre « remis au livreur / livre » et « retire » ;
//   - un rendez-vous remplace et une consultation annulee n'y sont pas ;
//   - un rendez-vous a venir est marque comme tel ;
//   - aucune valeur medicale : seulement des numeros et des noms de structures.
import { construireFil, type VisitePourFil } from '../src/services/fil-parcours.service';

const j = (jour: number, heure = 9) => new Date(Date.UTC(2026, 10, jour, heure));
const MAINTENANT = j(20, 12);

function visite(o: Partial<VisitePourFil> = {}): VisitePourFil {
  return {
    statut: 'EN_COURS', ouvertLe: j(10), closLe: null,
    demandeRendezVous: null, rendezVous: [], demandesAnalyse: [], consultations: [], ...o,
  };
}

const commande = (o: Partial<VisitePourFil['consultations'][0]['ordonnances'][0]['commandes'][0]> = {}) => ({
  numero: 'CM-1', statut: 'CLOTUREE', modeRemise: 'LIVRAISON', creeLe: j(12, 10), modifieLe: j(12, 10),
  priseEnChargeLe: j(12, 11), preteLe: j(12, 14), remiseLe: j(12, 15),
  pharmacie: { nom: 'Pharmacie du Marché' }, facture: { payeeLe: j(12, 12) },
  courses: [{ attribueeLe: j(12, 14), livreeLe: j(12, 16) }], ...o,
});

const types = (v: VisitePourFil) => construireFil(v, MAINTENANT).map((e) => e.type);

describe('le fil du parcours', () => {
  it('du rendez-vous demande a la livraison, dans l ordre du temps', () => {
    const v = visite({
      demandeRendezVous: { creeLe: j(9) },
      rendezVous: [{ prevuLe: j(11), arriveeLe: j(11, 8), statut: 'HONORE' }],
      demandesAnalyse: [{
        numero: 'DA-1', statut: 'VALIDEE', creeLe: j(10, 10), preleveeLe: j(10, 11), diffuseePatientLe: j(11, 7), annuleeLe: null,
        laboratoire: { nom: 'Labo Central' },
      }],
      consultations: [{
        creeLe: j(11, 9), signeLe: j(11, 10), statut: 'TERMINEE',
        ordonnances: [{ numero: 'OR-1', creeLe: j(11, 10), commandes: [commande()] }],
      }],
      statut: 'CLOS', closLe: j(13),
    });
    expect(types(v)).toEqual([
      'DEMANDE_RDV', 'VISITE_OUVERTE', 'ANALYSE_PRESCRITE', 'PRELEVEMENT', 'RESULTATS', 'ARRIVEE', 'RENDEZ_VOUS',
      'CONSULTATION', 'ORDONNANCE', 'COMMANDE', 'PHARMACIE_TROUVEE', 'PAIEMENT', 'PRETE', 'REMISE_LIVREUR', 'LIVREE', 'VISITE_CLOSE',
    ]);
    const fil = construireFil(v, MAINTENANT);
    for (let i = 1; i < fil.length; i += 1) expect(new Date(fil[i]!.le).getTime()).toBeGreaterThanOrEqual(new Date(fil[i - 1]!.le).getTime());
  });

  // Les resultats ne se montrent qu'une fois diffuses : valides par le
  // laboratoire mais pas encore relus par le medecin, ils ne sont pas au fil.
  it('les resultats n y sont qu une fois diffuses au patient', () => {
    const v = visite({ demandesAnalyse: [{
      numero: 'DA-1', statut: 'VALIDEE', creeLe: j(10, 10), preleveeLe: j(10, 11), diffuseePatientLe: null, annuleeLe: null,
      laboratoire: { nom: 'Labo Central' },
    }] });
    expect(types(v)).not.toContain('RESULTATS');
  });

  it('retrait en pharmacie : « retire », ni livreur ni livraison', () => {
    const v = visite({ consultations: [{ creeLe: j(11), signeLe: null, statut: 'TERMINEE', ordonnances: [{
      numero: 'OR-1', creeLe: j(11, 10), commandes: [commande({ modeRemise: 'RETRAIT_PHARMACIE', courses: [] })],
    }] }] });
    const t = types(v);
    expect(t).toContain('RETIREE');
    expect(t).not.toContain('REMISE_LIVREUR');
    expect(t).not.toContain('LIVREE');
    expect(construireFil(v, MAINTENANT).find((e) => e.type === 'PRETE')?.detail).toBe('RETRAIT');
  });

  it('aucune pharmacie : le fil le dit', () => {
    const v = visite({ consultations: [{ creeLe: j(11), signeLe: null, statut: 'TERMINEE', ordonnances: [{
      numero: 'OR-1', creeLe: j(11, 10),
      commandes: [commande({ statut: 'SANS_PHARMACIE', creeLe: j(11, 12), priseEnChargeLe: null, preteLe: null, remiseLe: null, facture: null, courses: [], modifieLe: j(11, 18) })],
    }] }] });
    expect(types(v)).toEqual(['VISITE_OUVERTE', 'CONSULTATION', 'ORDONNANCE', 'COMMANDE', 'SANS_PHARMACIE']);
  });

  it('un rendez-vous remplace et une consultation annulee n y sont pas ; un rendez-vous a venir est marque', () => {
    const v = visite({
      rendezVous: [{ prevuLe: j(15), arriveeLe: null, statut: 'ANNULE' }, { prevuLe: j(25), arriveeLe: null, statut: 'PLANIFIE' }],
      consultations: [{ creeLe: j(11), signeLe: null, statut: 'ANNULEE', ordonnances: [] }],
    });
    const fil = construireFil(v, MAINTENANT);
    expect(fil.map((e) => e.type)).toEqual(['VISITE_OUVERTE', 'RENDEZ_VOUS']);
    expect(fil[1]).toEqual(expect.objectContaining({ aVenir: true }));
    expect(fil[0]!.aVenir).toBeUndefined();
  });

  // La consultation se signe a la fin, apres l'ordonnance qu'elle produit :
  // datee a sa signature, elle passait apres son ordonnance dans le fil.
  it('la consultation precede l ordonnance qu elle produit, meme signee apres', () => {
    const v = visite({ consultations: [{
      creeLe: j(11, 9), signeLe: j(11, 11), statut: 'TERMINEE',
      ordonnances: [{ numero: 'OR-1', creeLe: j(11, 10), commandes: [] }],
    }] });
    expect(types(v)).toEqual(['VISITE_OUVERTE', 'CONSULTATION', 'ORDONNANCE']);
  });

  it('une visite annulee le dit, et non « close »', () => {
    expect(types(visite({ statut: 'ANNULE', closLe: j(11) }))).toEqual(['VISITE_OUVERTE', 'VISITE_ANNULEE']);
  });

  it('aucune valeur medicale : seulement des numeros, des noms de structures, un mode de remise', () => {
    const v = visite({
      demandesAnalyse: [{ numero: 'DA-1', statut: 'VALIDEE', creeLe: j(10, 10), preleveeLe: null, diffuseePatientLe: j(11), annuleeLe: null, laboratoire: { nom: 'Labo Central' } }],
      consultations: [{ creeLe: j(11), signeLe: null, statut: 'TERMINEE', ordonnances: [{ numero: 'OR-1', creeLe: j(11, 10), commandes: [commande()] }] }],
    });
    const details = construireFil(v, MAINTENANT).map((e) => e.detail).filter(Boolean);
    expect(new Set(details)).toEqual(new Set(['Labo Central', 'OR-1', 'CM-1', 'Pharmacie du Marché', 'LIVRAISON']));
  });
});
