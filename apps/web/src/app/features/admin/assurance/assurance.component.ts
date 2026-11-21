// features/admin/assurance/assurance.component.ts
//
// Assurance et tiers payant, cote administration nationale (EF-09, addendum
// du 2026-09-28 point 5).
//
// **La caisse savait deja chiffrer une prise en charge ; rien ne permettait de
// declarer l'assureur qui la finance.** L'API existait, elle ne se joignait
// qu'en ligne de commande. Cet ecran est ce qui manquait pour que le tiers
// payant existe depuis la plateforme.
//
// La page se lit de haut en bas : **qui assure**, puis **qui est assure**. Ce
// sont deux gestes de rythmes differents — on declare un assureur une fois,
// on rattache des polices tous les jours — mais le second n'a aucun sens
// avant le premier, et les melanger dans un seul formulaire les rendrait tous
// deux illisibles.
//
// **Une compagnie se cree en une fois, ici.** Il fallait trois gestes dans
// deux ecrans - la structure dans « Structures », puis la compagnie et son
// rattachement ici - et personne ne devinait l'enchainement. Le formulaire de
// creation fait naitre ensemble la structure, son dossier, la compagnie et le
// compte du responsable, comme une pharmacie nait avec son titulaire. Le
// rattachement a une structure existante reste, pour les assurances
// anterieures, mais ce n'est plus le chemin normal.
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ToastrService } from 'ngx-toastr';
import type {
  AgentAssureurCreeView,
  AssureurView,
  CategorieProduit,
  ContratAssuranceView,
  CreerAssuranceDto,
  ModeEchangeAssureur,
  PatientContratRechercheView,
  PiecesAttenduesView,
  TypePieceAgrement,
} from '@baobaoheath/shared-types';
import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
import { PiecesAgrementComponent } from '../../../shared/components/pieces-agrement/pieces-agrement.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { SuggestionsLieuxComponent } from '../../../shared/components/suggestions-lieux/suggestions-lieux.component';
import { GeographieService } from '../../../core/services/geographie.service';

/** Les categories de l'enum Prisma, dans l'ordre ou on les rencontre. */
const CATEGORIES: CategorieProduit[] = [
  'MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE',
  'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE',
];

/** Le code imprime sur la carte : la meme regle que le serveur. */
const FORME_CODE = /^[A-Za-z0-9-]{2,16}$/;
const FORME_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Le contenu de la modale de succes : le mot de passe n'existe que la. */
interface CompagnieCreee {
  compagnieNom: string;
  responsableNom: string;
  responsableTelephone: string;
  motDePasse: string;
  /** L'adresse, seulement si le courriel est **parti**. */
  emailEnvoye: string | null;
  /** L'adresse saisie, quand le courriel n'a pas pu partir. */
  emailEchec: string | null;
}

function assuranceVide() {
  return {
    nom: '', code: '', modeEchange: 'MANUEL' as ModeEchangeAssureur, telephone: '',
    prefecture: '', commune: '', quartier: '', adresse: '',
    rccm: '', numeroAgrementCreation: '', lieuAutorise: '',
    responsable: { prenom: '', nom: '', telephone: '', email: '' },
  };
}

@Component({
  selector: 'app-admin-assurance',
  standalone: true,
  imports: [ListeRechercheComponent, 
    CommonModule, FormsModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, TranslatePipe, SuggestionsLieuxComponent,
    PiecesAgrementComponent,
  ],
  templateUrl: './assurance.component.html',
  // Le formulaire de creation reprend les classes de l'ecran des structures,
  // lues a la source : les deux formulaires de creation se ressemblent, et
  // une copie finirait par diverger.
  styleUrls: ['./assurance.component.scss', '../structures/structures.component.scss'],
})
export class AssuranceComponent implements OnInit {
  readonly optionsAssureurs = computed<OptionListe[]>(() =>
    this.assureurs().map((a) => ({ valeur: a.id, libelle: `${a.code} — ${a.nom}` })));

  private admin = inject(AdminService);
  private demandes = inject(DemandeAgrementService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);
  /** R9 : le nom du niveau (« Prefecture », « LGA »...) et ses lieux viennent du pays installe. */
  readonly geo = inject(GeographieService);

  // ── Creer une compagnie en une fois ────────────────────────────────
  readonly formAssurance = signal(false);

