// shared/components/apparence-structure — les couleurs de la structure.
//
// Le responsable (administrateur, titulaire, assureur) choisit une palette ;
// tout son personnel la voit. **Un clic suffit** : l'interface se repeint
// sous ses yeux, puis le choix s'enregistre. S'il echoue, l'ecran revient a
// la palette d'avant et le dit.
//
// Les autres membres voient la palette retenue, sans pouvoir la changer.
//
// Tous les champs sont des signaux : l'application est zoneless.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import { PALETTES_STRUCTURE } from '@baobaoheath/shared-types';
import type { ApparenceStructureView, PaletteStructure, TypeStructure } from '@baobaoheath/shared-types';

import { APERCUS } from '../../../core/theme/palettes-structure';
import { monogramme } from '../../utils/monogramme';
import { urlMedia } from '../../utils/url-media';
import { PaletteStructureService } from '../../services/palette-structure.service';
import { I18nService } from '../../services/i18n.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * La palette conseillee pour chaque metier. Un conseil, pas une regle : la
 * croix verte des officines, le bleu hospitalier, la sobriete du laboratoire.
 */
export const PALETTE_CONSEILLEE: Record<TypeStructure, PaletteStructure> = {
  POSTE: 'EMERAUDE',
  CENTRE: 'EMERAUDE',
  PHARMACIE: 'EMERAUDE',
  HOPITAL_PREF: 'OCEAN',
  HOPITAL_REG: 'OCEAN',
  CHU: 'OCEAN',
  CLINIQUE: 'SARCELLE',
  LABORATOIRE: 'ARDOISE',
  ASSURANCE: 'INDIGO',
};

@Component({
  selector: 'app-apparence-structure',
  standalone: true,
  imports: [TranslatePipe, MatButtonModule],
  templateUrl: './apparence-structure.component.html',
  styleUrl: './apparence-structure.component.scss',
})
export class ApparenceStructureComponent implements OnInit {
  private palette = inject(PaletteStructureService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  readonly palettes = PALETTES_STRUCTURE;
  readonly apercus = APERCUS;

  vue = signal<ApparenceStructureView | null>(null);
  isLoading = signal(true);
  enCours = signal(false);

  /** La palette affichee : celle de l'ecran, apercu compris. */
  readonly active = this.palette.active;

  /** Le logo, ou les initiales qui en tiennent lieu. */
  readonly logo = computed(() => urlMedia(this.vue()?.logoUrl ?? ''));
  readonly initiales = computed(() => monogramme(this.vue()?.nomStructure ?? ''));
  envoiLogo = signal(false);

  readonly conseillee = computed(() => {
    const v = this.vue();
    return v ? PALETTE_CONSEILLEE[v.typeStructure] : null;
  });

  ngOnInit() {
    this.palette.lire().subscribe({
      next: (r) => { this.vue.set(r.data ?? null); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.erreur(err); },
    });
  }

  choisir(p: PaletteStructure) {
    const v = this.vue();
    if (!v?.peutModifier || this.enCours() || p === this.active()) return;
    this.enCours.set(true);
    this.palette.choisir(p).subscribe({
      next: (r) => {
        this.enCours.set(false);
        if (r.data) this.vue.set(r.data);
        this.toastr.success(
          this.i18n.t('APPARENCE.ENREGISTREE', { nom: this.i18n.t('APPARENCE.PALETTE_' + p) }),
          this.i18n.t('COMMON.SUCCESS'),
        );
      },
      error: (err) => { this.enCours.set(false); this.erreur(err); },
    });
  }

  choisirLogo(evenement: Event) {
    const champ = evenement.target as HTMLInputElement;
    const fichier = champ.files?.[0];
    champ.value = '';
    if (!fichier || this.envoiLogo()) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(fichier.type)) {
      this.toastr.error(this.i18n.t('APPARENCE.LOGO_ERR_TYPE'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    if (fichier.size > 3 * 1024 * 1024) {
      this.toastr.error(this.i18n.t('APPARENCE.LOGO_ERR_POIDS'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    this.envoiLogo.set(true);
    this.palette.televerserLogo(fichier).subscribe({
      next: (r) => {
        this.envoiLogo.set(false);
        if (r.data) this.vue.set(r.data);
        this.toastr.success(this.i18n.t('APPARENCE.LOGO_ENREGISTRE'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.envoiLogo.set(false); this.erreur(err); },
    });
  }

  retirerLogo() {
    if (this.envoiLogo()) return;
    this.envoiLogo.set(true);
    this.palette.retirerLogo().subscribe({
      next: (r) => {
        this.envoiLogo.set(false);
        if (r.data) this.vue.set(r.data);
        this.toastr.success(this.i18n.t('APPARENCE.LOGO_RETIRE'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.envoiLogo.set(false); this.erreur(err); },
    });
  }

  private erreur(err: unknown) {
    const e = err as { status?: number; error?: { error?: string; message?: string } };
    if (e?.status === 0) {
      this.toastr.error(this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    this.toastr.error(
      e?.error?.error ?? e?.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
      this.i18n.t('COMMON.ERROR_TITLE'),
    );
  }
}
