// R15 : le patient demande la correction de son identite, depuis son profil.
//
// Il ne la fait pas lui-meme : l'accueil de sa structure decide, et le plus
// souvent demandera a voir une piece. L'ecran montre donc d'abord ou en est
// sa derniere demande ; une seule attend a la fois.
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { DemandeCorrectionIdentiteView, DemanderCorrectionIdentiteDto } from '@baobaoheath/shared-types';
import { ToastrService } from 'ngx-toastr';
import { PatientService } from '../../../../core/services/patient.service';
import { TranslatePipe } from '../../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../../shared/services/i18n.service';

export const JUSTIFICATION_MIN = 10;

/** L'identite telle que le dossier la porte aujourd'hui. */
export interface IdentiteActuelle {
  prenom: string;
  nom: string;
  sexe: string;
  /** AAAA-MM-JJ */
  dateNaissance: string;
}

@Component({
  selector: 'app-demande-correction',
  standalone: true,
  imports: [FormsModule, MatFormFieldModule, MatInputModule, TranslatePipe],
  templateUrl: './demande-correction.component.html',
  styleUrl: './demande-correction.component.scss',
})
export class DemandeCorrectionComponent implements OnInit {
  private patientService = inject(PatientService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  actuelle = input.required<IdentiteActuelle>();

  demandes = signal<DemandeCorrectionIdentiteView[]>([]);
  ouvert = signal(false);
  envoi = signal(false);

  form = { prenom: '', nom: '', sexe: '', dateNaissance: '', justification: '' };

  /** La plus recente : c'est elle que le patient veut voir. */
  derniere = computed(() => this.demandes()[0] ?? null);
  enAttente = computed(() => this.derniere()?.statut === 'EN_ATTENTE');

  ngOnInit() {
    this.patientService.mesDemandesCorrection().subscribe({
      next: (res) => this.demandes.set(res.data ?? []),
      error: () => { /* sans historique, le formulaire reste propose */ },
    });
  }

  ouvrir() {
    const a = this.actuelle();
    this.form = { prenom: a.prenom, nom: a.nom, sexe: a.sexe, dateNaissance: a.dateNaissance, justification: '' };
    this.ouvert.set(true);
  }

  fermer() {
    this.ouvert.set(false);
  }

  /** Seuls les traits qui changent partent : demander la meme chose ne demande rien. */
  changements(): Omit<DemanderCorrectionIdentiteDto, 'justification'> {
    const a = this.actuelle();
    const prenom = this.form.prenom.trim();
    const nom = this.form.nom.trim();
    const dateNaissance = this.form.dateNaissance.trim();
    const sexe = this.form.sexe;
    return {
      ...(prenom && prenom !== a.prenom ? { prenom } : {}),
      ...(nom && nom !== a.nom ? { nom } : {}),
      ...((sexe === 'M' || sexe === 'F') && sexe !== a.sexe ? { sexe } : {}),
      ...(dateNaissance && dateNaissance !== a.dateNaissance ? { dateNaissance } : {}),
    };
  }

  peutEnvoyer(): boolean {
    return !this.envoi()
      && !this.enAttente()
      && this.form.justification.trim().length >= JUSTIFICATION_MIN
      && Object.keys(this.changements()).length > 0;
  }

  envoyer() {
    if (!this.peutEnvoyer()) return;
    this.envoi.set(true);
    this.patientService.demanderCorrection({
      ...this.changements(),
      justification: this.form.justification.trim(),
    }).subscribe({
      next: (res) => {
        this.envoi.set(false);
        if (res.data) this.demandes.update((l) => [res.data!, ...l]);
        this.ouvert.set(false);
        this.toastr.success(this.i18n.t('PATIENT.CORRECTION.ENVOYEE'));
      },
      error: (err) => {
        this.envoi.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('PATIENT.CORRECTION.ERR'));
      },
    });
  }

  /** « Prenom : Mariame · Sexe : F » — ce qui a ete demande, lisible. */
  resume(d: DemandeCorrectionIdentiteView): string {
    const parties: string[] = [];
    if (d.demande.prenom) parties.push(`${this.i18n.t('PATIENT.PROFILE.FIRST_NAME')} : ${d.demande.prenom}`);
    if (d.demande.nom) parties.push(`${this.i18n.t('PATIENT.PROFILE.LAST_NAME')} : ${d.demande.nom}`);
    if (d.demande.sexe) {
      const s = d.demande.sexe === 'M' ? 'PATIENT.PROFILE.GENDER_M' : 'PATIENT.PROFILE.GENDER_F';
      parties.push(`${this.i18n.t('PATIENT.PROFILE.GENDER')} : ${this.i18n.t(s)}`);
    }
    if (d.demande.dateNaissance) parties.push(`${this.i18n.t('PATIENT.PROFILE.BIRTH_DATE')} : ${d.demande.dateNaissance}`);
    return parties.join(' · ');
  }
}
