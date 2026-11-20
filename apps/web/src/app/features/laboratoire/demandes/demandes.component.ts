// features/laboratoire/demandes — file des demandes du laboratoire, triee
// par urgence puis anciennete (EF-04-01), filtrable par etape.
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ToastrService } from 'ngx-toastr';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import type { DemandeAnalyseView, ScanLaboratoireView, StatutDemandeAnalyse } from '@baobaoheath/shared-types';
import { LaboratoireService } from '../../../core/services/laboratoire.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { statutDemandeClasse, urgenceClasse } from '../../hopital/hopital.utils';
import { nbResultatsSaisis } from '../laboratoire.utils';
import { QrScannerComponent } from '../../../shared/components/qr-scanner/qr-scanner.component';
import { RACINE_LABO } from '../../../core/navigation/racines';

type Filtre = 'TOUS' | StatutDemandeAnalyse;

@Component({
  selector: 'app-labo-demandes',
  standalone: true,
  imports: [RouterLink, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, TranslatePipe, QrScannerComponent, ExportListeComponent],
  templateUrl: './demandes.component.html',
})
export class LaboDemandesComponent implements OnInit {
  /** /laboratoire, ou l'interface de l'administrateur : voir core/navigation/racines.ts. */
  readonly racine = inject(RACINE_LABO);

  private labo   = inject(LaboratoireService);
  private route  = inject(ActivatedRoute);
  private toastr = inject(ToastrService);
  private i18n   = inject(I18nService);

  readonly filtres: Filtre[] = ['TOUS', 'TRANSMISE', 'RECUE', 'PRELEVEE', 'EN_ANALYSE', 'VALIDEE', 'ANNULEE'];
  readonly demandeClasse = statutDemandeClasse;
  readonly urgenceClasse = urgenceClasse;
  readonly nbSaisis = nbResultatsSaisis;

  filtre    = signal<Filtre>('TOUS');
  recherche = '';
  page      = signal(1);
  limit     = 20;
  total     = signal(0);
  items     = signal<DemandeAnalyseView[]>([]);

  /**
   * La file du laboratoire, sur une feuille de paillasse.
   *
   * **Les resultats n'y sont pas, seulement les examens demandes.** Une
   * feuille de paillasse sert a savoir quoi prelever et pour qui ; les
   * valeurs appartiennent au compte rendu, pas a la file.
   */
  readonly colonnes: ColonneExport<DemandeAnalyseView>[] = [
    { titre: 'EXPORT.COL.NUMERO', valeur: (d) => d.numero },
    { titre: 'EXPORT.COL.PATIENT', valeur: (d) => d.patient.prenom + ' ' + d.patient.nom },
    { titre: 'EXPORT.COL.URGENCE', valeur: (d) => d.urgence },
    { titre: 'EXPORT.COL.STATUT', valeur: (d) => d.statut },
    { titre: 'EXPORT.COL.EXAMENS', valeur: (d) => d.lignes.length, nombre: true },
    { titre: 'EXPORT.COL.PRESCRIPTEUR', valeur: (d) => d.prescripteur.prenom + ' ' + d.prescripteur.nom },
    { titre: 'EXPORT.COL.EPISODE', valeur: (d) => d.numeroEpisode },
    { titre: 'EXPORT.COL.PRELEVEMENT', valeur: (d) => d.lieuPrelevement },
    { titre: 'EXPORT.COL.CRENEAU', valeur: (d) => (d.creneauPrelevement ? new Date(d.creneauPrelevement) : null) },
    { titre: 'EXPORT.COL.TRANSMISE_LE', valeur: (d) => (d.transmiseLe ? new Date(d.transmiseLe) : null) },
    { titre: 'EXPORT.COL.VALIDEE_LE', valeur: (d) => (d.valideeLe ? new Date(d.valideeLe) : null) },
  ];
  isLoading = signal(true);

  /**
   * Scan du QR patient au comptoir. Le laborantin voit ce qui reste a faire
   * pour ce patient dans son laboratoire, sans le chercher dans la file.
   */
  showScanner = signal(false);
  scan = signal<ScanLaboratoireView | null>(null);

  ouvrirScanner() {
    this.scan.set(null);
    this.showScanner.set(true);
  }

  onQrDetecte(qrCode: string) {
    this.showScanner.set(false);
    this.labo.scanPatient(qrCode).subscribe({
      next: (r) => this.scan.set(r.data ?? null),
      error: (err) => {
        const e = err as { status?: number; error?: { error?: string } };
        this.toastr.error(
          e?.status === 0
            ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
            : e?.error?.error ?? this.i18n.t('LABO.SCAN_ERREUR'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
      },
    });
  }

  private terme$ = new Subject<string>();

  ngOnInit() {
    const statut = this.route.snapshot.queryParamMap.get('statut') as Filtre | null;
    if (statut && this.filtres.includes(statut)) this.filtre.set(statut);
    this.terme$.pipe(debounceTime(300), distinctUntilChanged()).subscribe(() => { this.page.set(1); this.charger(); });
    this.charger();
  }

  charger() {
    this.isLoading.set(true);
    this.labo.fileDesDemandes({ statut: this.filtre() === 'TOUS' ? undefined : this.filtre(), q: this.recherche.trim() || undefined, page: this.page(), limit: this.limit }).subscribe({
      next: (r) => { this.items.set(r.data?.items ?? []); this.total.set(r.data?.total ?? 0); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE')); },
    });
  }

  setFiltre(f: Filtre) { this.filtre.set(f); this.page.set(1); this.charger(); }
  onRecherche(v: string) { this.recherche = v; this.terme$.next(v); }
  pageSuivante() { if (this.page() * this.limit < this.total()) { this.page.update((p) => p + 1); this.charger(); } }
  pagePrecedente() { if (this.page() > 1) { this.page.update((p) => p - 1); this.charger(); } }
  get nbPages() { return Math.max(1, Math.ceil(this.total() / this.limit)); }

  initiales(d: DemandeAnalyseView): string {
    return `${d.patient.prenom.charAt(0)}${d.patient.nom.charAt(0)}`.toUpperCase();
  }
}
