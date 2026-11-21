// Le dossier de la visite, cote infirmier : ce qu'il faut pour soigner
// aujourd'hui, et ses passages.
//
// **Ce qu'il voit** : le patient, ses allergies en tete - c'est ce qu'il doit
// lire avant tout geste -, ce qui l'amene, ce que le medecin a prescrit
// pendant la visite, ses vaccins, et les soins deja faits.
// **Ce qu'il fait** : noter un passage (constantes, soin, ou les deux) et
// enregistrer un vaccin. Rien d'autre : il ne prescrit pas.
//
// Memes cartes que le dossier de la visite a l'accueil.
import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ToastrService } from 'ngx-toastr';
import type { CreerSoinInfirmierDto, DossierVisiteInfirmierView } from '@baobaoheath/shared-types';

import { InfirmierService } from '../../../core/services/infirmier.service';
import { VaccinationService } from '../../../core/services/vaccination.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { CONSTANTES, constantesRenseignees, type Constante } from '../../../shared/utils/constantes-soin';


const PASSAGE_VIDE = (): Record<Constante, string> & { note: string } => ({
  temperature: '', tensionSystolique: '', tensionDiastolique: '', frequenceCardiaque: '',
  frequenceRespiratoire: '', spo2: '', poidsKg: '', glycemie: '', note: '',
});
const VACCIN_VIDE = () => ({ vaccinNom: '', numeroLot: '', siteInjection: '', dateProchaineD: '' });

@Component({
  selector: 'app-infirmier-visite',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, TranslatePipe],
  styleUrl: './visite.component.scss',
  templateUrl: './visite.component.html',
})
export class InfirmierVisiteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(InfirmierService);
  private readonly vaccins = inject(VaccinationService);
  private readonly toastr = inject(ToastrService);
  private readonly i18n = inject(I18nService);

  readonly constantes = CONSTANTES;
  readonly visite = signal<DossierVisiteInfirmierView | null>(null);
  readonly chargement = signal(true);
  readonly erreur = signal('');
  readonly envoi = signal(false);
  passage = PASSAGE_VIDE();
  vaccin = VACCIN_VIDE();

  private get idEpisode(): string {
    return this.route.snapshot.paramMap.get('id') ?? '';
  }

  ngOnInit(): void {
    this.charger();
  }

  charger(): void {
    this.service.visite(this.idEpisode).subscribe({
      next: (r) => { this.visite.set(r.data ?? null); this.chargement.set(false); },
      error: (err) => {
        this.erreur.set(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
        this.chargement.set(false);
      },
    });
  }

  /** Ce que le passage porte : les seules constantes saisies, et la note. */
  corpsDuPassage(): CreerSoinInfirmierDto | null {
    const corps: CreerSoinInfirmierDto = {};
    for (const { cle } of CONSTANTES) {
      const brut = String(this.passage[cle] ?? '').trim().replace(',', '.');
      if (brut !== '' && !Number.isNaN(Number(brut))) corps[cle] = Number(brut);
    }
    const note = this.passage.note.trim();
    if (note) corps.note = note;
    return Object.keys(corps).length ? corps : null;
  }

  noterPassage(): void {
    const corps = this.corpsDuPassage();
    if (!corps) {
      this.toastr.error(this.i18n.t('INFIRMIER.VISITE.PASSAGE_VIDE'));
      return;
    }
    this.envoi.set(true);
    this.service.noterSoin(this.idEpisode, corps).subscribe({
      next: (r) => {
        this.envoi.set(false);
        const soin = r.data;
        if (soin) this.visite.update((v) => (v ? { ...v, soins: [soin, ...v.soins] } : v));
        this.passage = PASSAGE_VIDE();
        this.toastr.success(this.i18n.t('INFIRMIER.VISITE.PASSAGE_OK'));
      },
      error: (err) => {
        this.envoi.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  enregistrerVaccin(): void {
    const v = this.visite();
    const nom = this.vaccin.vaccinNom.trim();
    if (!v || nom.length < 2) return;
    this.envoi.set(true);
    this.vaccins.administrerVaccin({
      idPatient: v.patient.id,
      vaccinNom: nom,
      ...(this.vaccin.numeroLot.trim() ? { numeroLot: this.vaccin.numeroLot.trim() } : {}),
      ...(this.vaccin.siteInjection.trim() ? { siteInjection: this.vaccin.siteInjection.trim() } : {}),
      ...(this.vaccin.dateProchaineD ? { dateProchaineD: this.vaccin.dateProchaineD } : {}),
    }).subscribe({
      next: () => {
        this.envoi.set(false);
        this.vaccin = VACCIN_VIDE();
        this.toastr.success(this.i18n.t('INFIRMIER.VISITE.VACCIN_OK', { vaccin: nom }));
        this.charger();
      },
      error: (err) => {
        this.envoi.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  /** Les constantes renseignees d'un passage, avec leur unite. */
  readonly constantesDe = constantesRenseignees;

  initiales(v: DossierVisiteInfirmierView): string {
    return `${v.patient.prenom.charAt(0)}${v.patient.nom.charAt(0)}`.toUpperCase();
  }
}
