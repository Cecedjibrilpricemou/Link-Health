// features/asc/stocks/stocks.component.ts
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AscService } from '../../../core/services/asc.service';
import { OfflineQueueService } from '../../../core/services/offline-queue.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import type { CreateStockDto, HorodatageApi, MedicamentView, StockAscView } from '@baobaoheath/shared-types';
import { QuantiteUnitePipe, formaterQuantite } from '../../../shared/pipes/quantite-unite.pipe';

@Component({
  selector: 'app-stocks',
  standalone: true,
  imports: [ListeRechercheComponent, QuantiteUnitePipe, 
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    TranslatePipe,
  ExportListeComponent],
  templateUrl: './stocks.component.html',
  styleUrl: './stocks.component.scss'
})
export class StocksComponent implements OnInit {
  private ascService = inject(AscService);
  private i18n = inject(I18nService);
  readonly offlineQueue = inject(OfflineQueueService);
  protected Math = Math;

  stocks           = signal<StockAscView[]>([]);

  /** Ce qu'on emporte en tournee, et ce qu'il faut demander avant de partir. */
  readonly colonnes: ColonneExport<StockAscView>[] = [
    { titre: 'EXPORT.COL.PRODUIT', valeur: (s) => s.medicament?.libelle },
    { titre: 'EXPORT.COL.QUANTITE', valeur: (s) => s.quantite, nombre: true },
    { titre: 'EXPORT.COL.UNITE', valeur: (s) => s.unite },
    { titre: 'EXPORT.COL.SEUIL', valeur: (s) => s.seuilAlerte, nombre: true },
    { titre: 'EXPORT.COL.ETAT', valeur: (s) => (s.enAlerte ? 'À demander' : 'Suffisant') },
    { titre: 'EXPORT.COL.PEREMPTION_PROCHE',
      valeur: (s) => (s.peremptionLaPlusProche ? new Date(s.peremptionLaPlusProche) : null) },
  ];
  isLoading        = signal(true);
  isSaving         = signal(false);
  successMessage   = signal('');
  errorMessage     = signal('');
  editingId        = signal<string | null>(null);
  editQuantite     = signal(0);
  searchQuery      = signal('');
  totalMedicaments = signal(0);
  stocksCritiques  = signal(0);
  stocksNormaux    = signal(0);

  // Ajout d'une ligne de stock (POST /asc/stocks). Catalogue charge a
  // l'ouverture du formulaire seulement : la plupart des visites ne l'ouvrent pas.
  showAjout        = signal(false);
  catalogue        = signal<MedicamentView[]>([]);
  isLoadingCatalogue = signal(false);
  isCreating       = signal(false);
  nouveau: CreateStockDto = this.nouveauVide();

  ngOnInit() { this.loadStocks(); }

  private nouveauVide(): CreateStockDto {
    return { idMedicament: '', quantite: 0, unite: 'unite', seuilAlerte: 10, datePeremption: undefined };
  }

  /** Medicaments du catalogue qui n'ont pas encore de ligne chez cet ASC. */
  /** Le catalogue pas encore en stock, pour la liste avec recherche. */
  readonly optionsCatalogue = computed<OptionListe[]>(() => {
    const dejaStockes = new Set(this.stocks().map((s) => s.medicament.id));
    return this.catalogue().filter((m) => !dejaStockes.has(m.id)).map((m) => ({
      valeur: m.id,
      libelle: this.libelleMedicament(m),
      recherche: [m.dci, m.nomCommercial].filter(Boolean).join(' '),
    }));
  });

  get catalogueDisponible(): MedicamentView[] {
    const dejaStockes = new Set(this.stocks().map(s => s.medicament.id));
    return this.catalogue().filter(m => !dejaStockes.has(m.id));
  }

  ouvrirAjout() {
    this.nouveau = this.nouveauVide();
    this.errorMessage.set('');
    this.showAjout.set(true);
    if (this.catalogue().length > 0) return;
    this.isLoadingCatalogue.set(true);
    this.ascService.getMedicaments().subscribe({
      next: res => { this.catalogue.set(res.data ?? []); this.isLoadingCatalogue.set(false); },
      error: () => {
        this.isLoadingCatalogue.set(false);
        this.errorMessage.set(this.i18n.t('ASC.STOCKS.ERR_CATALOGUE'));
      }
    });
  }

  fermerAjout() { this.showAjout.set(false); }

