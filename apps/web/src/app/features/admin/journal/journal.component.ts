// features/admin/journal/journal.component.ts
//
// Qui a touche au dossier de qui (EF-12-05).
//
// C'est l'ecran le plus sensible du produit : le seul d'ou l'on voit tout.
// Deux consequences visibles ici :
//
//   - **sa consultation est elle-meme journalisee** cote API, et l'ecran le
//     dit a l'operateur plutot que de le lui cacher ;
//   - **un export trop large est refuse, pas tronque.** Le message d'erreur du
//     serveur porte le nombre exact de lignes ; on l'affiche tel quel au lieu
//     d'un « echec de l'export » qui n'apprendrait rien.
//
// Tous les champs sont des signaux : l'application est zoneless, et un
// `[(ngModel)]` sur un champ ordinaire ne previent rien — un formulaire fige
// et un bouton mort, deja payes sur l'ecran de caisse le 2026-10-01.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { AnomalieView, FiltreJournalDto, LigneJournalView, Role, SeuilsAnomalies } from '@baobaoheath/shared-types';
import { AdminService } from '../../../core/services/admin.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/** Les roles proposes au filtre, dans l'ordre du parcours de soins. */
const ROLES: Role[] = [
  'PATIENT', 'ASC', 'ASC_SUPERVISOR', 'MEDECIN', 'SAGE_FEMME', 'PHARMACIEN', 'AGENT_ACCUEIL',
  'TECHNICIEN_LABO', 'LIVREUR', 'ADMIN_STRUCTURE', 'ADMIN_REGIONAL',
  'ADMIN_NATIONAL', 'SUPER_ADMIN',
];

@Component({
  selector: 'app-journal',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslatePipe,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatCheckboxModule, MatProgressSpinnerModule,
  ExportListeComponent,
  ],
  templateUrl: './journal.component.html',
  styleUrl: './journal.component.scss',
})
export class JournalComponent implements OnInit {
  private admin = inject(AdminService);
  private i18n = inject(I18nService);

  roles = ROLES;

  // ── Les criteres ───────────────────────────────────────────────────
  du = signal('');
  au = signal('');
  role = signal<Role | ''>('');
  ressource = signal('');
  idPatient = signal('');
  idUtilisateur = signal('');
  echecsSeulement = signal(false);
  parTiers = signal(false);
  page = signal(1);

  // ── L'etat ─────────────────────────────────────────────────────────
  lignes = signal<LigneJournalView[]>([]);

  /**
   * La page du journal qu'on a sous les yeux.
   *
   * **Elle ne remplace pas l'export du journal complet**, qui passe par l'API
   * et refuse au-dela d'un volume : ce qui s'imprime ici, c'est la page
   * affichee, et le sous-titre dit laquelle. Une feuille qui se ferait passer
   * pour le journal entier serait pire qu'inutile devant un controle.
   */
  readonly colonnes: ColonneExport<LigneJournalView>[] = [
    { titre: 'EXPORT.COL.HORODATAGE', valeur: (l) => new Date(l.creeLe) },
    { titre: 'EXPORT.COL.ACTEUR', valeur: (l) => l.acteur.prenom + ' ' + l.acteur.nom },
    { titre: 'EXPORT.COL.ROLE', valeur: (l) => l.acteur.role },
    { titre: 'EXPORT.COL.ACTION', valeur: (l) => l.action },
    { titre: 'EXPORT.COL.RESSOURCE', valeur: (l) => l.ressource },
    { titre: 'EXPORT.COL.PATIENT_CONCERNE', valeur: (l) => l.patientConcerne },
    { titre: 'EXPORT.COL.HTTP', valeur: (l) => l.statutHttp, nombre: true },
    { titre: 'EXPORT.COL.ADRESSE_IP', valeur: (l) => l.ipAdresse },
  ];
  total = signal(0);
  totalPages = signal(0);
  maxExport = signal(0);
  chargement = signal(true);
  exportEnCours = signal(false);
  erreur = signal('');

  // ── Les anomalies (EF-12-06) ───────────────────────────────────────
  //
  // Des **signaux a examiner, pas des verdicts** : l'ecran le dit, et chaque
  // signal mene au detail dans le tableau du dessous plutot que de conclure.
  anomalies = signal<AnomalieView[]>([]);
  seuils = signal<SeuilsAnomalies | null>(null);
  anomaliesChargees = signal(false);

  alertes = computed(() => this.anomalies().filter((a) => a.gravite === 'ALERTE').length);

  /** `parTiers` n'a de sens qu'avec un patient : tiers de qui, sinon ? */
  parTiersPossible = computed(() => this.idPatient().trim().length > 0);

  /** Prevenir avant de cliquer vaut mieux qu'un refus apres coup. */
  exportTropLarge = computed(() => this.maxExport() > 0 && this.total() > this.maxExport());

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  ngOnInit() {
    this.rechercher();
    this.chargerAnomalies();
  }

