import { Component, inject } from '@angular/core';
import type { EmplacementVisuel } from '@baobaoheath/shared-types';
import { PlateformeService } from '../../../../shared/services/plateforme.service';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * Une etape du parcours patient.
 *
 * Chaque etape a son emplacement d'image (`ETAPE_1` a `ETAPE_7`), que le
 * super-admin remplit depuis Parametres > Images. Une etape sans photo - ni
 * televersee, ni livree avec le site - retombe sur sa pastille d'icone :
 * mieux vaut une carte sobre qu'une image qui ne correspond pas a ce qu'elle
 * raconte.
 *
 * `bientot` marque ce qui n'est pas encore livre. Le cahier des charges vise
 * le parcours entier jusqu'a la livraison a domicile ; la commande, le
 * paiement et la livraison (blocs P6 a P8) restent a construire. Les afficher
 * sans le dire reviendrait a promettre un service qui n'existe pas.
 */
type Etape = {
  num: string;
  icon: string;
  emplacement: EmplacementVisuel;
  titleKey: string;
  descKey: string;
  bientot?: boolean;
};

@Component({
  selector: 'app-how-it-works',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './how-it-works.component.html',
  styleUrl: './how-it-works.component.scss'
})
export class HowItWorksComponent {
  readonly plateforme = inject(PlateformeService);

  /**
   * Le parcours tel que le cahier des charges le decrit : le patient ne se
   * deplace qu'une fois, tout le reste suit depuis son dossier.
   */
  // Les photos livrees avec le site ne couvrent que les etapes 3, 5 et 6
  // (shared/utils/visuels-publics.ts) ; les autres gardent leur icone tant
  // que le super-admin ne leur en donne pas une.
  steps: Etape[] = [
    {
      num: '01', emplacement: 'ETAPE_1', icon: 'pi-user-plus',
      titleKey: 'LANDING.HOW_STEP1_TITLE', descKey: 'LANDING.HOW_STEP1_DESC',
    },
    {
      num: '02', emplacement: 'ETAPE_2', icon: 'pi-qrcode',
      titleKey: 'LANDING.HOW_STEP2_TITLE', descKey: 'LANDING.HOW_STEP2_DESC',
    },
    {
      num: '03', emplacement: 'ETAPE_3', icon: 'pi-building',
      titleKey: 'LANDING.HOW_STEP3_TITLE', descKey: 'LANDING.HOW_STEP3_DESC',
    },
    {
      num: '04', emplacement: 'ETAPE_4', icon: 'pi-chart-line',
      titleKey: 'LANDING.HOW_STEP4_TITLE', descKey: 'LANDING.HOW_STEP4_DESC',
    },
    {
      num: '05', emplacement: 'ETAPE_5', icon: 'pi-file-edit',
      titleKey: 'LANDING.HOW_STEP5_TITLE', descKey: 'LANDING.HOW_STEP5_DESC',
    },
    {
      num: '06', emplacement: 'ETAPE_6', icon: 'pi-shop',
      titleKey: 'LANDING.HOW_STEP6_TITLE', descKey: 'LANDING.HOW_STEP6_DESC',
    },
    {
      num: '07', emplacement: 'ETAPE_7', icon: 'pi-send',
      titleKey: 'LANDING.HOW_STEP7_TITLE', descKey: 'LANDING.HOW_STEP7_DESC',
      bientot: true,
    },
  ];

  /**
   * Largeur du trait qui suit la pastille : court au depart, plein a la fin.
   * C'est le seul signal qui dit « vous avancez » dans une grille ou toutes
   * les cartes se ressemblent.
   */
  largeurTrait(index: number): number {
    const dernier = this.steps.length - 1;
    if (dernier <= 0) return 100;
    return Math.round(20 + (index / dernier) * 80);
  }
}
