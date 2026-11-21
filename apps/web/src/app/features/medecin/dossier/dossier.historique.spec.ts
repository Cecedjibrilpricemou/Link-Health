// Le panneau « Historique » du dossier de la visite.
//
// Ce que ce fichier tient :
//   - l'état de l'accord se lit dès l'ouverture du dossier ;
//   - sans accord, pas de bouton pour lire, mais la porte d'urgence, qui
//     emporte le patient jusqu'au bris de glace ;
//   - la relance n'est proposée que lorsqu'elle est permise ;
//   - avec l'accord, l'historique se charge à la demande, une seule fois ;
//   - un accord retiré entre-temps : le refus est dit, et l'état rechargé ;
//   - l'état indisponible n'empêche pas de soigner la visite.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { EtatAccesDossierView, HistoriquePatientView } from '@baobaoheath/shared-types';

import { DossierComponent } from './dossier.component';
import { HopitalService } from '../../../core/services/hopital.service';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { MedecinService } from '../../../core/services/medecin.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string {
    return p ? `${cle} ${JSON.stringify(p)}` : cle;
  }
}

const EPISODE = {
  id: 'ep-1', numero: 'EP-2026-000001', motif: 'Fièvre', statut: 'EN_COURS', service: null,
  ouvertLe: '2026-11-20T08:00:00Z', nbConsultations: 0, demandesAnalyse: [],
  structure: { id: 's-1', nom: 'Hôpital Donka' },
  patient: { id: 'pat-1', prenom: 'Awa', nom: 'Diallo', sexe: 'F', dateNaissance: '1990-05-01', telephone: '620000000' },
};

const HISTORIQUE: HistoriquePatientView = {
  patient: {
    prenom: 'Awa', nom: 'Diallo', dateNaissance: '1990-05-01', sexe: 'F',
    groupeSanguin: 'O+', allergies: ['Pénicilline'], maladiesChroniques: [],
  },
  consultations: [{
    id: 'c-1', date: '2026-06-01T10:00:00Z', motif: 'Paludisme suspecté', structure: 'Poste de Kaloum',
    medecin: 'Dr Mariama Bah', diagnostics: ['Paludisme simple'],
    traitements: [{ produit: 'Artéméther', posologie: '1 cp', frequence: '2x/j', dureeJours: 3, quantite: 6 }],
  }],
  vaccinations: [],
  examensSuivis: [{ codeLoinc: '718-7', libelle: 'Hémoglobine', unite: 'g/dL', nbPoints: 3 }],
};

function etat(o: Partial<EtatAccesDossierView>): EtatAccesDossierView {
  return { etat: 'AUCUNE', expireLe: null, peutRelancer: false, brisDeGlaceJusquau: null, peutLire: false, ...o };
}

function monter(acces: EtatAccesDossierView | 'erreur', historique: HistoriquePatientView | 'refus' = HISTORIQUE, soins: unknown[] = []) {
  const getAccesDossier = vi.fn(() => (acces === 'erreur' ? throwError(() => ({ status: 500 })) : of({ success: true, data: acces })));
  const getHistoriquePatient = vi.fn(() => (historique === 'refus'
    ? throwError(() => ({ status: 403, error: { error: 'accord retire' } }))
    : of({ success: true, data: historique })));
  const relancerAccesDossier = vi.fn(() => of({ success: true, data: etat({ etat: 'DEMANDEE', peutRelancer: false }) }));
  const toastr = { error: vi.fn(), success: vi.fn() };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DossierComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'ep-1' } } } },
      { provide: HopitalService, useValue: { getEpisode: () => of({ success: true, data: EPISODE }), listerExamens: () => of({ success: true, data: [] }), soinsDeLaVisite: () => of({ success: true, data: soins }) } },
      { provide: LaboratoireService, useValue: {} },
      { provide: MedecinService, useValue: { getAccesDossier, getHistoriquePatient, relancerAccesDossier } },
      { provide: I18nService, useClass: I18nMaquette },
      { provide: ToastrService, useValue: toastr },
    ],
  });
  const fixture = TestBed.createComponent(DossierComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  return { fixture, el, c: fixture.componentInstance, getAccesDossier, getHistoriquePatient, relancerAccesDossier, toastr };
}

const panneau = (el: HTMLElement) => el.querySelector('.bb-dossier__histo');
const bouton = (el: HTMLElement, classe: string) => el.querySelector<HTMLButtonElement | HTMLAnchorElement>(`.${classe}`);

