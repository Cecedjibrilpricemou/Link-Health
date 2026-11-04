// features/admin/analytics/analytics.component.ts
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { SeveriteVariantePipe } from '../../../shared/pipes/severite-variante.pipe';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { AdminService } from '../../../core/services/admin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { PlateformeService } from '../../../shared/services/plateforme.service';
import type {
  AlerteEpidemiqueView,
  CouvertureVaccinView,
  CouvertureVaccinaleView,
  DashboardAnalyticsView,
  HeatmapPointView,
  NiveauAlerte,
  TendanceView,
} from '@baobaoheath/shared-types';

// Formes derivees cote client, sans equivalent dans une reponse d'API.
interface StructureCount {
  type: string;
  count: number;
}

interface StatsStructures {
  total: number;
  parType: StructureCount[];
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [
    SeveriteVariantePipe,
    CommonModule, FormsModule, RouterLink, TranslatePipe,
    MatCardModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatSelectModule
    ],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss'
})
export class AnalyticsComponent implements OnInit {
  private adminService = inject(AdminService);
  private i18n = inject(I18nService);
  readonly plateforme = inject(PlateformeService);

  dashboard = signal<DashboardAnalyticsView | null>(null);
  heatmap = signal<HeatmapPointView[]>([]);
  alertes = signal<AlerteEpidemiqueView[]>([]);
  tendances = signal<TendanceView[]>([]);
  couverture = signal<CouvertureVaccinView[]>([]);
  statsStructures = signal<StatsStructures | null>(null);

  isLoadingDash = signal(true);
  isLoadingHeatmap = signal(true);
  isLoadingAlertes = signal(true);
  isLoadingTend = signal(true);
  isLoadingCouv = signal(true);
  isLoadingStructures = signal(true);

  activeTab = signal<'kpis' | 'heatmap' | 'alertes' | 'tendances' | 'vaccins'>('kpis');

  readonly tabs = [
    { id: 'kpis'      as const, icon: 'pi-home',                  labelKey: 'ADMIN.ANALYTICS.TAB_OVERVIEW'  },
    { id: 'heatmap'   as const, icon: 'pi-map',                   labelKey: 'ADMIN.ANALYTICS.TAB_HEATMAP'   },
    { id: 'alertes'   as const, icon: 'pi-exclamation-triangle',  labelKey: 'ADMIN.ANALYTICS.TAB_ALERTES'   },
    { id: 'tendances' as const, icon: 'pi-chart-line',            labelKey: 'ADMIN.ANALYTICS.TAB_TENDANCES' },
    { id: 'vaccins'   as const, icon: 'pi-heart',                 labelKey: 'ADMIN.ANALYTICS.TAB_VACCINS'   }
  ];

  /**
   * Échelle des barres de tendance. Sans normalisation, le compteur brut était
   * utilisé comme pourcentage : au-delà de 100 consultations la barre débordait.
   */
  readonly maxTendance = computed(() => {
    const valeurs = this.tendances().flatMap(t => [t.consultations, t.vaccinations]);
    return Math.max(1, ...valeurs);
  });

  /** Cartes de synthèse — la première est mise en avant (fond plein). */
  readonly kpiCards = computed(() => {
    const k = this.dashboard()?.kpis;
    return [
      { labelKey: 'ADMIN.ANALYTICS.KPI_PATIENTS', defKey: 'ADMIN.ANALYTICS.DEF_PATIENTS',       valeur: k?.totalPatients ?? 0,       icon: 'pi-users',      couleur: '#3EBB70' },
      { labelKey: 'ADMIN.ANALYTICS.KPI_CONSULTATIONS', defKey: 'ADMIN.ANALYTICS.DEF_CONSULTATIONS',  valeur: k?.totalConsultations ?? 0,  icon: 'pi-heart-fill', couleur: '#22C55E' },
      { labelKey: 'ADMIN.ANALYTICS.KPI_VACCINATIONS', defKey: 'ADMIN.ANALYTICS.DEF_VACCINATIONS',   valeur: k?.totalVaccinations ?? 0,   icon: 'pi-shield',     couleur: '#8B5CF6' },
      { labelKey: 'ADMIN.ANALYTICS.KPI_REFERENCEMENTS', defKey: 'ADMIN.ANALYTICS.DEF_REFERENCEMENTS', valeur: k?.totalReferencements ?? 0, icon: 'pi-send',       couleur: '#F97316' },
      { labelKey: 'ADMIN.ANALYTICS.KPI_ASC', defKey: 'ADMIN.ANALYTICS.DEF_ASC',            valeur: k?.totalAsc ?? 0,            icon: 'pi-user',       couleur: '#14B8A6' }
    ];
  });

