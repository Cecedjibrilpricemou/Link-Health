// features/medecin/dossier — le dossier de la visite, vu par le médecin.
//
// Bloc 2 de l'addendum du 2026-09-28 : c'est le médecin qui prescrit les
// analyses, plus l'agent d'accueil. Jusqu'ici le seul écran permettant de le
// faire était celui de l'accueil — côté API le médecin avait déjà le droit,
// c'est l'écran qui manquait.
//
// Le médecin arrive ici depuis ses orientations ou ses résultats à libérer.
//
// **La visite, sans rien demander ; l'historique, sur l'accord du patient.**
// Le panneau « Historique » dit où en est cet accord (demandé avec le
// rendez-vous), permet de relancer une fois par jour, et rappelle la seule
// autre porte : le bris de glace, déclaré et relu.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import type {
  DemandeAnalyseView, EpisodeSoinsView, EtatAccesDossierView, ExamenView, HistoriquePatientView, Urgence,
} from '@baobaoheath/shared-types';

import { HopitalService } from '../../../core/services/hopital.service';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { MedecinService } from '../../../core/services/medecin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ChoixLaboratoireComponent, ChoixLaboratoire } from '../../../shared/components/choix-laboratoire/choix-laboratoire.component';
import { statutDemandeClasse, statutEpisodeClasse, urgenceClasse } from '../../hopital/hopital.utils';
import { interpretationClasse, referenceLisible } from '../../laboratoire/laboratoire.utils';

@Component({
  selector: 'app-medecin-dossier',
  standalone: true,
  imports: [
    RouterLink, DatePipe, FormsModule,
    MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDialogModule,
    ChoixLaboratoireComponent, TranslatePipe,
  ],
  templateUrl: './dossier.component.html',
  styleUrl: './dossier.component.scss',
})
export class DossierComponent implements OnInit {
  private route   = inject(ActivatedRoute);
  private router  = inject(Router);
  private hopital = inject(HopitalService);
  private labo    = inject(LaboratoireService);
  private medecin = inject(MedecinService);
  private toastr  = inject(ToastrService);
  private i18n    = inject(I18nService);
  private dialog  = inject(MatDialog);

  readonly statutClasse  = statutEpisodeClasse;
  readonly demandeClasse = statutDemandeClasse;
  readonly urgenceClasse = urgenceClasse;
  readonly lectureClasse = interpretationClasse;
  readonly reference     = referenceLisible;

  episode   = signal<EpisodeSoinsView | null>(null);
  isLoading = signal(true);
  isSaving  = signal(false);
  prescrit  = signal(false);
  ouvre     = signal(false);

  readonly termine = computed(() => {
    const s = this.episode()?.statut;
    return s === 'CLOS' || s === 'ANNULE';
  });

  examens = signal<ExamenView[]>([]);

  // ── L'historique, sur l'accord du patient ─────────────────────────
  acces = signal<EtatAccesDossierView | null>(null);
  historique = signal<HistoriquePatientView | null>(null);
  historiqueOuvert = signal(false);
  chargeHistorique = signal(false);
  relance = signal(false);

  demande = { urgence: 'ROUTINE' as Urgence, indicationClinique: '', consignesPatient: '' };
  filtreExamens = signal('');
  selection = signal<Map<string, string>>(new Map());

  /** Le laboratoire retenu, avec ce qu'il ne sait pas faire. */
  laboChoisi = signal<ChoixLaboratoire | null>(null);

  /** Ce que la couverture regarde : les examens coches, et eux seuls. */
  readonly examensIds = computed(() => [...this.selection().keys()]);
  readonly urgences: Urgence[] = ['ROUTINE', 'URGENT', 'URGENCE_VITALE'];