  chargerAnomalies() {
    this.admin.anomalies().subscribe({
      next: (res) => {
        this.anomalies.set(res.data?.anomalies ?? []);
        this.seuils.set(res.data?.seuils ?? null);
        this.anomaliesChargees.set(true);
      },
      // Un echec de la detection ne doit pas empecher de consulter le
      // journal : c'est le journal qui porte la preuve, la detection n'est
      // qu'une aide a la lecture.
      error: () => this.anomaliesChargees.set(true),
    });
  }

  /** Depuis un signal, on va voir les lignes qui l'ont produit. */
  enqueterSur(a: AnomalieView) {
    this.reinitialiserCriteres();
    this.idUtilisateur.set(a.idUtilisateur);
    if (a.type === 'REFUS_REPETES') this.echecsSeulement.set(true);
    this.rechercher();
    document.querySelector('.journal-resultats')?.scrollIntoView({ behavior: 'smooth' });
  }

  private reinitialiserCriteres() {
    this.du.set('');
    this.au.set('');
    this.role.set('');
    this.ressource.set('');
    this.idPatient.set('');
    this.idUtilisateur.set('');
    this.echecsSeulement.set(false);
    this.parTiers.set(false);
  }

  rechercher(page = 1) {
    this.page.set(page);
    this.chargement.set(true);
    this.erreur.set('');

    this.admin.rechercherJournal(this.criteres()).subscribe({
      next: (res) => {
        const d = res.data;
        this.lignes.set(d?.lignes ?? []);
        this.total.set(d?.meta?.total ?? 0);
        this.totalPages.set(d?.meta?.totalPages ?? 0);
        this.maxExport.set(d?.maxExport ?? 0);
        this.chargement.set(false);
      },
      error: (err) => {
        this.chargement.set(false);
        this.erreur.set(this.messageDe(err));
      },
    });
  }

  reinitialiser() {
    this.reinitialiserCriteres();
    this.rechercher();
  }

  exporter() {
    this.exportEnCours.set(true);
    this.erreur.set('');

    this.admin.exporterJournal(this.criteres()).subscribe({
      next: (reponse) => {
        this.exportEnCours.set(false);
        const corps = reponse.body;
        if (!corps) return;
        // Le nom vient du serveur : il porte la date de l'export. Sans
        // `exposedHeaders` cote CORS, cet en-tete arrive a `null` — d'ou le
        // repli, qui ne doit pas servir.
        const entete = reponse.headers.get('Content-Disposition') ?? '';
        const trouve = /filename="([^"]+)"/.exec(entete);
        const nom = trouve?.[1] ?? `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`;

        const url = URL.createObjectURL(corps);
        const a = document.createElement('a');
        a.href = url;
        a.download = nom;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: async (err) => {
        this.exportEnCours.set(false);
        // La reponse d'erreur arrive en Blob, puisqu'on a demande un fichier :
        // sans ce decodage, le message du serveur — qui porte le nombre exact
        // de lignes — serait perdu, et l'operateur ne saurait pas de combien
        // resserrer sa recherche.
        this.erreur.set(await this.messageDeBlob(err));
      },
    });
  }

  /** Le libelle d'une ligne, traduit : l'API rend des cles. */
  libelle(l: LigneJournalView): string {
    const objet = l.libelleObjet ? this.i18n.t(l.libelleObjet) : '';
    return this.i18n.t(l.libelle, { objet });
  }

  private criteres(): FiltreJournalDto {
    return {
      du: this.du() || undefined,
      au: this.au() || undefined,
      role: (this.role() || undefined) as Role | undefined,
      ressource: this.ressource().trim() || undefined,
      idPatient: this.idPatient().trim() || undefined,
      idUtilisateur: this.idUtilisateur().trim() || undefined,
      echecsSeulement: this.echecsSeulement() || undefined,
      parTiers: (this.parTiersPossible() && this.parTiers()) || undefined,
      page: this.page(),
      limit: 50,
    };
  }

  private messageDe(err: unknown): string {
    const e = err as { error?: { error?: string; message?: string } };
    return e?.error?.error ?? e?.error?.message ?? this.i18n.t('ADMIN.JOURNAL.ERR_RECHERCHE');
  }

  private async messageDeBlob(err: unknown): Promise<string> {
    const e = err as { error?: unknown };
    if (e?.error instanceof Blob) {
      try {
        const corps = JSON.parse(await e.error.text()) as { error?: string; message?: string };
        return corps.error ?? corps.message ?? this.i18n.t('ADMIN.JOURNAL.ERR_EXPORT');
      } catch {
        return this.i18n.t('ADMIN.JOURNAL.ERR_EXPORT');
      }
    }
    return this.messageDe(err);
  }
}