  /**
   * Part des patients ayant recu au moins une dose.
   *
   * Le calcul divisait le nombre de **doses** par le nombre de patients :
   * 25 doses pour 10 patients affichaient 100 %, quand 4 patients seulement
   * etaient vaccines.
   */
  readonly tauxVaccination = computed(() => {
    const k = this.dashboard()?.kpis;
    if (!k?.totalPatients) return 0;
    return Math.min(100, Math.round(((k.patientsVaccines ?? 0) / k.totalPatients) * 100));
  });

  /** Arc de la jauge : rayon 52 -> circonférence ≈ 326.7. */
  readonly gaugeDasharray = computed(() => {
    const circonference = 2 * Math.PI * 52;
    const rempli = (this.tauxVaccination() / 100) * circonference;
    return `${rempli} ${circonference - rempli}`;
  });

  get prefiltreOptions() {
    return [
      { label: this.i18n.t('ADMIN.ANALYTICS.PREFILTRE_ALL'), value: '' },
      { label: 'Conakry', value: 'Conakry' },
      { label: 'Kindia', value: 'Kindia' },
      { label: 'Boké', value: 'Boké' },
      { label: 'Mamou', value: 'Mamou' },
      { label: 'Labé', value: 'Labé' },
      { label: 'Faranah', value: 'Faranah' },
      { label: 'Kankan', value: 'Kankan' },
      { label: 'Nzérékoré', value: 'Nzérékoré' }
    ];
  }
  prefiltreSelectionne = '';

  // Partial : un type de structure inconnu doit retomber sur sa valeur brute (??).
  get typeLabels(): Partial<Record<string, string>> {
    return {
      'CHU': this.i18n.t('ADMIN.ANALYTICS.TYPE_GROUP_CHU'),
      'HOPITAL_REG': this.i18n.t('ADMIN.ANALYTICS.TYPE_GROUP_HOPITAL_REG'),
      'HOPITAL_PREF': this.i18n.t('ADMIN.ANALYTICS.TYPE_GROUP_HOPITAL_PREF'),
      'CENTRE': this.i18n.t('ADMIN.ANALYTICS.TYPE_GROUP_CENTRE'),
      'POSTE': this.i18n.t('ADMIN.ANALYTICS.TYPE_GROUP_POSTE'),
      'CLINIQUE': this.i18n.t('ADMIN.ANALYTICS.TYPE_GROUP_CLINIQUE'),
      'PHARMACIE': this.i18n.t('ADMIN.ANALYTICS.TYPE_GROUP_PHARMACIE')
    };
  }

  readonly typeColors: Record<string, string> = {
    'CHU': '#EF4444',
    'HOPITAL_REG': '#F97316',
    'HOPITAL_PREF': '#EAB308',
    'CENTRE': '#3B82F6',
    'POSTE': '#8B5CF6',
    'CLINIQUE': '#22C55E',
    'PHARMACIE': '#3EBB70'
  };

  ngOnInit() { this.loadAll(); }

  loadAll() {
    this.loadDashboard();
    this.loadHeatmap();
    this.loadAlertes();
    this.loadTendances();
    this.loadCouverture();
    this.loadStatsStructures();
  }

  private loadDashboard() {
    this.isLoadingDash.set(true);
    const params = this.prefiltreSelectionne ? { prefecture: this.prefiltreSelectionne } : undefined;
    this.adminService.getAnalyticsDashboard(params).subscribe({
      next: (response) => { 
        if (response.success && response.data) this.dashboard.set(response.data as DashboardAnalyticsView);
        this.isLoadingDash.set(false); 
      },
      error: () => { this.isLoadingDash.set(false); }
    });
  }

