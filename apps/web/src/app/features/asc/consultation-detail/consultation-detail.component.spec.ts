// Consultation (ASC et medecin) : constantes, diagnostic, prescription,
// referencement, cloture. L'ecran le plus sensible de la plateforme, couvert
// jusqu'ici par les seuls parcours Playwright.
//
// Les seuils des alertes de constantes sont **figes ici tels qu'ils sont**,
// pas valides medicalement : ce test garantit qu'ils ne changent pas par
// accident. Les modifier reste une decision medicale.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ConsultationDetailComponent } from './consultation-detail.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { MedecinService } from '../../../core/services/medecin.service';
import { ConsultationService } from '../../../core/services/consultation.service';
import { OrdonnanceService } from '../../../core/services/ordonnance.service';

const CONSULTATION = {
  id: 'c1', statut: 'EN_COURS', constantes: null, diagnostics: [], ordonnances: [{ id: 'o1' }, { id: 'o2' }],
  patient: { utilisateur: { prenom: 'Aïssatou', nom: 'Diallo' } },
};
const MEDICAMENTS = [
  { id: 'para', libelle: 'Paracétamol 500 mg', estReglemente: false },
  { id: 'morph', libelle: 'Morphine 10 mg', estReglemente: true },
];

function monter(options: { role?: string; alertes?: 'ok' | 'motif' | 'panne' } = {}) {
  const appels: Record<string, unknown[]> = { ordonnance: [], diagnostic: [], referral: [], cloture: [], signature: [], alertes: [] };
  const consultations = {
    getConsultationById: () => of({ success: true, data: structuredClone(CONSULTATION) }),
    alertesPrescription: (id: string, idMed: string) => {
      appels['alertes'].push(idMed);
      if (options.alertes === 'panne') return throwError(() => ({ status: 500 }));
      return of({ success: true, data: options.alertes === 'motif'
        ? { alertes: [{ niveau: 'CONTRE_INDICATION', message: 'Allergie connue' }], motifRequis: true }
        : { alertes: [], motifRequis: false } });
    },
    saveOrdonnance: (id: string, dto: unknown) => { appels['ordonnance'].push(dto); return of({ success: true, data: { id: 'l1' } }); },
    saveDiagnostic: (id: string, dto: unknown) => { appels['diagnostic'].push(dto); return of({ success: true, data: { id: 'd1' } }); },
    saveReferral: (id: string, dto: unknown) => { appels['referral'].push(dto); return of({ success: true, data: { id: 'r1' } }); },
    closeConsultation: (id: string) => { appels['cloture'].push(id); return of({ success: true }); },
    saveVitals: () => of({ success: true, data: {} }),
  };
  TestBed.configureTestingModule({
    imports: [ConsultationDetailComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ConsultationService, useValue: consultations },
      { provide: ApiService, useValue: { get: (url: string) => of({ success: true, data: url === '/medicaments' ? MEDICAMENTS : [] }) } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'c1' } } } },
      { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
      { provide: AuthService, useValue: { userRole: signal(options.role ?? 'ASC') } },
      { provide: MedecinService, useValue: { validerConsultation: (id: string, dto: unknown) => { appels['signature'].push(dto); return of({ success: true }); } } },
      { provide: OrdonnanceService, useValue: { urlDocument: () => '' } },
    ],
  });
  TestBed.overrideComponent(ConsultationDetailComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(ConsultationDetailComponent);
  fixture.detectChanges();
  return { c: fixture.componentInstance, appels };
}

const niveaux = (c: ConsultationDetailComponent) => c.vitalsAlerts().map((a) => a.level);

describe('consultation : constantes vitales', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('ne signale rien pour des constantes normales', () => {
    const { c } = monter();
    c.vitalsForm = { spo2: 98, temperature: 37, tensionSystolique: 120, frequenceCardiaque: 75, frequenceRespiratoire: 16, glycemie: 1.0 };
    c.onVitalsChange();
    expect(c.vitalsAlerts()).toEqual([]);
  });

  it('applique les seuils actuels de saturation et de température', () => {
    const { c } = monter();
    for (const [valeurs, attendu] of [
      [{ spo2: 89 }, ['danger']], [{ spo2: 90 }, ['warn']], [{ spo2: 95 }, []],
      [{ temperature: 39 }, ['danger']], [{ temperature: 38 }, ['warn']], [{ temperature: 35.5 }, ['warn']],
      [{ tensionSystolique: 180 }, ['danger']], [{ tensionSystolique: 85 }, ['danger']],
      [{ glycemie: 0.6 }, ['danger']], [{ glycemie: 2.5 }, ['warn']],
    ] as const) {
      c.vitalsForm = { ...valeurs };
      c.onVitalsChange();
      expect(niveaux(c), JSON.stringify(valeurs)).toEqual(attendu);
    }
  });
});