  creerStock() {
    if (!this.nouveau.idMedicament || this.isCreating()) return;
    if (!this.offlineQueue.isOnline()) {
      this.errorMessage.set(this.i18n.t('ASC.STOCKS.ERR_CREATE_OFFLINE'));
      return;
    }
    const payload: CreateStockDto = {
      idMedicament: this.nouveau.idMedicament,
      quantite: Number(this.nouveau.quantite) || 0,
      unite: this.nouveau.unite?.trim() || 'unite',
      seuilAlerte: this.nouveau.seuilAlerte !== undefined ? Number(this.nouveau.seuilAlerte) : undefined,
      ...(this.nouveau.datePeremption ? { datePeremption: this.nouveau.datePeremption } : {}),
    };

    this.isCreating.set(true); this.errorMessage.set('');
    this.ascService.createStock(payload).subscribe({
      next: () => {
        this.isCreating.set(false);
        this.showAjout.set(false);
        this.successMessage.set(this.i18n.t('ASC.STOCKS.SUCCESS_CREATE'));
        setTimeout(() => this.successMessage.set(''), 3000);
        this.loadStocks();
      },
      error: (err) => {
        this.isCreating.set(false);
        this.errorMessage.set(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.STOCKS.ERR_CREATE'));
      }
    });
  }

  libelleMedicament(m: MedicamentView): string {
    return m.libelle;
  }

  private loadStocks() {
    this.isLoading.set(true);
    this.ascService.getStocks().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          // GET /asc/stocks renvoie deja la ligne avec son medicament :
          // aucun remappage necessaire (cf. StockAscView).
          const data = response.data as unknown as StockAscView[];
          this.stocks.set(data);
          this.totalMedicaments.set(data.length);
          this.stocksCritiques.set(data.filter(s => s.quantite <= s.seuilAlerte).length);
          this.stocksNormaux.set(data.filter(s => s.quantite > s.seuilAlerte).length);
        }
        this.isLoading.set(false);
      },
      error: () => { this.isLoading.set(false); }
    });
  }

  getMedicamentLabel(s: StockAscView): string {
    const m = s.medicament;
    if (!m) return '—';
    // Le libelle est le nom complet ; la DCI n'est ajoutee que si elle apporte
    // quelque chose. L'ancienne formule rendait « null null » hors medicament.
    return m.dci && !m.libelle.toLowerCase().includes(m.dci.toLowerCase())
      ? `${m.libelle} (${m.dci})`
      : m.libelle;
  }

  /**
   * La liste telle qu'elle est affichee, filtre applique.
   *
   * `computed` et non un accesseur : l'accesseur refabriquait le tableau a
   * chaque cycle de detection, donc l'entree de `<app-export-liste>`
   * changeait d'identite sans arret.
   */
  readonly stocksFiltres = computed<StockAscView[]>(() => {
    const q = this.searchQuery().toLowerCase();
    if (!q) return this.stocks();
    return this.stocks().filter(s => {
      const m = s.medicament;
      return (
        m?.libelle?.toLowerCase().includes(q) ||
        m?.dci?.toLowerCase().includes(q) ||
        m?.nomCommercial?.toLowerCase().includes(q) ||
        m?.classeTherapeutique?.toLowerCase().includes(q)
      );
    });
  });

  getNiveauStock(s: StockAscView): 'critique' | 'faible' | 'normal' {
    if (s.quantite <= s.seuilAlerte) return 'critique';
    if (s.quantite <= s.seuilAlerte * 2) return 'faible';
    return 'normal';
  }

  getStockPourcentage(s: StockAscView): number {
    return Math.min(Math.round((s.quantite / (s.seuilAlerte * 4)) * 100), 100);
  }

  /** Variante de badge correspondant au niveau de stock. */
  getNiveauVariante(s: StockAscView): string {
    const n = this.getNiveauStock(s);
    return n === 'critique' ? 'danger' : n === 'faible' ? 'warning' : 'success';
  }

  getBarColor(s: StockAscView): string {
    const n = this.getNiveauStock(s);
    return n === 'critique' ? '#EF4444' : n === 'faible' ? '#F97316' : '#3EBB70';
  }

  startEdit(s: StockAscView) { this.editingId.set(s.id); this.editQuantite.set(s.quantite); }
  cancelEdit()        { this.editingId.set(null); this.editQuantite.set(0); }

  saveStock(stockId: string) {
    this.isSaving.set(true); this.errorMessage.set('');
    const stock = this.stocks().find(s => s.id === stockId);
    const libelle = stock
      ? `${stock.medicament.libelle} — ${formaterQuantite((cle) => this.i18n.t(cle), this.editQuantite(), stock.unite)}`
      : undefined;

    const nouvelleQuantite = this.editQuantite();

    this.ascService.updateStock(stockId, nouvelleQuantite, libelle).subscribe({
      next: (resultat) => {
        this.isSaving.set(false); this.editingId.set(null);
        this.successMessage.set(this.i18n.t(
          resultat.synchronise ? 'ASC.STOCKS.SUCCESS_UPDATE' : 'ASC.STOCKS.SUCCESS_QUEUED'
        ));
        setTimeout(() => this.successMessage.set(''), resultat.synchronise ? 3000 : 5000);

        if (resultat.synchronise) {
          this.loadStocks();
          return;
        }
        // Hors connexion : le rechargement échouerait et réafficherait
        // l'ancienne quantité, laissant croire à l'agent que sa saisie est
        // perdue. On applique donc la valeur localement en attendant l'envoi.
        this.appliquerQuantiteLocale(stockId, nouvelleQuantite);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.errorMessage.set(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ASC.STOCKS.ERR_UPDATE'));
      }
    });
  }

  private appliquerQuantiteLocale(stockId: string, quantite: number) {
    this.stocks.update(liste =>
      liste.map(s => (s.id === stockId ? { ...s, quantite } : s))
    );
    const liste = this.stocks();
    this.stocksCritiques.set(liste.filter(s => s.quantite <= s.seuilAlerte).length);
    this.stocksNormaux.set(liste.filter(s => s.quantite > s.seuilAlerte).length);
  }

  formatDate(d?: HorodatageApi | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  isExpireSoon(dateStr?: HorodatageApi | null): boolean {
    if (!dateStr) return false;
    return new Date(dateStr).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
  }

  isExpire(dateStr?: string): boolean {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  }
}
