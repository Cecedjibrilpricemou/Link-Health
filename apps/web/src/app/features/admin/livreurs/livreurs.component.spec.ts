// Recrutement des livreurs : la commune est la zone qui decide quelles
// courses un livreur voit et recoit. Le formulaire l'exige et l'envoie ; la
// liste l'affiche.
//
// **Depuis que la creation depose un dossier**, ce fichier tient aussi ce que
// la porte de l'administration ne doit jamais devenir : celle par ou l'on
// passe pour eviter de fournir les six pieces qu'exige le formulaire public.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { CreationLivreurView, CreerLivreurDto, LivreurAdminView } from '@baobaoheath/shared-types';

import { LivreursComponent } from './livreurs.component';
import { LivreurAdminService } from '../../../core/services/livreur-admin.service';
import { TYPES_PIECES_LIVREUR } from '../../../core/services/candidature-livreur.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

const LIVREUR: LivreurAdminView = {
  id: 'l-1', prenom: 'Ibrahima', nom: 'Keïta', telephone: '620100016',
  quartier: 'Donka', commune: 'Dixinn', prefecture: 'Conakry', estActif: true,
  creeLe: '2026-11-06T00:00:00.000Z',
} as LivreurAdminView;

function monter(livreurs: LivreurAdminView[] = [LIVREUR], motDePasse: string | null = 'Temp-Mdp-9') {
  const creer = vi.fn((dto: CreerLivreurDto) => of({
    success: true,
    data: {
      livreur: { ...LIVREUR, ...dto },
      numeroDossier: 'DL-2026-0003',
      motDePasseTemporaire: motDePasse,
    } as CreationLivreurView,
  }));
  const service = {
    lister: () => of({ success: true, data: livreurs }),
    creer,
    definirActivite: () => of({ success: true, data: LIVREUR }),
  };
  TestBed.configureTestingModule({
    imports: [LivreursComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: LivreurAdminService, useValue: service },
    ],
  });
  const fixture = TestBed.createComponent(LivreursComponent);
  fixture.detectChanges();
  const rendre = () => { fixture.detectChanges(); return fixture.nativeElement as HTMLElement; };
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, rendre, creer };
}

/** Ce que fait le navigateur quand on choisit un fichier. */
function evenementFichier(f: File): Event {
  return { target: { files: [f], value: 'x' } } as unknown as Event;
}

function remplir(c: LivreursComponent, commune: string) {
  c.modifier('prenom', 'Mamadou');
  c.modifier('nom', 'Diallo');
  c.modifier('dateNaissance', '1995-04-12');
  c.modifier('sexe', 'M');
  c.modifier('telephone', '620100099');
  c.modifier('quartier', 'Kipé');
  c.modifier('commune', commune);
  c.modifier('prefecture', 'Conakry');
}

function joindreLesSixPieces(c: LivreursComponent) {
  for (const type of TYPES_PIECES_LIVREUR) {
    c.choisirPiece(type, evenementFichier(new File([new Uint8Array(2048)], `${type}.jpg`, { type: 'image/jpeg' })));
  }
}

