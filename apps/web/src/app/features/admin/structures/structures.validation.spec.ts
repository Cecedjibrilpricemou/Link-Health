// Ce que la creation d'une structure exige, type par type.
//
// **Deux defauts ont mene a ce fichier.**
//
// Le premier : un formulaire rempli au complet pour un centre de sante se
// voyait refuse par « Nom et prefecture sont obligatoires » — alors que le nom
// et la prefecture etaient la. Ce qui manquait etait la commune, que la
// condition teste mais que le message ne nommait pas.
//
// Le second, plus grave : `exigeUnDossier` etait un `computed` qui lisait
// `newStructure.type`, une propriete ordinaire. Sans dependance reactive, il
// etait evalue une fois a l'affichage puis fige. Choisir « Clinique » ne
// faisait donc pas apparaitre le dossier reglementaire, l'ecran laissait
// partir la creation, et le serveur la refusait sur des champs que le
// formulaire n'avait jamais montres.
//
// Les neuf types y passent : un controle ajoute pour les uns ne doit pas
// bloquer les autres.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { PiecesAttenduesView, TypePieceAgrement } from '@baobaoheath/shared-types';

import { StructuresComponent } from './structures.component';
import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
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

/** Nees d'un acte de l'Etat : ni RCCM ni arrete d'exploitation. */
const PUBLICS = ['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU'];

const QUATRE: TypePieceAgrement[] = [
  'AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
];
const TROIS: TypePieceAgrement[] = ['AGREMENT_CREATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE'];
const DEUX: TypePieceAgrement[] = ['AGREMENT_CREATION', 'DIPLOME_RESPONSABLE'];

/** Ce que l'API rend : la table du serveur, pour les neuf types. */
const PIECES_PAR_TYPE: Record<string, TypePieceAgrement[]> = {
  PHARMACIE: QUATRE, CLINIQUE: QUATRE, LABORATOIRE: QUATRE,
  HOPITAL_PREF: TROIS, HOPITAL_REG: TROIS, CHU: TROIS,
  POSTE: DEUX, CENTRE: DEUX,
  ASSURANCE: ['AGREMENT_ASSURANCE'],
};

const ATTENDUES: PiecesAttenduesView[] = TYPES.map((type) => ({
  type,
  demandable: !['POSTE', 'CENTRE', 'ASSURANCE'].includes(type),
  estPublique: PUBLICS.includes(type),
  pieces: PIECES_PAR_TYPE[type]!.map((piece) => ({
    type: piece,
    libelle: PUBLICS.includes(type) && piece === 'AGREMENT_CREATION'
      ? "l'acte de création de l'établissement"
      : `libellé de ${piece}`,
  })),
}));

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
        provide: DemandeAgrementService,
        useValue: { piecesAttendues: () => of({ success: true, data: ATTENDUES }) },
      },
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

  // Toutes les pieces du type, puisque toutes sont obligatoires.
  const fichiers: Partial<Record<TypePieceAgrement, File>> = {};
  for (const piece of PIECES_PAR_TYPE[type] ?? []) {
    fichiers[piece] = new File(['%PDF-1.4'], `${piece}.pdf`, { type: 'application/pdf' });
  }
  component.pieces.set(fichiers);
  component.piecesCompletes.set(true);
}

describe('creation d une structure : ce qui est exige, type par type', () => {
  beforeEach(() => TestBed.resetTestingModule());

  /**
   * Le message doit nommer **tous** les champs que la condition teste.
   * Verifie sur le catalogue reel, pas sur une cle.
   */
  it('nomme la commune dans le message, puisqu elle est exigee', () => {
    const texteFr = (fr as Record<string, any>)['ADMIN']['STRUCTURES']['ERR_VALIDATION_STRUCT'] as string;
    const texteEn = (en as Record<string, any>)['ADMIN']['STRUCTURES']['ERR_VALIDATION_STRUCT'] as string;

    expect(texteFr.toLowerCase()).toContain('commune');
    expect(texteEn.toLowerCase()).toContain('commune');
    expect(texteFr.toLowerCase()).toContain('nom');
    expect(texteFr.toLowerCase()).toContain('préfecture');
  });

  /**
   * Le defaut du `computed` fige. Ce test lit la valeur **avant** de changer
   * de type, exactement comme le gabarit en s'affichant.
   */
  it('voit le changement de type apres le premier affichage', () => {
    const { component } = monter();

    // Ce que fait le gabarit en s'affichant, avec le type par defaut.
    expect(component.estPublique()).toBe(true);
    expect(component.estAssureur()).toBe(false);

    component.newStructure.type = 'CLINIQUE';
    expect(component.estPublique()).toBe(false);
    expect(component.exigeUnDossier()).toBe(true);

    component.newStructure.type = 'ASSURANCE';
    expect(component.estAssureur()).toBe(true);
    expect(component.estPublique()).toBe(false);
  });

  it("refuse lui-meme une clinique sans dossier, apres un changement de type", () => {
    const { component, erreurs, envois } = monter();

    expect(component.estPublique()).toBe(true);

    remplir(component, 'CLINIQUE');
    component.newStructure.rccm = '';
    component.newStructure.lieuAutorise = '';
    component.newStructure.numeroAgrementCreation = '';
    component.newStructure.numeroAgrementExploitation = '';

    component.creerStructure();

    expect(envois).toEqual([]);
    expect(erreurs.length).toBe(1);
  });

  for (const type of TYPES) {
    const publique = PUBLICS.includes(type);

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

    /**
     * **Tous les types produisent un dossier** depuis le 2026-11-18 : la
     * creation par l'administration exige les memes pieces que la demande
     * publique. Deux portes qui n'exigent pas la meme chose finissent par
     * servir de contournement l'une a l'autre.
     */
    it(`exige un dossier d'un ${type}`, () => {
      const { component } = monter();
      remplir(component, type);

      expect(component.exigeUnDossier()).toBe(true);
      expect(component.requisesImposees()).toEqual(PIECES_PAR_TYPE[type]);
    });

    it(`refuse un ${type} dont le dossier est incomplet`, () => {
      const { component, erreurs, envois } = monter();
      remplir(component, type);
      component.piecesCompletes.set(false);

      component.creerStructure();

      expect(envois).toEqual([]);
      expect(erreurs.length).toBe(1);
    });

    if (publique) {
      it(`n'envoie ni RCCM ni arrete d'exploitation pour un ${type}`, () => {
        const { component, envois } = monter();
        remplir(component, type);

        component.creerStructure();

        const payload = envois[0]!.payload;
        expect(payload['rccm']).toBeUndefined();
        expect(payload['numeroAgrementExploitation']).toBeUndefined();
        expect(payload['numeroAgrementCreation']).toBe('ARR/2026/01');
      });

      it(`refuse un ${type} sans la reference de son acte de creation`, () => {
        const { component, erreurs, envois } = monter();
        remplir(component, type);
        component.newStructure.numeroAgrementCreation = '';

        component.creerStructure();

        expect(envois).toEqual([]);
        expect(erreurs.length).toBe(1);
      });

      it(`nomme « acte de creation » la piece attendue d'un ${type}`, () => {
        const { component } = monter();
        remplir(component, type);

        expect(component.libellesImposes()['AGREMENT_CREATION']).toContain('acte de création');
      });
    } else {
      it(`exige le RCCM d'un ${type}`, () => {
        const { component, erreurs, envois } = monter();
        remplir(component, type);
        component.newStructure.rccm = '';

        component.creerStructure();

        expect(envois).toEqual([]);
        expect(erreurs.length).toBe(1);
      });
    }
  }
});

