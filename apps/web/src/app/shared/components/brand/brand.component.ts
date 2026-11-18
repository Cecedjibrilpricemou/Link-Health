// shared/components/brand/brand.component.ts
// Marque de la plateforme : logo (s'il est televerse) + nom, lus dans les
// parametres. Utilise dans les barres laterales, la landing et les pages
// d'authentification. La taille se regle par variables CSS depuis le parent :
//   --bb-brand-logo (hauteur du logo, 1.75em) et --bb-brand-size (taille du nom,
//   1em : la classe posee sur <app-brand> par le parent fixe donc la taille).
import { Component, inject } from '@angular/core';
import { PlateformeService } from '../../services/plateforme.service';

@Component({
  selector: 'app-brand',
  standalone: true,
  template: `
    @if (plateforme.logoUrl()) {
      <span class="bb-brand__logo-wrap">
        <img class="bb-brand__logo" [src]="plateforme.logoUrl()" [alt]="plateforme.nom()" />
      </span>
    }
    <span class="bb-brand__name">{{ plateforme.nom() }}</span>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 8px; min-width: 0; color: inherit; }
    .bb-brand__logo-wrap {
      display: grid; place-items: center; flex: 0 0 auto;
      width: calc(var(--bb-brand-logo, 1.75em) * 1.6);
      aspect-ratio: 1; overflow: hidden; box-sizing: border-box;
      background: var(--bb-surface-1); border: 1px solid var(--bb-border-light); border-radius: 50%;
    }
    /* Le logo remplit le cercle au lieu d'y flotter : la plupart des logos
       d'etablissement sont des carres a fond plein, et pose au milieu d'une
       pastille claire un tel logo donnait un carre dans un rond, ou le cercle
       ne se voyait pas. Rogne, il devient le cercle. */
    .bb-brand__logo {
      display: block; width: 100%; height: 100%; object-fit: cover;
    }
    .bb-brand__name {
      font-family: var(--bb-font-display); font-size: var(--bb-brand-size, 1em); font-weight: 800;
      letter-spacing: -0.3px; color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
  `],
})
export class BrandComponent {
  readonly plateforme = inject(PlateformeService);
}
