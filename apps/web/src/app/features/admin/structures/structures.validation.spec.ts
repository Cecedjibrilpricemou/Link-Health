// Ce que la creation d'une structure exige, type par type.
//
// **Le constat.** Un formulaire rempli au complet pour un centre de sante se
// voyait refuse par « Nom et prefecture sont obligatoires » — alors que le nom
// et la prefecture etaient la. Ce qui manquait etait la commune, que la
// condition teste mais que le message ne nomme pas. On cherche au mauvais
// endroit, longtemps.
//
// Les neuf types y passent : un controle ajoute pour les structures privees
// ne doit pas bloquer un poste de sante, et l'inverse non plus.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';

import { StructuresComponent } from './structures.component';
import { AdminService } from '../../../core/services/admin.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

const cartes = vi.hoisted(() => {
  const carte = { setView: vi.fn(), on: vi.fn(), remove: vi.fn() };
  return {
    carte,
    map: vi.fn(() => carte),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    marker: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      on: vi.fn().mockReturnThis(),
      setLatLng: vi.fn().mockReturnThis(),
      getLatLng: vi.fn(() => ({ lat: 9.5, lng: -13.6 })),
    })),
    divIcon: vi.fn(() => ({})),
  };
});

vi.mock('leaflet', () => cartes);

/** Les neuf types que le formulaire propose. */
const TYPES = [
  'POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU',
  'CLINIQUE', 'PHARMACIE', 'LABORATOIRE', 'ASSURANCE',
] as const;

/** Ceux qui doivent produire un dossier reglementaire. */
const PRIVES = ['PHARMACIE', 'CLINIQUE', 'LABORATOIRE', 'ASSURANCE'];

function monter() {
  const erreurs: string[] = [];
  const envois: { route: string; payload: Record<string, unknown> }[] = [];

  const reponse = of({
    success: true,
    data: {
      structure: { id: 's1', nom: 'Essai' },
      admin: { prenom: 'Awa', nom: 'Bah', telephone: '622000001' },
      motDePasseTemporaire: 'temporaire',
    },
  });

  const admin = {
    getStructures: () => of({ success: true, data: [] }),
    createStructure: vi.fn((payload: Record<string, unknown>) => {
      envois.push({ route: 'structure', payload });
      return reponse;
    }),
    createPharmacie: vi.fn((payload: Record<string, unknown>) => {
      envois.push({ route: 'pharmacie', payload });
      return reponse;
    }),
  };

  TestBed.configureTestingModule({
    imports: [StructuresComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: AdminService, useValue: admin },
      {
        provide: ToastrService,
        useValue: {
          success() {}, warning() {}, info() {},
          error(message: string) { erreurs.push(message); },
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(StructuresComponent);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, erreurs, envois };
}

/** Un formulaire complet pour ce type, dossier reglementaire compris. */
function remplir(component: StructuresComponent, type: string): void {
  component.newStructure = {
    nom: 'Structure d’essai',
    type,
    prefecture: 'Conakry',
    commune: 'Ratoma',
    quartier: 'Kipé',
    adresse: 'Route de Kipé',
    latitude: null,
    longitude: null,
    telephone: '620000001',
    rccm: 'GN.TCC.2026.A.1',
    numeroAgrementCreation: 'ARR/2026/01',
    numeroAgrementExploitation: 'ARR/2026/02',
    lieuAutorise: 'Kipé, Ratoma',
    admin: {
      prenom: 'Awa', nom: 'Bah',
      telephone: '622000001', email: 'awa@example.gn',
    },
  };

  if (PRIVES.includes(type)) {
    component.pieces.set({
      AGREMENT_CREATION: new File(['%PDF-1.4'], 'creation.pdf', { type: 'application/pdf' }),
    });
    component.piecesCompletes.set(true);
  }
}

describe('creation d une structure : ce qui est exige, type par type', () => {
  beforeEach(() => TestBed.resetTestingModule());

  /**
   * Le message doit nommer **tous** les champs que la condition teste.
   *
   * C'est le defaut d'origine : la commune etait exigee sans etre nommee.
   * Verifie sur le catalogue reel, pas sur une cle.
   */
  it('nomme la commune dans le message, puisqu elle est exigee', () => {
    const texteFr = (fr as Record<string, any>)['ADMIN']['STRUCTURES']['ERR_VALIDATION_STRUCT'] as string;
    const texteEn = (en as Record<string, any>)['ADMIN']['STRUCTURES']['ERR_VALIDATION_STRUCT'] as string;

    expect(texteFr.toLowerCase()).toContain('commune');
    expect(texteEn.toLowerCase()).toContain('commune');
    // Les deux autres champs testes restent nommes.
    expect(texteFr.toLowerCase()).toContain('nom');
    expect(texteFr.toLowerCase()).toContain('préfecture');
  });

  for (const type of TYPES) {
    const prive = PRIVES.includes(type);

    it(`cree un ${type} quand le formulaire est complet`, () => {
      const { component, erreurs, envois } = monter();
      remplir(component, type);

      component.creerStructure();

      expect(erreurs).toEqual([]);
      expect(envois.length).toBe(1);
      expect(envois[0]!.route).toBe(type === 'PHARMACIE' ? 'pharmacie' : 'structure');
    });

    it(`refuse un ${type} sans commune, en la nommant`, () => {
      const { component, erreurs, envois } = monter();
      remplir(component, type);
      component.newStructure.commune = '';

      component.creerStructure();

      expect(envois).toEqual([]);
      expect(erreurs.length).toBe(1);
      expect(erreurs[0]!.toLowerCase()).toContain('commune');
    });

    it(`n'exige un dossier reglementaire d'un ${type} que s'il est prive`, () => {
      const { component } = monter();
      remplir(component, type);

      expect(component.exigeUnDossier()).toBe(prive);
    });

    if (!prive) {
      it(`cree un ${type} sans aucune piece ni numero d'agrement`, () => {
        const { component, erreurs, envois } = monter();
        remplir(component, type);
        component.newStructure.rccm = '';
        component.newStructure.numeroAgrementCreation = '';
        component.newStructure.numeroAgrementExploitation = '';
        component.newStructure.lieuAutorise = '';
        component.pieces.set({});
        component.piecesCompletes.set(false);

        component.creerStructure();

        expect(erreurs).toEqual([]);
        expect(envois.length).toBe(1);
      });
    } else {
      it(`refuse un ${type} dont le dossier est incomplet`, () => {
        const { component, erreurs, envois } = monter();
        remplir(component, type);
        component.piecesCompletes.set(false);

        component.creerStructure();

        expect(envois).toEqual([]);
        expect(erreurs.length).toBe(1);
      });
    }
  }
});
