import { Component } from '@angular/core';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';

/**
 * Une etape du parcours patient.
 *
 * `image` est facultative : une etape sans photo retombe sur sa pastille
 * d'icone. Mieux vaut une carte sobre qu'une image d'illustration qui ne
 * correspond pas a ce qu'elle raconte.
 *
 * `bientot` marque ce qui n'est pas encore livre. Le cahier des charges vise
 * le parcours entier jusqu'a la livraison a domicile ; la commande, le
 * paiement et la livraison (blocs P6 a P8) restent a construire. Les afficher
 * sans le dire reviendrait a promettre un service qui n'existe pas.
 */
type Etape = {
  num: string;
  icon: string;
  /** Nom de base, sans extension : le gabarit sert `-480.webp` ou `-800.webp`. */
  image?: string;
  imageAltKey?: string;
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
  /**
   * Le parcours tel que le cahier des charges le decrit : le patient ne se
   * deplace qu'une fois, tout le reste suit depuis son dossier.
   */
  // Les photos disponibles ne couvrent que trois etapes, et leurs noms de
  // fichiers ne decrivent pas leur contenu (verifie image par image). Les
  // autres etapes gardent leur icone dans le meme cadre : le jour ou les
  // photos manquantes arrivent, il n'y a qu'une ligne a ajouter.
  steps: Etape[] = [
    {
      num: '01', icon: 'pi-user-plus',
      titleKey: 'LANDING.HOW_STEP1_TITLE', descKey: 'LANDING.HOW_STEP1_DESC',
    },
    {
      num: '02', icon: 'pi-qrcode',
      titleKey: 'LANDING.HOW_STEP2_TITLE', descKey: 'LANDING.HOW_STEP2_DESC',
    },
    {
      num: '03', icon: 'pi-building',
      // hero-pharma.jpeg est en realite un accueil de clinique — le nom du
      // fichier ment. Seule reserve : la signaletique y est en espagnol.
      image: 'assets/images/hero-pharma', imageAltKey: 'LANDING.HOW_STEP3_ALT',
      titleKey: 'LANDING.HOW_STEP3_TITLE', descKey: 'LANDING.HOW_STEP3_DESC',
    },
    {
      num: '04', icon: 'pi-chart-line',
      titleKey: 'LANDING.HOW_STEP4_TITLE', descKey: 'LANDING.HOW_STEP4_DESC',
    },
    {
      num: '05', icon: 'pi-file-edit',
      // hero-hospital.jpeg est un portrait de medecin, pas un hopital.
      image: 'assets/images/hero-hospital', imageAltKey: 'LANDING.HOW_STEP5_ALT',
      titleKey: 'LANDING.HOW_STEP5_TITLE', descKey: 'LANDING.HOW_STEP5_DESC',
    },
    {
      num: '06', icon: 'pi-shop',
      // hero-vaccine.jpeg montre des plaquettes de medicaments, pas un vaccin.
      image: 'assets/images/hero-vaccine', imageAltKey: 'LANDING.HOW_STEP6_ALT',
      titleKey: 'LANDING.HOW_STEP6_TITLE', descKey: 'LANDING.HOW_STEP6_DESC',
    },
    {
      num: '07', icon: 'pi-send',
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
