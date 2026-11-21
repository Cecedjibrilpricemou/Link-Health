// features/medecin/demandes — les demandes de rendez-vous venues de chez le
// patient (addendum du 2026-09-28, point 6).
//
// Accepter, c'est fixer l'heure : ce geste ouvre la visite. Refuser demande un
// motif — un refus sans explication est un mur.
import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { DemandeRendezVousView } from '@baobaoheath/shared-types';

import { MedecinService } from '../../../core/services/medecin.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { roleDeLEspace } from '../../../shared/utils/role-espace';

type Panneau = { id: string; mode: 'accepter' | 'refuser' } | null;

@Component({
  selector: 'app-medecin-demandes',
  standalone: true,
  imports: [DatePipe, FormsModule, MatButtonModule, TranslatePipe, ExportListeComponent],
  templateUrl: './demandes.component.html',
  styleUrl: './demandes.component.scss',
})
export class DemandesComponent implements OnInit {
  /** « Médecin » ou « Sage-femme » : l'etiquette de l'espace suit le metier. */
  readonly roleEspace = roleDeLEspace();
  private service = inject(MedecinService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  demandes = signal<DemandeRendezVousView[]>([]);

  readonly colonnes: ColonneExport<DemandeRendezVousView>[] = [
    { titre: 'EXPORT.COL.PATIENT', valeur: (d) => `${d.patient.prenom} ${d.patient.nom}` },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (d) => d.patient.telephone },
    { titre: 'EXPORT.COL.MOTIF', valeur: (d) => d.motif },
    { titre: 'EXPORT.COL.STATUT', valeur: (d) => d.statut },
    { titre: 'EXPORT.COL.DEMANDEE_LE', valeur: (d) => new Date(d.creeLe) },
    { titre: 'EXPORT.COL.TRAITEE_LE', valeur: (d) => (d.traiteeLe ? new Date(d.traiteeLe) : null) },
    { titre: 'EXPORT.COL.MOTIF_REFUS', valeur: (d) => d.motifRefus },
    { titre: 'EXPORT.COL.EPISODE', valeur: (d) => d.numeroEpisode },
  ];
  isLoading = signal(true);
  enCours = signal<string | null>(null);

  panneau = signal<Panneau>(null);
  quand = '';
  motifRefus = '';

  ngOnInit() {
    this.charger();
  }

  private charger() {
    this.isLoading.set(true);
    this.service.mesDemandesRendezVous().subscribe({
      next: (r) => {
        this.demandes.set(r.data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.i18n.t('MEDECIN.DEMANDES.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
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

  ouvrir(id: string, mode: 'accepter' | 'refuser') {
    const p = this.panneau();
    if (p?.id === id && p.mode === mode) { this.panneau.set(null); return; }
    this.panneau.set({ id, mode });
    this.quand = this.creneauParDefaut();
    this.motifRefus = '';
  }

  estOuvert(id: string, mode: 'accepter' | 'refuser'): boolean {
    const p = this.panneau();
    return p?.id === id && p.mode === mode;
  }

  /** Demain à 9 h : une proposition plausible, pas une contrainte. */
  private creneauParDefaut(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const n = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())}T${n(d.getHours())}:${n(d.getMinutes())}`;
  }

  accepter(d: DemandeRendezVousView) {
    if (this.enCours() || !this.quand) return;
    this.enCours.set(d.id);
    this.service.accepterDemandeRendezVous(d.id, { prevuLe: new Date(this.quand).toISOString() }).subscribe({
      next: () => {
        this.enCours.set(null);
        this.panneau.set(null);
        this.toastr.success(
          this.i18n.t('MEDECIN.DEMANDES.OK_ACCEPTEE', { patient: `${d.patient.prenom} ${d.patient.nom}` }),
          this.i18n.t('COMMON.SUCCESS')
        );
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        this.erreur(err, 'MEDECIN.DEMANDES.ERR_ACCEPTER');
        this.charger();
      },
    });
  }

  refuser(d: DemandeRendezVousView) {
    const motif = this.motifRefus.trim();
    if (this.enCours() || motif.length < 5) return;
    this.enCours.set(d.id);
    this.service.refuserDemandeRendezVous(d.id, motif).subscribe({
      next: () => {
        this.enCours.set(null);
        this.panneau.set(null);
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        this.erreur(err, 'MEDECIN.DEMANDES.ERR_REFUSER');
        this.charger();
      },
    });
  }

  /** Depuis combien de jours le patient attend une réponse. */
  joursDAttente(creeLe: string | Date): number {
    return Math.max(0, Math.floor((Date.now() - new Date(creeLe).getTime()) / 86_400_000));
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
