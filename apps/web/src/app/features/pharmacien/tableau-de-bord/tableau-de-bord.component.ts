// features/pharmacien/tableau-de-bord — ce que l'officine a fait aujourd'hui.
//
// Addendum du 2026-09-28, point 1.2. Les ventes annulees sont exclues de tous
// les agregats cote API : une erreur de caisse corrigee ne doit pas gonfler le
// chiffre d'affaires.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { RapportCaisseView, RuptureStockView, TableauDeBordOfficineView } from '@baobaoheath/shared-types';

import { PharmacienService } from '../../../core/services/pharmacien.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { CategorieProduitPipe } from '../../../shared/pipes/categorie-produit.pipe';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

@Component({
  selector: 'app-pharmacien-tableau-de-bord',
  standalone: true,
  imports: [DatePipe, DecimalPipe, RouterLink, MatButtonModule, CategorieProduitPipe, TranslatePipe, ExportListeComponent],
  templateUrl: './tableau-de-bord.component.html',
  styleUrl: './tableau-de-bord.component.scss',
})
export class TableauDeBordComponent implements OnInit {
  private pharma = inject(PharmacienService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  tb = signal<TableauDeBordOfficineView | null>(null);
  rapport = signal<RapportCaisseView | null>(null);
  periodeRapport = signal<'JOUR' | 'MOIS' | 'ANNEE'>('JOUR');

  /** Ce qu'on emporte chez le grossiste : les produits en manque, et de
   * combien. Le manque est la difference au seuil — c'est le nombre qu'on
   * commande, et le calculer de tete devant le fournisseur se rate. */
  readonly ruptures = computed<RuptureStockView[]>(() => this.tb()?.ruptures ?? []);

  readonly colonnes: ColonneExport<RuptureStockView>[] = [
    { titre: 'EXPORT.COL.PRODUIT', valeur: (r) => r.medicament.libelle },
    { titre: 'EXPORT.COL.CATEGORIE', valeur: (r) => r.medicament.categorie },
    { titre: 'EXPORT.COL.EN_STOCK', valeur: (r) => r.quantite, nombre: true },
    { titre: 'EXPORT.COL.SEUIL', valeur: (r) => r.seuilAlerte, nombre: true },
    { titre: 'EXPORT.COL.UNITE', valeur: (r) => r.unite },
    { titre: 'EXPORT.COL.MANQUE', valeur: (r) => Math.max(0, r.seuilAlerte - r.quantite), nombre: true },
  ];
  isLoading = signal(true);

  readonly periodes: ('JOUR' | 'MOIS' | 'ANNEE')[] = ['JOUR', 'MOIS', 'ANNEE'];

  /**
   * La part de chaque moyen de paiement sur la periode, pour la barre de
   * repartition. Rapportee au total encaisse, pas au chiffre d'affaires :
   * la part prise en charge par un assureur n'est pas encaissee au comptoir.
   */
  readonly parts = computed(() => {
    const modes = this.rapport()?.encaissementsParMode ?? [];
    const total = modes.reduce((s, m) => s + m.montantGnf, 0);
    if (total === 0) return [];
    return modes.map((m) => ({ ...m, pourcent: Math.round((m.montantGnf / total) * 100) }));
  });

  /** Panier moyen de la periode (ventes payees seulement, au franc pres). */
  readonly panierMoyen = computed(() => {
    const r = this.rapport();
    return r && r.nombreVentesPayees > 0 ? Math.round(r.chiffreAffairesGnf / r.nombreVentesPayees) : 0;
  });

  choisirPeriode(p: 'JOUR' | 'MOIS' | 'ANNEE') {
    if (this.periodeRapport() === p) return;
    this.periodeRapport.set(p);
    this.chargerRapport();
  }

  /** La quantite du produit le plus vendu, qui sert d'echelle aux barres. */
  readonly maxQuantite = computed(() =>
    Math.max(1, ...(this.tb()?.produitsLesPlusVendus ?? []).map((p) => p.quantite))
  );

  ngOnInit() {
    this.charger();
  }

  charger() {
    this.isLoading.set(true);
    this.pharma.getTableauDeBord().subscribe({
      next: (r) => {
        this.tb.set(r.data ?? null);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.isLoading.set(false);
        const e = err as { status?: number };
        this.toastr.error(
          e?.status === 0
            ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
            : this.i18n.t('PHARMACIEN.TDB.ERR_LOAD'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
      },
    });
    this.chargerRapport();
  }

  chargerRapport() {
    this.pharma.getRapportCaisse(this.periodeRapport()).subscribe({
      next: (r) => this.rapport.set(r.data ?? null),
      error: (err) => {
        const e = err as { status?: number; error?: { error?: string } };
        this.toastr.error(
          e?.status === 0 ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE') : e?.error?.error ?? this.i18n.t('PHARMACIEN.TDB.RAPPORT_ERR'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
      },
    });
  }

  /** Largeur de barre, en pourcentage de la meilleure vente. */
  largeur(quantite: number): string {
    return `${Math.max(4, Math.round((quantite / this.maxQuantite()) * 100))}%`;
  }
}
