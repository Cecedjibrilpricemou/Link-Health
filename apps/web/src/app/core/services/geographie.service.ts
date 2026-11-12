// core/services/geographie.service.ts
// Le referentiel geographique (M1) et le decoupage du pays installe.
//
// Une installation sert un pays : ses niveaux administratifs (Prefecture,
// LGA, Distrito...) viennent de l'API, avec leur nom dans chaque langue. Les
// ecrans ne connaissent que deux roles : le niveau de **base** (champ
// `commune`, ou l'on cherche d'abord) et celui d'**elargissement** (champ
// `prefecture`, ou l'appel s'etend ensuite).
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, map, of, shareReplay, catchError } from 'rxjs';
import type {
  ApiResponse,
  ConfigurationGeoView,
  CreerLieuGeoDto,
  JeuDeDepartGeoView,
  LieuGeoView,
  LieuHorsReferentielView,
  ModifierLieuGeoDto,
  NiveauAdministratifView,
  RenommageLieuGeoView,
  UtilisationLieuGeoView,
} from '@baobaoheath/shared-types';
import { ApiService } from './api.service';
import { I18nService } from '../../shared/services/i18n.service';

export type RoleNiveau = 'base' | 'elargissement';

export interface FiltreLieux {
  niveau?: string;
  parent?: string;
  /** Nom d'un lieu englobant, a n'importe quel niveau au-dessus. */
  dans?: string;
}

/**
 * Le drapeau d'un code pays ISO a deux lettres : chaque lettre devient son
 * « indicateur regional » Unicode (G -> 🇬, N -> 🇳), et la paire s'affiche
 * en drapeau. Un code invalide ne donne rien plutot qu'un symbole faux.
 */
export function drapeauDe(code: string | null | undefined): string {
  const c = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((l) => 0x1f1e6 + l.charCodeAt(0) - 65));
}

@Injectable({ providedIn: 'root' })
export class GeographieService {
  private readonly api = inject(ApiService);
  private readonly i18n = inject(I18nService);

  /** Le decoupage du pays ; `null` tant qu'il n'est pas charge. */
  readonly configuration = signal<ConfigurationGeoView | null>(null);
  private chargement$?: Observable<ConfigurationGeoView | null>;
  private readonly suggestions = new Map<string, Observable<string[]>>();

  /** Charge le decoupage une fois pour toute l'application. */
  chargerConfiguration(forcer = false): Observable<ConfigurationGeoView | null> {
    if (!this.chargement$ || forcer) {
      this.chargement$ = this.api.get<ApiResponse<ConfigurationGeoView>>('/geographie/configuration').pipe(
        map((r) => r.data ?? null),
        map((c) => { this.configuration.set(c); return c; }),
        // Sans decoupage, les ecrans gardent leurs libelles par defaut.
        catchError(() => of(null)),
        shareReplay(1),
      );
      if (forcer) this.suggestions.clear();
    }
    return this.chargement$;
  }

  /** Le code du niveau qui joue ce role dans le pays installe. */
  codeNiveau(role: RoleNiveau): string | null {
    const c = this.configuration();
    return c ? (role === 'base' ? c.niveauBase : c.niveauElargissement) : null;
  }

  /**
   * Le nom d'un niveau dans la langue de l'utilisateur, a defaut en francais.
   * Sans configuration, retombe sur la cle de traduction fournie.
   */
  libelleNiveau(niveau: NiveauAdministratifView | undefined, repli: string): string {
    if (!niveau) return this.i18n.t(repli);
    const langue = this.i18n.lang() as keyof NiveauAdministratifView['libelles'];
    return niveau.libelles[langue] || niveau.libelles.fr;
  }

  /** « Commune » en Guinee, « Ward » au Nigeria... pour un role donne. */
  libelle(role: RoleNiveau): string {
    const code = this.codeNiveau(role);
    const niveau = this.configuration()?.niveaux.find((n) => n.code === code);
    return this.libelleNiveau(niveau, role === 'base' ? 'GEO.DEFAUT_BASE' : 'GEO.DEFAUT_ELARGISSEMENT');
  }

