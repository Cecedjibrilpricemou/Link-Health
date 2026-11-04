// features/pharmacien/stocks/stocks.component.ts
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { CategorieProduitPipe } from '../../../shared/pipes/categorie-produit.pipe';
import { SeveriteVariantePipe } from '../../../shared/pipes/severite-variante.pipe';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { AuthService } from '../../../core/services/auth.service';
import type {
  CategorieProduit,
  CreateProduitOfficineDto,
  HorodatageApi,
  MedicamentTarifeView,
  LotStockView,
  MouvementStockView,
  StockPharmacieView,
} from '@baobaoheath/shared-types';
import { QuantiteUnitePipe } from '../../../shared/pipes/quantite-unite.pipe';

type FiltreEtat = 'TOUS' | 'CRITIQUE' | 'FAIBLE' | 'NORMAL' | 'PEREMPTION';
type ColonneTri = 'produit' | 'quantite' | 'etat' | 'prix' | 'peremption';

@Component({
  selector: 'app-pharmacien-stocks',
  standalone: true,
  imports: [ListeRechercheComponent, QuantiteUnitePipe, 
    CategorieProduitPipe, SeveriteVariantePipe,
    MatFormFieldModule, MatInputModule, MatSelectModule,CommonModule, FormsModule, TranslatePipe, ExportListeComponent],
  templateUrl: './stocks.component.html',
  styleUrl: './stocks.component.scss'
})
export class PharmacienStocksComponent implements OnInit {
  private pharmacienService = inject(PharmacienService);
  private authService = inject(AuthService);
  private i18n = inject(I18nService);
  protected Math = Math;

  stocks           = signal<StockPharmacieView[]>([]);
  medicaments      = signal<MedicamentTarifeView[]>([]);
  isLoading        = signal(true);
  isSaving         = signal(false);
  searchQuery      = signal('');
  totalMedicaments = signal(0);
  stocksCritiques  = signal(0);
  stocksNormaux    = signal(0);
  showForm         = signal(false);
  showCatalogueLocal = signal(false);
  showProduitForm = signal(false);
  produitEnEdition = signal<string | null>(null);
  successMsg       = signal('');
  errorMsg         = signal('');
  inventaireStockId = signal<string | null>(null);
  inventaireLots = signal<Array<LotStockView & { quantiteComptee: number }>>([]);
  isLoadingLots = signal(false);
  mouvementsStock = signal<MouvementStockView[]>([]);
  isLoadingMouvements = signal(false);
  motifAjustement = '';
  readonly estTitulaire = computed(() => this.authService.currentUser()?.roleOfficine === 'TITULAIRE');
  readonly stockInventaire = computed(() =>
    this.stocks().find((stock) => stock.id === this.inventaireStockId()) ?? null);
  readonly produitsLocaux = computed(() => this.medicaments().filter((m) => m.estPropreOfficine));
  readonly categoriesLocales: Exclude<CategorieProduit, 'MEDICAMENT'>[] = [
    'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE', 'HYGIENE',
    'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE',
  ];
  formProduit = {
    libelle: '',
    categorie: 'PARAPHARMACIE' as Exclude<CategorieProduit, 'MEDICAMENT'>,
    prixUnitaireGnf: null as number | null,
    seuilAlerte: 10,
    unite: 'unite',
  };

  // Formulaire réapprovisionnement
  formReappro = {
    idMedicament: '',
    quantiteAjoutee: null as number | null,
    datePeremption: '',
    margeGnf: null as number | null
  };

  /** Les colonnes du document imprime **et** du fichier : les memes.
   * C'est ce qui empeche la feuille et le tableur de se contredire. */
  readonly colonnes: ColonneExport<StockPharmacieView>[] = [
    { titre: 'EXPORT.COL.PRODUIT', valeur: (s) => s.medicament.libelle },
    { titre: 'EXPORT.COL.QUANTITE', valeur: (s) => s.quantite, nombre: true },
    { titre: 'EXPORT.COL.UNITE', valeur: (s) => s.unite },
    { titre: 'EXPORT.COL.SEUIL_ALERTE', valeur: (s) => s.seuilAlerte, nombre: true },
    // Ce qu'on vient chercher quand on imprime : ce qu'il faut commander.
    { titre: 'EXPORT.COL.ETAT', valeur: (s) => (s.quantite === 0 ? 'Rupture' : s.quantite <= s.seuilAlerte ? 'À commander' : 'Suffisant') },
    { titre: 'EXPORT.COL.PEREMPTION_PROCHE', valeur: (s) => (s.peremptionLaPlusProche ? new Date(s.peremptionLaPlusProche) : null) },
  ];

