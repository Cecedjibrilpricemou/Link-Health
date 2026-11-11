// L'adresse du patient (M3), dans son profil.
//
// La commune et le quartier decident a quelles pharmacies part son ordonnance.
// Le point de repere guide le motard la ou les rues n'ont pas de nom. La
// position n'est prise que d'un geste du patient, lui est montree avant
// d'etre enregistree, et s'efface quand il le veut.
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { AdressePatientView, DefinirAdresseDto } from '@baobaoheath/shared-types';
import { ToastrService } from 'ngx-toastr';
import { PatientService } from '../../../../core/services/patient.service';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../../shared/services/i18n.service';

@Component({
  selector: 'app-adresse-patient',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule, TranslatePipe],
  templateUrl: './adresse.component.html',
  styleUrl: './adresse.component.scss',
})
export class AdressePatientComponent implements OnInit {
  private patientService = inject(PatientService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  adresse = signal<AdressePatientView | null>(null);
  enregistrement = signal(false);
  gpsEnCours = signal(false);
  erreurGps = signal<string | null>(null);
  /** La position captee, pas encore enregistree : le patient la voit avant. */
  positionProposee = signal<{ latitude: number; longitude: number } | null>(null);

  form = { commune: '', quartier: '', pointRepere: '' };

  ngOnInit() {
    this.patientService.monAdresse().subscribe({
      next: (res) => { if (res.data) this.appliquer(res.data); },
      error: () => { /* l'adresse reste vide : le patient peut la saisir */ },
    });
  }

  get complete(): boolean {
    return !!this.form.commune.trim() && !!this.form.quartier.trim();
  }

  /** Une position est-elle deja enregistree ? */
  get positionEnregistree(): boolean {
    const a = this.adresse();
    return a?.latitude != null && a.longitude != null;
  }

  utiliserMaPosition() {
    if (!navigator.geolocation) {
      this.erreurGps.set(this.i18n.t('PATIENT.ADRESSE.GPS_ERR'));
      return;
    }
    this.gpsEnCours.set(true);
    this.erreurGps.set(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.positionProposee.set({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
        });
        this.gpsEnCours.set(false);
      },
      () => {
        this.gpsEnCours.set(false);
        this.erreurGps.set(this.i18n.t('PATIENT.ADRESSE.GPS_ERR'));
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  oublierPositionProposee() {
    this.positionProposee.set(null);
  }

  enregistrer() {
    if (!this.complete || this.enregistrement()) return;
    const position = this.positionProposee();
    this.envoyer({
      commune: this.form.commune.trim(),
      quartier: this.form.quartier.trim(),
      pointRepere: this.form.pointRepere.trim(),
      ...(position ?? {}),
    }, 'PATIENT.ADRESSE.SUCCESS');
  }

  /** Retire la position enregistree ; commune, quartier et repere restent. */
  effacerPosition() {
    const a = this.adresse();
    if (!a?.commune || !a.quartier || this.enregistrement()) return;
    this.envoyer({
      commune: a.commune,
      quartier: a.quartier,
      pointRepere: a.pointRepere ?? '',
      effacerPosition: true,
    }, 'PATIENT.ADRESSE.POSITION_EFFACEE');
  }

  private envoyer(dto: DefinirAdresseDto, cleSucces: string) {
    this.enregistrement.set(true);
    this.patientService.definirAdresse(dto).subscribe({
      next: (res) => {
        this.enregistrement.set(false);
        if (res.data) this.appliquer(res.data);
        this.positionProposee.set(null);
        this.toastr.success(this.i18n.t(cleSucces));
      },
      error: (err) => {
        this.enregistrement.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('PATIENT.ADRESSE.ERR_SAVE'));
      },
    });
  }

  private appliquer(a: AdressePatientView) {
    this.adresse.set(a);
    this.form = { commune: a.commune ?? '', quartier: a.quartier ?? '', pointRepere: a.pointRepere ?? '' };
  }
}
