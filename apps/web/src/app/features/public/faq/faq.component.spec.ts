// La FAQ nomme la plateforme par le nom que l'administration a configure.
//
// **Le defaut que ce fichier empeche de revenir.** La premiere question
// disait « À quoi sert Baobao Health ? », ecrit a la main dans les deux
// catalogues : la plateforme avait change de nom, la FAQ non. Le nom vient
// desormais des parametres (`PlateformeService.nom()`), comme sur l'accueil.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FaqComponent } from './faq.component';
import { PlateformeService } from '../../../shared/services/plateforme.service';
import { ThemeService } from '../../../shared/services/theme.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

function monter(nom: string) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FaqComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ThemeService, useValue: { isDark: signal(false), toggle() {} } },
      {
        provide: PlateformeService,
        useValue: {
          nom: signal(nom),
          logoUrl: signal(''),
          emailContact: signal(''),
          copyright: () => nom,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(FaqComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

/** Toutes les valeurs texte d'un catalogue, avec leur chemin. */
function textes(table: Record<string, unknown>, prefixe = ''): [string, string][] {
  return Object.entries(table).flatMap(([cle, valeur]) => {
    const chemin = prefixe ? `${prefixe}.${cle}` : cle;
    if (typeof valeur === 'string') return [[chemin, valeur] as [string, string]];
    return valeur && typeof valeur === 'object' ? textes(valeur as Record<string, unknown>, chemin) : [];
  });
}

describe('FAQ : le nom de la plateforme', () => {
  it('nomme la plateforme configuree, dans la question comme dans la reponse', () => {
    const el = monter('Kènèya');
    const premiere = el.querySelector('.pub-faq__item')!;

    expect(premiere.querySelector('summary')?.textContent).toContain('Kènèya');
    expect(premiere.querySelector('.pub-faq__answer')?.textContent).toContain('Kènèya');
    expect(el.textContent).not.toMatch(/baobao/i);
  });

  it('suit un changement de nom', () => {
    expect(monter('Autre Nom').querySelector('summary')?.textContent).toContain('Autre Nom');
  });

  // Un texte affiche ne doit jamais porter un nom de plateforme ecrit en dur :
  // il passe par `{{nom}}`. Les noms de paquets (`@baobaoheath/...`) ne sont
  // pas dans les catalogues, seulement dans le code.
  it.each([['fr', fr], ['en', en]] as const)('%s ne contient plus l ancien nom', (_langue, catalogue) => {
    const fautifs = textes(catalogue as Record<string, unknown>).filter(([, v]) => /bao\s*bao/i.test(v));
    expect(fautifs).toEqual([]);
  });
});
