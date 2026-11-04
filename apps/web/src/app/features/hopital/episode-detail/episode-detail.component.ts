// features/hopital/episode-detail — un episode : orientation (EF-03-05),
// demandes d'analyse (EF-03-03/04/06), cloture.
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
import type { DemandeAnalyseView, EpisodeSoinsView, ExamenView, Urgence } from '@baobaoheath/shared-types';
import { HopitalService, MedecinRefView } from '../../../core/services/hopital.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ChoixLaboratoireComponent, ChoixLaboratoire } from '../../../shared/components/choix-laboratoire/choix-laboratoire.component';
import { statutDemandeClasse, statutEpisodeClasse, urgenceClasse } from '../hopital.utils';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { interpretationClasse, referenceLisible } from '../../laboratoire/laboratoire.utils';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';

type Panneau = 'aucun' | 'orientation' | 'analyse';

@Component({
  selector: 'app-hopital-episode-detail',
  standalone: true,
  imports: [ListeRechercheComponent, RouterLink, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDialogModule, ChoixLaboratoireComponent, TranslatePipe],
  templateUrl: './episode-detail.component.html',
})
export class EpisodeDetailComponent implements OnInit {
  /** Les medecins : on cherche par nom ou par specialite. */
  readonly optionsMedecins = computed<OptionListe[]>(() =>
    this.medecins().map((m) => ({ valeur: m.id, libelle: `Dr ${m.prenom} ${m.nom}`, detail: m.specialite ?? undefined })));

  private route   = inject(ActivatedRoute);
  private router  = inject(Router);
  private hopital = inject(HopitalService);
  private labo    = inject(LaboratoireService);
  private toastr  = inject(ToastrService);
  private i18n    = inject(I18nService);
  private dialog  = inject(MatDialog);
  private auth    = inject(AuthService);

  /**
   * Addendum du 2026-09-28 : l'agent d'accueil ne fait plus rien de medical.
   * Il ouvre l'episode, oriente et pointe ; prescrire, lire un resultat et
   * cloturer sont passes au medecin. L'API refuse deja ces appels — masquer
   * les boutons evite de lui proposer des actions qui echoueront.
   *
   * L'ecran reste partage avec l'administrateur de structure, qui les garde.
   */
  readonly estAccueil = computed(() => this.auth.currentUser()?.role === 'AGENT_ACCUEIL');

  readonly statutClasse = statutEpisodeClasse;
  readonly demandeClasse = statutDemandeClasse;
  readonly urgenceClasse = urgenceClasse;
  readonly lectureClasse = interpretationClasse;
  readonly reference = referenceLisible;

  episode   = signal<EpisodeSoinsView | null>(null);
  isLoading = signal(true);
  isSaving  = signal(false);
  panneau   = signal<Panneau>('aucun');

  readonly termine = computed(() => { const s = this.episode()?.statut; return s === 'CLOS' || s === 'ANNULE'; });

  // Referentiels (charges une fois)
  medecins = signal<MedecinRefView[]>([]);
  examens  = signal<ExamenView[]>([]);

  // Orientation
  // Plus de date ici : le medecin fixe le creneau (addendum, point 3).
  orientation = { idMedecin: '', service: '', motif: '' };

  // Demande d'analyse
  demande = { urgence: 'ROUTINE' as Urgence, indicationClinique: '', consignesPatient: '' };

  /** Le laboratoire retenu, avec ce qu'il ne sait pas faire. */
  laboChoisi = signal<ChoixLaboratoire | null>(null);

  /** Ce que la couverture regarde : les examens coches, et eux seuls. */
  readonly examensIds = computed(() => [...this.selection().keys()]);

  filtreExamens = signal('');
  selection = signal<Map<string, string>>(new Map()); // idExamen -> commentaire
  readonly examensFiltres = computed(() => {
    const q = this.filtreExamens().trim().toLowerCase();
    const liste = q ? this.examens().filter((e) => e.libelle.toLowerCase().includes(q) || e.codeLoinc.includes(q) || e.categorie.toLowerCase().includes(q)) : this.examens();
    const groupes = new Map<string, ExamenView[]>();
    for (const e of liste) groupes.set(e.categorie, [...(groupes.get(e.categorie) ?? []), e]);
    return [...groupes.entries()].map(([categorie, items]) => ({ categorie, items }));
  });
  readonly urgences: Urgence[] = ['ROUTINE', 'URGENT', 'URGENCE_VITALE'];