// ── Pourquoi le bouton ne part pas ───────────────────────────────────
//
// **Un formulaire rempli au complet, un bouton mort, et rien qui le dise.**
// Le dossier reclame quatre PDF ; le compteur « 0/4 jointes » vit en haut du
// bloc des pieces et sort de l'ecran bien avant le bouton. L'administrateur
// n'avait aucun moyen de savoir ce qui manquait.

describe('la raison du blocage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  /** Remplit tout sauf le dossier, et joint `combien` pieces. */
  function sansDossierComplet(component: StructuresComponent, type: string, combien: number) {
    remplir(component, type);
    const fichiers: Partial<Record<TypePieceAgrement, File>> = {};
    for (const piece of (PIECES_PAR_TYPE[type] ?? []).slice(0, combien)) {
      fichiers[piece] = new File(['%PDF-1.4'], `${piece}.pdf`, { type: 'application/pdf' });
    }
    component.pieces.set(fichiers);
    component.piecesCompletes.set(false);
  }

  it('dit combien de pieces manquent quand aucune n est jointe', () => {
    const { component } = monter();
    sansDossierComplet(component, 'PHARMACIE', 0);

    const raison = component.raisonBlocage();
    expect(component.peutEnvoyer()).toBe(false);
    expect(raison).toContain('0');
    expect(raison).toContain('4');
  });

  it('suit le compte a mesure que les pieces arrivent', () => {
    const { component } = monter();
    sansDossierComplet(component, 'CLINIQUE', 2);

    expect(component.raisonBlocage()).toContain('2');
  });

  // Un hopital n'en demande que trois : le total vient du serveur, jamais
  // d'un chiffre ecrit en dur dans l'ecran.
  it('compte selon le type, et non sur un total fixe', () => {
    const { component } = monter();
    sansDossierComplet(component, 'HOPITAL_PREF', 0);

    expect(component.raisonBlocage()).toContain('3');
  });

  it('se tait quand le dossier est complet', () => {
    const { component } = monter();
    remplir(component, 'PHARMACIE');

    expect(component.peutEnvoyer()).toBe(true);
    expect(component.raisonBlocage()).toBeNull();
  });

  // Pendant l'envoi, le bouton est deja desactive et affiche « Creation... » :
  // une raison en plus accuserait l'administrateur alors qu'il n'a rien a
  // faire qu'attendre.
  it('se tait pendant l envoi', () => {
    const { component } = monter();
    sansDossierComplet(component, 'PHARMACIE', 0);
    component.isSaving.set(true);

    expect(component.raisonBlocage()).toBeNull();
  });

  it('nomme la commune quand c est elle qui manque', () => {
    const { component } = monter();
    remplir(component, 'PHARMACIE');
    component.newStructure.commune = '  ';

    expect(component.raisonBlocage()?.toLowerCase()).toContain('commune');
  });

  /**
   * Les deux marqueurs doivent exister dans les deux langues : sans eux, le
   * compte ne s'affiche pas et la phrase perd ce qu'elle apporte.
   */
  it('porte le compte dans les deux langues', () => {
    for (const catalogue of [fr, en]) {
      const texte = (catalogue as Record<string, any>)['ADMIN']['STRUCTURES']['BLOCAGE_PIECES'] as string;
      expect(texte).toContain('{{jointes}}');
      expect(texte).toContain('{{total}}');
    }
    expect((fr as Record<string, any>)['ADMIN']['STRUCTURES']['BLOCAGE_COMMUNE'].toLowerCase()).toContain('commune');
    expect((en as Record<string, any>)['ADMIN']['STRUCTURES']['BLOCAGE_COMMUNE'].toLowerCase()).toContain('commune');
  });
});
