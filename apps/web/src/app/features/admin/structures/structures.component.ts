// features/admin/structures/structures.component.ts
import { Component, computed, HostListener, inject, signal, OnInit } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../../core/services/admin.service';
import { ToastrService } from 'ngx-toastr';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { DossierAgrementComponent } from '../../../shared/components/dossier-agrement/dossier-agrement.component';
import { PiecesAgrementComponent } from '../../../shared/components/pieces-agrement/pieces-agrement.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import type { CreationPharmacieView, CreationStructureView, StructureAdminView, TypePieceAgrement } from '@baobaoheath/shared-types';
import { ListeRechercheComponent, OptionsDePipe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { GeographieService } from '../../../core/services/geographie.service';
import { SuggestionsLieuxComponent } from '../../../shared/components/suggestions-lieux/suggestions-lieux.component';
import { SituerStructureDialogComponent } from './situer-structure-dialog.component';

// Contenu de la modale de confirmation : assemble cote client a partir de la
// reponse de creation, il n'a pas d'equivalent dans une reponse d'API.
interface MotDePasseAffiche {
  structureNom: string;
  adminNom: string;
  adminTelephone: string;
  motDePasse: string;
  emailEnvoye?: string;
}

type FiltreEtatStructure = 'TOUS' | 'ACTIVES' | 'INACTIVES';

const ICONES_TYPE: Record<string, string> = {
  POSTE: 'pi-map-marker',
  CENTRE: 'pi-home',
  HOPITAL_PREF: 'pi-building',
  HOPITAL_REG: 'pi-building',
  CHU: 'pi-building-columns',
  CLINIQUE: 'pi-heart',
  LABORATOIRE: 'pi-search-plus',
  PHARMACIE: 'pi-plus-circle',
  ASSURANCE: 'pi-shield',
};

/** Recherche insensible a la casse et aux accents (« Labé » = « labe »). */
function normaliser(v: string): string {
  return v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

@Component({
  selector: 'app-structures',
  standalone: true,
  imports: [ListeRechercheComponent, OptionsDePipe, 
    MatFormFieldModule, MatInputModule, MatSelectModule,CommonModule, FormsModule, TranslatePipe,
    ExportListeComponent, PiecesAgrementComponent, DossierAgrementComponent, SuggestionsLieuxComponent,
    SituerStructureDialogComponent],
  templateUrl: './structures.component.html',
  styleUrl: './structures.component.scss'
})
export class StructuresComponent implements OnInit {
  private adminService = inject(AdminService);
  private toastr       = inject(ToastrService);
  private i18n         = inject(I18nService);

  structures        = signal<StructureAdminView[]>([]);
  isLoading         = signal(true);
  showForm          = signal(false);
  isSaving          = signal(false);
  isToggling        = signal<string | null>(null); // id de la structure en cours de toggle
  confirmDesactiver = signal<StructureAdminView | null>(null); // modal confirmation
  structureASituer = signal<StructureAdminView | null>(null);

  mdpAffiche = signal<MotDePasseAffiche | null>(null);

  /**
   * La structure dont le dossier est ouvert.
   *
   * Un seul a la fois : charger le dossier de quarante structures d'un coup
   * ferait quarante requetes pour un ecran qu'on ne regarde qu'une ligne a la
   * fois. C'est aussi ce qui permet de garder la liste lisible.
   */
  dossierOuvert = signal<string | null>(null);

  basculerDossier(id: string) {
    this.dossierOuvert.update((v) => (v === id ? null : id));
  }

  gpsEnCours = signal(false);
  erreurGps = signal<string | null>(null);

  newStructure = {
    nom: '', type: 'CENTRE', prefecture: '', commune: '', quartier: '', adresse: '',
    latitude: null as number | null, longitude: null as number | null, telephone: '',
    rccm: '', numeroAgrementCreation: '', numeroAgrementExploitation: '', lieuAutorise: '',
    admin: { prenom: '', nom: '', telephone: '', email: '' }
  };

  /**
   * Le dossier reglementaire des structures privees.
   *
   * **Il bloque** (decision du 2026-10-28) : une pharmacie independante, une
   * clinique, un laboratoire prive ou un assureur ne se creent pas sans leurs
   * pieces. Le serveur refuse de toute facon ; l'ecran l'annonce avant, pour
   * ne pas faire saisir un formulaire entier qui sera rejete.
   */
  pieces = signal<Partial<Record<TypePieceAgrement, File>>>({});
  piecesCompletes = signal(false);

  /** Les types qui doivent produire un dossier. Le public n'en produit aucun. */
  private static readonly TYPES_PRIVES = ['PHARMACIE', 'CLINIQUE', 'LABORATOIRE', 'ASSURANCE'];

  readonly exigeUnDossier = computed(() =>
    StructuresComponent.TYPES_PRIVES.includes(this.newStructure.type));

  /** L'assureur releve de la Banque Centrale : une seule reference, pas deux. */
  readonly estAssureur = computed(() => this.newStructure.type === 'ASSURANCE');

  /**
   * Le formulaire est-il envoyable ?
   *
   * Lu par le gabarit pour desactiver le bouton : un envoi parti sans ses
   * pieces reviendrait en 400, apres le temps de montee des fichiers.
   */
  peutEnvoyer(): boolean {
    return !this.isSaving() && !!this.newStructure.commune.trim() && (!this.exigeUnDossier() || this.piecesCompletes());
  }

  get typeOptions() {
    return [
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_POSTE'),        value: 'POSTE'        },
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_CENTRE'),       value: 'CENTRE'       },
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_HOPITAL_PREF'), value: 'HOPITAL_PREF' },
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_HOPITAL_REG'),  value: 'HOPITAL_REG'  },
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_CHU'),          value: 'CHU'          },
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_CLINIQUE'),     value: 'CLINIQUE'     },
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_LABORATOIRE'),  value: 'LABORATOIRE'  },
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_PHARMACIE'),    value: 'PHARMACIE'    },
      // **Aucune route ne savait creer cette structure** : elle n'existait que
      // par la semence. Or c'est elle qui porte l'agrement de l'assureur, donc
      // sans elle aucun assureur ne peut etre inscrit.
      { label: this.i18n.t('ADMIN.STRUCTURES.TYPE_ASSURANCE'),    value: 'ASSURANCE'    }
    ];
  }

  /** M1 : les noms des niveaux et les lieux viennent du pays installe. */
  readonly geo = inject(GeographieService);
  private readonly zonesReferentiel = signal<string[]>([]);

  /**
   * Les zones d'elargissement proposees (les prefectures en Guinee), tirees du
   * referentiel du pays installe.
   *
   * R9 : plus de liste guineenne de repli. Elle etait incomplete (27
   * prefectures sur 33) et figeait dans le code un decoupage qui appartient
   * au referentiel. Tant que celui-ci est vide, la zone se saisit librement
   * (`saisieLibreZone`) et l'ecran invite a charger le jeu de depart.
   */
  readonly prefectures = computed(() => this.zonesReferentiel().map((p) => ({ label: p, value: p })));

  /** Referentiel encore vide : la zone se tape, pour qu'une structure puisse quand meme etre creee. */
  readonly saisieLibreZone = computed(() => this.zonesReferentiel().length === 0);

  /** Les colonnes du document imprime **et** du fichier : les memes.
   * C'est ce qui empeche la feuille et le tableur de se contredire. */
  readonly colonnes: ColonneExport<StructureAdminView>[] = [
    { titre: 'EXPORT.COL.NOM', valeur: (s) => s.nom },
    { titre: 'EXPORT.COL.TYPE', valeur: (s) => s.type },
    { titre: 'EXPORT.COL.PREFECTURE', valeur: (s) => s.prefecture },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (s) => s.telephone },
    { titre: 'EXPORT.COL.ETAT', valeur: (s) => (s.estActive ? 'Active' : 'Inactive') },
    { titre: 'EXPORT.COL.CREEE_LE', valeur: (s) => new Date(s.creeLe) },
  ];

  // ── Recherche, filtres, menu d'actions ────────────────────────
  // L'API renvoie toutes les structures d'un coup : filtrer ici est exact.
  readonly recherche = signal('');
  readonly filtreType = signal('');
  readonly filtreEtat = signal<FiltreEtatStructure>('TOUS');
  readonly etats: FiltreEtatStructure[] = ['TOUS', 'ACTIVES', 'INACTIVES'];

  /** Ce que la liste affiche, et ce que l'export reprend. */
  readonly structuresFiltrees = computed<StructureAdminView[]>(() => {
    const q = normaliser(this.recherche().trim());
    const type = this.filtreType();
    const etat = this.filtreEtat();
    return this.structures().filter((s) =>
      (!type || s.type === type)
      && (etat === 'TOUS' || (etat === 'ACTIVES') === s.estActive)
      && (!q || [s.nom, s.prefecture, s.telephone ?? ''].some((v) => normaliser(v).includes(q))));
  });

  /** La ligne dont le menu d'actions est ouvert (une seule a la fois). */
  readonly menuOuvert = signal<string | null>(null);

  basculerMenu(id: string, event?: Event) {
    event?.stopPropagation();
    this.menuOuvert.update((v) => (v === id ? null : id));
  }

  @HostListener('document:keydown.escape')
  @HostListener('document:click')
  fermerMenu() { this.menuOuvert.set(null); }

  /** Une icone par type : un poste de sante n'est pas un CHU. */
  iconeType(type: string): string {
    return ICONES_TYPE[type] ?? 'pi-building';
  }

  ngOnInit() {
    this.loadStructures();
    // M1 : les zones d'elargissement du referentiel, quand il est rempli.
    this.geo.chargerConfiguration().subscribe(() =>
      this.geo.nomsSuggeres('elargissement').subscribe((noms) => this.zonesReferentiel.set(noms)));
  }

  loadStructures() {
    this.isLoading.set(true);
    this.adminService.getStructures().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const paginatedData = response.data;
          const data = Array.isArray(paginatedData) ? paginatedData : (paginatedData as unknown as { items?: StructureAdminView[] })?.items ?? [];
          this.structures.set(data);
        }
        this.isLoading.set(false);
      },
      error: () => { this.isLoading.set(false); }
    });
  }

  positionActuelle() {
    if (!navigator.geolocation) {
      this.erreurGps.set(this.i18n.t('ADMIN.STRUCTURES.GPS_ERR'));
      return;
    }

    this.gpsEnCours.set(true);
    this.erreurGps.set(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.newStructure.latitude = Number(pos.coords.latitude.toFixed(6));
        this.newStructure.longitude = Number(pos.coords.longitude.toFixed(6));
        this.gpsEnCours.set(false);
      },
      () => {
        this.gpsEnCours.set(false);
        this.erreurGps.set(this.i18n.t('ADMIN.STRUCTURES.GPS_ERR'));
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  creerStructure() {
    const validationTitle = this.i18n.t('ADMIN.STRUCTURES.VALIDATION_TITLE');
    if (!this.newStructure.nom || !this.newStructure.prefecture || !this.newStructure.commune.trim()) {
      this.toastr.error(this.i18n.t('ADMIN.STRUCTURES.ERR_VALIDATION_STRUCT'), validationTitle); return;
    }
    if (!this.newStructure.admin.prenom || !this.newStructure.admin.nom || !this.newStructure.admin.telephone || !this.newStructure.admin.email) {
      this.toastr.error(this.i18n.t('ADMIN.STRUCTURES.ERR_VALIDATION_ADMIN'), validationTitle); return;
    }
    // Les identifiants reglementaires, pour les seuls types prives. Le
    // serveur les exige aussi : ce controle evite une montee de fichiers pour
    // rien, il ne la remplace pas.
    if (this.exigeUnDossier()) {
      const manquants = !this.newStructure.rccm.trim()
        || !this.newStructure.lieuAutorise.trim()
        || !this.newStructure.numeroAgrementCreation.trim()
        || (!this.estAssureur() && !this.newStructure.numeroAgrementExploitation.trim());
      if (manquants) {
        this.toastr.error(this.i18n.t('AGREMENT.ERR_IDENTIFIANTS'), validationTitle); return;
      }
      if (!this.piecesCompletes()) {
        this.toastr.error(this.i18n.t('AGREMENT.ERR_PIECES'), validationTitle); return;
      }
    }

    this.isSaving.set(true);

    const nomStructureCree = this.newStructure.nom;
    const telephoneAdminSaisi = this.newStructure.admin.telephone;

    let request$;

    if (this.newStructure.type === 'PHARMACIE') {
      const payload = {
        nom: this.newStructure.nom,
        prefecture: this.newStructure.prefecture,
        commune: this.newStructure.commune.trim(),
        quartier: this.newStructure.quartier.trim() || undefined,
        adresse: this.newStructure.adresse || undefined,
        telephone: this.newStructure.telephone || undefined,
        latitude: this.newStructure.latitude ?? undefined,
        longitude: this.newStructure.longitude ?? undefined,
        ...this.identifiants(),
        pharmacien: {
          prenom: this.newStructure.admin.prenom,
          nom: this.newStructure.admin.nom,
          telephone: this.newStructure.admin.telephone,
          email: this.newStructure.admin.email || undefined
        }
      };
      request$ = this.adminService.createPharmacie(payload, this.pieces());
    } else {
      const payload = {
        nom: this.newStructure.nom,
        type: this.newStructure.type,
        prefecture: this.newStructure.prefecture,
        commune: this.newStructure.commune.trim(),
        quartier: this.newStructure.quartier.trim() || undefined,
        adresse: this.newStructure.adresse || undefined,
        telephone: this.newStructure.telephone || undefined,
        latitude: this.newStructure.latitude ?? undefined,
        longitude: this.newStructure.longitude ?? undefined,
        ...this.identifiants(),
        admin: {
          prenom: this.newStructure.admin.prenom,
          nom: this.newStructure.admin.nom,
          telephone: this.newStructure.admin.telephone,
          email: this.newStructure.admin.email || undefined
        }
      };
      request$ = this.adminService.createStructure(payload, this.pieces());
    }

    request$.subscribe({
      next: (response) => {
        const data = (response?.data ?? response) as Partial<CreationStructureView & CreationPharmacieView>;
        this.isSaving.set(false);
        this.showForm.set(false);
        this.newStructure = {
          nom: '', type: 'CENTRE', prefecture: '', commune: '', quartier: '', adresse: '',
          latitude: null, longitude: null, telephone: '',
          rccm: '', numeroAgrementCreation: '', numeroAgrementExploitation: '', lieuAutorise: '',
          admin: { prenom: '', nom: '', telephone: '', email: '' }
        };
        // Les fichiers retenus doivent partir avec le formulaire : les garder
        // ferait joindre l'agrement d'une clinique a la structure suivante.
        this.pieces.set({});
        this.piecesCompletes.set(false);

        const adminData = data?.admin ?? data?.pharmacien;
        // Les deux endpoints renvoient la structure sous la meme cle.
        const structureData = data?.structure;

        // Le mot de passe temporaire est toujours affiché ici : l'envoi d'email
        // peut échouer silencieusement côté serveur (SMTP indisponible, etc.),
        // il ne faut jamais faire dépendre l'accès au compte de sa réception.
        this.mdpAffiche.set({
          structureNom: structureData?.nom ?? nomStructureCree,
          adminNom: `${adminData?.prenom ?? ''} ${adminData?.nom ?? ''}`.trim(),
          adminTelephone: adminData?.telephone ?? telephoneAdminSaisi,
          motDePasse: data?.motDePasseTemporaire ?? '',
          // L'API renvoie `null` quand aucun email n'est renseigne.
          emailEnvoye: adminData?.email ?? undefined
        });
        this.toastr.success(this.i18n.t('ADMIN.STRUCTURES.SUCCESS_CREATED', { nom: nomStructureCree }), this.i18n.t('ADMIN.STRUCTURES.SUCCESS_TITLE'));
        this.loadStructures();
      },
      error: err => {
        this.isSaving.set(false);
        this.toastr.error(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ADMIN.STRUCTURES.ERR_CREATE'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  // ── Demander confirmation avant désactivation ─────────────────
  demanderDesactivation(s: StructureAdminView) {
    this.menuOuvert.set(null);
    this.confirmDesactiver.set(s);
  }

  situerStructure(s: StructureAdminView) {
    this.menuOuvert.set(null);
    this.structureASituer.set(s);
  }

  fermerDialoguePosition() {
    this.structureASituer.set(null);
  }

  appliquerPositionStructure(position: { id: string; latitude: number; longitude: number }) {
    this.structures.update((structures) =>
      structures.map((structure) =>
        structure.id === position.id
          ? { ...structure, latitude: position.latitude, longitude: position.longitude }
          : structure,
      ),
    );
  }

  annulerDesactivation() {
    this.confirmDesactiver.set(null);
  }

  // ── Désactiver une structure ──────────────────────────────────
  confirmerDesactivation() {
    const s = this.confirmDesactiver();
    if (!s) return;
    this.confirmDesactiver.set(null);
    this.isToggling.set(s.id);
    this.adminService.deleteStructure(s.id).subscribe({
      next: () => {
        this.isToggling.set(null);
        this.toastr.success(this.i18n.t('ADMIN.STRUCTURES.SUCCESS_DEACTIVATED', { nom: s.nom }), this.i18n.t('ADMIN.STRUCTURES.SUCCESS_TITLE'));
        this.loadStructures();
      },
      error: err => {
        this.isToggling.set(null);
        this.toastr.error(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ADMIN.STRUCTURES.ERR_DEACTIVATE'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  // ── Réactiver une structure ───────────────────────────────────
  reactiver(s: StructureAdminView) {
    this.menuOuvert.set(null);
    this.isToggling.set(s.id);
    this.adminService.updateStructure(s.id, { estActive: true }).subscribe({
      next: () => {
        this.isToggling.set(null);
        this.toastr.success(this.i18n.t('ADMIN.STRUCTURES.SUCCESS_REACTIVATED', { nom: s.nom }), this.i18n.t('ADMIN.STRUCTURES.SUCCESS_TITLE'));
        this.loadStructures();
      },
      error: err => {
        this.isToggling.set(null);
        this.toastr.error(err?.error?.error ?? err?.error?.message ?? this.i18n.t('ADMIN.STRUCTURES.ERR_REACTIVATE'), this.i18n.t('COMMON.ERROR_TITLE'));
      }
    });
  }

  fermerMdp() { this.mdpAffiche.set(null); }

  getTypeLabel(type: string): string {
    return this.typeOptions.find(t => t.value === type)?.label ?? type;
  }


  /**
   * Les identifiants reglementaires a envoyer.
   *
   * Vides pour une structure publique : elle n'a rien a produire, et envoyer
   * des chaines vides ferait croire a une saisie.
   */
  private identifiants(): Record<string, string | undefined> {
    if (!this.exigeUnDossier()) return {};
    return {
      rccm: this.newStructure.rccm.trim() || undefined,
      numeroAgrementCreation: this.newStructure.numeroAgrementCreation.trim() || undefined,
      // Sans objet chez la Banque Centrale : pas d'arrete d'exploitation
      // distinct, contrairement au ministere de la Sante.
      numeroAgrementExploitation: this.estAssureur()
        ? undefined
        : this.newStructure.numeroAgrementExploitation.trim() || undefined,
      lieuAutorise: this.newStructure.lieuAutorise.trim() || undefined,
    };
  }
}
