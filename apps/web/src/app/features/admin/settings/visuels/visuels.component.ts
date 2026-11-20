// features/admin/settings/visuels — Parametres > Images.
//
// Les images des pages publiques, emplacement par emplacement : la page
// d'accueil, les ecrans de connexion, les sept etapes de « Comment ca
// marche ». Le super-admin remplace une image, revient a celle d'origine, et
// la decrit pour qui ne la voit pas.
//
// **Chaque geste s'enregistre seul** : pas de bouton « Enregistrer » commun,
// une image envoyee est en ligne. Les pages publiques suivent sans
// rechargement (PlateformeService).
//
// Tous les champs sont des signaux : l'application est zoneless.
import { Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ToastrService } from 'ngx-toastr';
import { EMPLACEMENTS_VISUELS } from '@baobaoheath/shared-types';
import type { EmplacementVisuel, ParametresVisuelsView } from '@baobaoheath/shared-types';

import { AdminService } from '../../../../core/services/admin.service';
import { PlateformeService } from '../../../../shared/services/plateforme.service';
import { I18nService } from '../../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { ImagePublique, imagePublique, LARGEUR_MINIMUM } from '../../../../shared/utils/visuels-publics';

/** Les memes limites que l'API : refuser ici evite un envoi inutile. */
export const TYPES_ACCEPTES = ['image/jpeg', 'image/png', 'image/webp'];
export const TAILLE_MAX_OCTETS = 8 * 1024 * 1024;
export const DESCRIPTION_MAX = 200;

@Component({
  selector: 'app-settings-visuels',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, TranslatePipe],
  templateUrl: './visuels.component.html',
  styleUrl: './visuels.component.scss',
})
export class VisuelsComponent implements OnInit {
  private admin = inject(AdminService);
  private plateforme = inject(PlateformeService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  /** Les images telles que les parametres les ont chargees. */
  initiaux = input.required<ParametresVisuelsView>();

  readonly emplacements = EMPLACEMENTS_VISUELS;
  readonly minimum = LARGEUR_MINIMUM;
  readonly descriptionMax = DESCRIPTION_MAX;

  visuels = signal<ParametresVisuelsView | null>(null);
  /** Les descriptions en cours de saisie, par emplacement. */
  brouillons = signal<Partial<Record<EmplacementVisuel, string>>>({});
  /** L'emplacement dont un envoi est en cours : ses boutons attendent. */
  enCours = signal<EmplacementVisuel | null>(null);

  ngOnInit() {
    this.majVisuels(this.initiaux());
  }

  image(e: EmplacementVisuel): ImagePublique | null {
    return imagePublique(e, this.visuels());
  }

  description(e: EmplacementVisuel): string {
    return this.brouillons()[e] ?? this.visuels()?.[e].description ?? '';
  }

  saisir(e: EmplacementVisuel, texte: string) {
    this.brouillons.update((b) => ({ ...b, [e]: texte }));
  }

  descriptionModifiee(e: EmplacementVisuel): boolean {
    const b = this.brouillons()[e];
    return b !== undefined && b.trim() !== (this.visuels()?.[e].description ?? '');
  }

  /** La photo du panneau de connexion est decorative : rien a decrire. */
  decorative(e: EmplacementVisuel): boolean {
    return e === 'CONNEXION';
  }

  choisirFichier(e: EmplacementVisuel, evenement: Event) {
    const champ = evenement.target as HTMLInputElement;
    const fichier = champ.files?.[0];
    champ.value = ''; // le meme fichier pourra etre choisi de nouveau
    if (!fichier || this.enCours()) return;
    if (!TYPES_ACCEPTES.includes(fichier.type)) {
      this.toastr.error(this.i18n.t('ADMIN.SETTINGS.VISUELS_ERR_TYPE'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    if (fichier.size > TAILLE_MAX_OCTETS) {
      this.toastr.error(this.i18n.t('ADMIN.SETTINGS.VISUELS_ERR_POIDS'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    this.envoyer(e, this.admin.remplacerVisuel(e, fichier), 'ADMIN.SETTINGS.VISUELS_REMPLACEE');
  }

  retablir(e: EmplacementVisuel) {
    if (this.enCours()) return;
    this.envoyer(e, this.admin.retablirVisuel(e), 'ADMIN.SETTINGS.VISUELS_RETABLIE');
  }

  decrire(e: EmplacementVisuel) {
    if (this.enCours() || !this.descriptionModifiee(e)) return;
    this.envoyer(e, this.admin.decrireVisuel(e, this.description(e).trim()), 'ADMIN.SETTINGS.VISUELS_DECRITE');
  }

  private envoyer(
    e: EmplacementVisuel,
    requete: ReturnType<AdminService['retablirVisuel']>,
    succes: string,
  ) {
    this.enCours.set(e);
    requete.subscribe({
      next: (r) => {
        this.enCours.set(null);
        if (r.data) this.majVisuels(r.data);
        this.brouillons.update((b) => { const c = { ...b }; delete c[e]; return c; });
        this.toastr.success(
          this.i18n.t(succes, { emplacement: this.i18n.t('ADMIN.SETTINGS.VISUEL_' + e) }),
          this.i18n.t('COMMON.SUCCESS'),
        );
      },
      error: (err) => {
        this.enCours.set(null);
        const e2 = err as { status?: number; error?: { error?: string; message?: string } };
        this.toastr.error(
          e2?.status === 0
            ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
            : e2?.error?.error ?? e2?.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
          this.i18n.t('COMMON.ERROR_TITLE'),
        );
      },
    });
  }

  private majVisuels(v: ParametresVisuelsView) {
    this.visuels.set(v);
    // Les pages publiques ouvertes dans cet onglet suivent tout de suite.
    this.plateforme.appliquerVisuels(v);
  }
}
