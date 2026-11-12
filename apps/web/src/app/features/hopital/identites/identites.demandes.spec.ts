// R15 : l'accueil traite les demandes de correction des patients. Accepter
// et refuser exigent un texte ; la demande traitee quitte la liste ; un
// echec (deja traitee par un collegue) recharge la liste.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import type { DemandeCorrectionIdentiteView } from '@baobaoheath/shared-types';

import { IdentitesComponent } from './identites.component';
import { HopitalService } from '../../../core/services/hopital.service';
import { AuthService } from '../../../core/services/auth.service';

const DEMANDE: DemandeCorrectionIdentiteView = {
  id: 'd1', statut: 'EN_ATTENTE',
  demande: { prenom: 'Mariame', dateNaissance: '2002-03-16' },
  justification: "Mon prenom est mal ecrit depuis l'inscription",
  reponse: null, creeLe: '2026-11-12T10:00:00.000Z', traiteeLe: null, traitePar: null,
  patient: { id: 'p1', prenom: 'Mariama', nom: 'Bah', sexe: 'F', dateNaissance: '2002-03-15' },
};
const TEXTE = 'Acte de naissance presente au comptoir';

function monter(echec = false) {
  const appels: { action: string; id: string; texte: string }[] = [];
  const compte = { demandes: 0, identites: 0 };
  const reponse = (action: string) => (id: string, texte: string) => {
    appels.push({ action, id, texte });
    return echec
      ? throwError(() => ({ error: { error: 'Cette demande a deja ete traitee' } }))
      : of({ success: true, data: { ...DEMANDE, statut: action === 'accepter' ? 'ACCEPTEE' : 'REFUSEE' } });
  };
  TestBed.configureTestingModule({
    imports: [IdentitesComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: HopitalService,
        useValue: {
          identites: () => { compte.identites++; return of({ success: true, data: [] }); },
          demandesCorrection: () => { compte.demandes++; return of({ success: true, data: [DEMANDE] }); },
          accepterDemandeCorrection: reponse('accepter'),
          refuserDemandeCorrection: reponse('refuser'),
        },
      },
      { provide: AuthService, useValue: { userRole: () => 'AGENT_ACCUEIL' } },
    ],
  });
  // La logique seule : le gabarit Material est couvert par le build.
  TestBed.overrideComponent(IdentitesComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(IdentitesComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, appels, compte };
}

describe('identites : demandes de correction des patients', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('charge les demandes a l ouverture', () => {
    const { c, compte } = monter();
    expect(compte.demandes).toBe(1);
    expect(c.demandes()).toHaveLength(1);
  });

  it('montre chaque trait demande a cote de la valeur actuelle', () => {
    const { c } = monter();
    expect(c.traitsDemandes(DEMANDE)).toEqual([
      { cle: 'HOPITAL.IDENTITES.CORRIGER_PRENOM', avant: 'Mariama', apres: 'Mariame' },
      { cle: 'HOPITAL.IDENTITES.CORRIGER_NAISSANCE', avant: '2002-03-15', apres: '2002-03-16' },
    ]);
  });

  it('n accepte pas sans dire ce qui a ete verifie', () => {
    const { c, appels } = monter();
    c.ouvrirDecision(DEMANDE, 'ACCEPTER');
    c.texteDecision.set('  ok  ');
    expect(c.peutDecider()).toBe(false);
    c.confirmerDecision();
    expect(appels).toHaveLength(0);
  });

  it('accepte, retire la demande et recharge les identites', () => {
    const { c, appels, compte } = monter();
    c.ouvrirDecision(DEMANDE, 'ACCEPTER');
    c.texteDecision.set(`  ${TEXTE}  `);
    c.confirmerDecision();

    expect(appels).toEqual([{ action: 'accepter', id: 'd1', texte: TEXTE }]);
    expect(c.demandes()).toHaveLength(0);
    expect(c.decision()).toBeNull();
    expect(compte.identites).toBe(2);
  });

  it('refuse avec une reponse, sans recharger les identites', () => {
    const { c, appels, compte } = monter();
    c.ouvrirDecision(DEMANDE, 'REFUSER');
    c.texteDecision.set('Venez au comptoir avec votre piece');
    c.confirmerDecision();

    expect(appels).toEqual([{ action: 'refuser', id: 'd1', texte: 'Venez au comptoir avec votre piece' }]);
    expect(c.demandes()).toHaveLength(0);
    expect(compte.identites).toBe(1);
  });

  it('en cas d echec, garde la boite ouverte, dit pourquoi et recharge la liste', () => {
    const { c, compte } = monter(true);
    c.ouvrirDecision(DEMANDE, 'ACCEPTER');
    c.texteDecision.set(TEXTE);
    c.confirmerDecision();

    expect(c.decision()).not.toBeNull();
    expect(c.erreur()).toContain('deja ete traitee');
    expect(compte.demandes).toBe(2);
    expect(c.enCours()).toBe(false);
  });
});
