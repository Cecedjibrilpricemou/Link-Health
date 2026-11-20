// Creer une compagnie d'assurance en une fois, depuis l'onglet Assurances.
//
// **Le defaut qui a mene ici** : il fallait trois gestes dans deux ecrans -
// la structure dans « Structures », puis la compagnie et son rattachement
// ici. Qui s'arretait au premier laissait un responsable devant « Cette
// structure n'est rattachee a aucune compagnie d'assurance ».
//
// Ce fichier tient ce que l'ecran promet : le bouton ne part pas sans
// l'agrement et dit pourquoi, juste au-dessus de lui ; tout part en un seul
// envoi ; le mot de passe ne vit que dans la modale.
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { ToastrService } from 'ngx-toastr';
import { vi } from 'vitest';
import type { CreationAssuranceView, CreerAssuranceDto, PiecesAttenduesView } from '@baobaoheath/shared-types';

import { AssuranceComponent } from './assurance.component';
import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
import { GeographieService } from '../../../core/services/geographie.service';
import { PiecesAgrementComponent } from '../../../shared/components/pieces-agrement/pieces-agrement.component';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

const ATTENDUES: PiecesAttenduesView[] = [{
  type: 'ASSURANCE',
  demandable: false,
  estPublique: false,
  pieces: [{ type: 'AGREMENT_ASSURANCE', libelle: "l'agrément de la Banque Centrale" }],
}];

const CREEE: CreationAssuranceView = {
  structure: { id: 'struct-1', nom: 'Sunu Assurances', type: 'ASSURANCE', prefecture: 'Conakry' } as CreationAssuranceView['structure'],
  assureur: {
    id: 'assu-1', nom: 'Sunu Assurances', code: 'SUNU', estActif: true, modeEchange: 'MANUEL',
    nombreContrats: 0, regles: [],
  } as unknown as CreationAssuranceView['assureur'],
  responsable: { id: 'resp-1', prenom: 'Awa', nom: 'Bah', telephone: '620333444', email: 'awa@sunu.gn', role: 'ASSUREUR' },
  motDePasseTemporaire: 'Kq7m-Xw3P-abcd-EFGH',
};

function monter() {
  const creerAssurance = vi.fn((_dto: CreerAssuranceDto, _pieces: Record<string, File>) =>
    of({ success: true, data: CREEE }));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AssuranceComponent],
    providers: [
      provideZonelessChangeDetection(),
      {
        provide: AdminService,
        useValue: {
          getAssureurs: () => of({ success: true, data: [] }),
          getStructures: () => of({ success: true, data: [] }),
          creerAssurance,
        },
      },
      {
        provide: DemandeAgrementService,
        useValue: { piecesAttendues: () => of({ success: true, data: ATTENDUES }) },
      },
      {
        provide: GeographieService,
        useValue: {
          configuration: () => null,
          chargerConfiguration: () => of(null),
          libelle: (role: string) => (role === 'base' ? 'Commune' : 'Préfecture'),
          nomsSuggeres: () => of([]),
        },
      },
      { provide: ToastrService, useValue: { success() {}, error() {}, warning() {}, info() {} } },
    ],
  });
  const fixture = TestBed.createComponent(AssuranceComponent);
  fixture.detectChanges();
  const rendre = () => { fixture.detectChanges(); return fixture.nativeElement as HTMLElement; };
  return { c: fixture.componentInstance, fixture, rendre, creerAssurance };
}

/** Tout ce que le formulaire exige, sauf la piece. */
function remplir(c: AssuranceComponent) {
  c.ouvrirCreation();
  c.nouvelleAssurance = {
    nom: 'Sunu Assurances', code: 'sunu', modeEchange: 'PORTAIL', telephone: '620111222',
    prefecture: 'Conakry', commune: 'Kaloum', quartier: '', adresse: '',
    rccm: 'GN.TCC.2026.B.00042', numeroAgrementCreation: 'D/2009/CAM/LOA/07', lieuAutorise: 'Kaloum',
    responsable: { prenom: 'Awa', nom: 'Bah', telephone: '620333444', email: 'awa@sunu.gn' },
  };
}

/**
 * Joindre l'agrement comme le ferait l'administrateur : par le bloc des
 * pieces, qui rend lui-meme les fichiers et leur completude au formulaire.
 * Fixer ces deux signaux a la main ne tiendrait pas : le bloc reemet son
 * propre etat au rendu suivant.
 */
function joindreAgrement(fixture: ComponentFixture<AssuranceComponent>) {
  fixture.detectChanges();
  const bloc = fixture.debugElement.query(By.directive(PiecesAgrementComponent)).componentInstance as PiecesAgrementComponent;
  const fichier = new File([new Uint8Array(2048)], 'agrement.pdf', { type: 'application/pdf' });
  bloc.choisir('AGREMENT_ASSURANCE', { target: { files: [fichier], value: 'agrement.pdf' } } as unknown as Event);
  fixture.detectChanges();
}

