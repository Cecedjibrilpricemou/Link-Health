// shared/components/pharmacien-layout/pharmacien-layout.component.ts
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../../../core/services/auth.service';
import type { RoleOfficine } from '@baobaoheath/shared-types';
import { ThemeService } from '../../services/theme.service';
import { LayoutService } from '../../services/layout.service';
import { I18nService } from '../../services/i18n.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { ProfilModalComponent } from '../profil-modal/profil-modal.component';
import { AvatarComponent } from '../avatar/avatar.component';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';
import { TopbarCrumbComponent } from '../topbar-crumb/topbar-crumb.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import { BrandComponent } from '../brand/brand.component';

@Component({
  selector: 'app-pharmacien-layout',
  standalone: true,
  imports: [BrandComponent, 
    CommonModule, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe,
    ProfilModalComponent, AvatarComponent, NotificationBellComponent, TopbarCrumbComponent,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatButtonModule, MatMenuModule, MatTooltipModule, MatDialogModule,
  ],
  templateUrl: './pharmacien-layout.component.html',
  styleUrl: './pharmacien-layout.component.scss'
})
export class PharmacienLayoutComponent {
  private authService   = inject(AuthService);
  readonly themeService = inject(ThemeService);
  readonly layout        = inject(LayoutService);
  private i18nService   = inject(I18nService);
  private dialog        = inject(MatDialog);

  currentUser           = this.authService.currentUser;
  doitChangerMotDePasse = this.authService.doitChangerMotDePasse;
  sidebarOpen           = signal(false);
  showProfil            = signal(false);

  constructor(iconRegistry: MatIconRegistry) {
    // PrimeIcons est déjà embarqué localement : on l'expose comme font set
    // Material plutôt que d'ajouter Material Symbols (plusieurs Mo).
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  /**
   * Sur mobile la barre s'ouvre par-dessus ; sur grand écran elle est ancrée,
   * et le même bouton la replie sur ses icônes. Un seul bouton, deux gestes
   * selon la place disponible.
   */
  toggleSidebar() {
    if (this.layout.estMobile()) this.sidebarOpen.update(v => !v);
    else this.layout.basculerRepli();
  }
  closeSidebar()   { this.sidebarOpen.set(false); }
  toggleTheme()    { this.themeService.toggle(); }
  toggleLang()     { this.i18nService.toggle(); }

  askLogout() {
    const data: ConfirmDialogData = {
      titre: this.i18nService.t('COMMON.LOGOUT_CONFIRM_TITLE'),
      texte: this.i18nService.t('COMMON.LOGOUT_CONFIRM_TEXT'),
      confirmer: this.i18nService.t('COMMON.LOGOUT'),
      annuler: this.i18nService.t('COMMON.CANCEL'),
      icone: 'pi-sign-out',
      danger: true,
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '380px', autoFocus: false })
      .afterClosed().subscribe(confirme => { if (confirme) this.authService.logout(); });
  }

  getInitiales(): string {
    const u = this.currentUser();
    if (!u) return '??';
    return `${u.prenom?.charAt(0) ?? ''}${u.nom?.charAt(0) ?? ''}`.toUpperCase();
  }

  private readonly allNavItems: {
    labelKey: string;
    icon: string;
    route: string;
    roles: RoleOfficine[];
  }[] = [
    { labelKey: 'PHARMACIEN.NAV_TABLEAU_DE_BORD', icon: 'pi-chart-bar', route: '/pharmacien/tableau-de-bord', roles: ['TITULAIRE', 'ADJOINT', 'PREPARATEUR', 'CAISSIER'] },
    { labelKey: 'PHARMACIEN.NAV_CAISSE', icon: 'pi-shopping-cart', route: '/pharmacien/caisse', roles: ['TITULAIRE', 'ADJOINT', 'PREPARATEUR', 'CAISSIER'] },
    { labelKey: 'PHARMACIEN.NAV_COMMANDES', icon: 'pi-inbox', route: '/pharmacien/commandes', roles: ['TITULAIRE', 'ADJOINT'] },
    { labelKey: 'PHARMACIEN.NAV_ORDONNANCES', icon: 'pi-file', route: '/pharmacien/ordonnances', roles: ['TITULAIRE', 'ADJOINT', 'PREPARATEUR'] },
    { labelKey: 'PHARMACIEN.NAV_STOCKS', icon: 'pi-box', route: '/pharmacien/stocks', roles: ['TITULAIRE', 'ADJOINT', 'PREPARATEUR', 'CAISSIER'] },
    { labelKey: 'PHARMACIEN.NAV_APPROVISIONNEMENTS', icon: 'pi-truck', route: '/pharmacien/approvisionnements', roles: ['TITULAIRE'] },
    { labelKey: 'PHARMACIEN.NAV_PEREMPTIONS', icon: 'pi-clock', route: '/pharmacien/peremptions', roles: ['TITULAIRE', 'ADJOINT', 'PREPARATEUR'] },
    { labelKey: 'PHARMACIEN.NAV_HORAIRES', icon: 'pi-clock', route: '/pharmacien/horaires', roles: ['TITULAIRE'] },
    { labelKey: 'PHARMACIEN.NAV_CONNEXIONS', icon: 'pi-shield', route: '/pharmacien/connexions', roles: ['TITULAIRE'] },
    { labelKey: 'PHARMACIEN.NAV_AGENTS', icon: 'pi-users', route: '/pharmacien/agents', roles: ['TITULAIRE'] },
    { labelKey: 'PHARMACIEN.NAV_ASSURANCES', icon: 'pi-shield', route: '/pharmacien/assurances', roles: ['TITULAIRE'] },
  ];

  get navItems() {
    const role = this.currentUser()?.roleOfficine ?? 'ADJOINT';
    return this.allNavItems.filter(item => item.roles.includes(role));
  }
}
