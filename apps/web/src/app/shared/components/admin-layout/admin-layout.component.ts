import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthService } from '../../../core/services/auth.service';
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
  selector: 'app-admin-layout',
  standalone: true,
  imports: [BrandComponent, 
    CommonModule, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe,
    ProfilModalComponent, AvatarComponent, NotificationBellComponent, TopbarCrumbComponent,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatButtonModule, MatMenuModule, MatBadgeModule, MatTooltipModule, MatDialogModule,
  ],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss'
})
export class AdminLayoutComponent {
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
    // Material plutôt que d'ajouter Material Symbols (plusieurs Mo), la
    // plateforme visant des connexions à faible débit.
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

  /**
   * Le menu de l'espace administration.
   *
   * `roles` restreint une entree. **Sans lui, l'ecran d'assurance apparaitrait
   * a l'admin regional, qui se ferait refuser a chaque appel** : l'API ne
   * repond qu'a l'administration nationale. Un menu qui mene a un mur est pire
   * qu'un menu plus court.
   */
  private readonly tousLesItems = [
    { labelKey: 'ADMIN.NAV_ANALYTICS',  icon: 'pi-chart-bar', route: '/admin/analytics',
      roles: ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_STRUCTURES', icon: 'pi-building',  route: '/admin/structures',
      roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_EXPORT',     icon: 'pi-download', route: '/admin/export',
      roles: ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_COMPTES',   icon: 'pi-users',     route: '/admin/comptes',
      roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_ADMINISTRATEURS', icon: 'pi-shield', route: '/admin/administrateurs',
      roles: ['SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_LIVREURS',  icon: 'pi-truck',     route: '/admin/livreurs',
      roles: ['ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_ASSURANCE', icon: 'pi-id-card',  route: '/admin/assurance',
      roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_RGPD',      icon: 'pi-file-edit', route: '/admin/demandes-rgpd',
      roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_JOURNAL',   icon: 'pi-shield',    route: '/admin/journal',
      roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_GEO',       icon: 'pi-map',       route: '/admin/geographie',
      roles: ['ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_BRIS',      icon: 'pi-unlock',    route: '/admin/bris-de-glace',
      roles: ['ADMIN_STRUCTURE', 'ADMIN_REGIONAL', 'ADMIN_NATIONAL', 'SUPER_ADMIN'] },
    { labelKey: 'ADMIN.NAV_SETTINGS',  icon: 'pi-cog',       route: '/admin/settings',
      roles: ['SUPER_ADMIN'] }
  ] satisfies { labelKey: string; icon: string; route: string; roles?: string[] }[];

  readonly navItems = computed(() => {
    const role = this.currentUser()?.role;
    return this.tousLesItems.filter(
      (i) => role !== undefined && i.roles.includes(role)
    );
  });
}
