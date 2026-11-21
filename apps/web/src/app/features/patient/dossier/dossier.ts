import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { SeveriteVariantePipe } from '../../../shared/pipes/severite-variante.pipe';
import { PatientService } from '../../../core/services/patient.service';
import { VaccinationService } from '../../../core/services/vaccination.service';
import { Consultation, Vaccination } from '../../../core/models/patient.model';
import type { HorodatageApi } from '@baobaoheath/shared-types';
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

interface TimelineItem {
  date: string;
  type: string;
  medecin: string;
  diagnostic: string;
  statut: string;
  color: string;
  icon: string;
  /** Variante de badge, alignee sur la couleur du marqueur. */
  variante: string;
}

interface VaccinItem {
  nom: string;
  date: string;
  statut: string;
  severity: 'success' | 'warn' | 'danger';
}

const STATUT_STYLE: Record<string, { statutKey: string; color: string; icon: string; variante: string }> = {
  TERMINEE:   { statutKey: 'STATUT.TERMINEE',   color: '#3EBB70', icon: 'pi pi-check',      variante: 'success' },
  EN_COURS:   { statutKey: 'STATUT.EN_COURS',   color: '#F59E0B', icon: 'pi pi-clock',      variante: 'warning' },
  PLANIFIEE:  { statutKey: 'STATUT.PLANIFIEE',  color: '#3B82F6', icon: 'pi pi-calendar',   variante: 'info' },
  ANNULEE:    { statutKey: 'STATUT.ANNULEE',    color: '#EF4444', icon: 'pi pi-times',      variante: 'danger' },
  REFERENCEE: { statutKey: 'STATUT.REFERENCEE', color: '#8B5CF6', icon: 'pi pi-share-alt',  variante: 'neutral' },
};

@Component({
  selector: 'app-dossier',
  standalone: true,
  imports: [
    CommonModule, RouterLink, TranslatePipe,
    MatCardModule, MatButtonModule, MatIconModule, SeveriteVariantePipe,
  ],
  templateUrl: './dossier.html',
  styleUrl: './dossier.scss',
})
export class Dossier implements OnInit {
  private patientService = inject(PatientService);
  private vaccinationService = inject(VaccinationService);
  private i18n = inject(I18nService);

  isExporting = signal(false);

  /** GET /patients/me/export : le dossier complet, telecharge tel que renvoye par l'API. */
  exportDossier() {
    if (this.isExporting()) return;
    this.isExporting.set(true);
    this.patientService.exportDossier().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dossier-medical.json';
        a.click();
        URL.revokeObjectURL(url);
        this.isExporting.set(false);
      },
      error: () => { this.isExporting.set(false); }
    });
  }

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  historique = signal<TimelineItem[]>([]);
  vaccins = signal<VaccinItem[]>([]);

  ngOnInit() {
    this.loadHistorique();
    this.loadVaccins();
  }

  private loadHistorique() {
    this.patientService.getMyConsultations(20).subscribe({
      next: (response) => {
        const items = response?.data ?? [];
        this.historique.set(items.map((c) => this.toTimelineItem(c)));
      },
      error: () => {},
    });
  }

  private toTimelineItem(c: Consultation): TimelineItem {
    const style = STATUT_STYLE[c.statut];
    const label = style ? this.i18n.t(style.statutKey) : c.statut;
    // L'API renvoie medecinValideur (contrat ConsultationView) ; `medecin`
    // est la forme historique de certains ecrans.
    const medecin = c.medecinValideur ?? c.medecin?.utilisateur;
    // « Dr » pour le medecin seul : une sage-femme n'est pas docteur. Sans
    // role connu (forme historique), l'usage d'avant.
    const titre = medecin && 'role' in medecin && medecin.role === 'SAGE_FEMME' ? '' : `${this.i18n.t('PATIENT.DOSSIER.DOCTOR_PREFIX')} `;
    const intervenant = medecin
      ? `${titre}${medecin.prenom} ${medecin.nom}`
      : c.asc?.utilisateur
        ? `${this.i18n.t('PATIENT.DOSSIER.AGENT_PREFIX')} ${c.asc.utilisateur.prenom} ${c.asc.utilisateur.nom}`
        : '—';
    return {
      date: this.formatDate(c.consulteeLE),
      type: c.motifPrincipal || this.i18n.t('PATIENT.DOSSIER.DEFAULT_MOTIF'),
      medecin: intervenant,
      diagnostic: c.diagnostics?.[0]?.libelle ?? this.i18n.t('PATIENT.DOSSIER.DIAGNOSTIC_NOT_SPECIFIED'),
      statut: label,
      color: style?.color ?? '#64748B',
      icon: style?.icon ?? 'pi pi-circle',
      variante: style?.variante ?? 'neutral',
    };
  }

  private loadVaccins() {
    this.vaccinationService.getMyVaccinations().subscribe({
      next: (response) => {
        const items = response?.data ?? [];
        this.vaccins.set(items.map((v) => this.toVaccinItem(v)));
      },
      error: () => {},
    });
  }

  private toVaccinItem(v: Vaccination): VaccinItem {
    const rappel = v.dateProchaineD;
    let statut: VaccinItem['statut'] = this.i18n.t('PATIENT.DOSSIER.VACCIN_UP_TO_DATE');
    let severity: VaccinItem['severity'] = 'success';
    if (rappel) {
      if (new Date(rappel) < new Date()) {
        statut = this.i18n.t('PATIENT.DOSSIER.VACCIN_LATE');
        severity = 'danger';
      } else {
        statut = this.i18n.t('PATIENT.DOSSIER.VACCIN_REMINDER_PLANNED');
        severity = 'warn';
      }
    }
    return {
      nom: v.vaccinNom,
      date: this.formatDate(v.administreLe),
      statut,
      severity,
    };
  }

  private formatDate(dateStr: HorodatageApi | null | undefined): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
