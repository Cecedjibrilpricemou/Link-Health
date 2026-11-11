// Suggestions de lieux pour un champ de saisie (M1).
//
// Une <datalist> native, reliee au champ par son `list` : le navigateur
// propose les noms du referentiel, mais **le texte libre reste accepte** —
// la liste des communes d'un pays n'est jamais complete au depart, et
// l'exiger bloquerait des zones entieres. Les saisies hors liste remontent a
// l'administrateur (ecran du referentiel).
//
//   <input matInput [attr.list]="'liste-communes'" ... />
//   <app-suggestions-lieux idListe="liste-communes" role="base" [dans]="prefecture" />
import { ChangeDetectionStrategy, Component, inject, input, signal, effect } from '@angular/core';
import { Subscription } from 'rxjs';
import { GeographieService, RoleNiveau } from '../../../core/services/geographie.service';

@Component({
  selector: 'app-suggestions-lieux',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <datalist [id]="idListe()">
      @for (nom of noms(); track nom) { <option [value]="nom"></option> }
    </datalist>
  `,
  styles: [':host { display: none; }'],
})
export class SuggestionsLieuxComponent {
  private readonly geo = inject(GeographieService);

  readonly idListe = input.required<string>();
  readonly role = input.required<RoleNiveau>();
  /** Restreint aux lieux contenus dans celui-ci (les communes d'une prefecture). */
  readonly dans = input<string | null | undefined>(undefined);

  readonly noms = signal<string[]>([]);
  private abonnement?: Subscription;

  constructor() {
    // Recharge quand le role, la zone englobante ou le decoupage changent.
    effect((onCleanup) => {
      const role = this.role();
      const dans = (this.dans() ?? '').trim();
      this.geo.configuration();
      this.abonnement?.unsubscribe();
      this.abonnement = this.geo.chargerConfiguration().subscribe(() => {
        this.abonnement = this.geo.nomsSuggeres(role, dans || undefined).subscribe((noms) => this.noms.set(noms));
      });
      onCleanup(() => this.abonnement?.unsubscribe());
    });
  }
}
