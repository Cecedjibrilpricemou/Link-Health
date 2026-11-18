// Recrutement des livreurs : la commune est la zone qui decide quelles
// courses un livreur voit et recoit. Le formulaire l'exige et l'envoie ; la
// liste l'affiche.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';
import type { CreerLivreurDto, LivreurAdminView } from '@baobaoheath/shared-types';

import { LivreursComponent } from './livreurs.component';
import { LivreurAdminService } from '../../../core/services/livreur-admin.service';

const LIVREUR: LivreurAdminView = {
  id: 'l-1', prenom: 'Ibrahima', nom: 'Keïta', telephone: '620100016',
  quartier: 'Donka', commune: 'Dixinn', prefecture: 'Conakry', estActif: true,
  creeLe: '2026-11-06T00:00:00.000Z',
} as LivreurAdminView;

function monter(livreurs: LivreurAdminView[] = [LIVREUR]) {
  const envoyes: CreerLivreurDto[] = [];
  const service = {
    lister: () => of({ success: true, data: livreurs }),
    creer: (dto: CreerLivreurDto) => {
      envoyes.push(dto);
      return of({ success: true, data: { livreur: { ...LIVREUR, ...dto }, motDePasseTemporaire: 'x' } });
    },
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
  return { c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, fixture, envoyes };
}

function remplir(c: LivreursComponent, commune: string) {
  c.modifier('prenom', 'Mamadou');
  c.modifier('nom', 'Diallo');
  c.modifier('telephone', '620100099');
  c.modifier('quartier', 'Kipé');
  c.modifier('commune', commune);
  c.modifier('prefecture', 'Conakry');
}

describe('admin : recrutement des livreurs', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('n autorise pas la creation sans commune', () => {
    const { c } = monter();
    remplir(c, '   ');
    expect(c.peutCreer()).toBe(false);
  });

  it('envoie la commune, nettoyee, avec le reste du profil', () => {
    const { c, envoyes } = monter();
    remplir(c, '  Ratoma ');
    expect(c.peutCreer()).toBe(true);

    c.creer();

    expect(envoyes).toEqual([expect.objectContaining({ quartier: 'Kipé', commune: 'Ratoma', prefecture: 'Conakry' })]);
    // Le formulaire repart vide, commune comprise.
    expect(c.formulaire().commune).toBe('');
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