  ngOnInit() {
    this.loadStocks();
    this.loadMedicaments();
    if (this.estTitulaire()) this.loadMouvementsStock();
  }

  loadMouvementsStock(): void {
    this.isLoadingMouvements.set(true);
    this.pharmacienService.getMouvementsStock().subscribe({
      next: (response) => {
        this.mouvementsStock.set(response.success ? response.data ?? [] : []);
        this.isLoadingMouvements.set(false);
        if (!response.success) this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.ERR_MOVEMENTS'));
      },
      error: () => {
        this.isLoadingMouvements.set(false);
        this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.ERR_MOVEMENTS'));
      },
    });
  }

  ouvrirInventaire(stock: StockPharmacieView): void {
    this.inventaireStockId.set(stock.id);
    this.inventaireLots.set([]);
    this.motifAjustement = '';
    this.isLoadingLots.set(true);
    this.errorMsg.set('');
    this.pharmacienService.getLots(stock.medicament.id).subscribe({
      next: (response) => {
        this.isLoadingLots.set(false);
        if (!response.success || !response.data) {
          this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.ERR_LOTS'));
          return;
        }
        this.inventaireLots.set(response.data.map((lot) => ({ ...lot, quantiteComptee: lot.quantite })));
      },
      error: () => {
        this.isLoadingLots.set(false);
        this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.ERR_LOTS'));
      },
    });
  }

  fermerInventaire(): void {
    this.inventaireStockId.set(null);
    this.inventaireLots.set([]);
    this.motifAjustement = '';
  }

  ajusterLot(lot: LotStockView & { quantiteComptee: number }): void {
    const motif = this.motifAjustement.trim();
    if (!Number.isInteger(lot.quantiteComptee) || lot.quantiteComptee < 0 || motif.length < 5) {
      this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.ERR_ADJUSTMENT_FIELDS'));
      return;
    }
    this.isSaving.set(true);
    this.errorMsg.set('');
    this.pharmacienService.ajusterLotStock(lot.id, {
      quantiteComptee: lot.quantiteComptee,
      motif,
    }).subscribe({
      next: (response) => {
        this.isSaving.set(false);
        if (!response.success || !response.data) {
          this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.ERR_ADJUSTMENT'));
          return;
        }
        this.successMsg.set(response.data.variation === 0
          ? this.i18n.t('PHARMACIEN.STOCKS.ADJUSTMENT_UNCHANGED')
          : this.i18n.t('PHARMACIEN.STOCKS.ADJUSTMENT_SUCCESS'));
        this.loadStocks();
        this.loadMouvementsStock();
        const stock = this.stocks().find((item) => item.id === this.inventaireStockId());
        if (stock) this.ouvrirInventaire(stock);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PHARMACIEN.STOCKS.ERR_ADJUSTMENT'));
      },
    });
  }

  labelMouvement(type: MouvementStockView['type']): string {
    return this.i18n.t(`PHARMACIEN.STOCKS.MOVEMENT_${type}`);
  }