describe('admin : recrutement des livreurs', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('n autorise pas la creation sans commune', () => {
    const { c } = monter();
    remplir(c, '   ');
    joindreLesSixPieces(c);
    expect(c.peutCreer()).toBe(false);
  });

  it('envoie la commune, nettoyee, avec le reste du profil et les six pieces', () => {
    const { c, creer } = monter();
    remplir(c, '  Ratoma ');
    joindreLesSixPieces(c);
    expect(c.peutCreer()).toBe(true);

    c.creer();

    const [dto, pieces] = creer.mock.calls[0] as unknown as [CreerLivreurDto, Record<string, File>];
    expect(dto).toEqual(expect.objectContaining({
      quartier: 'Kipé', commune: 'Ratoma', prefecture: 'Conakry', dateNaissance: '1995-04-12', sexe: 'M',
    }));
    // Un email vide n'est pas un email : il ne part pas.
    expect(dto).not.toHaveProperty('email');
    expect(Object.keys(pieces).sort()).toEqual([...TYPES_PIECES_LIVREUR].sort());
    // Le formulaire repart vide, commune et pieces comprises.
    expect(c.formulaire().commune).toBe('');
    expect(c.piecesManquantes()).toHaveLength(6);
  });

  it('affiche un champ et une colonne Commune', () => {
    const { el } = monter();
    expect(el.querySelector('input[name="commune"]')).not.toBeNull();
    const cellules = [...el.querySelectorAll('.livreurs__table tbody td')].map((td) => td.textContent?.trim());
    expect(cellules).toContain('Dixinn');
  });

  it('montre un tiret pour un livreur cree avant la commune', () => {
    const { el } = monter([{ ...LIVREUR, commune: null }]);
    const cellules = [...el.querySelectorAll('.livreurs__table tbody td')].map((td) => td.textContent?.trim());
    expect(cellules).toContain('—');
  });
});

describe('admin : le dossier du livreur cree', () => {
  beforeEach(() => TestBed.resetTestingModule());

  // La porte de l'administration n'exige pas moins que celle du motard.
  it('n autorise pas la creation tant qu une piece manque', () => {
    const { c, el, rendre } = monter();
    remplir(c, 'Ratoma');
    joindreLesSixPieces(c);
    c.retirerPiece('CARTE_GRISE');

    expect(c.peutCreer()).toBe(false);
    expect(rendre().querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
    expect(el.querySelectorAll('input[type=file]')).toHaveLength(6);
  });

  it('refuse un mineur, comme le serveur', () => {
    const { c } = monter();
    remplir(c, 'Ratoma');
    joindreLesSixPieces(c);
    const date = new Date();
    date.setFullYear(date.getFullYear() - 17);
    c.modifier('dateNaissance', date.toISOString().slice(0, 10));

    expect(c.estMineur()).toBe(true);
    expect(c.peutCreer()).toBe(false);
  });

  it('refuse un fichier trop lourd sans le retenir', () => {
    const { c } = monter();
    c.choisirPiece('PERMIS_CONDUIRE', evenementFichier(
      new File([new Uint8Array(6 * 1024 * 1024)], 'permis.jpg', { type: 'image/jpeg' }),
    ));
    expect(c.nomDe('PERMIS_CONDUIRE')).toBeNull();
    expect(c.refusDe('PERMIS_CONDUIRE')).not.toBeNull();
  });

  // Parti par courriel, le mot de passe n'a rien a faire a l'ecran.
  it('n affiche pas le mot de passe parti par courriel', () => {
    const { c, rendre } = monter([LIVREUR], null);
    remplir(c, 'Ratoma');
    c.modifier('email', 'motard@exemple.gn');
    joindreLesSixPieces(c);

    c.creer();

    expect(c.creation()).toBeNull();
    expect(rendre().querySelector('.livreurs__password')).toBeNull();
    expect(c.succes()).toContain('DL-2026-0003');
  });

  // Sans email, c'est le seul moyen pour le livreur d'apprendre son mot de passe.
  it('affiche le mot de passe quand il n a pas pu partir', () => {
    const { c, rendre } = monter([LIVREUR], 'Temp-Mdp-9');
    remplir(c, 'Ratoma');
    joindreLesSixPieces(c);

    c.creer();

    expect(rendre().querySelector('.livreurs__password code')?.textContent).toBe('Temp-Mdp-9');
  });

  it.each([['fr', fr], ['en', en]] as const)('%s porte les textes du dossier', (_langue, catalogue) => {
    const bloc = (catalogue as Record<string, any>)['ADMIN']['LIVREURS'];
    for (const cle of ['BIRTH_DATE', 'GENDER', 'EMAIL', 'PIECES_TITLE', 'SUCCES_CREATION', 'SUCCES_CREATION_EMAIL']) {
      expect(bloc[cle]).toBeTruthy();
    }
  });
});
