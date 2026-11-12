// features/public/recherche/recherche.component.ts
// A1 : chercher un produit et voir ou il est, sans compte.
//
// La zone se choisit dans une liste plutot que par la position du telephone :
// le referentiel geographique la fournit deja, cela marche sur n'importe quel
// appareil, et personne n'a a autoriser quoi que ce soit pour chercher du
// paracetamol.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { PharmacieProduitView, ProduitTrouveView, RechercheProduitsView } from '@baobaoheath/shared-types';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { PublicShellComponent } from '../../../shared/components/public-shell/public-shell.component';
import { GeographieService } from '../../../core/services/geographie.service';
import { RechercheService } from '../../../core/services/recherche.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';

/** Ou le navigateur retient la zone choisie, pour ne pas la redemander. */
const ZONE_RETENUE = 'keneya.recherche.zone';

@Component({
  selector: 'app-recherche',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe, PublicShellComponent],
  templateUrl: './recherche.component.html',
  styleUrl: './recherche.component.scss',
})
export class RechercheComponent implements OnInit {
  private readonly recherche = inject(RechercheService);
  private readonly i18n = inject(I18nService);
  readonly geo = inject(GeographieService);
  /**
   * La devise est un reglage de la plateforme (R12), pas un mot de la
   * traduction : une installation hors de Guinee n'affiche pas « GNF ».
   */
  readonly plateforme = inject(PlateformeService);

  readonly q = signal('');
  readonly prefecture = signal('');
  readonly commune = signal('');

  readonly prefectures = signal<string[]>([]);
  readonly communes = signal<string[]>([]);

  readonly chargement = signal(false);
  readonly erreur = signal('');
  readonly resultat = signal<RechercheProduitsView | null>(null);
  /** Vrai une fois qu'une recherche a abouti : « rien trouve » n'est pas l'etat initial. */
  readonly aCherche = signal(false);

  /** Les libelles du pays installe : « Prefecture » ici, « LGA » ailleurs. */
  readonly libelleZone = computed(() => this.geo.libelle('elargissement'));
  readonly libelleCommune = computed(() => this.geo.libelle('base'));

  /**
   * **Deux lettres suffisent.** Exiger de choisir sa zone avant de pouvoir
   * taper arretait net quelqu'un qui voulait juste savoir ou trouver du
   * paracetamol. La zone resserre et classe ; elle ne commande pas.
   */
  readonly peutChercher = computed(() => this.q().trim().length >= 2);

  /** Les produits dont la liste d'officines est ouverte. */
  private readonly deplies = signal<ReadonlySet<string>>(new Set());

  ngOnInit(): void {
    this.geo.chargerConfiguration().subscribe(() => {
      this.geo.nomsSuggeres('elargissement').subscribe((noms) => {
        this.prefectures.set(noms);
        this.reprendreLaZone(noms);
      });
    });
  }

  /**
   * La zone de la derniere visite, si elle existe encore au referentiel.
   *
   * On ne redemande pas a quelqu'un ou il habite a chaque passage. Le
   * navigateur peut refuser de nous repondre (navigation privee, stockage
   * bloque) : dans ce cas on n'insiste pas, la recherche marche sans.
   */
  private reprendreLaZone(connues: string[]): void {
    let garde: { prefecture?: string; commune?: string } | null = null;
    try {
      const brut = localStorage.getItem(ZONE_RETENUE);
      garde = brut ? (JSON.parse(brut) as { prefecture?: string; commune?: string }) : null;
    } catch {
      return;
    }
    const prefecture = (garde?.prefecture ?? '').trim();
    if (!prefecture || !connues.includes(prefecture)) return;
    this.prefecture.set(prefecture);
    this.geo.nomsSuggeres('base', prefecture).subscribe((noms) => {
      this.communes.set(noms);
      const commune = (garde?.commune ?? '').trim();
      if (commune && noms.includes(commune)) this.commune.set(commune);
    });
  }

  private retenirLaZone(): void {
    try {
      localStorage.setItem(
        ZONE_RETENUE,
        JSON.stringify({ prefecture: this.prefecture(), commune: this.commune() }),
      );
    } catch {
      // Sans stockage, on redemandera la prochaine fois. Ce n'est pas grave.
    }
  }

  /** Les officines d'un produit sont-elles ouvertes ? */
  estDeplie(idProduit: string): boolean {
    return this.deplies().has(idProduit);
  }

  basculerPharmacies(idProduit: string): void {
    const ouverts = new Set(this.deplies());
    if (!ouverts.delete(idProduit)) ouverts.add(idProduit);
    this.deplies.set(ouverts);
  }

  /** « Dixinn · Belle-Vue », ou juste ce qu'on connait. */
  lieuDe(p: PharmacieProduitView): string {
    return [p.commune, p.quartier].map((v) => (v ?? '').trim()).filter(Boolean).join(' \u00b7 ');
  }

  prixPharmacie(p: PharmacieProduitView): string {
    return this.montant(p.prixGnf);
  }

  changerPrefecture(nom: string): void {
    this.prefecture.set(nom);
    this.commune.set('');
    this.communes.set([]);
    this.resultat.set(null);
    this.aCherche.set(false);
    if (!nom) return;
    this.geo.nomsSuggeres('base', nom).subscribe((noms) => this.communes.set(noms));
  }

  chercher(): void {
    if (!this.peutChercher() || this.chargement()) return;
    this.chargement.set(true);
    this.erreur.set('');
    this.deplies.set(new Set());
    this.retenirLaZone();
    this.recherche.produits(this.q().trim(), this.prefecture(), this.commune()).subscribe({
      next: (r) => {
        this.resultat.set(r.data ?? null);
        this.aCherche.set(true);
        this.chargement.set(false);
      },
      error: (e: { error?: { message?: string } }) => {
        this.erreur.set(e.error?.message ?? this.i18n.t('PUBLIC.SEARCH.ERROR'));
        this.chargement.set(false);
      },
    });
  }

  /** « 12 000 GNF », ou « de 12 000 a 14 500 GNF » quand les officines different. */
  prix(p: ProduitTrouveView): string {
    const min = this.montant(p.prixMinGnf);
    if (p.prixMinGnf === p.prixMaxGnf) return min;
    return this.i18n.t('PUBLIC.SEARCH.PRICE_RANGE', { min, max: this.montant(p.prixMaxGnf) });
  }

  private montant(gnf: number): string {
    return new Intl.NumberFormat(this.i18n.lang() === 'en' ? 'en-US' : 'fr-FR').format(gnf);
  }

  /** « aujourd'hui », « il y a 3 jours » : la fraicheur compte plus que la date. */
  declare(p: ProduitTrouveView): string {
    const jours = Math.floor((Date.now() - new Date(p.declareLe).getTime()) / 86_400_000);
    if (jours <= 0) return this.i18n.t('PUBLIC.SEARCH.DECLARED_TODAY');
    if (jours === 1) return this.i18n.t('PUBLIC.SEARCH.DECLARED_YESTERDAY');
    return this.i18n.t('PUBLIC.SEARCH.DECLARED_DAYS', { jours });
  }
}
