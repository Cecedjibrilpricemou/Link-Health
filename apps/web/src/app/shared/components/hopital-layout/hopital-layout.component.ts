// shared/components/hopital-layout/hopital-layout.component.ts
// Espace Â« Accueil hopital Â» (role AGENT_ACCUEIL) : admission, episodes de
// soins, demandes d'analyse. Meme coquille que les autres espaces.
import { Component, computed, inject, signal } from '@angular/core';
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
import { DirecteurService, type StructureDuDirecteur } from '../../../core/services/directeur.service';
import { rubriquesDirecteur, type RubriqueNav } from '../../../core/navigation/menu-directeur';

@Component({
  selector: 'app-hopital-layout',
  standalone: true,
  imports: [
    BrandComponent, CommonModule, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe,
    ProfilModalComponent, AvatarComponent, NotificationBellComponent, TopbarCrumbComponent,
    MatSidenavModule, MatToolbarModule, MatListModule, MatIconModule,
    MatButtonModule, MatMenuModule, MatTooltipModule, MatDialogModule,
  ],
  templateUrl: './hopital-layout.component.html',
  styleUrl: './hopital-layout.component.scss'
})
export class HopitalLayoutComponent {
  private authService   = inject(AuthService);
  readonly themeService = inject(ThemeService);
  readonly layout       = inject(LayoutService);
  private i18nService   = inject(I18nService);
  private dialog        = inject(MatDialog);

  currentUser           = this.authService.currentUser;
  doitChangerMotDePasse = this.authService.doitChangerMotDePasse;
  sidebarOpen           = signal(false);
  showProfil            = signal(false);


  // ── Le directeur, dans cet espace ─────────────────────────────────
  // Comme le titulaire d'une officine : il travaille dans l'espace de son
  // etablissement et y voit en plus les menus de gestion. Le personnel garde
  // son menu d'un seul tenant.
  private readonly directeur = inject(DirecteurService);
  readonly estDirecteur = computed(() => this.currentUser()?.role === 'ADMIN_STRUCTURE');
  private readonly structure = signal<StructureDuDirecteur | null>(null);
  /** La structure n'a pas pu etre lue : le menu du directeur le dit. */
  readonly menuIllisible = computed(() => this.structure()?.illisible === true);
  readonly rubriques = computed<RubriqueNav[]>(() => this.estDirecteur()
    ? rubriquesDirecteur(this.structure()?.type ?? null, this.structure()?.hospitaliere === true)
    : [{ titreKey: 'COMMON.NAVIGATION', items: this.navItems() }]);
  /** Toutes les entrees a plat : le fil d'Ariane du haut de page les lit. */
  readonly entrees = computed(() => this.rubriques().flatMap((r) => r.items));
  readonly racineFil = computed(() => (this.estDirecteur() ? 'ADMIN_STRUCTURE.ROLE' : 'HOPITAL.ROLE'));

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
    if (this.estDirecteur()) this.directeur.structure().subscribe((s) => this.structure.set(s));
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
   * Les alertes de valeurs critiques ne concernent plus l'agent d'accueil :
   * depuis l'addendum du 2026-09-28 il ne prescrit plus, donc aucune alerte ne
   * lui est destinÃ©e, et l'API lui a fermÃ© la lecture des rÃ©sultats. L'entrÃ©e
   * reste pour l'administrateur de structure, vers qui les escalades partent.
   */
  readonly navItems = computed(() => {
    const items = [
      { labelKey: 'HOPITAL.NAV_DASHBOARD', icon: 'pi-th-large',  route: '/hopital/tableau-de-bord' },
      { labelKey: 'HOPITAL.NAV_ADMISSION', icon: 'pi-user-plus', route: '/hopital/admission' },
      { labelKey: 'HOPITAL.NAV_EPISODES',  icon: 'pi-folder',    route: '/hopital/episodes' },
      { labelKey: 'HOPITAL.NAV_PRESENCES', icon: 'pi-user-edit', route: '/hopital/presences' },
      { labelKey: 'HOPITAL.NAV_DEMANDES',  icon: 'pi-directions', route: '/hopital/demandes' },
      { labelKey: 'HOPITAL.NAV_IDENTITES', icon: 'pi-id-card',   route: '/hopital/identites' },
    ];
    if (this.currentUser()?.role !== 'AGENT_ACCUEIL') {
      items.push({ labelKey: 'HOPITAL.NAV_ALERTES', icon: 'pi-bell', route: '/hopital/alertes' });
    }
    return items;
  });
}
