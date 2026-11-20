// features/laboratoire/demande-detail — poste de travail du laboratoire sur
// une demande : reception, planification et enregistrement du prelevement
// (EF-04-02/03), saisie des resultats (EF-04-04), validation nominative du
// laborantin (EF-04-05), compte rendu. Le role BIOLOGISTE a ete supprime
// le 2026-09-30 (addendum, point 4).
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
import type { DemandeAnalyseView, LieuPrelevement, LigneDemandeAnalyseView } from '@baobaoheath/shared-types';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { dateLocaleParDefaut, statutDemandeClasse, urgenceClasse } from '../../hopital/hopital.utils';
import { ETAPES_DEMANDE, apercuInterpretation, indexEtape, interpretationClasse, referenceLisible } from '../laboratoire.utils';
import { RACINE_LABO } from '../../../core/navigation/racines';

type Panneau = 'aucun' | 'planifier' | 'prelever' | 'valider';
type Saisie = { valeur: string; commentaire: string; idEchantillon: string };

@Component({
  selector: 'app-labo-demande-detail',
  standalone: true,
  imports: [RouterLink, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatDialogModule, TranslatePipe],
  templateUrl: './demande-detail.component.html',
  styleUrl: './demande-detail.component.scss',
})
export class LaboDemandeDetailComponent implements OnInit {
  /** /laboratoire, ou l'interface de l'administrateur : voir core/navigation/racines.ts. */
  readonly racine = inject(RACINE_LABO);

  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private labo   = inject(LaboratoireService);
  private auth   = inject(AuthService);
  private toastr = inject(ToastrService);
  private i18n   = inject(I18nService);
  private dialog = inject(MatDialog);

  readonly demandeClasse = statutDemandeClasse;
  readonly urgenceClasse = urgenceClasse;
  readonly lectureClasse = interpretationClasse;
  readonly reference = referenceLisible;
  readonly etapes = ETAPES_DEMANDE;
  readonly lieux: LieuPrelevement[] = ['SUR_PLACE', 'DOMICILE'];

  demande   = signal<DemandeAnalyseView | null>(null);
  isLoading = signal(true);
  isSaving  = signal(false);
  panneau   = signal<Panneau>('aucun');

  /** Qui peut valider : le laborantin, depuis la suppression du role biologiste. */
  readonly peutSigner = computed(() => this.auth.currentUser()?.role === 'TECHNICIEN_LABO');
  readonly etapeCourante = computed(() => { const d = this.demande(); return d ? indexEtape(d.statut) : -1; });
  /**
   * Saisir les resultats et imprimer le compte rendu : au laborantin. L'ecran
   * sert aussi l'administrateur de la structure, qui suit l'activite sans
   * lire les valeurs (l'API les lui retire, et refuse la saisie).
   */
  readonly peutSaisir = computed(() => {
    const s = this.demande()?.statut;
    return this.peutSigner() && (s === 'PRELEVEE' || s === 'EN_ANALYSE');
  });
  readonly toutSaisi = computed(() => { const d = this.demande(); return !!d && d.lignes.length > 0 && d.lignes.every((l) => l.resultat); });
  readonly peutValider = computed(() => this.peutSigner() && this.demande()?.statut === 'EN_ANALYSE' && this.toutSaisi());
  readonly saisieModifiee = computed(() => {
    const d = this.demande(); if (!d) return false;
    return d.lignes.some((l) => { const s = this.saisies()[l.id]; return s && (s.valeur.trim() !== (l.resultat?.valeur ?? '') || s.commentaire.trim() !== (l.resultat?.commentaire ?? '')); });
  });

  // Planification
  planification = { lieu: 'SUR_PLACE' as LieuPrelevement, avecCreneau: true, creneau: dateLocaleParDefaut() };
  // Prelevement : un echantillon par specimen, ajustable
  echantillons = signal<{ specimen: string; commentaire: string }[]>([]);
  lieuPrelevement: LieuPrelevement = 'SUR_PLACE';
  // Saisie des resultats, par ligne
  saisies = signal<Record<string, Saisie>>({});
  // Validation
  commentaireLaboratoire = '';

  ngOnInit() {
    this.charger(this.route.snapshot.paramMap.get('id')!);
  }

  private charger(id: string) {
    this.labo.getDemande(id).subscribe({
      next: (r) => { this.appliquer(r.data ?? null); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.erreur(err); this.router.navigate([this.racine + '/demandes']); },
    });
  }

  private appliquer(d: DemandeAnalyseView | null) {
    this.demande.set(d);
    if (!d) return;
    if (d.lieuPrelevement) { this.planification.lieu = d.lieuPrelevement; this.lieuPrelevement = d.lieuPrelevement; }
    if (this.echantillons().length === 0) {
      this.echantillons.set([...new Set(d.lignes.map((l) => l.examen.specimen))].map((specimen) => ({ specimen, commentaire: '' })));
    }
    const premier = d.echantillons[0]?.id ?? '';
    const saisies: Record<string, Saisie> = {};
    for (const l of d.lignes) {
      saisies[l.id] = { valeur: l.resultat?.valeur ?? '', commentaire: l.resultat?.commentaire ?? '', idEchantillon: d.echantillons.find((e) => e.code === l.resultat?.codeEchantillon)?.id ?? d.echantillons.find((e) => e.specimen === l.examen.specimen)?.id ?? premier };
    }
    this.saisies.set(saisies);
  }

