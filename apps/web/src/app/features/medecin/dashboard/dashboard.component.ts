// features/medecin/dashboard/dashboard.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MedecinService } from '../../../core/services/medecin.service';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import type { ConsultationAValiderView, HorodatageApi, MedecinDashboardView } from '@baobaoheath/shared-types';
import { roleDeLEspace } from '../../../shared/utils/role-espace';

@Component({
  selector: 'app-medecin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class MedecinDashboardComponent implements OnInit {
  /** « Médecin » ou « Sage-femme » : l'etiquette de l'espace suit le metier. */
  readonly roleEspace = roleDeLEspace();
  private medecinService = inject(MedecinService);
  private authService    = inject(AuthService);

  currentUser          = this.authService.currentUser;
  stats                = signal<MedecinDashboardView | null>(null);
  consultationsRecentes = signal<ConsultationAValiderView[]>([]);
  isLoading            = signal(true);

  ngOnInit() { this.loadDashboard(); }

  private loadDashboard() {
    this.isLoading.set(true);

    // Stats dashboard
    this.medecinService.getDashboard().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.stats.set(response.data as unknown as MedecinDashboardView);
        }
        this.isLoading.set(false);
      },
      error: () => { this.isLoading.set(false); }
    });

    // Consultations récentes à valider
    this.medecinService.getConsultationsRecentes().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.consultationsRecentes.set(response.data as unknown as ConsultationAValiderView[]);
        }
      },
      error: () => {}
    });
  }

  getPatientNom(c: ConsultationAValiderView): string {
    const u = c.patient?.utilisateur;
    return u ? `${u.prenom} ${u.nom}` : '—';
  }

  getAscNom(c: ConsultationAValiderView): string {
    const u = c.asc?.utilisateur;
    return u ? `${u.prenom} ${u.nom}` : '—';
  }

  getInitiales(): string {
    const u = this.currentUser();
    if (!u) return '??';
    return `${u.prenom?.charAt(0) ?? ''}${u.nom?.charAt(0) ?? ''}`.toUpperCase();
  }

  formatDate(d: HorodatageApi): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
