// shared/services/palette-structure.service.ts — les couleurs de sa structure.
//
// **Toute l'interface suit, sans rechargement.** La palette ne touche que des
// variables CSS posees sur `<html>` : jetons `--bb-*` de la feuille de style
// et `--mat-sys-*` d'Angular Material. Changer de palette, c'est changer un
// attribut et une feuille de style - chaque ecran ouvert se repeint dans
// l'instant, menu, boutons, champs et fonds compris.
//
// **Elle suit le compte connecte.** `/auth/me` dit la palette de sa
// structure ; un patient, l'administration nationale ou une page publique
// n'en recoivent aucune et gardent la feuille de style telle quelle. A la
// deconnexion, elle tombe.
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { PALETTE_PAR_DEFAUT } from '@baobaoheath/shared-types';
import type { ApparenceStructureView, PaletteStructure } from '@baobaoheath/shared-types';

import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { ApiResponse } from '../../core/models/api.model';
import { cssDePalette, PALETTES, PaletteSurchargee } from '../../core/theme/palettes-structure';

/** L'element `<style>` qui porte la palette active, unique. */
export const ID_FEUILLE_PALETTE = 'bb-palette-structure';
/** La classe qui adoucit le passage d'une palette a l'autre. */
export const CLASSE_TRANSITION = 'bb-palette-transition';
const DUREE_TRANSITION_MS = 400;

@Injectable({ providedIn: 'root' })
export class PaletteStructureService {
  private auth = inject(AuthService);
  private api = inject(ApiService);

  /** Un apercu en cours, qui l'emporte sur la palette du compte. */
  private apercu = signal<PaletteStructure | null>(null);

  /** La palette affichee en ce moment. */
  readonly active = computed<PaletteStructure>(() =>
    this.apercu() ?? this.auth.currentUser()?.paletteStructure ?? PALETTE_PAR_DEFAUT);

  constructor() {
    effect(() => this.appliquer(this.active()));
  }

  /** Lire l'apparence de sa structure : la palette, et s'il peut la changer. */
  lire(): Observable<ApiResponse<ApparenceStructureView>> {
    return this.api.get<ApiResponse<ApparenceStructureView>>('/apparence');
  }

  /**
   * Choisir une palette : elle s'affiche tout de suite, puis s'enregistre.
   * Si l'enregistrement echoue, l'ecran revient a la palette d'avant.
   */
  choisir(palette: PaletteStructure): Observable<ApiResponse<ApparenceStructureView>> {
    this.adoucir();
    this.apercu.set(palette);
    return this.api.put<ApiResponse<ApparenceStructureView>>('/apparence', { palette }).pipe(
      tap({
        next: (r) => {
          const retenue = r.data?.palette ?? palette;
          this.auth.definirPaletteStructure(retenue === PALETTE_PAR_DEFAUT ? null : retenue);
          this.apercu.set(null);
        },
        error: () => { this.adoucir(); this.apercu.set(null); },
      }),
    );
  }

  /** Le logo de la structure : la barre laterale de l'equipe le prend aussitot. */
  televerserLogo(fichier: File): Observable<ApiResponse<ApparenceStructureView>> {
    const donnees = new FormData();
    donnees.append('logo', fichier);
    return this.api.post<ApiResponse<ApparenceStructureView>>('/apparence/logo', donnees).pipe(
      tap((r) => { if (r.data) this.auth.definirLogoStructure(r.data.logoUrl); }),
    );
  }

  /** Retirer le logo : le monogramme revient. */
  retirerLogo(): Observable<ApiResponse<ApparenceStructureView>> {
    return this.api.delete<ApiResponse<ApparenceStructureView>>('/apparence/logo').pipe(
      tap((r) => { if (r.data) this.auth.definirLogoStructure(r.data.logoUrl); }),
    );
  }

  /** Poser la palette sur le document : un attribut, une feuille de style. */
  private appliquer(palette: PaletteStructure): void {
    const racine = document.documentElement;
    let feuille = document.getElementById(ID_FEUILLE_PALETTE) as HTMLStyleElement | null;
    if (palette === PALETTE_PAR_DEFAUT || !(palette in PALETTES)) {
      // La palette par defaut, c'est la feuille de style elle-meme.
      racine.removeAttribute('data-palette');
      feuille?.remove();
      return;
    }
    if (!feuille) {
      feuille = document.createElement('style');
      feuille.id = ID_FEUILLE_PALETTE;
      document.head.appendChild(feuille);
    }
    feuille.textContent = cssDePalette(palette as PaletteSurchargee);
    racine.setAttribute('data-palette', palette);
  }

  /**
   * Un fondu bref quand c'est l'utilisateur qui change : sans lui, l'ecran
   * saute d'une couleur a l'autre. Jamais au chargement, ou il retarderait
   * l'affichage. Desactive quand le systeme demande moins d'animations.
   */
  private adoucir(): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const racine = document.documentElement;
    racine.classList.add(CLASSE_TRANSITION);
    setTimeout(() => racine.classList.remove(CLASSE_TRANSITION), DUREE_TRANSITION_MS);
  }
}