  private erreur(err: unknown) {
    const e = err as { error?: { error?: string } };
    this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE'));
  }

  private succes(cle: string, params?: Record<string, string | number>) {
    this.toastr.success(this.i18n.t(cle, params), this.i18n.t('COMMON.SUCCESS'));
  }

  ouvrir(p: Panneau) { this.panneau.set(this.panneau() === p ? 'aucun' : p); }

  // ── Reception ─────────────────────────────────────────────────────────
  accuserReception() {
    const d = this.demande(); if (!d || this.isSaving()) return;
    this.isSaving.set(true);
    this.labo.accuserReception(d.id).subscribe({
      next: (r) => { this.isSaving.set(false); this.appliquer(r.data ?? d); this.succes('LABO.DETAIL.RECEPTION_OK'); },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // ── Planification (EF-04-02) ──────────────────────────────────────────
  planifier() {
    const d = this.demande(); if (!d || this.isSaving()) return;
    this.isSaving.set(true);
    const p = this.planification;
    this.labo.planifierPrelevement(d.id, { lieu: p.lieu, creneau: p.avecCreneau ? new Date(p.creneau).toISOString() : undefined }).subscribe({
      next: (r) => { this.isSaving.set(false); this.appliquer(r.data ?? d); this.panneau.set('aucun'); this.succes('LABO.DETAIL.PLANIFIE_OK'); },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // ── Prelevement (EF-04-03) ────────────────────────────────────────────
  ajouterEchantillon() { this.echantillons.update((l) => [...l, { specimen: '', commentaire: '' }]); }
  retirerEchantillon(i: number) { this.echantillons.update((l) => l.filter((_, k) => k !== i)); }
  majEchantillon(i: number, champ: 'specimen' | 'commentaire', valeur: string) {
    this.echantillons.update((l) => l.map((e, k) => (k === i ? { ...e, [champ]: valeur } : e)));
  }

  prelever() {
    const d = this.demande(); if (!d || this.isSaving()) return;
    const echantillons = this.echantillons().map((e) => ({ specimen: e.specimen.trim(), commentaire: e.commentaire.trim() || undefined })).filter((e) => e.specimen.length >= 2);
    if (echantillons.length === 0) return;
    this.isSaving.set(true);
    this.labo.enregistrerPrelevement(d.id, { echantillons, lieu: this.lieuPrelevement }).subscribe({
      next: (r) => { this.isSaving.set(false); this.appliquer(r.data ?? d); this.panneau.set('aucun'); this.succes('LABO.DETAIL.PRELEVE_OK', { n: r.data?.echantillons.length ?? 0 }); },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // ── Saisie des resultats (EF-04-04) ───────────────────────────────────
  majSaisie(idLigne: string, champ: keyof Saisie, valeur: string) {
    this.saisies.update((s) => ({ ...s, [idLigne]: { ...s[idLigne], [champ]: valeur } }));
  }

  apercu(l: LigneDemandeAnalyseView) {
    return apercuInterpretation(this.saisies()[l.id]?.valeur ?? '', l.examen);
  }

  enregistrerResultats() {
    const d = this.demande(); if (!d || this.isSaving()) return;
    const resultats = d.lignes
      .map((l) => ({ l, s: this.saisies()[l.id] }))
      .filter(({ s }) => s && s.valeur.trim())
      .map(({ l, s }) => ({ idLigne: l.id, valeur: s.valeur.trim(), commentaire: s.commentaire.trim() || undefined, idEchantillon: s.idEchantillon || undefined }));
    if (resultats.length === 0) return;
    this.isSaving.set(true);
    this.labo.saisirResultats(d.id, { resultats }).subscribe({
      next: (r) => { this.isSaving.set(false); this.appliquer(r.data ?? d); this.succes('LABO.DETAIL.SAISIE_OK', { n: resultats.length }); },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // ── Validation (EF-04-05) ─────────────────────────────────────────────
  valider() {
    const d = this.demande(); if (!d || this.isSaving() || !this.peutValider()) return;
    const critiques = d.lignes.filter((l) => l.resultat?.interpretation === 'CRITIQUE').length;
    const data: ConfirmDialogData = {
      titre: this.i18n.t('LABO.DETAIL.VALIDER_CONFIRM_TITLE'),
      texte: this.i18n.t(critiques ? 'LABO.DETAIL.VALIDER_CONFIRM_CRITIQUE' : 'LABO.DETAIL.VALIDER_CONFIRM_TEXT', { n: critiques }),
      confirmer: this.i18n.t('LABO.DETAIL.ACTION_VALIDER'),
      annuler: this.i18n.t('COMMON.CANCEL'),
      icone: 'pi-verified',
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '420px', autoFocus: false }).afterClosed().subscribe((ok) => {
      if (!ok) return;
      this.isSaving.set(true);
      this.labo.validerResultats(d.id, { commentaire: this.commentaireLaboratoire.trim() || undefined }).subscribe({
        next: (r) => { this.isSaving.set(false); this.appliquer(r.data ?? d); this.panneau.set('aucun'); this.succes('LABO.DETAIL.VALIDE_OK'); },
        error: (err) => { this.isSaving.set(false); this.erreur(err); },
      });
    });
  }

  compteRendu() { const d = this.demande(); if (d) this.labo.ouvrirCompteRendu(d.id, 'labo'); }

  initiales(d: DemandeAnalyseView): string {
    return `${d.patient.prenom.charAt(0)}${d.patient.nom.charAt(0)}`.toUpperCase();
  }
}
