// shared/components/patient-layout/patient-layout.component.ts
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
  selector: 'app-patient-layout',
  standalone: true,
  imports: [BrandComponent, 
    CommonModule, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe,
    ProfilModalComponent, AvatarComponent, NotificationBellComponent, TopbarCrumbComponent,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatButtonModule, MatMenuModule, MatTooltipModule, MatDialogModule,
  ],
  templateUrl: './patient-layout.component.html',
  styleUrl: './patient-layout.component.scss'
})
export class PatientLayoutComponent {
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

  navItems = [
    { labelKey: 'PATIENT.NAV_DASHBOARD', icon: 'pi-home',   route: '/patient/dashboard' },
    { labelKey: 'PATIENT.NAV_PARCOURS',  icon: 'pi-map',    route: '/patient/parcours'  },
    { labelKey: 'PATIENT.NAV_RENDEZ_VOUS', icon: 'pi-calendar-plus', route: '/patient/rendez-vous' },
    { labelKey: 'PATIENT.NAV_ORDONNANCES', icon: 'pi-file-edit', route: '/patient/ordonnances' },
    { labelKey: 'PATIENT.NAV_RESULTATS', icon: 'pi-chart-line', route: '/patient/resultats' },
    { labelKey: 'PATIENT.NAV_COMMANDES', icon: 'pi-shopping-bag', route: '/patient/commandes' },
    { labelKey: 'PATIENT.NAV_PAIEMENTS', icon: 'pi-wallet', route: '/patient/paiements' },
    { labelKey: 'PATIENT.NAV_PROFIL',    icon: 'pi-user',   route: '/patient/profil'    },
    { labelKey: 'PATIENT.NAV_QR_CODE',   icon: 'pi-qrcode', route: '/patient/qr-code'   },
    { labelKey: 'PATIENT.NAV_CARTES_ASSURANCE', icon: 'pi-id-card', route: '/patient/cartes-assurance' },
    { labelKey: 'PATIENT.NAV_ACCES_DOSSIER', icon: 'pi-lock-open', route: '/patient/acces-dossier' },
    { labelKey: 'PATIENT.NAV_CONSENTS',  icon: 'pi-shield', route: '/patient/consentements' }
  ];

  /**
   * Le fil d'Ariane se deduit du menu : une page atteinte hors menu (le carnet
   * vaccinal, ouvert depuis le tableau de bord) n'avait pas de titre. On la
   * declare ici sans l'ajouter au menu.
   */
  crumbItems = [
    ...this.navItems,
    { labelKey: 'PATIENT.DASHBOARD.VACCINE_BOOK', icon: 'pi-book', route: '/patient/carnet-vaccinal' }
  ];
}
