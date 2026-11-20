// shared/components/brand/brand.component.ts
// La marque en tete de la barre laterale, de la landing et des pages
// d'authentification. La taille se regle par variables CSS depuis le parent :
//   --bb-brand-logo (hauteur du logo, 1.75em) et --bb-brand-size (taille du nom,
//   1em : la classe posee sur <app-brand> par le parent fixe donc la taille).
//
// **Deux portees.** `plateforme` (par defaut) : le logo et le nom de la
// plateforme - pages publiques, authentification, administration nationale.
// `espace` : la structure de l'utilisateur, son logo ou son monogramme, et
// l'onglet du navigateur a son nom. La plateforme n'apparait plus dans les
// interfaces des structures.
import { Component, OnDestroy, computed, effect, inject, input } from '@angular/core';
import { PlateformeService } from '../../services/plateforme.service';
import { EspaceService } from '../../services/espace.service';

@Component({
  selector: 'app-brand',
  standalone: true,
  template: `
    @if (espaceAffiche(); as e) {
      @if (e.logo) {
        <span class="bb-brand__logo-wrap">
          <img class="bb-brand__logo" [src]="e.logo" [alt]="e.nom" />
        </span>
      } @else if (e.monogramme) {
        <span class="bb-brand__mono" aria-hidden="true">{{ e.monogramme }}</span>
      } @else {
        <span class="bb-brand__mono" aria-hidden="true"><i [class]="'pi ' + e.icone"></i></span>
      }
      <span class="bb-brand__name bb-brand__name--espace" [attr.title]="e.nom">{{ e.nom }}</span>
    } @else {
      @if (plateforme.logoUrl()) {
        <span class="bb-brand__logo-wrap">
          <img class="bb-brand__logo" [src]="plateforme.logoUrl()" [alt]="plateforme.nom()" />
        </span>
      }
      <span class="bb-brand__name">{{ plateforme.nom() }}</span>
    }
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
    /* Le monogramme : les initiales de la structure, aux couleurs de sa
       palette. Le fonce sur le vif tient 5,9:1 dans toutes les palettes. */
    .bb-brand__mono {
      display: grid; place-items: center; flex: 0 0 auto;
      width: calc(var(--bb-brand-logo, 1.75em) * 1.6);
      aspect-ratio: 1; border-radius: 50%; box-sizing: border-box;
      background: var(--bb-bright); color: var(--bb-deep);
      font-family: var(--bb-font-display); font-weight: 800;
      font-size: calc(var(--bb-brand-logo, 1.75em) * 0.52); letter-spacing: -0.02em; line-height: 1;
    }
    .bb-brand__mono i { font-size: 1.1em; }
    .bb-brand__name {
      font-family: var(--bb-font-display); font-size: var(--bb-brand-size, 1em); font-weight: 800;
      letter-spacing: -0.3px; color: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* Un nom d'etablissement est souvent long (« Centre hospitalier
       universitaire de Donka ») : deux lignes plutot qu'une coupure. */
    .bb-brand__name--espace {
      white-space: normal; line-height: 1.15;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
  `],
})
export class BrandComponent implements OnDestroy {
  readonly plateforme = inject(PlateformeService);
  private espaces = inject(EspaceService);

  /** `espace` dans les interfaces des structures et des patients. */
  portee = input<'plateforme' | 'espace'>('plateforme');

  readonly espaceAffiche = computed(() => (this.portee() === 'espace' ? this.espaces.espace() : null));

  constructor() {
    effect(() => {
      if (this.portee() !== 'espace') return;
      const e = this.espaces.espace();
      this.plateforme.entrerEspace(e ? { nom: e.nom, logo: e.logo } : null);
    });
  }

  ngOnDestroy(): void {
    if (this.portee() === 'espace') this.plateforme.entrerEspace(null);
  }
}
