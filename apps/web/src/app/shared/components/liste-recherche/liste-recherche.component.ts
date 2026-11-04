// shared/components/liste-recherche — liste deroulante dans laquelle on peut taper.
//
// Un clic montre tous les choix, comme un <select> ; taper filtre la liste
// (sans tenir compte des accents ni des majuscules). Le composant s'utilise
// avec [(ngModel)] a la place d'un <select> ou d'un <mat-select>, et garde
// l'id du champ : les <label for> et les tests continuent de le trouver.
//
// Accessibilite : motif « combobox » de l'ARIA (champ role=combobox, liste
// role=listbox, option active annoncee par aria-activedescendant).
import {
  ChangeDetectionStrategy, Component, ElementRef, Pipe, PipeTransform, computed, forwardRef, inject, input, signal, viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { I18nService } from '../../services/i18n.service';

export interface OptionListe {
  /** Ce que le modele recoit (un id, le plus souvent). */
  valeur: string;
  /** Ce qui s'affiche et se cherche. */
  libelle: string;
  /** Precision affichee a droite (stock, prefecture...) ; cherchee aussi. */
  detail?: string;
  /** Mots-cles caches mais cherches (DCI, nom commercial...). */
  recherche?: string;
}

/** Minuscules, sans accents : « Crème » et « creme » se trouvent l'un l'autre. */
export function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Les listes deja au format { value, label } (celui des anciens <mat-select>). */
@Pipe({ name: 'optionsDe', standalone: true })
export class OptionsDePipe implements PipeTransform {
  transform(liste: readonly { value: string; label: string }[] | null | undefined): OptionListe[] {
    return (liste ?? []).map((o) => ({ valeur: o.value, libelle: o.label }));
  }
}

let compteur = 0;

@Component({
  selector: 'app-liste-recherche',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => ListeRechercheComponent), multi: true }],
  templateUrl: './liste-recherche.component.html',
  styleUrl: './liste-recherche.component.scss',
})
export class ListeRechercheComponent implements ControlValueAccessor {
  readonly options = input<OptionListe[]>([]);
  /** Id du champ de saisie : c'est lui que vise le <label for>. */
  readonly inputId = input<string>(`lr-${++compteur}`);
  readonly placeholder = input<string>('');
  /** Nom accessible quand aucun <label for> ne vise le champ. */
  readonly ariaLabel = input<string | null>(null);
  /** Si renseigne, un choix vide est propose en tete (valeur ''). */
  readonly videLibelle = input<string | null>(null);
  /** Texte quand rien ne correspond ; par defaut COMMON.AUCUN_RESULTAT. */
  readonly aucunResultat = input<string | null>(null);
  /** Desactive le champ en plus de l'etat venu du formulaire. */
  readonly desactive = input<boolean>(false);

  private readonly champ = viewChild<ElementRef<HTMLInputElement>>('champ');
  private readonly i18n = inject(I18nService);
  protected readonly texteAucun = computed(() => this.aucunResultat() ?? this.i18n.t('COMMON.AUCUN_RESULTAT'));

  protected readonly valeur = signal<string | null>(null);
  /** Texte tape ; null tant qu'on ne cherche pas (le champ montre alors le choix). */
  protected readonly saisie = signal<string | null>(null);
  protected readonly ouverte = signal(false);
  protected readonly active = signal(-1);
  private readonly desactiveParFormulaire = signal(false);

  protected readonly idListe = computed(() => `${this.inputId()}-liste`);
  protected readonly estDesactive = computed(() => this.desactive() || this.desactiveParFormulaire());

  private readonly toutes = computed<OptionListe[]>(() => {
    const vide = this.videLibelle();
    return vide !== null ? [{ valeur: '', libelle: vide }, ...this.options()] : this.options();
  });

  protected readonly filtrees = computed<OptionListe[]>(() => {
    const q = normaliser(this.saisie() ?? '');
    if (!q) return this.toutes();
    return this.options().filter((o) =>
      normaliser(`${o.libelle} ${o.detail ?? ''} ${o.recherche ?? ''}`).includes(q));
  });

  /** Le libelle du choix courant ; la valeur '' a aussi le sien (« Toute la Guinée », « — »). */
  private readonly libelleChoisi = computed(() =>
    this.toutes().find((o) => o.valeur === (this.valeur() ?? ''))?.libelle ?? '');

  /** Ce que montre le champ : la saisie en cours, sinon le libelle du choix. */
  protected readonly texte = computed(() => this.saisie() ?? this.libelleChoisi());

  protected readonly idActif = computed(() =>
    this.ouverte() && this.active() >= 0 && this.active() < this.filtrees().length
      ? `${this.idListe()}-${this.active()}` : null);

  private onChange: (v: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  // ── ControlValueAccessor ──────────────────────────────────────
  writeValue(v: string | null): void { this.valeur.set(v ?? null); }
  registerOnChange(fn: (v: string | null) => void): void { this.onChange = fn; }
  registerOnTouched(fn: () => void): void { this.onTouched = fn; }
  setDisabledState(d: boolean): void { this.desactiveParFormulaire.set(d); }

  // ── Interactions ──────────────────────────────────────────────
  protected ouvrir(): void {
    if (this.estDesactive() || this.ouverte()) return;
    this.ouverte.set(true);
    const i = this.filtrees().findIndex((o) => o.valeur === (this.valeur() ?? ''));
    this.active.set(i >= 0 ? i : 0);
  }

  protected basculer(): void {
    if (this.ouverte()) this.fermer();
    else { this.ouvrir(); this.champ()?.nativeElement.focus(); }
  }

  protected saisir(event: Event): void {
    this.saisie.set((event.target as HTMLInputElement).value);
    this.ouverte.set(true);
    this.active.set(0);
  }

  protected clavier(event: KeyboardEvent): void {
    const n = this.filtrees().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!this.ouverte()) { this.ouvrir(); return; }
        this.active.set(n ? (this.active() + 1) % n : -1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!this.ouverte()) { this.ouvrir(); return; }
        this.active.set(n ? (this.active() - 1 + n) % n : -1);
        break;
      case 'Enter': {
        if (!this.ouverte()) return;
        event.preventDefault();
        const o = this.filtrees()[this.active()];
        if (o) this.choisir(o);
        break;
      }
      case 'Escape':
        if (this.ouverte()) { event.preventDefault(); this.fermer(); }
        break;
      case 'Tab':
        this.fermer();
        break;
    }
  }

  protected choisir(o: OptionListe): void {
    this.valeur.set(o.valeur);
    this.onChange(o.valeur);
    this.saisie.set(null);
    this.ouverte.set(false);
    this.onTouched();
  }

  /** Perte du focus : une saisie inachevee ne change pas le choix. */
  protected quitter(): void {
    this.fermer();
    this.onTouched();
  }

  private fermer(): void {
    this.ouverte.set(false);
    this.saisie.set(null);
    this.active.set(-1);
  }
}