describe('consultation : prescription', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('un produit réglementé n’est jamais renouvelable', () => {
    const { c } = monter();
    c.ordonnanceForm.renouvellementsAutorises = 3;
    c.ordonnanceForm.idMedicament = 'morph';
    c.analyserMedicament();
    expect(c.ordonnanceForm.renouvellementsAutorises).toBe(0);
    expect(c.medicamentReglemente()).toBe(true);
  });

  it('demande les alertes dès le choix du médicament', () => {
    const { c, appels } = monter();
    c.ordonnanceForm.idMedicament = 'para';
    c.analyserMedicament();
    expect(appels['alertes']).toEqual(['para']);
  });

  it('quand l’API exige un motif, l’ordonnance ne part pas sans lui', () => {
    const { c, appels } = monter({ alertes: 'motif' });
    c.ordonnanceForm.idMedicament = 'para';
    c.analyserMedicament();
    expect(c.motifRequis()).toBe(true);
    c.motifDepassement = 'ok';
    c.saveOrdonnance();
    expect(appels['ordonnance']).toEqual([]);
    expect(c.errorMessage()).not.toBe('');
    c.motifDepassement = '  Bénéfice supérieur au risque  ';
    c.saveOrdonnance();
    expect(appels['ordonnance']).toEqual([expect.objectContaining({ idMedicament: 'para', motifDepassement: 'Bénéfice supérieur au risque' })]);
  });

  it('une analyse indisponible n’empêche pas de prescrire, mais le dit', () => {
    const { c, appels } = monter({ alertes: 'panne' });
    c.ordonnanceForm.idMedicament = 'para';
    c.analyserMedicament();
    expect(c.errorMessage()).not.toBe('');
    expect(c.motifRequis()).toBe(false);
    c.saveOrdonnance();
    expect(appels['ordonnance'].length).toBe(1);
  });

  it('remet le formulaire à zéro après l’enregistrement', () => {
    const { c } = monter({ alertes: 'motif' });
    c.ordonnanceForm.idMedicament = 'para';
    c.analyserMedicament();
    c.motifDepassement = 'Bénéfice supérieur au risque';
    c.saveOrdonnance();
    expect(c.ordonnanceForm.idMedicament).toBe('');
    expect(c.motifRequis()).toBe(false);
    expect(c.motifDepassement).toBe('');
  });
});

describe('consultation : diagnostic, référencement, clôture', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('n’envoie pas de gravité quand aucune n’est choisie', () => {
    const { c, appels } = monter();
    c.diagnosticForm.libelle = 'Paludisme simple';
    c.saveDiagnostic();
    expect(appels['diagnostic']).toEqual([expect.objectContaining({ libelle: 'Paludisme simple', severite: undefined, source: 'ASC' })]);
  });

  it('un référencement exige une structure et un résumé clinique', () => {
    const { c, appels } = monter();
    c.referralForm = { idStructureCible: 'cs1', urgence: 'URGENT', resumeClinique: '' };
    c.saveReferral();
    expect(appels['referral']).toEqual([]);
    c.referralForm.resumeClinique = 'Fièvre à 40 °C depuis 3 jours, convulsions';
    c.saveReferral();
    expect(appels['referral'].length).toBe(1);
    expect(c.consultation()?.statut).toBe('REFERENCEE');
    expect(c.isConsultationTerminee()).toBe(true);
  });

  it('l’ASC termine et transmet ; elle ne signe pas', () => {
    const { c, appels } = monter({ role: 'ASC' });
    c.closeConsultation();
    expect(appels['cloture']).toEqual(['c1']);
    expect(appels['signature']).toEqual([]);
    expect(c.consultation()?.statut).toBe('TERMINEE');
  });

  it('le médecin signe, avec toutes les ordonnances de la consultation', () => {
    const { c, appels } = monter({ role: 'MEDECIN' });
    c.closeConsultation();
    expect(appels['signature']).toEqual([{ idOrdonnances: ['o1', 'o2'] }]);
    expect(appels['cloture']).toEqual([]);
  });
});