  private loadStocks() {
    this.isLoading.set(true);
    this.pharmacienService.getStocks().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const data = response.data as unknown as StockPharmacieView[];
          this.stocks.set(data);
          this.totalMedicaments.set(data.length);
          this.stocksCritiques.set(data.filter((s: StockPharmacieView) => s.quantite <= s.seuilAlerte).length);
          this.stocksNormaux.set(data.filter((s: StockPharmacieView) => s.quantite > s.seuilAlerte).length);
        }
        this.isLoading.set(false);
      },
      error: () => { this.isLoading.set(false); }
    });
  }

  private loadMedicaments() {
    this.pharmacienService.getMedicaments().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.medicaments.set(response.data as unknown as MedicamentTarifeView[]);
        }
      },
      error: () => {}
    });
  }

  /** Le produit a reapprovisionner : on peut taper pour filtrer. */
  readonly optionsReappro = computed<OptionListe[]>(() => this.medicaments().map((m) => ({
    valeur: m.id,
    libelle: m.libelle,
    recherche: [m.dci, m.nomCommercial].filter(Boolean).join(' '),
  })));

  get medicamentOptions() {
    return this.medicaments().map(m => ({ label: m.libelle, value: m.id }));
  }

  /**
   * Le stock tel qu'il est affiche : recherche, filtre d'etat et tri
   * appliques. L'export reprend exactement ces lignes, dans cet ordre.
   *
   * `computed` et non un accesseur : l'accesseur refabriquait le tableau a
   * chaque cycle de detection, donc l'entree de `<app-export-liste>`
   * changeait d'identite sans arret.
   */
  readonly stocksFiltres = computed<StockPharmacieView[]>(() => {
    const filtre = this.filtreEtat();
    const { colonne, sens } = this.tri();
    const facteur = sens === 'asc' ? 1 : -1;
    return this.stocksRecherches()
      .filter((s) => this.correspondAuFiltre(s, filtre))
      .sort((a, b) => facteur * this.comparer(a, b, colonne)
        // A egalite, ordre alphabetique stable quel que soit le sens.
        || a.medicament.libelle.localeCompare(b.medicament.libelle, 'fr'));
  });

  readonly colonnesTableau: { id: ColonneTri; titre: string; num?: boolean }[] = [
    { id: 'produit', titre: 'PHARMACIEN.STOCKS.COL_PRODUIT' },
    { id: 'quantite', titre: 'PHARMACIEN.STOCKS.COL_QUANTITE', num: true },
    { id: 'etat', titre: 'PHARMACIEN.STOCKS.COL_ETAT' },
    { id: 'prix', titre: 'PHARMACIEN.STOCKS.COL_PRIX', num: true },
    { id: 'peremption', titre: 'PHARMACIEN.STOCKS.COL_PEREMPTION' },
  ];

  /** Filtres d'etat : ce que le pharmacien vient chercher sur cet ecran. */
  readonly filtresEtat: FiltreEtat[] = ['TOUS', 'CRITIQUE', 'FAIBLE', 'NORMAL', 'PEREMPTION'];
  readonly filtreEtat = signal<FiltreEtat>('TOUS');
  /** Par defaut : ce qu'il faut commander d'abord. */
  readonly tri = signal<{ colonne: ColonneTri; sens: 'asc' | 'desc' }>({ colonne: 'etat', sens: 'asc' });

  /** Recherche seule : sert aussi a compter les produits de chaque filtre. */
  private readonly stocksRecherches = computed<StockPharmacieView[]>(() => {
    const q = this.searchQuery().toLowerCase();
    if (!q) return this.stocks();
    return this.stocks().filter(s =>
      s.medicament.libelle.toLowerCase().includes(q) ||
      s.medicament.dci?.toLowerCase().includes(q) ||
      s.medicament.nomCommercial?.toLowerCase().includes(q) ||
      s.medicament.classeTherapeutique?.toLowerCase().includes(q)
    );
  });

  readonly compteParFiltre = computed<Record<FiltreEtat, number>>(() => {
    const liste = this.stocksRecherches();
    const compte = { TOUS: 0, CRITIQUE: 0, FAIBLE: 0, NORMAL: 0, PEREMPTION: 0 } as Record<FiltreEtat, number>;
    for (const f of this.filtresEtat) compte[f] = liste.filter((s) => this.correspondAuFiltre(s, f)).length;
    return compte;
  });

  trierPar(colonne: ColonneTri): void {
    const actuel = this.tri();
    this.tri.set(actuel.colonne === colonne
      ? { colonne, sens: actuel.sens === 'asc' ? 'desc' : 'asc' }
      : { colonne, sens: 'asc' });
  }

  ariaSort(colonne: ColonneTri): 'ascending' | 'descending' | 'none' {
    const { colonne: active, sens } = this.tri();
    if (active !== colonne) return 'none';
    return sens === 'asc' ? 'ascending' : 'descending';
  }

  private rangNiveau(s: StockPharmacieView): number {
    if (s.quantite <= s.seuilAlerte) return 0;
    if (s.quantite <= s.seuilAlerte * 2) return 1;
    return 2;
  }

  private correspondAuFiltre(s: StockPharmacieView, filtre: FiltreEtat): boolean {
    switch (filtre) {
      case 'CRITIQUE': return this.rangNiveau(s) === 0;
      case 'FAIBLE': return this.rangNiveau(s) === 1;
      case 'NORMAL': return this.rangNiveau(s) === 2;
      case 'PEREMPTION': return this.isExpireSoon(s);
      default: return true;
    }
  }

  private comparer(a: StockPharmacieView, b: StockPharmacieView, colonne: ColonneTri): number {
    switch (colonne) {
      case 'produit': return a.medicament.libelle.localeCompare(b.medicament.libelle, 'fr');
      case 'quantite': return a.quantite - b.quantite;
      case 'prix': return this.getPrixVente(a) - this.getPrixVente(b);
      case 'peremption': {
        // Sans date de peremption : toujours en dernier en tri croissant.
        const ta = a.peremptionLaPlusProche ? new Date(a.peremptionLaPlusProche).getTime() : Infinity;
        const tb = b.peremptionLaPlusProche ? new Date(b.peremptionLaPlusProche).getTime() : Infinity;
        return ta === tb ? 0 : ta < tb ? -1 : 1;
      }
      case 'etat':
      default:
        // Meme niveau : le plus proche de la rupture d'abord.
        return this.rangNiveau(a) - this.rangNiveau(b)
          || a.quantite / Math.max(a.seuilAlerte, 1) - b.quantite / Math.max(b.seuilAlerte, 1);
    }
  }

  reapprovisionner() {
    if (!this.formReappro.idMedicament || !this.formReappro.quantiteAjoutee) {
      this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.ERR_REQUIRED')); return;
    }
    this.isSaving.set(true); this.errorMsg.set('');

    const payload = {
      idMedicament: this.formReappro.idMedicament,
      quantiteAjoutee: this.formReappro.quantiteAjoutee,
      datePeremption: this.formReappro.datePeremption || undefined,
      margeGnf: this.formReappro.margeGnf ?? undefined
    };

    this.pharmacienService.reapprovisionner(payload).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.showForm.set(false);
        this.formReappro = { idMedicament: '', quantiteAjoutee: null, datePeremption: '', margeGnf: null };
        this.successMsg.set(this.i18n.t('PHARMACIEN.STOCKS.SUCCESS_REAPPRO'));
        setTimeout(() => this.successMsg.set(''), 4000);
        this.loadStocks();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PHARMACIEN.STOCKS.ERR_REAPPRO'));
      }
    });
  }

  ouvrirCreationProduit(): void {
    this.produitEnEdition.set(null);
    this.formProduit = {
      libelle: '', categorie: 'PARAPHARMACIE', prixUnitaireGnf: null, seuilAlerte: 10, unite: 'unite',
    };
    this.showProduitForm.set(true);
    this.showCatalogueLocal.set(true);
  }

  ouvrirEditionProduit(produit: MedicamentTarifeView): void {
    if (!produit.estPropreOfficine) return;
    this.produitEnEdition.set(produit.id);
    const stock = this.stocks().find((item) => item.medicament.id === produit.id);
    this.formProduit = {
      libelle: produit.libelle,
      categorie: produit.categorie as Exclude<CategorieProduit, 'MEDICAMENT'>,
      prixUnitaireGnf: produit.prixUnitaireGnf,
      seuilAlerte: stock?.seuilAlerte ?? 10,
      unite: stock?.unite ?? 'unite',
    };
    this.showProduitForm.set(true);
    this.showCatalogueLocal.set(true);
  }

  annulerEditionProduit(): void {
    this.showProduitForm.set(false);
    this.produitEnEdition.set(null);
  }

  enregistrerProduit(): void {
    const libelle = this.formProduit.libelle.trim();
    const prix = this.formProduit.prixUnitaireGnf;
    if (!libelle || !prix || prix < 1) {
      this.errorMsg.set(this.i18n.t('PHARMACIEN.STOCKS.PRODUIT_CHAMPS_REQUIS'));
      return;
    }
    this.isSaving.set(true);
    this.errorMsg.set('');
    this.successMsg.set('');
    const dto: CreateProduitOfficineDto = {
      libelle,
      categorie: this.formProduit.categorie,
      prixUnitaireGnf: Math.trunc(prix),
      seuilAlerte: this.formProduit.seuilAlerte,
      unite: this.formProduit.unite.trim(),
    };
    const id = this.produitEnEdition();
    const requete = id
      ? this.pharmacienService.modifierProduitOfficine(id, dto)
      : this.pharmacienService.creerProduitOfficine(dto);
    requete.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.showProduitForm.set(false);
        this.produitEnEdition.set(null);
        this.successMsg.set(this.i18n.t(id
          ? 'PHARMACIEN.STOCKS.PRODUIT_MODIFIE'
          : 'PHARMACIEN.STOCKS.PRODUIT_CREE'));
        this.loadMedicaments();
        this.loadStocks();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PHARMACIEN.STOCKS.PRODUIT_ERR'));
      },
    });
  }

  desactiverProduit(produit: MedicamentTarifeView): void {
    if (!produit.estPropreOfficine || !window.confirm(
      this.i18n.t('PHARMACIEN.STOCKS.CONFIRMER_DESACTIVATION', { produit: produit.libelle }),
    )) return;
    this.isSaving.set(true);
    this.errorMsg.set('');
    this.pharmacienService.desactiverProduitOfficine(produit.id).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.successMsg.set(this.i18n.t('PHARMACIEN.STOCKS.PRODUIT_DESACTIVE'));
        this.loadMedicaments();
        this.loadStocks();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PHARMACIEN.STOCKS.PRODUIT_ERR'));
      },
    });
  }

  estProduitLocal(idMedicament: string): boolean {
    return this.medicaments().some((m) => m.id === idMedicament && m.estPropreOfficine);
  }

  /**
   * Le libelle est le nom complet du produit. On n'ajoute la DCI que si elle
   * apporte quelque chose : un article non medicamenteux n'en a pas, et la
   * formule precedente affichait « null null » pour un lait infantile.
   */
  getMedicamentLabel(s: StockPharmacieView): string {
    const m = s.medicament;
    return m.dci && !m.libelle.toLowerCase().includes(m.dci.toLowerCase())
      ? `${m.libelle} (${m.dci})`
      : m.libelle;
  }

  /** Vide pour un article non medicamenteux : il n'a ni forme ni dosage. */
  formeEtDosage(s: StockPharmacieView): string {
    return [s.medicament.forme, s.medicament.dosage].filter(Boolean).join(' · ');
  }

  getPrixVente(s: StockPharmacieView): number { return s.medicament.prixUnitaireGnf + (s.margeGnf ?? 0); }

  getNiveauSeverity(s: StockPharmacieView): 'danger' | 'warn' | 'success' {
    if (s.quantite <= s.seuilAlerte) return 'danger';
    if (s.quantite <= s.seuilAlerte * 2) return 'warn';
    return 'success';
  }

  getNiveauLabel(s: StockPharmacieView): string {
    if (s.quantite <= s.seuilAlerte) return this.i18n.t('PHARMACIEN.STOCKS.NIVEAU_CRITIQUE');
    if (s.quantite <= s.seuilAlerte * 2) return this.i18n.t('PHARMACIEN.STOCKS.NIVEAU_FAIBLE');
    return this.i18n.t('PHARMACIEN.STOCKS.NIVEAU_NORMAL');
  }

  formatDate(d?: HorodatageApi | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatMontant(m: number): string {
    return new Intl.NumberFormat('fr-GN', { style: 'currency', currency: 'GNF', maximumFractionDigits: 0 }).format(m);
  }

  isExpireSoon(s: StockPharmacieView): boolean {
    if (!s.peremptionLaPlusProche) return false;
    return new Date(s.peremptionLaPlusProche).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000;
  }
}