  /**
   * Un objet ordinaire, lie aux champs par `ngModel`. **Tout ce qui le lit est
   * une methode, jamais un `computed`** : un `computed` qui lit une propriete
   * non signal est evalue une fois puis fige (voir PASSATION, section 5).
   */
  nouvelleAssurance = assuranceVide();

  /** Les fichiers retenus et leur completude, rendus par le bloc des pieces. */
  readonly piecesAssurance = signal<Partial<Record<TypePieceAgrement, File>>>({});
  readonly piecesAssuranceCompletes = signal(false);

  /** Ce que le serveur exige d'une assurance : lu, jamais recopie. */
  readonly attendues = signal<PiecesAttenduesView[]>([]);

  /** La modale de succes. Le mot de passe ne vit que la, jusqu'a sa fermeture. */
  readonly compagnieCreee = signal<CompagnieCreee | null>(null);

  // ── Les assureurs ──────────────────────────────────────────────────
  assureurs = signal<AssureurView[]>([]);
  chargement = signal(true);
  enregistre = signal(false);
  /** L'assureur dont on deplie les regles : une seule a la fois. */
  reglesOuvertes = signal<string | null>(null);
  /** L'assureur auquel on ajoute une regle. */
  formRegle = signal<string | null>(null);
  /** L'assureur auquel l'administration ajoute son compte agent. */
  readonly formAgentAssureur = signal<string | null>(null);
  /** Le mot de passe n'est conserve que jusqu'a sa fermeture. */
  readonly motDePasseAgent = signal<{ assureurNom: string; resultat: AgentAssureurCreeView } | null>(null);

  nouvelleRegle = {
    categorie: 'MEDICAMENT' as CategorieProduit,
    exclu: false,
    tauxPourcent: null as number | null,
    plafondLigneGnf: 0,
    dateEffet: this.aujourdhui(),
  };

  nouvelAgentAssureur = { prenom: '', nom: '', telephone: '', email: '', prefecture: '' };

  // ── Les polices ────────────────────────────────────────────────────
  recherche = '';
  resultats = signal<PatientContratRechercheView[] | null>(null);
  chercheEnCours = signal(false);
  patient = signal<PatientContratRechercheView | null>(null);
  contrats = signal<ContratAssuranceView[]>([]);
  formPolice = signal(false);

  nouvellePolice = {
    idAssureur: '', numeroPolice: '',
    tauxBasePourcent: 80, plafondAnnuelGnf: 0, franchiseGnf: 0,
    dateEffet: this.aujourdhui(), dateFin: '', carenceJours: 0,
  };

  readonly categories = CATEGORIES;

  ngOnInit(): void {
    this.chargerAssureurs();
    this.demandes.piecesAttendues().subscribe({
      next: (r) => this.attendues.set(r.data ?? []),
      // Sans la liste, le bloc des pieces retombe sur sa table, et la raison
      // du blocage dit seulement que le dossier est incomplet.
      error: () => this.attendues.set([]),
    });
  }

  // ── Creer une compagnie en une fois ────────────────────────────────
  ouvrirCreation(): void {
    this.formAssurance.set(true);
  }

  fermerCreation(): void {
    this.formAssurance.set(false);
  }

  private entreeAssurance(): PiecesAttenduesView | null {
    return this.attendues().find((a) => a.type === 'ASSURANCE') ?? null;
  }

  /** Les pieces a reclamer, telles que le serveur les donne - ou `null`. */
  requisesImposees(): readonly TypePieceAgrement[] | null {
    const entree = this.entreeAssurance();
    return entree ? entree.pieces.map((p) => p.type) : null;
  }

  libellesImposes(): Partial<Record<TypePieceAgrement, string>> {
    const libelles: Partial<Record<TypePieceAgrement, string>> = {};
    for (const piece of this.entreeAssurance()?.pieces ?? []) libelles[piece.type] = piece.libelle;
    return libelles;
  }