  // Annulation d'une demande
  demandeAAnnuler = signal<DemandeAnalyseView | null>(null);
  motifAnnulation = '';

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.charger(id);
    this.hopital.listerMedecins().subscribe({ next: (r) => this.medecins.set(r.data ?? []) });
    this.hopital.listerExamens().subscribe({ next: (r) => this.examens.set(r.data ?? []) });
  }

  private charger(id: string) {
    this.hopital.getEpisode(id).subscribe({
      next: (r) => { this.episode.set(r.data ?? null); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.erreur(err); this.router.navigate(['/hopital/episodes']); },
    });
  }

  private erreur(err: unknown) {
    const e = err as { error?: { error?: string } };
    this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE'));
  }

  ouvrir(p: Panneau) { this.panneau.set(this.panneau() === p ? 'aucun' : p); }

  // ── Orientation ────────────────────────────────────────────────
  orienter() {
    const ep = this.episode();
    if (!ep || this.isSaving()) return;
    const o = this.orientation;
    if (!o.idMedecin && !o.service.trim()) return;
    this.isSaving.set(true);
    this.hopital.orienter(ep.id, {
      idMedecin: o.idMedecin || undefined,
      service: o.service.trim() || undefined,
      motif: o.motif.trim() || undefined,
    }).subscribe({
      next: (r) => { this.isSaving.set(false); this.episode.set(r.data ?? ep); this.panneau.set('aucun'); this.toastr.success(this.i18n.t('HOPITAL.DETAIL.ORIENT_SUCCESS'), this.i18n.t('COMMON.SUCCESS')); },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // ── Demande d'analyse ──────────────────────────────────────────
  basculerExamen(e: ExamenView) {
    const s = new Map(this.selection());
    if (s.has(e.id)) s.delete(e.id); else s.set(e.id, '');
    this.selection.set(s);
  }
  commenterExamen(id: string, commentaire: string) {
    const s = new Map(this.selection()); s.set(id, commentaire); this.selection.set(s);
  }
  examenChoisi(id: string) { return this.selection().has(id); }

  // Un laboratoire a couverture partielle reste un choix defendable, mais les
  // examens qui ne seront pas realises sont **nommes** avant l'envoi : sinon
  // c'est le patient qui decouvre le probleme, sur place, apres le trajet.
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
      examens: [...this.selection().entries()].map(([idExamen, commentaire]) => ({ idExamen, commentaire: commentaire.trim() || undefined })),
    }).subscribe({
      next: (r) => {
        this.isSaving.set(false);
        this.toastr.success(this.i18n.t('HOPITAL.DETAIL.DA_SUCCESS', { numero: r.data?.numero ?? '' }), this.i18n.t('COMMON.SUCCESS'));
        this.selection.set(new Map()); this.laboChoisi.set(null);
        this.demande.indicationClinique = ''; this.demande.consignesPatient = ''; this.demande.urgence = 'ROUTINE';
        this.panneau.set('aucun');
        this.charger(ep.id);
      },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  bonExamen(d: DemandeAnalyseView) { this.hopital.ouvrirBonExamen(d.id); }
  compteRendu(d: DemandeAnalyseView) { this.labo.ouvrirCompteRendu(d.id, 'prescripteur'); }
  aResultats(d: DemandeAnalyseView) { return d.lignes.some((l) => l.resultat); }
  peutAnnulerDemande(d: DemandeAnalyseView) { return d.statut === 'TRANSMISE' || d.statut === 'RECUE'; }

  confirmerAnnulationDemande() {
    const d = this.demandeAAnnuler(); const ep = this.episode();
    if (!d || !ep || this.motifAnnulation.trim().length < 3 || this.isSaving()) return;
    this.isSaving.set(true);
    this.hopital.annulerDemande(d.id, this.motifAnnulation.trim()).subscribe({
      next: () => { this.isSaving.set(false); this.demandeAAnnuler.set(null); this.motifAnnulation = ''; this.toastr.success(this.i18n.t('HOPITAL.DETAIL.DEMANDE_ANNULEE'), this.i18n.t('COMMON.SUCCESS')); this.charger(ep.id); },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // ── Cloture / annulation ───────────────────────────────────────
  cloturer(annuler: boolean) {
    const ep = this.episode();
    if (!ep) return;
    const data: ConfirmDialogData = {
      titre: this.i18n.t(annuler ? 'HOPITAL.DETAIL.ACTION_ANNULER' : 'HOPITAL.DETAIL.ACTION_CLOTURER'),
      texte: this.i18n.t(annuler ? 'HOPITAL.DETAIL.ANNULER_CONFIRM' : 'HOPITAL.DETAIL.CLOTURER_CONFIRM'),
      confirmer: this.i18n.t('COMMON.CONFIRM'),
      annuler: this.i18n.t('COMMON.CANCEL'),
      icone: annuler ? 'pi-times-circle' : 'pi-lock',
      danger: annuler,
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '400px', autoFocus: false }).afterClosed().subscribe((ok) => {
      if (!ok) return;
      const appel = annuler ? this.hopital.annulerEpisode(ep.id) : this.hopital.cloturerEpisode(ep.id);
      appel.subscribe({
        next: (r) => { this.episode.set(r.data ?? ep); this.toastr.success(this.i18n.t(annuler ? 'HOPITAL.DETAIL.EPISODE_ANNULE' : 'HOPITAL.DETAIL.EPISODE_CLOS'), this.i18n.t('COMMON.SUCCESS')); },
        error: (err) => this.erreur(err),
      });
    });
  }

  initiales(ep: EpisodeSoinsView): string {
    return `${ep.patient.prenom.charAt(0)}${ep.patient.nom.charAt(0)}`.toUpperCase();
  }
}
