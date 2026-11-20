// shared/components/auth-shell/auth-shell.component.ts
// Coquille commune des pages d'authentification (connexion, inscription,
// mot de passe oublie, reinitialisation) : en-tete marque + theme/langue,
// formulaire projete a gauche, panneau visuel de marque a droite.
import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { I18nService } from '../../services/i18n.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { BrandComponent } from '../brand/brand.component';
import { PlateformeService } from '../../services/plateforme.service';

@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [BrandComponent, RouterLink, TranslatePipe],
  templateUrl: './auth-shell.component.html',
  // Styles globaux : styles/_auth.scss (les pages y font aussi reference).
})
export class AuthShellComponent {
  readonly themeService = inject(ThemeService);
  /** La photo du panneau : celle du super-admin, sinon celle d'origine. */
  readonly plateforme   = inject(PlateformeService);
  private i18nService   = inject(I18nService);

  /** Cles i18n du message pose sous la photo. */
  titleKey = input('AUTH.VISUAL.TITLE');
  textKey  = input('AUTH.VISUAL.TEXT');
  /** Formulaire large (champs par deux) : inscription. */
  large = input(false);

  readonly points = ['AUTH.VISUAL.POINT_1', 'AUTH.VISUAL.POINT_2', 'AUTH.VISUAL.POINT_3'];
  /** Une icone par point, dans le meme ordre. Decoratif : `aria-hidden` sur le panneau. */
  readonly icones = ['pi pi-folder-open', 'pi pi-shield', 'pi pi-wifi'];

  toggleTheme() { this.themeService.toggle(); }
  toggleLang()  { this.i18nService.toggle(); }
}