  /**
   * Pourquoi le bouton ne part pas, en une phrase, ou `null` s'il part.
   *
   * Un bouton grise qui ne dit rien laisse chercher : la phrase nomme ce qui
   * manque, et pour le dossier, ou on en est. Elle s'affiche juste au-dessus
   * du bouton, la ou le regard se pose quand il ne repond pas.
   */
  raisonBlocage(): string | null {
    if (this.enregistre()) return null;
    const a = this.nouvelleAssurance;
    if (a.nom.trim().length < 2) return this.i18n.t('ADMIN.ASSURANCE.BLOCAGE_NOM');
    if (!FORME_CODE.test(a.code.trim())) return this.i18n.t('ADMIN.ASSURANCE.BLOCAGE_CODE');
    if (!a.prefecture.trim() || !a.commune.trim()) {
      return this.i18n.t('ADMIN.ASSURANCE.BLOCAGE_LIEU', {
        zone: this.geo.libelle('elargissement'),
        base: this.geo.libelle('base'),
      });
    }
    if (!a.rccm.trim() || !a.lieuAutorise.trim() || !a.numeroAgrementCreation.trim()) {
      return this.i18n.t('ADMIN.ASSURANCE.BLOCAGE_IDENTIFIANTS');
    }
    const r = a.responsable;
    if (!r.prenom.trim() || !r.nom.trim() || !r.telephone.trim() || !FORME_EMAIL.test(r.email.trim())) {
      return this.i18n.t('ADMIN.ASSURANCE.BLOCAGE_RESPONSABLE');
    }
    if (!this.piecesAssuranceCompletes()) {
      const requises = this.requisesImposees();
      // Sans la liste du serveur, on ne peut pas compter : pas de total invente.
      if (!requises) return this.i18n.t('AGREMENT.ERR_PIECES');
      const jointes = requises.filter((type) => !!this.piecesAssurance()[type]).length;
      return this.i18n.t('ADMIN.ASSURANCE.BLOCAGE_PIECES', { jointes, total: requises.length });
    }
    return null;
  }

  peutCreerAssurance(): boolean {
    return !this.enregistre() && this.raisonBlocage() === null;
  }

  creerAssurance(): void {
    if (!this.peutCreerAssurance()) return;
    this.enregistre.set(true);
    const a = this.nouvelleAssurance;
    const facultatif = (v: string) => v.trim() || undefined;
    const dto: CreerAssuranceDto = {
      nom: a.nom.trim(),
      code: a.code.trim().toUpperCase(),
      modeEchange: a.modeEchange,
      prefecture: a.prefecture.trim(),
      commune: a.commune.trim(),
      ...(facultatif(a.quartier) ? { quartier: a.quartier.trim() } : {}),
      ...(facultatif(a.adresse) ? { adresse: a.adresse.trim() } : {}),
      ...(facultatif(a.telephone) ? { telephone: a.telephone.trim() } : {}),
      rccm: a.rccm.trim(),
      lieuAutorise: a.lieuAutorise.trim(),
      numeroAgrementCreation: a.numeroAgrementCreation.trim(),
      responsable: {
        prenom: a.responsable.prenom.trim(),
        nom: a.responsable.nom.trim(),
        telephone: a.responsable.telephone.trim(),
        email: a.responsable.email.trim(),
      },
    };
    this.admin.creerAssurance(dto, this.piecesAssurance()).subscribe({
      next: (r) => {
        this.enregistre.set(false);
        const data = r.data;
        if (!data) {
          this.toastr.error(this.i18n.t('COMMON.ERROR_GENERIC'));
          return;
        }
        this.compagnieCreee.set({
          compagnieNom: data.assureur.nom,
          responsableNom: `${data.responsable.prenom} ${data.responsable.nom}`,
          responsableTelephone: data.responsable.telephone,
          motDePasse: data.motDePasseTemporaire,
          // Ce que le serveur a fait : annoncer un envoi qui a echoue ferait
          // fermer la modale sans noter le mot de passe.
          emailEnvoye: data.emailEnvoye ? (data.responsable.email ?? dto.responsable.email) : null,
          emailEchec: data.emailEnvoye ? null : (data.responsable.email ?? dto.responsable.email),
        });
        this.toastr.success(this.i18n.t('ADMIN.ASSURANCE.COMPAGNIE_CREEE', { nom: data.assureur.nom }));
        // Les fichiers retenus partent avec le formulaire : les garder
        // joindrait l'agrement d'une compagnie a la suivante.
        this.nouvelleAssurance = assuranceVide();
        this.piecesAssurance.set({});
        this.piecesAssuranceCompletes.set(false);
        this.formAssurance.set(false);
        this.chargerAssureurs();
      },
      error: (err) => this.echec(err),
    });
  }

