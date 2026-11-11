import { Component, OnInit, signal, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import type {
  CategorieProduit,
  IdentitePlateformeView,
  ParametresAlertesView,
  ParametresFacturationView,
  ParametresIdentiteView,
  ParametresSecuriteView,
  ParametresPharmacieView,
  ParametresPrescriptionView,
  ParametresSyncView,
  ParametresSystemeValeurs,
  ParametresSystemeView,
  ParametresPaysView,
  ParametresZonesView,
  UpdateParametresSystemeDto,
} from '@baobaoheath/shared-types';
import { CategorieProduitPipe } from '../../../shared/pipes/categorie-produit.pipe';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { AdminService } from '../../../core/services/admin.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';
import { urlMedia } from '../../../shared/utils/url-media';

type Onglet = keyof ParametresSystemeValeurs;

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    MatButtonModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, MatSliderModule,
    MatProgressSpinnerModule, CommonModule, FormsModule, RouterLink, TranslatePipe,
    CategorieProduitPipe
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  private i18n = inject(I18nService);
  private adminService = inject(AdminService);
  private toastr = inject(ToastrService);
  private plateforme = inject(PlateformeService);
  /** L'apercu du logo : son chemin (/uploads/logos/...) resolu chez l'API. */
  readonly urlMedia = urlMedia;

  // Navigation
  activeTab = signal<Onglet>('identite');

  isLoading = signal(true);
  isSaving  = signal(false);
  isUploadingLogo = signal(false);
  modifieLe = signal<string | Date | null>(null);

  get tabs(): { id: Onglet; label: string; icon: string }[] {
    return [
      { id: 'identite',    label: this.i18n.t('ADMIN.SETTINGS.TAB_IDENTITY'), icon: 'pi pi-id-card' },
      { id: 'facturation', label: this.i18n.t('ADMIN.SETTINGS.TAB_BILLING'),  icon: 'pi pi-wallet' },
      { id: 'securite',    label: this.i18n.t('ADMIN.SETTINGS.TAB_SECURITY'), icon: 'pi pi-lock' },
      { id: 'alertes',     label: this.i18n.t('ADMIN.SETTINGS.TAB_ALERTS'),   icon: 'pi pi-bolt' },
      { id: 'sync',        label: this.i18n.t('ADMIN.SETTINGS.TAB_SYNC'),     icon: 'pi pi-sync' },
      { id: 'prescription', label: this.i18n.t('ADMIN.SETTINGS.TAB_PRESCRIPTION'), icon: 'pi pi-file-edit' },
      { id: 'pharmacie',   label: this.i18n.t('ADMIN.SETTINGS.TAB_PHARMACIE'),    icon: 'pi pi-shopping-cart' },
      { id: 'zones',       label: this.i18n.t('ADMIN.SETTINGS.TAB_ZONES'),        icon: 'pi pi-map-marker' },
      { id: 'pays',        label: this.i18n.t('ADMIN.SETTINGS.TAB_PAYS'),         icon: 'pi pi-globe' }
    ];
  }

  // Modeles lies aux formulaires (ngModel). Remplis par GET /admin-structure/parametres,
  // renvoyes section par section par PUT — chaque onglet a son propre bouton.
  identite: ParametresIdentiteView = {
    nom: '', nomCourt: '', slogan: '', logoUrl: '', adresse: '', ville: '', pays: '',
    telephone: '', telephoneSupport: '', emailContact: '', emailSupport: '', emailExpediteur: '',
    siteWeb: '', facebook: '', whatsapp: '', copyright: '', devise: 'GNF'
  };

  facturation: ParametresFacturationView = {
    paiementEspeces: true,
    paiementOrangeMoney: true,
    paiementMomo: false,
    margePct: 15
  };

  securite: ParametresSecuriteView = {
    consentementDefaut: true
  };

  alertes: ParametresAlertesView = {
    seuilPaludisme: 20,
    seuilEbola: 1,
    activerIA: true
  };

  sync: ParametresSyncView = {
    offlineMode: true,
    frequenceMinutes: 30,
    ussdTimeoutSecondes: 600
  };

  // La duree de validite d'une ordonnance releve de la reglementation, pas du
  // code : le cahier des charges (decision D2) en fait un parametre.
  prescription: ParametresPrescriptionView = {
    dureeValiditeJours: 90,
    longueurCodeVerification: 6,
    signatureObligatoire: false,
    dureeValiditeReglementeJours: 28,
    renouvellementsMax: 6
  };

  // Le comptoir d'officine. `categoriesExigeantOrdonnance` porte la reponse a
  // la question E de l'addendum, non tranchee : quelles categories, en plus
  // des produits reglementes, ne se vendent pas sans ordonnance.
  pharmacie: ParametresPharmacieView = {
    categoriesExigeantOrdonnance: []
  };

  // M5 : delai avant qu'un appel sans preneur dans sa commune s'ouvre a
  // toute la prefecture (ordonnances pour les pharmacies, courses pour les motards).
  zones: ParametresZonesView = {
    delaiElargissementCommandeMinutes: 10,
    delaiElargissementCourseMinutes: 10
  };

  // M1 : le pays de l'installation et son decoupage administratif. Une
  // installation sert un pays ; ses niveaux (Prefecture, LGA, Distrito...)
  // et leurs noms se declarent ici, pas dans le code.
  pays: ParametresPaysView = {
    code: '', nom: '', indicatifTelephone: '', niveaux: [], niveauBase: '', niveauElargissement: ''
  };

  readonly maxNiveaux = 6;

  ajouterNiveau() {
    if (this.pays.niveaux.length >= this.maxNiveaux) return;
    this.pays.niveaux = [...this.pays.niveaux, { code: '', libelles: { fr: '', en: '', pt: '' } }];
  }

  retirerNiveau(index: number) {
    this.pays.niveaux = this.pays.niveaux.filter((_, i) => i !== index);
  }

  /** Les niveaux vont du plus large au plus fin : l'ordre a un sens. */
  deplacerNiveau(index: number, sens: -1 | 1) {
    const cible = index + sens;
    if (cible < 0 || cible >= this.pays.niveaux.length) return;
    const niveaux = [...this.pays.niveaux];
    [niveaux[index], niveaux[cible]] = [niveaux[cible]!, niveaux[index]!];
    this.pays.niveaux = niveaux;
  }

  /** Ce qui part a l'API : libelles vides retires, codes et textes nettoyes. */
  private paysPourEnvoi(): ParametresPaysView {
    const p = this.pays;
    return {
      code: p.code.trim().toUpperCase(),
      nom: p.nom.trim(),
      indicatifTelephone: p.indicatifTelephone.trim(),
      niveaux: p.niveaux.map((n) => ({
        code: n.code.trim().toLowerCase(),
        libelles: {
          fr: n.libelles.fr.trim(),
          ...(n.libelles.en?.trim() ? { en: n.libelles.en.trim() } : {}),
          ...(n.libelles.pt?.trim() ? { pt: n.libelles.pt.trim() } : {}),
        },
      })),
      niveauBase: p.niveauBase,
      niveauElargissement: p.niveauElargissement,
    };
  }

  /**
   * Les categories que l'on peut soumettre a ordonnance. `MEDICAMENT` n'y
   * figure pas : un medicament reglemente l'est deja de droit (EF-05-12), et
   * soumettre *tous* les medicaments fermerait la vente libre de paracetamol.
   */
  readonly categoriesDisponibles: CategorieProduit[] = [
    'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE',
    'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE',
  ];

  categorieSoumise(c: CategorieProduit): boolean {
    return this.pharmacie.categoriesExigeantOrdonnance.includes(c);
  }

  basculerCategorie(c: CategorieProduit, soumise: boolean) {
    const sans = this.pharmacie.categoriesExigeantOrdonnance.filter((x) => x !== c);
    this.pharmacie.categoriesExigeantOrdonnance = soumise ? [...sans, c] : sans;
  }

  ngOnInit() {
    this.charger();
  }

  setTab(id: Onglet) {
    this.activeTab.set(id);
  }

  charger() {
    this.isLoading.set(true);
    this.adminService.getParametres().subscribe({
      next: res => {
        if (res.data) this.appliquer(res.data);
        this.isLoading.set(false);
      },
      error: err => {
        this.isLoading.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('ADMIN.SETTINGS.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  /** Enregistre uniquement la section de l'onglet actif. */
  enregistrer(section: Onglet) {
    if (this.isSaving()) return;
    const payload: UpdateParametresSystemeDto = section === 'pays'
      ? { pays: this.paysPourEnvoi() }
      : { [section]: { ...this[section] } };

    this.isSaving.set(true);
    this.adminService.updateParametres(payload).subscribe({
      next: res => {
        // La reponse fait foi : elle contient les valeurs normalisees par l'API.
        if (res.data) this.appliquer(res.data);
        this.isSaving.set(false);
        this.toastr.success(this.i18n.t('ADMIN.SETTINGS.SUCCESS_SAVED'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: err => {
        this.isSaving.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('ADMIN.SETTINGS.ERR_SAVE'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  /** Televerse le logo ; l'API renvoie l'identite a jour, appliquee aussitot a toute l'interface. */
  changerLogo(event: Event) {
    const input = event.target as HTMLInputElement;
    const fichier = input.files?.[0];
    input.value = '';
    if (!fichier || this.isUploadingLogo()) return;

    this.isUploadingLogo.set(true);
    this.adminService.uploadLogo(fichier).subscribe({
      next: res => {
        if (res.data) this.appliquerIdentite(res.data);
        this.isUploadingLogo.set(false);
        this.toastr.success(this.i18n.t('ADMIN.SETTINGS.IDENTITY_LOGO_SAVED'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: err => {
        this.isUploadingLogo.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('ADMIN.SETTINGS.ERR_SAVE'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  /** Retire le logo : le nom seul est affiche. */
  retirerLogo() {
    this.identite.logoUrl = '';
    this.enregistrer('identite');
  }

  private appliquerIdentite(identite: IdentitePlateformeView) {
    // La reponse contient les derives (copyright « © annee nom », nom court) :
    // seul le logo entre dans le formulaire, sinon un champ laisse vide par
    // l'admin serait fige a la valeur calculee du jour.
    this.identite = { ...this.identite, logoUrl: identite.logoUrl };
    this.plateforme.appliquer(identite);
  }

  private appliquer(vue: ParametresSystemeView) {
    // Copies : ngModel mute les objets, la reponse HTTP ne doit pas etre partagee.
    this.identite    = { ...vue.identite };
    this.plateforme.appliquer(vue.identite);
    this.facturation = { ...vue.facturation };
    this.securite    = { ...vue.securite };
    this.alertes     = { ...vue.alertes };
    this.sync        = { ...vue.sync };
    this.prescription = { ...vue.prescription };
    // La liste est copiee, pas partagee : ngModel mute les tableaux.
    this.pharmacie = { ...vue.pharmacie, categoriesExigeantOrdonnance: [...vue.pharmacie.categoriesExigeantOrdonnance] };
    this.zones = { ...vue.zones };
    this.pays = { ...vue.pays, niveaux: vue.pays.niveaux.map((n) => ({ ...n, libelles: { ...n.libelles } })) };
    this.modifieLe.set(vue.modifieLe);
  }
}