  private loadHeatmap() {
    this.isLoadingHeatmap.set(true);
    this.adminService.getAnalyticsHeatmap().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const points = (Array.isArray(response.data) ? response.data : []) as HeatmapPointView[];
          this.heatmap.set([...points].sort((a, b) => b.count - a.count));
        }
        this.isLoadingHeatmap.set(false);
      },
      error: () => { this.isLoadingHeatmap.set(false); }
    });
  }

  private loadAlertes() {
    this.isLoadingAlertes.set(true);
    this.adminService.getAnalyticsAlertes().subscribe({
      next: (response) => { 
        if (response.success && response.data) this.alertes.set(response.data as AlerteEpidemiqueView[]);
        this.isLoadingAlertes.set(false); 
      },
      error: () => { this.isLoadingAlertes.set(false); }
    });
  }

  private loadTendances() {
    this.isLoadingTend.set(true);
    this.adminService.getAnalyticsTendances().subscribe({
      next: (response) => { 
        // Un cast seul ne protège de rien : @for sur un non-itérable lève une
        // TypeError qui vide tout l'onglet. On vérifie donc la forme reçue.
        const donnees = response.data as unknown;
        this.tendances.set(Array.isArray(donnees) ? (donnees as TendanceView[]) : []);
        this.isLoadingTend.set(false);
      },
      error: () => { this.isLoadingTend.set(false); }
    });
  }

  private loadCouverture() {
    this.isLoadingCouv.set(true);
    this.adminService.getAnalyticsCouverture().subscribe({
      next: (response) => { 
        const donnees = response.data as unknown as CouvertureVaccinaleView | undefined;
        this.couverture.set(Array.isArray(donnees?.couverture) ? donnees.couverture : []);
        this.isLoadingCouv.set(false);
      },
      error: () => { this.isLoadingCouv.set(false); }
    });
  }

  // ── Utilise la route publique accessible sans restriction de rôle
  private loadStatsStructures() {
    this.isLoadingStructures.set(true);
    this.adminService.getPublicStructures().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const structures = response.data;
          const counts = new Map<string, number>();
          // `type` est garanti par StructurePubliqueView : plus besoin de le
          // supposer par transtypage.
          structures.forEach((s) => {
            counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
          });
          const parType: StructureCount[] = Array.from(counts.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
          this.statsStructures.set({ total: structures.length, parType });
        }
        this.isLoadingStructures.set(false);
      },
      error: () => { this.isLoadingStructures.set(false); }
    });
  }

  onPrefiltreChange() { this.loadDashboard(); this.loadHeatmap(); }

  getTypeIcon(type: string): string {
    const map: Record<string, string> = {
      'CHU': 'pi-building', 'HOPITAL_REG': 'pi-building',
      'HOPITAL_PREF': 'pi-building', 'CENTRE': 'pi-heart-fill',
      'POSTE': 'pi-home', 'CLINIQUE': 'pi-plus-circle',
      'PHARMACIE': 'pi-box'
    };
    return map[type] ?? 'pi-building';
  }

  getTypeLabel(type: string): string { return this.typeLabels[type] ?? type; }
  getTypeColor(type: string): string { return this.typeColors[type] ?? '#6B7280'; }

  getStatutLabel(s: string): string {
    const known = ['EN_COURS', 'TERMINEE', 'PLANIFIEE', 'ANNULEE', 'REFERENCEE'];
    return known.includes(s) ? this.i18n.t(`STATUT.${s}`) : s;
  }

  getStatutColor(s: string): string {
    const map: Record<string, string> = {
      'EN_COURS': '#F97316', 'TERMINEE': '#22C55E',
      'PLANIFIEE': '#3B82F6', 'ANNULEE': '#EF4444', 'REFERENCEE': '#8B5CF6'
    };
    return map[s] ?? '#6B7280';
  }

  getBarWidth(count: number, max: number): number {
    return max > 0 ? Math.round((count / max) * 100) : 0;
  }

  getMaxHeatmap(): number { return Math.max(...this.heatmap().map(p => p.count), 1); }

  /**
   * Intensite de la tuile portee par le fond seul.
   *
   * L'opacite s'appliquait auparavant a toute la tuile : une prefecture a
   * faible volume voyait son libelle tomber a 30% d'opacite, illisible. Un
   * vert translucide se pose aussi bien sur le fond clair que sombre.
   */
  getHeatBackground(count: number): string {
    const ratio = this.getBarWidth(count, this.getMaxHeatmap()) / 100;
    return `rgba(62, 187, 112, ${(0.12 + ratio * 0.36).toFixed(3)})`;
  }
  getMaxPathologie(): number { return Math.max(...(this.dashboard()?.topPathologies ?? []).map(p => p.count), 1); }
  getMaxStatut(): number { return Math.max(...(this.dashboard()?.consultationsParStatut ?? []).map(s => s.count), 1); }
  getMaxStructure(): number { return Math.max(...(this.statsStructures()?.parType ?? []).map(s => s.count), 1); }

  getAlerteSeverity(niveau: NiveauAlerte): 'danger' | 'warn' | 'info' {
    if (niveau === 'URGENCE') return 'danger';
    if (niveau === 'ALERTE') return 'warn';
    return 'info';
  }

  getAlerteNiveauLabel(niveau: NiveauAlerte): string {
    return this.i18n.t('ADMIN.ANALYTICS.ALERTE_NIVEAU_' + niveau);
  }
}