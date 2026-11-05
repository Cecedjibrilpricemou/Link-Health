// features/patient/rendez-vous — demander un rendez-vous depuis chez soi.
//
// Addendum du 2026-09-28, point 6. Le patient n'ouvre pas un dossier : il
// demande. C'est le médecin qui répond en fixant l'heure, et c'est à ce
// moment-là seulement qu'une visite existe.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { DemandeRendezVousView, StatutDemandeRendezVous, StructurePubliqueView } from '@baobaoheath/shared-types';
import { AdminService } from '../../../core/services/admin.service';

import { PatientService } from '../../../core/services/patient.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { DicteeComponent } from '../../../shared/components/dictee/dictee.component';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';

@Component({
  selector: 'app-patient-rendez-vous',
  standalone: true,
  imports: [DicteeComponent, ListeRechercheComponent, DatePipe, FormsModule, MatButtonModule, TranslatePipe, ExportListeComponent],
  templateUrl: './rendez-vous.component.html',
  styleUrl: './rendez-vous.component.scss',
})
export class RendezVousComponent implements OnInit {
  /** Les etablissements, avec recherche (nom ou prefecture). */
  readonly optionsEtablissements = computed<OptionListe[]>(() =>
    this.etablissements().map((e) => ({ valeur: e.id, libelle: e.nom, detail: e.prefecture })));

  private patient = inject(PatientService);
  private structures = inject(AdminService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  demandes = signal<DemandeRendezVousView[]>([]);

  /** De quoi se presenter a l'accueil : l'etablissement, le medecin, le bureau. */
  readonly colonnes: ColonneExport<DemandeRendezVousView>[] = [
    { titre: 'EXPORT.COL.ETABLISSEMENT', valeur: (d) => d.structure.nom },
    { titre: 'EXPORT.COL.PREFECTURE', valeur: (d) => d.structure.prefecture },
    { titre: 'EXPORT.COL.MEDECIN', valeur: (d) => (d.medecin ? d.medecin.prenom + ' ' + d.medecin.nom : '') },
    { titre: 'EXPORT.COL.BUREAU', valeur: (d) => d.medecin?.bureau },
    { titre: 'EXPORT.COL.MOTIF', valeur: (d) => d.motif },
    { titre: 'EXPORT.COL.STATUT', valeur: (d) => d.statut },
    { titre: 'EXPORT.COL.DEMANDEE_LE', valeur: (d) => new Date(d.creeLe) },
    { titre: 'EXPORT.COL.EPISODE', valeur: (d) => d.numeroEpisode },
  ];
  isLoading = signal(true);
  enCours = signal(false);

  formulaireOuvert = signal(false);
  motif = '';

  /**
   * L'etablissement ou le patient veut etre vu. Le dossier peut en porter un
   * par defaut, mais pas toujours : sans ce choix, l'API refuse la demande et
   * l'ecran n'offrait aucun moyen de la completer.
   */
  etablissements = signal<StructurePubliqueView[]>([]);
  idStructure = '';

  /**
   * Une seule demande en attente à la fois : l'API le refuse, autant ne pas
   * proposer un bouton qui échouera.
   */
  readonly enAttente = computed(() => this.demandes().find((d) => d.statut === 'EN_ATTENTE') ?? null);
  readonly historique = computed(() => this.demandes().filter((d) => d.statut !== 'EN_ATTENTE'));

  ngOnInit() {
    this.charger();
    this.structures.getPublicStructures().subscribe({
      next: (r) => this.etablissements.set(r.data ?? []),
    });
  }

  private charger() {
    this.isLoading.set(true);
    this.patient.mesDemandesRendezVous().subscribe({
      next: (r) => {
        this.demandes.set(r.data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.i18n.t('PATIENT.RDV.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
      },
    });
  }

  private erreur(err: unknown, cleParDefaut: string) {
    const e = err as { status?: number; error?: { error?: string } };
    this.toastr.error(
      e?.status === 0
        ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
        : e?.error?.error ?? this.i18n.t(cleParDefaut),
      this.i18n.t('COMMON.ERROR_TITLE')
    );
  }

  envoyer() {
    const motif = this.motif.trim();
    if (this.enCours() || motif.length < 5) return;
    this.enCours.set(true);

    this.patient.creerDemandeRendezVous({
      motif,
      idStructure: this.idStructure || undefined,
    }).subscribe({
      next: () => {
        this.enCours.set(false);
        this.formulaireOuvert.set(false);
        this.motif = '';
        this.idStructure = '';
        this.toastr.success(this.i18n.t('PATIENT.RDV.OK'), this.i18n.t('COMMON.SUCCESS'));
        this.charger();
      },
      error: (err) => {
        this.enCours.set(false);
        this.erreur(err, 'PATIENT.RDV.ERR_ENVOI');
      },
    });
  }

  annuler(d: DemandeRendezVousView) {
    if (this.enCours()) return;
    this.enCours.set(true);
    this.patient.annulerDemandeRendezVous(d.id).subscribe({
      next: () => {
        this.enCours.set(false);
        this.charger();
      },
      error: (err) => {
        this.enCours.set(false);
        this.erreur(err, 'PATIENT.RDV.ERR_ANNULER');
        this.charger();
      },
    });
  }

  libelleStatut(s: StatutDemandeRendezVous): string {
    return this.i18n.t('PATIENT.RDV.STATUT.' + s);
  }
}