describe('le panneau historique du dossier de la visite', () => {
  it('lit l etat de l accord pour le patient de la visite', () => {
    const { getAccesDossier, el } = monter(etat({ etat: 'AUCUNE' }));
    expect(getAccesDossier).toHaveBeenCalledWith('pat-1');
    expect(panneau(el)?.textContent).toContain('MEDECIN.DOSSIER.HISTORIQUE.ETAT_AUCUNE');
  });

  it('sans accord : pas de lecture, la porte d urgence mene au bris de glace avec le patient', () => {
    const { el } = monter(etat({ etat: 'REFUSEE' }));
    expect(bouton(el, 'bb-dossier__histo-voir')).toBeNull();
    const urgence = bouton(el, 'bb-dossier__histo-urgence') as HTMLAnchorElement;
    expect(urgence).not.toBeNull();
    expect(urgence.getAttribute('href')).toBe('/medecin/bris-de-glace?patient=pat-1');
  });

  it('demande en attente : relancer seulement quand c est permis', () => {
    const attente = monter(etat({ etat: 'DEMANDEE', peutRelancer: false }));
    expect((bouton(attente.el, 'bb-dossier__histo-relancer') as HTMLButtonElement).disabled).toBe(true);
    expect(attente.el.querySelector('.bb-dossier__histo-aide')).not.toBeNull();

    const permise = monter(etat({ etat: 'DEMANDEE', peutRelancer: true }));
    const b = bouton(permise.el, 'bb-dossier__histo-relancer') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    b.click();
    expect(permise.relancerAccesDossier).toHaveBeenCalledWith('pat-1');
    expect(permise.toastr.success).toHaveBeenCalled();
    permise.fixture.detectChanges();
    expect((bouton(permise.el, 'bb-dossier__histo-relancer') as HTMLButtonElement).disabled).toBe(true);
  });

  it('accord donne : l historique se charge a la demande, une seule fois', () => {
    const { el, fixture, getHistoriquePatient } = monter(etat({ etat: 'ACCORDEE', peutLire: true }));
    expect(getHistoriquePatient).not.toHaveBeenCalled();
    expect(bouton(el, 'bb-dossier__histo-urgence')).toBeNull();

    (bouton(el, 'bb-dossier__histo-voir') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getHistoriquePatient).toHaveBeenCalledWith('pat-1');
    const texte = el.querySelector('.bb-dossier__histo-corps')?.textContent ?? '';
    expect(texte).toContain('Pénicilline');
    expect(texte).toContain('Paludisme simple');
    expect(texte).toContain('Artéméther');
    expect(texte).toContain('Hémoglobine');

    // Masquer puis rouvrir ne relit pas : la lecture est journalisee.
    (bouton(el, 'bb-dossier__histo-voir') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.bb-dossier__histo-corps')).toBeNull();
    (bouton(el, 'bb-dossier__histo-voir') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getHistoriquePatient).toHaveBeenCalledTimes(1);
  });

  it('un bris de glace en cours ouvre la lecture et dit jusqu a quand', () => {
    const { el } = monter(etat({ etat: 'REFUSEE', peutLire: true, brisDeGlaceJusquau: '2026-11-20T14:00:00Z' }));
    expect(bouton(el, 'bb-dossier__histo-voir')).not.toBeNull();
    expect(panneau(el)?.textContent).toContain('MEDECIN.DOSSIER.HISTORIQUE.BRIS_JUSQU_AU');
  });

  it('accord retire entre-temps : le refus est dit, l etat recharge', () => {
    const { el, fixture, toastr, getAccesDossier } = monter(etat({ etat: 'ACCORDEE', peutLire: true }), 'refus');
    (bouton(el, 'bb-dossier__histo-voir') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(toastr.error).toHaveBeenCalledWith('accord retire', expect.anything());
    expect(el.querySelector('.bb-dossier__histo-corps')).toBeNull();
    expect(getAccesDossier).toHaveBeenCalledTimes(2);
  });

  it('etat indisponible : pas de panneau, la visite reste soignable', () => {
    const { el } = monter('erreur');
    expect(panneau(el)).toBeNull();
    expect(el.textContent).toContain('MEDECIN.DOSSIER.OUVRIR_CONSULTATION');
  });

  // Les soins de l'infirmier pendant la visite : le praticien les lit avant
  // de consulter, et apres avoir prescrit.
  it('les soins de l infirmier s affichent dans la visite ; sans soin, rien', () => {
    const soin = {
      id: 's1', creeLe: '2026-11-21T08:00:00.000Z', note: 'Pansement refait', auteur: 'Mariama Sow',
      constantes: { temperature: 38.5, tensionSystolique: null, tensionDiastolique: null, frequenceCardiaque: null,
        frequenceRespiratoire: null, spo2: null, poidsKg: null, glycemie: null },
    };
    const { el } = monter(etat({ etat: 'AUCUNE' }), HISTORIQUE, [soin]);
    const carte = el.querySelector('.bb-hop-soins');
    expect(carte?.textContent).toContain('Mariama Sow');
    expect(carte?.textContent).toContain('38.5');
    expect(carte?.textContent).toContain('Pansement refait');
    const vide = monter(etat({ etat: 'AUCUNE' }));
    expect(vide.el.querySelector('.bb-hop-soins')).toBeNull();
  });
});
