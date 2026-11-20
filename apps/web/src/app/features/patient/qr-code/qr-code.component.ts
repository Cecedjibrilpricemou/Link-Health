// features/patient/qr-code/qr-code.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PatientService } from '../../../core/services/patient.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { EspaceService } from '../../../shared/services/espace.service';
import { Patient } from '../../../core/models/patient.model';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import QRCode from 'qrcode';

@Component({
  selector: 'app-qr-code',
  standalone: true,
  imports: [
    MatIconModule, MatButtonModule,CommonModule, RouterLink, TranslatePipe, AvatarComponent],
  templateUrl: './qr-code.component.html',
  styleUrl: './qr-code.component.scss'
})
export class QrCodeComponent implements OnInit {
  private authService = inject(AuthService);
  private patientService = inject(PatientService);
  private i18n = inject(I18nService);
  /** La structure du patient : sa carte la lui rappelle. */
  readonly espace = inject(EspaceService).espace;

  currentUser  = this.authService.currentUser;
  patientInfo  = signal<Patient | null>(null);
  qrCodeUrl    = signal<string | null>(null); // data URL base64 générée côté frontend
  isLoading    = signal(true);
  errorMessage = signal('');

  ngOnInit() { this.loadPatient(); }

  private loadPatient() {
    this.isLoading.set(true);
    this.patientService.getMe().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          const info = response.data;
          this.patientInfo.set(info);

          // Générer le QR Code à partir de l'UUID reçu du backend
          if (info.qrCode) {
            this.generateQrCode(info.qrCode);
          } else {
            this.isLoading.set(false);
          }
        } else {
          this.isLoading.set(false);
        }
      },
      error: (err) => {
        this.errorMessage.set(err?.error?.error ?? err?.error?.message ?? 'Impossible de charger le QR Code.');
        this.isLoading.set(false);
      }
    });
  }

  private async generateQrCode(code: string) {
    try {
      const dataUrl = await QRCode.toDataURL(code, {
        width: 280,
        margin: 2,
        color: { dark: '#0F172A', light: '#ffffff' } // Use slate-900 for dark
      });
      this.qrCodeUrl.set(dataUrl);
    } catch (err) {
      this.errorMessage.set(this.i18n.t('PATIENT.QR.ERR_GENERATE'));
    } finally {
      this.isLoading.set(false);
    }
  }

  getInitiales(): string {
    const p = this.patientInfo();
    if (!p) return '??';
    return `${p.utilisateur?.prenom?.charAt(0) ?? p.prenom?.charAt(0) ?? ''}${p.utilisateur?.nom?.charAt(0) ?? p.nom?.charAt(0) ?? ''}`.toUpperCase();
  }

  formatDate(dateStr?: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  downloadQrCode() {
    const url = this.qrCodeUrl();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-code-${this.patientInfo()?.utilisateur?.nom ?? this.patientInfo()?.nom ?? 'patient'}.png`;
    a.click();
  }

  shareQrCode() {
    const url = this.qrCodeUrl();
    if (url && navigator.share) {
      navigator.share({ title: this.espace()?.estStructure ? `Mon QR Code — ${this.espace()!.nom}` : 'Mon QR Code', url }).catch(() => {});
    }
  }
}