  /** Fermer la modale efface le mot de passe : il ne s'affiche qu'une fois. */
  fermerCompagnieCreee(): void {
    this.compagnieCreee.set(null);
  }

  // ── Assureurs ──────────────────────────────────────────────────────
  chargerAssureurs(): void {
    this.chargement.set(true);
    this.admin.getAssureurs().subscribe({
      next: (r) => {
        this.assureurs.set(r.data ?? []);
        this.chargement.set(false);
      },
      error: () => {
        this.chargement.set(false);
        this.toastr.error(this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  basculerRegles(id: string): void {
    this.reglesOuvertes.update((v) => (v === id ? null : id));
    this.formRegle.set(null);
  }

  ouvrirFormAgentAssureur(id: string): void {
    const assureur = this.assureurs().find((item) => item.id === id);
    if (!assureur || assureur.agentExistant) return;
    this.nouvelAgentAssureur = { prenom: '', nom: '', telephone: '', email: '', prefecture: '' };
    this.formAgentAssureur.set(id);
  }

  peutCreerAgentAssureur(): boolean {
    const a = this.nouvelAgentAssureur;
    return !this.enregistre()
      && !!a.prenom.trim()
      && !!a.nom.trim()
      && !!a.telephone.trim()
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())
      && !!a.prefecture.trim();
  }

  creerAgentAssureur(idAssureur: string): void {
    if (!this.peutCreerAgentAssureur()) return;
    this.enregistre.set(true);
    const formulaire = this.nouvelAgentAssureur;
    const assureur = this.assureurs().find((item) => item.id === idAssureur);
    if (!assureur || assureur.agentExistant) {
      this.enregistre.set(false);
      return;
    }
    this.admin.creerAgentAssureur(idAssureur, {
      prenom: formulaire.prenom.trim(),
      nom: formulaire.nom.trim(),
      telephone: formulaire.telephone.trim(),
      email: formulaire.email.trim(),
      prefecture: formulaire.prefecture.trim(),
    }).subscribe({
      next: (response) => {
        this.enregistre.set(false);
        if (!response.data) {
          this.toastr.error(this.i18n.t('COMMON.ERROR_GENERIC'));
          return;
        }
        this.motDePasseAgent.set({ assureurNom: assureur.nom, resultat: response.data });
        this.formAgentAssureur.set(null);
        this.nouvelAgentAssureur = { prenom: '', nom: '', telephone: '', email: '', prefecture: '' };
        this.chargerAssureurs();
      },
      error: (err) => this.echec(err),
    });
  }

  copierMotDePasseAgent(): void {
    const motDePasse = this.motDePasseAgent()?.resultat.motDePasseTemporaire;
    if (!motDePasse) return;
    const pressePapiers = navigator.clipboard;
    if (!pressePapiers) {
      this.toastr.error(this.i18n.t('ADMIN.ASSURANCE.AGENT_PASSWORD_COPY_ERROR'));
      return;
    }
    pressePapiers.writeText(motDePasse).then(
      () => this.toastr.success(this.i18n.t('ADMIN.ASSURANCE.AGENT_PASSWORD_COPIED')),
      () => this.toastr.error(this.i18n.t('ADMIN.ASSURANCE.AGENT_PASSWORD_COPY_ERROR')),
    );
  }

  fermerMotDePasseAgent(): void {
    this.motDePasseAgent.set(null);
  }

  ouvrirFormRegle(id: string): void {
    this.formRegle.set(id);
    this.nouvelleRegle = {
      categorie: 'MEDICAMENT', exclu: false, tauxPourcent: null,
      plafondLigneGnf: 0, dateEffet: this.aujourdhui(),
    };
  }

  /**
   * Une categorie exclue n'a pas de taux : porter les deux serait
   * contradictoire, et une contrainte SQL le refuse. On vide le champ plutot
   * que d'envoyer une valeur que l'API rejettera.
   */
  surExclusion(exclu: boolean): void {
    this.nouvelleRegle.exclu = exclu;
    if (exclu) this.nouvelleRegle.tauxPourcent = null;
  }

  ajouterRegle(idAssureur: string): void {
    if (this.enregistre()) return;
    this.enregistre.set(true);
    const r = this.nouvelleRegle;
    this.admin.ajouterRegleCouverture(idAssureur, {
      categorie: r.categorie,
      exclu: r.exclu,
      ...(r.exclu || r.tauxPourcent === null ? {} : { tauxPourcent: Number(r.tauxPourcent) }),
      plafondLigneGnf: Number(r.plafondLigneGnf) || 0,
      dateEffet: new Date(r.dateEffet).toISOString(),
    }).subscribe({
      next: () => {
        this.enregistre.set(false);
        this.formRegle.set(null);
        this.toastr.success(this.i18n.t('ADMIN.ASSURANCE.REGLE_AJOUTEE'));
        this.chargerAssureurs();
      },
      error: (err) => this.echec(err),
    });
  }

  // ── Polices ────────────────────────────────────────────────────────
  chercher(): void {
    const q = this.recherche.trim();
    if (q.length < 3) {
      this.resultats.set(null);
      return;
    }
    this.chercheEnCours.set(true);
    this.admin.rechercherPatientsPourPolice(q).subscribe({
      next: (r) => {
        this.chercheEnCours.set(false);
        this.resultats.set(r.data ?? []);
      },
      error: (err) => {
        this.chercheEnCours.set(false);
        this.echec(err);
      },
    });
  }

  choisirPatient(p: PatientContratRechercheView): void {
    this.patient.set(p);
    this.resultats.set(null);
    this.contrats.set([]);
    this.admin.contratsDuPatient(p.id).subscribe({
      next: (r) => this.contrats.set(r.data ?? []),
      error: (err) => this.echec(err),
    });
  }

  changerPatient(): void {
    this.patient.set(null);
    this.contrats.set([]);
    this.formPolice.set(false);
    this.recherche = '';
    this.resultats.set(null);
  }

  ouvrirFormPolice(): void {
    this.formPolice.set(true);
    this.nouvellePolice = {
      idAssureur: this.assureurs()[0]?.id ?? '', numeroPolice: '',
      tauxBasePourcent: 80, plafondAnnuelGnf: 0, franchiseGnf: 0,
      dateEffet: this.aujourdhui(), dateFin: '', carenceJours: 0,
    };
  }

  peutCreerPolice(): boolean {
    const p = this.nouvellePolice;
    return !this.enregistre()
      && !!this.patient()
      && p.idAssureur.length > 0
      && p.numeroPolice.trim().length > 0
      && p.dateEffet.length > 0;
  }

  creerPolice(): void {
    if (!this.peutCreerPolice()) return;
    this.enregistre.set(true);
    const p = this.nouvellePolice;
    this.admin.creerContrat({
      idAssureur: p.idAssureur,
      idPatient: this.patient()!.id,
      numeroPolice: p.numeroPolice.trim(),
      tauxBasePourcent: Number(p.tauxBasePourcent),
      plafondAnnuelGnf: Number(p.plafondAnnuelGnf) || 0,
      franchiseGnf: Number(p.franchiseGnf) || 0,
      dateEffet: new Date(p.dateEffet).toISOString(),
      ...(p.dateFin ? { dateFin: new Date(p.dateFin).toISOString() } : {}),
      carenceJours: Number(p.carenceJours) || 0,
    }).subscribe({
      next: (r) => {
        this.enregistre.set(false);
        this.formPolice.set(false);
        this.toastr.success(this.i18n.t('ADMIN.ASSURANCE.POLICE_CREEE', { numero: r.data?.numeroPolice ?? '' }));
        const pat = this.patient();
        if (pat) this.choisirPatient(pat);
        this.chargerAssureurs();
      },
      error: (err) => this.echec(err),
    });
  }

  // ── Affichage ──────────────────────────────────────────────────────
  /** 1 500 000 plutot que 1500000 : au comptoir on compte les zeros. */
  montant(gnf: number): string {
    return new Intl.NumberFormat('fr-FR').format(gnf);
  }

  libelleCategorie(c: CategorieProduit): string {
    return this.i18n.t(`ADMIN.ASSURANCE.CAT_${c}`);
  }

  libelleStatut(s: string): string {
    return this.i18n.t(`ADMIN.ASSURANCE.STATUT_${s}`);
  }

  private aujourdhui(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** L'API nomme ce qu'elle refuse ; le dire vaut mieux qu'un message generique. */
  private echec(err: unknown): void {
    this.enregistre.set(false);
    const e = err as { error?: { error?: string } };
    this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
  }
}
