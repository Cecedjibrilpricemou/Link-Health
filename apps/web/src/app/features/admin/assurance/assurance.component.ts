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
  ModeEchangeAssureur,
  PatientContratRechercheView,
  StructureAdminView,
} from '@baobaoheath/shared-types';
import { AdminService } from '../../../core/services/admin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';

/** Les categories de l'enum Prisma, dans l'ordre ou on les rencontre. */
const CATEGORIES: CategorieProduit[] = [
  'MEDICAMENT', 'LAIT_INFANTILE', 'COMPLEMENT_ALIMENTAIRE', 'COSMETIQUE',
  'HYGIENE', 'PARAPHARMACIE', 'DISPOSITIF_MEDICAL', 'AUTRE',
];

@Component({
  selector: 'app-admin-assurance',
  standalone: true,
  imports: [ListeRechercheComponent, 
    CommonModule, FormsModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatCheckboxModule, TranslatePipe,
  ],
  templateUrl: './assurance.component.html',
  styleUrl: './assurance.component.scss',
})
export class AssuranceComponent implements OnInit {
  /** Structures « assurance » : la compagnie porte l'agrement de la Banque Centrale. */
  readonly optionsStructuresAssurance = computed<OptionListe[]>(() =>
    this.structuresAssurance().map((s) => ({ valeur: s.id, libelle: s.nom, detail: s.prefecture })));
  readonly optionsAssureurs = computed<OptionListe[]>(() =>
    this.assureurs().map((a) => ({ valeur: a.id, libelle: `${a.code} — ${a.nom}` })));

  private admin = inject(AdminService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  // ── Les assureurs ──────────────────────────────────────────────────
  assureurs = signal<AssureurView[]>([]);
  chargement = signal(true);
  formAssureur = signal(false);
  enregistre = signal(false);
  /** L'assureur dont on deplie les regles : une seule a la fois. */
  reglesOuvertes = signal<string | null>(null);
  /** L'assureur auquel on ajoute une regle. */
  formRegle = signal<string | null>(null);
  /** L'assureur auquel l'administration ajoute son compte agent. */
  readonly formAgentAssureur = signal<string | null>(null);
  /** Le mot de passe n'est conserve que jusqu'a sa fermeture. */
  readonly motDePasseAgent = signal<{ assureurNom: string; resultat: AgentAssureurCreeView } | null>(null);

  nouvelAssureur = {
    nom: '', code: '', telephone: '', email: '', idStructure: '',
    modeEchange: 'MANUEL' as ModeEchangeAssureur,
  };

  /**
   * Les structures de type ASSURANCE disponibles.
   *
   * **Un assureur ne peut plus exister sans sa structure** : c'est elle qui
   * porte son agrement de la Banque Centrale, son RCCM et son siege autorise.
   * L'enregistrement `Assureur` ne porte que la configuration metier — le code
   * imprime sur la carte, le mode d'echange.
   *
   * La structure se cree depuis l'administration des structures, ou son
   * agrement est exige. Si son dossier est incomplet, le serveur refuse le
   * rattachement et **nomme ce qui manque** : on laisse parler ce message
   * plutot que de recalculer la completude ici.
   */
  structuresAssurance = signal<StructureAdminView[]>([]);

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
    this.chargerStructuresAssurance();
  }

  private chargerStructuresAssurance(): void {
    this.admin.getStructures(1, 200).subscribe({
      next: (r) => {
        const page = r.data as unknown as { items?: StructureAdminView[] } | StructureAdminView[] | undefined;
        const liste = Array.isArray(page) ? page : page?.items ?? [];
        this.structuresAssurance.set(liste.filter((s) => s.type === 'ASSURANCE' && s.estActive));
      },
      // Silencieux : l'ecran reste utilisable pour tout le reste, et le champ
      // vide dit lui-meme qu'aucune structure n'est disponible.
      error: () => this.structuresAssurance.set([]),
    });
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

  peutCreerAssureur(): boolean {
    return !this.enregistre()
      && this.nouvelAssureur.nom.trim().length > 1
      && this.nouvelAssureur.code.trim().length > 1
      // Sans structure, le serveur refuse : autant ne pas laisser cliquer.
      && this.nouvelAssureur.idStructure.length > 0;
  }

  creerAssureur(): void {
    if (!this.peutCreerAssureur()) return;
    this.enregistre.set(true);
    const a = this.nouvelAssureur;
    this.admin.creerAssureur({
      nom: a.nom.trim(),
      code: a.code.trim().toUpperCase(),
      modeEchange: a.modeEchange,
      idStructure: a.idStructure,
      ...(a.telephone.trim() ? { telephone: a.telephone.trim() } : {}),
      ...(a.email.trim() ? { email: a.email.trim() } : {}),
    }).subscribe({
      next: (r) => {
        this.enregistre.set(false);
        this.formAssureur.set(false);
        this.toastr.success(this.i18n.t('ADMIN.ASSURANCE.ASSUREUR_CREE', { nom: r.data?.nom ?? '' }));
        this.nouvelAssureur = { nom: '', code: '', telephone: '', email: '', idStructure: '', modeEchange: 'MANUEL' };
        this.chargerAssureurs();
      },
      error: (err) => this.echec(err),
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
