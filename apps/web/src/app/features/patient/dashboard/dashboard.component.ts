// features/patient/dashboard/dashboard.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { SeveriteVariantePipe } from '../../../shared/pipes/severite-variante.pipe';
import { MatIconModule } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PatientService } from '../../../core/services/patient.service';
import { ConsultationService } from '../../../core/services/consultation.service';
import { VaccinationService } from '../../../core/services/vaccination.service';
import { PaiementService } from '../../../core/services/paiement.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { Patient, Vaccination as ApiVaccination } from '../../../core/models/patient.model';
import type { FactureView } from '@baobaoheath/shared-types';
import type { HorodatageApi } from '@baobaoheath/shared-types';

// Interface alignée sur les champs utilisés dans le template HTML
interface Consultation {
  id: string;
  date: string;
  statut: string;
  motif?: string;
  asc?: { nom: string; prenom: string };
}

// Interface alignée sur les champs utilisés dans le template HTML
interface DashboardVaccination {
  id: string;
  vaccin: string;           
  dateAdministration: HorodatageApi;
  prochainRappel?: HorodatageApi | null;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    SeveriteVariantePipe,
    MatIconModule,CommonModule, RouterLink, TranslatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  private authService = inject(AuthService);
  private patientService = inject(PatientService);
  private vaccinationService = inject(VaccinationService);
  private paiementService = inject(PaiementService);
  private i18n = inject(I18nService);
  private consultationService = inject(ConsultationService);

  currentUser = this.authService.currentUser;

  patientProfil      = signal<Patient | null>(null);
  consultations      = signal<Consultation[]>([]); 
  vaccinations       = signal<DashboardVaccination[]>([]);
  factures           = signal<FactureView[]>([]);
  isLoading          = signal(true);
  errorMessage       = signal('');
  totalConsultations = signal(0);  
  totalVaccinations  = signal(0);
  prochainsRappels   = signal(0);

  ngOnInit() { this.loadDashboard(); }

  private loadDashboard() {
    this.isLoading.set(true);

    // Profil patient
    this.patientService.getMe().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.patientProfil.set(response.data);
        }
        this.isLoading.set(false);
      },
      error: () => { this.isLoading.set(false); }
    });

    // Consultations récentes
    this.patientService.getMyConsultations(5).subscribe({
      next: (response) => {
        const items = response?.data ?? [];
        const list: Consultation[] = items.map((c) => ({
          id: c.id,
          date: c.consulteeLE,
          statut: c.statut,
          motif: c.motifPrincipal,
          asc: c.asc ? { nom: c.asc.utilisateur.nom, prenom: c.asc.utilisateur.prenom } : undefined,
        }));
        this.consultations.set(list);
        // Le total pagine est dans meta, pas dans data (qui est le tableau).
        this.totalConsultations.set(response?.meta?.total ?? list.length);
      },
      error: () => {}
    });

    // Carnet vaccinal
    this.vaccinationService.getMyVaccinations().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const raw = response.data;
          const list: DashboardVaccination[] = raw.map((v: ApiVaccination) => ({
            id: v.id,
            vaccin: v.vaccinNom,
            dateAdministration: v.administreLe,
            prochainRappel: v.dateProchaineD
          }));
          this.vaccinations.set(list.slice(0, 3));
          this.totalVaccinations.set(list.length);
          
          const dans30j = new Date();
          dans30j.setDate(dans30j.getDate() + 30);
          this.prochainsRappels.set(
            list.filter(v => v.prochainRappel && new Date(v.prochainRappel) <= dans30j).length
          );
        }
      },
      error: () => {}
    });

    // Paiements 
    this.paiementService.getHistorique().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.factures.set(response.data.slice(0, 3));
        }
      },
      error: () => {}
    });
  }

  exportDossier() {
    this.patientService.exportDossier().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dossier-medical-${this.currentUser()?.nom ?? 'patient'}.json`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => {}
    });
  }

  getStatutSeverity(statut: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const map: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
      'TERMINEE':   'success',
      'EN_COURS':   'warn',
      'PLANIFIEE':  'info',
      'ANNULEE':    'danger',
      'REFERENCEE': 'secondary'
    };
    return map[statut] ?? 'secondary';
  }

  getStatutLabel(statut: string): string {
    const known = ['TERMINEE', 'EN_COURS', 'PLANIFIEE', 'ANNULEE', 'REFERENCEE'];
    return known.includes(statut) ? this.i18n.t(`STATUT.${statut}`) : statut;
  }

  /**
   * Le compte rendu d'une consultation achevee. Une consultation en cours
   * n'a pas encore de compte rendu a tendre au patient : il serait faux
   * demain.
   */
  peutImprimer(c: Consultation): boolean {
    return c.statut === 'TERMINEE' || c.statut === 'REFERENCEE';
  }

  imprimerCompteRendu(c: Consultation): void {
    window.open(this.consultationService.urlCompteRendu(c.id), '_blank', 'noopener');
  }

  getStatutFactureSeverity(statut: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    const map: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary'> = {
      'PAYEE':      'success',
      'EN_ATTENTE': 'warn',
      'PARTIELLE':  'info',
      'ANNULEE':    'danger',
      'REMBOURSEE': 'secondary'
    };
    return map[statut] ?? 'secondary';
  }

  formatDate(dateStr: HorodatageApi | null | undefined): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatMontant(montant: number): string {
    return new Intl.NumberFormat('fr-GN', {
      style: 'currency', currency: 'GNF', maximumFractionDigits: 0
    }).format(montant);
  }

  getInitiales(): string {
    const user = this.currentUser();
    const prenom = this.patientProfil()?.utilisateur?.prenom ?? this.patientProfil()?.prenom ?? user?.prenom ?? '';
    const nom    = this.patientProfil()?.utilisateur?.nom    ?? this.patientProfil()?.nom    ?? user?.nom    ?? '';
    return `${prenom.charAt(0)}${nom.charAt(0)}`.toUpperCase() || '??';
  }

  getAllergies(): string {
    const a = this.patientProfil()?.allergies;
    if (!a || a.length === 0) return 'Aucune allergie connue';
    return a.join(', ');
  }
}