  /** Le libelle d'un niveau designe par son code. */
  libelleDuCode(code: string): string {
    return this.libelleNiveau(this.configuration()?.niveaux.find((n) => n.code === code), 'GEO.DEFAUT_LIEU');
  }

  readonly niveaux = computed(() => this.configuration()?.niveaux ?? []);

  /**
   * Le pays installe tel qu'on l'affiche : « Guinée 🇬🇳 », « Sénégal 🇸🇳 ».
   * Vide tant que la configuration n'est pas chargee : un ecran public ne
   * doit pas annoncer un pays qui n'est pas le sien.
   */
  readonly paysAffiche = computed(() => {
    const c = this.configuration();
    const nom = c?.nom?.trim() ?? '';
    return nom ? `${nom} ${drapeauDe(c?.code)}`.trim() : '';
  });

  lieux(filtre: FiltreLieux = {}): Observable<ApiResponse<LieuGeoView[]>> {
    const params: Record<string, string> = {};
    if (filtre.niveau) params['niveau'] = filtre.niveau;
    if (filtre.parent) params['parent'] = filtre.parent;
    if (filtre.dans) params['dans'] = filtre.dans;
    return this.api.get<ApiResponse<LieuGeoView[]>>('/geographie/lieux', params);
  }

  /**
   * Les noms proposes a la saisie pour un role, eventuellement restreints a un
   * lieu englobant (les communes d'une prefecture). Mis en cache : la liste
   * change rarement, et plusieurs champs la demandent.
   */
  nomsSuggeres(role: RoleNiveau, dans?: string): Observable<string[]> {
    const code = this.codeNiveau(role);
    if (!code) return of([]);
    const cle = `${code}|${(dans ?? '').trim().toLowerCase()}`;
    let flux = this.suggestions.get(cle);
    if (!flux) {
      flux = this.lieux({ niveau: code, dans: dans?.trim() || undefined }).pipe(
        map((r) => [...new Set((r.data ?? []).map((l) => l.nom))]),
        catchError(() => of([])),
        shareReplay(1),
      );
      this.suggestions.set(cle, flux);
    }
    return flux;
  }

  creerLieu(dto: CreerLieuGeoDto): Observable<ApiResponse<LieuGeoView>> {
    this.suggestions.clear();
    return this.api.post<ApiResponse<LieuGeoView>>('/geographie/lieux', dto);
  }

  modifierLieu(id: string, dto: ModifierLieuGeoDto): Observable<ApiResponse<LieuGeoView>> {
    return this.api.put<ApiResponse<LieuGeoView>>(`/geographie/lieux/${id}`, dto);
  }

  /** R7 : ce qui porte le nom d'un lieu, montre avant de le renommer ou de le supprimer. */
  utilisationLieu(id: string): Observable<ApiResponse<UtilisationLieuGeoView>> {
    return this.api.get<ApiResponse<UtilisationLieuGeoView>>(`/geographie/lieux/${id}/utilisation`);
  }

  /** R7 : le nouveau nom suit dans les adresses et les appels en cours. */
  renommerLieu(id: string, nom: string): Observable<ApiResponse<RenommageLieuGeoView>> {
    this.suggestions.clear();
    return this.api.post<ApiResponse<RenommageLieuGeoView>>(`/geographie/lieux/${id}/renommer`, { nom });
  }

  supprimerLieu(id: string): Observable<ApiResponse<void>> {
    this.suggestions.clear();
    return this.api.delete<ApiResponse<void>>(`/geographie/lieux/${id}`);
  }

  chargerJeuDeDepart(): Observable<ApiResponse<JeuDeDepartGeoView>> {
    this.suggestions.clear();
    return this.api.post<ApiResponse<JeuDeDepartGeoView>>('/geographie/jeu-de-depart', {});
  }

  horsReferentiel(): Observable<ApiResponse<LieuHorsReferentielView[]>> {
    return this.api.get<ApiResponse<LieuHorsReferentielView[]>>('/geographie/hors-referentiel');
  }
}
