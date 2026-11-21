// features/medecin/bris-de-glace/bris-de-glace.component.ts
//
// Ouvrir en urgence le dossier d'un patient qu'on ne suit pas (EF-02-06).
//
// **L'écran dit ce que le geste engage.** Cette porte existe parce qu'un
// contrôle d'accès sans issue de secours ferait prescrire à l'aveugle. Mais
// elle n'est pas un passe-partout : le nom du soignant, son motif et l'heure
// sont enregistrés, le patient en est prévenu, et l'accès est relu. Le taire
// ferait croire à une porte ordinaire.
//
// Tous les champs sont des signaux : l'application est zoneless.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { BrisDeGlaceView, MotifBrisDeGlace } from '@baobaoheath/shared-types';
import { BrisDeGlaceService } from '../../../core/services/bris-de-glace.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { roleDeLEspace } from '../../../shared/utils/role-espace';

const MOTIFS: MotifBrisDeGlace[] = [
  'URGENCE_VITALE',
  'PATIENT_HORS_ETAT',
  'CONTINUITE_DES_SOINS',
  'VERIFICATION_AVANT_PRESCRIPTION',
  'AUTRE',
];

/** La même longueur que l'API et que la contrainte SQL. */
const EXPLICATION_MIN = 20;

/** La même durée que le service. Affichée pour que le soignant la connaisse. */
const DUREE_HEURES = 4;

@Component({
  selector: 'app-bris-de-glace',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslatePipe,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
  ],
  templateUrl: './bris-de-glace.component.html',
  styleUrl: './bris-de-glace.component.scss',
})
export class BrisDeGlaceComponent implements OnInit {
  /** « Médecin » ou « Sage-femme » : l'etiquette de l'espace suit le metier. */
  readonly roleEspace = roleDeLEspace();
  private service = inject(BrisDeGlaceService);
  private route = inject(ActivatedRoute);
  private i18n = inject(I18nService);

  motifs = MOTIFS;
  explicationMin = EXPLICATION_MIN;
  dureeHeures = DUREE_HEURES;

  // ── La déclaration ─────────────────────────────────────────────────
  idPatient = signal('');
  motif = signal<MotifBrisDeGlace | ''>('');
  explication = signal('');
  enCours = signal(false);

  peutDeclarer = computed(() =>
    !this.enCours()
    && this.idPatient().trim().length > 0
    && !!this.motif()
    && this.explication().trim().length >= EXPLICATION_MIN
  );

  // ── Ce qui a déjà été ouvert ───────────────────────────────────────
  acces = signal<BrisDeGlaceView[]>([]);
  chargement = signal(true);
  succes = signal('');
  erreur = signal('');

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  ngOnInit() {
    // Venu du dossier de la visite : le patient est deja connu, le soignant
    // n'a plus qu'a dire pourquoi.
    const patient = this.route.snapshot.queryParamMap.get('patient');
    if (patient) this.idPatient.set(patient);
    this.charger();
  }

  charger() {
    this.chargement.set(true);
    this.service.lister().subscribe({
      next: (res) => {
        this.acces.set(res.data ?? []);
        this.chargement.set(false);
      },
      error: () => this.chargement.set(false),
    });
  }

  declarer() {
    if (!this.peutDeclarer()) return;

    this.enCours.set(true);
    this.erreur.set('');
    this.service.declarer({
      idPatient: this.idPatient().trim(),
      motif: this.motif() as MotifBrisDeGlace,
      explication: this.explication().trim(),
    }).subscribe({
      next: (res) => {
        this.enCours.set(false);
        const b = res.data;
        const heure = b
          ? new Date(b.expireLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : '';
        // **Le message dit si le patient a pu être prévenu.** Le taire ferait
        // croire que la notification est toujours partie.
        this.succes.set(this.i18n.t(
          b?.notifieLe ? 'BRIS_DE_GLACE.DECLARE_MSG' : 'BRIS_DE_GLACE.DECLARE_MSG_SANS_NOTIF',
          { heure }
        ));
        this.idPatient.set('');
        this.motif.set('');
        this.explication.set('');
        this.charger();
      },
      error: (err) => {
        this.enCours.set(false);
        this.erreur.set(this.messageDe(err, 'BRIS_DE_GLACE.ERREUR'));
      },
    });
  }

  refermer(b: BrisDeGlaceView) {
    this.service.refermer(b.id).subscribe({
      next: () => {
        this.succes.set(this.i18n.t('BRIS_DE_GLACE.REFERME_MSG'));
        this.charger();
      },
      error: (err) => this.erreur.set(this.messageDe(err, 'BRIS_DE_GLACE.ERREUR')),
    });
  }

  heure(quand: string | Date): string {
    return new Date(quand).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  private messageDe(err: unknown, cleDefaut: string): string {
    const e = err as { error?: { error?: string; message?: string } };
    return e?.error?.error ?? e?.error?.message ?? this.i18n.t(cleDefaut);
  }
}