  /** Les examens groupés par catégorie : 33 lignes à plat seraient illisibles. */
  readonly examensFiltres = computed(() => {
    const q = this.filtreExamens().trim().toLowerCase();
    const liste = q
      ? this.examens().filter((e) =>
          e.libelle.toLowerCase().includes(q) || e.codeLoinc.includes(q) || e.categorie.toLowerCase().includes(q))
      : this.examens();
    const groupes = new Map<string, ExamenView[]>();
    for (const e of liste) groupes.set(e.categorie, [...(groupes.get(e.categorie) ?? []), e]);
    return [...groupes.entries()].map(([categorie, items]) => ({ categorie, items }));
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.charger(id);
    this.hopital.listerExamens().subscribe({ next: (r) => this.examens.set(r.data ?? []) });
  }

  private charger(id: string) {
    this.hopital.getEpisode(id).subscribe({
      next: (r) => {
        this.episode.set(r.data ?? null);
        this.isLoading.set(false);
        if (r.data) this.chargerAcces(r.data.patient.id);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.erreur(err);
        this.router.navigate(['/medecin/orientations']);
      },
    });
  }

  private erreur(err: unknown) {
    const e = err as { status?: number; error?: { error?: string; message?: string } };
    if (e?.status === 0) {
      this.toastr.error(this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    this.toastr.error(
      e?.error?.error ?? e?.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
      this.i18n.t('COMMON.ERROR_TITLE')
    );
  }

  // ── L'historique du patient ──────────────────────────────────────
  private chargerAcces(idPatient: string) {
    this.medecin.getAccesDossier(idPatient).subscribe({
      next: (r) => this.acces.set(r.data ?? null),
      // L'état de l'accord est un plus : son absence n'empêche pas de soigner.
      error: () => this.acces.set(null),
    });
  }

  basculerHistorique() {
    const ep = this.episode();
    if (!ep) return;
    if (this.historiqueOuvert()) { this.historiqueOuvert.set(false); return; }
    this.historiqueOuvert.set(true);
    if (this.historique() || this.chargeHistorique()) return;
    this.chargeHistorique.set(true);
    this.medecin.getHistoriquePatient(ep.patient.id).subscribe({
      next: (r) => { this.historique.set(r.data ?? null); this.chargeHistorique.set(false); },
      error: (err) => {
        this.chargeHistorique.set(false);
        this.historiqueOuvert.set(false);
        this.erreur(err);
        // Retiré entre-temps : l'état affiché doit le dire.
        this.chargerAcces(ep.patient.id);
      },
    });
  }

  relancer() {
    const ep = this.episode();
    if (!ep || this.relance()) return;
    this.relance.set(true);
    this.medecin.relancerAccesDossier(ep.patient.id).subscribe({
      next: (r) => {
        this.relance.set(false);
        this.acces.set(r.data ?? this.acces());
        this.toastr.success(this.i18n.t('MEDECIN.DOSSIER.HISTORIQUE.RELANCE_OK'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.relance.set(false); this.erreur(err); },
    });
  }

  // ── La consultation ──────────────────────────────────────────────
  //
  // **Le pas qui manquait au parcours hospitalier.** Le patient demande un
  // rendez-vous, l'accueil l'oriente, le medecin fixe l'heure, le patient
  // arrive — et la, plus rien : `POST /consultations` est reserve a l'ASC. Le
  // medecin avait la visite sous les yeux et aucun moyen d'y consulter.
  //
  // L'ecran qui suit est **celui de l'ASC**, qui ne depend d'aucun service
  // propre a ce role et s'adapte au role appelant.
  ouvrirConsultation() {
    const ep = this.episode();
    if (!ep || this.ouvre()) return;
    this.ouvre.set(true);
    this.hopital.ouvrirConsultation(ep.id).subscribe({
      next: (r) => {
        this.ouvre.set(false);
        const id = r.data?.id;
        if (id) this.router.navigate(['/medecin/consultations', id]);
      },
      error: (err) => { this.ouvre.set(false); this.erreur(err); },
    });
  }

  // ── Prescription d'analyses ──────────────────────────────────────
  basculerExamen(e: ExamenView) {
    const s = new Map(this.selection());
    if (s.has(e.id)) s.delete(e.id); else s.set(e.id, '');
    this.selection.set(s);
  }
  examenChoisi(id: string) { return this.selection().has(id); }

  // **On ne bloque pas, on fait dire qu'on a vu.** Un laboratoire a couverture
  // partielle reste un choix defendable -- le medecin peut savoir ce que le
  // plateau declare ignore, ou vouloir ce laboratoire pour le reste. Mais les
  // examens qui ne seront pas realises sont **nommes** : « etes-vous sur ? » ne
  // dit rien, et c'est le patient qui paierait le deplacement.
  creerDemande() {
    const labo = this.laboChoisi();
    if (!this.episode() || this.isSaving() || !labo || this.selection().size === 0) return;
    if (labo.nonCouverts.length === 0) { this.envoyer(labo.id); return; }

    const data: ConfirmDialogData = {
      titre: this.i18n.t('LABO.CHOIX.PARTIEL_TITRE'),
      texte: this.i18n.t('LABO.CHOIX.PARTIEL_TEXTE', {
        labo: labo.nom,
        examens: labo.nonCouverts.map((e) => e.libelle).join(', '),
      }),
      confirmer: this.i18n.t('LABO.CHOIX.PARTIEL_OK'),
      annuler: this.i18n.t('COMMON.CANCEL'),
      icone: 'pi-exclamation-triangle',
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '440px', autoFocus: false })
      .afterClosed().subscribe((ok) => { if (ok) this.envoyer(labo.id); });
  }

  private envoyer(idLaboratoire: string) {
    const ep = this.episode();
    if (!ep) return;
    this.isSaving.set(true);
    this.hopital.creerDemandeAnalyse(ep.id, {
      idLaboratoire,
      urgence: this.demande.urgence,
      indicationClinique: this.demande.indicationClinique.trim() || undefined,
      consignesPatient: this.demande.consignesPatient.trim() || undefined,
      examens: [...this.selection().entries()].map(([idExamen, commentaire]) => ({
        idExamen, commentaire: commentaire.trim() || undefined,
      })),
    }).subscribe({
      next: (r) => {
        this.isSaving.set(false);
        this.toastr.success(
          this.i18n.t('HOPITAL.DETAIL.DA_SUCCESS', { numero: r.data?.numero ?? '' }),
          this.i18n.t('COMMON.SUCCESS')
        );
        this.selection.set(new Map());
        this.laboChoisi.set(null);
        this.demande.indicationClinique = '';
        this.demande.consignesPatient = '';
        this.demande.urgence = 'ROUTINE';
        this.prescrit.set(false);
        this.charger(ep.id);
      },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // ── Résultats ────────────────────────────────────────────────────
  bonExamen(d: DemandeAnalyseView) { this.hopital.ouvrirBonExamen(d.id); }
  compteRendu(d: DemandeAnalyseView) { this.labo.ouvrirCompteRendu(d.id, 'prescripteur'); }
  aResultats(d: DemandeAnalyseView) { return d.lignes.some((l) => l.resultat); }

  /** Validés par le laboratoire mais que le patient ne voit pas encore. */
  aLiberer(d: DemandeAnalyseView) { return d.statut === 'VALIDEE' && !d.diffuseePatientLe; }

  // ── Clôture ──────────────────────────────────────────────────────
  // Depuis l'addendum, c'est le médecin qui ferme l'épisode : lui seul sait
  // quand la prise en charge est finie.
  cloturer() {
    const ep = this.episode();
    if (!ep) return;
    const data: ConfirmDialogData = {
      titre: this.i18n.t('HOPITAL.DETAIL.ACTION_CLOTURER'),
      texte: this.i18n.t('MEDECIN.DOSSIER.CLOTURER_CONFIRM'),
      confirmer: this.i18n.t('COMMON.CONFIRM'),
      annuler: this.i18n.t('COMMON.CANCEL'),
      icone: 'pi-lock',
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '400px', autoFocus: false })
      .afterClosed().subscribe((ok) => {
        if (!ok) return;
        this.hopital.cloturerEpisode(ep.id).subscribe({
          next: (r) => {
            this.episode.set(r.data ?? ep);
            this.toastr.success(this.i18n.t('HOPITAL.DETAIL.EPISODE_CLOS'), this.i18n.t('COMMON.SUCCESS'));
          },
          error: (err) => this.erreur(err),
        });
      });
  }

  age(dateNaissance: string | Date): number | null {
    const n = new Date(dateNaissance);
    if (Number.isNaN(n.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - n.getFullYear();
    if (now < new Date(now.getFullYear(), n.getMonth(), n.getDate())) a -= 1;
    return a;
  }
}
