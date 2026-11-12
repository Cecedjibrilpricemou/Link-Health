// features/public/pharmacie/pharmacie.component.ts
// A3 : la page publique d'une officine — ce qu'elle a en rayon, ou elle est,
// comment l'appeler.
//
// Son adresse web est partageable : on envoie le lien a quelqu'un pour lui
// dire ou aller chercher son traitement. Quand on arrive depuis la recherche
// d'un produit, ce produit est repris dans le champ, parce que le retrouver
// dans deux cents lignes serait une corvee.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PharmacieDetailView, ProduitEnRayonView } from '@baobaoheath/shared-types';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { PublicShellComponent } from '../../../shared/components/public-shell/public-shell.component';
import { RechercheService } from '../../../core/services/recherche.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';

@Component({
  selector: 'app-pharmacie',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe, PublicShellComponent],
  templateUrl: './pharmacie.component.html',
  styleUrl: './pharmacie.component.scss',
})
export class PharmacieComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly recherche = inject(RechercheService);
  private readonly i18n = inject(I18nService);
  readonly plateforme = inject(PlateformeService);

  readonly q = signal('');
  readonly chargement = signal(true);
  readonly erreur = signal('');
  readonly officine = signal<PharmacieDetailView | null>(null);

  private id = '';

  /** « Dixinn · Belle-Vue », ou ce qu'on en connait. */
  readonly lieu = computed(() => {
    const o = this.officine();
    if (!o) return '';
    return [o.commune, o.quartier].map((v) => (v ?? '').trim()).filter(Boolean).join(' · ');
  });

  /** Vrai quand la liste affichee ne montre qu'une partie du rayon. */
  readonly filtre = computed(() => {
    const o = this.officine();
    return !!o && this.q().trim() !== '' && o.produits.length !== o.nombreProduits;
  });

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.q.set(this.route.snapshot.queryParamMap.get('q') ?? '');
    this.charger();
  }

  charger(): void {
    if (!this.id) {
      this.erreur.set(this.i18n.t('PUBLIC.PHARMACY.NOT_FOUND'));
      this.chargement.set(false);
      return;
    }
    this.chargement.set(true);
    this.erreur.set('');
    this.recherche.pharmacie(this.id, this.q()).subscribe({
      next: (r) => {
        this.officine.set(r.data ?? null);
        this.chargement.set(false);
      },
      error: (e: { error?: { message?: string } }) => {
        this.erreur.set(e.error?.message ?? this.i18n.t('PUBLIC.PHARMACY.NOT_FOUND'));
        this.officine.set(null);
        this.chargement.set(false);
      },
    });
  }

  /** Tout voir : on efface le filtre herite de la recherche precedente. */
  toutVoir(): void {
    this.q.set('');
    this.charger();
  }

  prix(p: ProduitEnRayonView): string {
    return new Intl.NumberFormat(this.i18n.lang() === 'en' ? 'en-US' : 'fr-FR').format(p.prixGnf);
  }

  declare(p: ProduitEnRayonView): string {
    const jours = Math.floor((Date.now() - new Date(p.declareLe).getTime()) / 86_400_000);
    if (jours <= 0) return this.i18n.t('PUBLIC.SEARCH.DECLARED_TODAY');
    if (jours === 1) return this.i18n.t('PUBLIC.SEARCH.DECLARED_YESTERDAY');
    return this.i18n.t('PUBLIC.SEARCH.DECLARED_DAYS', { jours });
  }
}