describe('creer une compagnie d assurance en une fois', () => {
  // (5) Sans l'agrement, le bouton ne part pas - et il dit pourquoi, avec le
  // compte des pieces, juste au-dessus de lui.
  it('desactive le bouton tant que l agrement manque, et en donne la raison au-dessus', () => {
    const { c, rendre } = monter();
    remplir(c);

    const el = rendre();
    const bouton = el.querySelector<HTMLButtonElement>('.bb-struct__save-btn')!;
    const raison = el.querySelector('.bb-struct__blocage')!;

    expect(bouton.disabled).toBe(true);
    expect(raison.textContent).toContain('0 sur 1');
    // Juste au-dessus : la raison precede immediatement la rangee du bouton.
    expect(raison.nextElementSibling?.classList.contains('bb-struct__form-actions')).toBe(true);
  });

  it('libere le bouton une fois l agrement joint, sans plus rien dire', () => {
    const { c, fixture, rendre } = monter();
    remplir(c);
    joindreAgrement(fixture);

    const el = rendre();
    expect(el.querySelector<HTMLButtonElement>('.bb-struct__save-btn')!.disabled).toBe(false);
    expect(el.querySelector('.bb-struct__blocage')).toBeNull();
  });

  it('nomme ce qui manque avant la piece : le responsable sans email valide', () => {
    const { c, fixture } = monter();
    remplir(c);
    joindreAgrement(fixture);
    c.nouvelleAssurance.responsable.email = 'pas-un-email';

    expect(c.raisonBlocage()).toBe((fr as Record<string, any>)['ADMIN']['ASSURANCE']['BLOCAGE_RESPONSABLE']);
    expect(c.peutCreerAssurance()).toBe(false);
  });

  it('envoie tout en un seul appel, piece comprise, et montre le mot de passe dans la modale', () => {
    const { c, fixture, rendre, creerAssurance } = monter();
    remplir(c);
    joindreAgrement(fixture);

    c.creerAssurance();

    expect(creerAssurance).toHaveBeenCalledTimes(1);
    const [dto, pieces] = creerAssurance.mock.calls[0]!;
    expect(dto).toEqual(expect.objectContaining({
      nom: 'Sunu Assurances', code: 'SUNU', modeEchange: 'PORTAIL', commune: 'Kaloum',
      responsable: expect.objectContaining({ email: 'awa@sunu.gn' }),
    }));
    expect(Object.keys(pieces)).toEqual(['AGREMENT_ASSURANCE']);
    expect(rendre().querySelector('.bb-mdp-modal__mdp')?.textContent).toBe('Kq7m-Xw3P-abcd-EFGH');
  });

  // Le mot de passe ne s'affiche qu'une fois : fermer la modale l'efface, et
  // il n'apparait nulle part ailleurs sur la page.
  it('efface le mot de passe a la fermeture de la modale', () => {
    const { c, fixture, rendre } = monter();
    remplir(c);
    joindreAgrement(fixture);
    c.creerAssurance();

    c.fermerCompagnieCreee();

    expect(c.compagnieCreee()).toBeNull();
    expect(rendre().textContent).not.toContain('Kq7m-Xw3P-abcd-EFGH');
  });

  it('repart d un formulaire vide, sans la piece de la compagnie precedente', () => {
    const { c, fixture } = monter();
    remplir(c);
    joindreAgrement(fixture);
    c.creerAssurance();

    expect(c.nouvelleAssurance.nom).toBe('');
    expect(c.piecesAssurance()).toEqual({});
    expect(c.piecesAssuranceCompletes()).toBe(false);
  });

  // (6) Une cle absente s'affiche telle quelle : l'administrateur lirait
  // « ADMIN.ASSURANCE.CREER_COMPAGNIE » sur le bouton.
  it.each([['fr', fr], ['en', en]] as const)('%s porte toutes les cles de la creation', (_langue, catalogue) => {
    const bloc = (catalogue as Record<string, any>)['ADMIN']['ASSURANCE'];
    for (const cle of [
      'NOUVELLE_COMPAGNIE', 'RATTACHER_EXISTANTE', 'RATTACHER_AIDE', 'CREATION_TITRE', 'CREATION_AIDE',
      'SECTION_COMPAGNIE', 'SECTION_SIEGE', 'SECTION_RESPONSABLE', 'RESPONSABLE_AIDE', 'CREER_COMPAGNIE',
      'COMPAGNIE_CREEE_TITRE', 'COMPAGNIE_CREEE', 'BLOCAGE_NOM', 'BLOCAGE_CODE', 'BLOCAGE_LIEU',
      'BLOCAGE_IDENTIFIANTS', 'BLOCAGE_RESPONSABLE', 'BLOCAGE_PIECES',
    ]) {
      expect(bloc[cle]).toBeTruthy();
    }
  });
});
