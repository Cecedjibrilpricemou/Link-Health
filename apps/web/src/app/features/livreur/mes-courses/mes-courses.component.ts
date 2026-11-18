import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import QRCode from 'qrcode';
import type { AdresseLivraisonView, CourseLivreurView } from '@baobaoheath/shared-types';
import { CourseService } from '../../../core/services/course.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

@Component({
  selector: 'app-livreur-mes-courses',
  standalone: true,
  imports: [CommonModule, DatePipe, TranslatePipe],
  templateUrl: './mes-courses.component.html',
  styleUrl: './mes-courses.component.scss',
})
export class LivreurMesCoursesComponent implements OnInit {
  private readonly coursesService = inject(CourseService);
  private readonly toastr = inject(ToastrService);
  private readonly i18n = inject(I18nService);

  readonly courses = signal<CourseLivreurView[]>([]);
  readonly qrCode = signal('');
  readonly qrImage = signal('');
  readonly qrError = signal(false);
  readonly chargement = signal(true);

  ngOnInit(): void {
    this.charger();
  }

  charger(): void {
    this.chargement.set(true);
    this.coursesService.mesCourses().subscribe({
      next: (response) => {
        const data = response.data;
        this.courses.set(data?.courses ?? []);
        this.qrCode.set(data?.qrCode ?? '');
        this.chargement.set(false);
        if (data?.qrCode) void this.genererQr(data.qrCode);
      },
      error: (error: unknown) => {
        this.chargement.set(false);
        const response = error as { error?: { error?: string } };
        this.toastr.error(response?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  libelleStatut(statut: string): string {
    return this.i18n.t(`LIVREUR.STATUT_${statut}`);
  }

  /** « Kipé, Ratoma » : le quartier d'abord, c'est lui qui guide sur place. */
  lieuDe(a: AdresseLivraisonView): string {
    return [a.quartier, a.commune].filter((x): x is string => !!x?.trim()).join(', ');
  }

  /**
   * M3 : l'itineraire jusqu'au patient, quand il a donne sa position. Les
   * coordonnees sont des nombres venus de l'API : elles ne peuvent rien
   * injecter d'autre dans le lien.
   */
  lienItineraire(a: AdresseLivraisonView): string | null {
    if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}`;
  }

  private async genererQr(code: string): Promise<void> {
    this.qrError.set(false);
    try {
      this.qrImage.set(await QRCode.toDataURL(code, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#FFFFFF' },
      }));
    } catch {
      this.qrImage.set('');
      this.qrError.set(true);
    }
  }
}
