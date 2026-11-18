// « Plateforme sécurisée · Guinée 🇬🇳 » au pied des ecrans de connexion.
//
// Le pays n'est plus ecrit dans la traduction : c'est celui de l'installation
// (une installation par pays), avec son drapeau tire de son code. Tant que la
// configuration n'est pas chargee, seule la premiere partie s'affiche.
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { GeographieService } from '../../../core/services/geographie.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-plateforme-securisee',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ 'AUTH.PLATEFORME_SECURISEE' | translate }}@if (geo.paysAffiche(); as pays) { · {{ pays }}}`,
  styles: [':host { display: contents; }'],
})
export class PlateformeSecuriseeComponent implements OnInit {
  readonly geo = inject(GeographieService);

  ngOnInit(): void {
    this.geo.chargerConfiguration().subscribe();
  }
}
