import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import type { CourseLivreurView, LivreurZoneView, ProposerOffreCourseDto } from '@baobaoheath/shared-types';
import { CourseService } from '../../../core/services/course.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

/** Communes desservies en plus de la sienne : la meme limite que l'API. */
export const MAX_COMMUNES_DESSERVIES = 5;

interface OffreForm {
  prixGnf: string;
  delaiMinutes: string;
}

@Component({
  selector: 'app-livreur-courses',
  standalone: true,
  imports: [CommonModule, DatePipe, TranslatePipe],
  templateUrl: './courses.component.html',
  styleUrl: './courses.component.scss',
})
export class LivreurCoursesComponent implements OnInit {
  private readonly coursesService = inject(CourseService);
  private readonly toastr = inject(ToastrService);
  private readonly i18n = inject(I18nService);

  // ── Disponibilite et zone (M4) ────────────────────────────────────
  //
  // **Seul un motard en service est prevenu des courses**, et lui seul peut
  // proposer une offre (l'API le verifie). Hors service, la page reste
  // consultable : il voit ce qui se passe avant de se decider.
  readonly zone = signal<LivreurZoneView | null>(null);
  readonly bascule = signal(false);
  /** Les communes en cours d'edition, avant enregistrement. */
  readonly communes = signal<string[]>([]);
  readonly nouvelleCommune = signal('');
  readonly enregistrementCommunes = signal(false);
  readonly max = MAX_COMMUNES_DESSERVIES;
  readonly communesModifiees = computed(() =>
    JSON.stringify(this.communes()) !== JSON.stringify(this.zone()?.communesDesservies ?? []));

  readonly courses = signal<CourseLivreurView[]>([]);
  readonly formulaires = signal<Record<string, OffreForm>>({});
  readonly envoyees = signal<Record<string, boolean>>({});
  readonly chargement = signal(true);
  readonly envoi = signal<string | null>(null);

  ngOnInit(): void {
    this.chargerZone();
    this.charger();
  }

  chargerZone(): void {
    this.coursesService.profilLivreur().subscribe({
      next: (response) => {
        const zone = response.data ?? null;
        this.zone.set(zone);
        this.communes.set([...(zone?.communesDesservies ?? [])]);
      },
      // Sans profil, la page reste utilisable : l'API decide a l'envoi d'une offre.
      error: () => this.zone.set(null),
    });
  }

  basculerService(): void {
    const zone = this.zone();
    if (!zone || this.bascule()) return;
    const cible = !zone.enService;
    this.bascule.set(true);
    this.coursesService.definirEnService(cible).subscribe({
      next: (response) => {
        this.bascule.set(false);
        if (response.data) this.zone.set(response.data);
        this.toastr.success(this.i18n.t(cible ? 'LIVREUR.SERVICE.EN_SERVICE_OK' : 'LIVREUR.SERVICE.HORS_SERVICE_OK'));
        if (cible) this.charger();
      },
      error: (error: unknown) => {
        this.bascule.set(false);
        this.toastr.error(this.messageErreur(error));
      },
    });
  }

  ajouterCommune(): void {
    const commune = this.nouvelleCommune().trim();
    if (!commune) return;
    const cle = commune.toLowerCase();
    const propre = (this.zone()?.commune ?? '').trim().toLowerCase();
    const dejaLa = this.communes().some((c) => c.toLowerCase() === cle);
    // Sa propre commune ou un doublon : rien a ajouter, on vide simplement le champ.
    if (cle !== propre && !dejaLa && this.communes().length < this.max) {
      this.communes.update((liste) => [...liste, commune]);
    }
    this.nouvelleCommune.set('');
  }

  retirerCommune(commune: string): void {
    this.communes.update((liste) => liste.filter((c) => c !== commune));
  }

  enregistrerCommunes(): void {
    if (!this.communesModifiees() || this.enregistrementCommunes()) return;
    this.enregistrementCommunes.set(true);
    this.coursesService.definirCommunes(this.communes()).subscribe({
      next: (response) => {
        this.enregistrementCommunes.set(false);
        if (response.data) {
          this.zone.set(response.data);
          this.communes.set([...response.data.communesDesservies]);
        }
        this.toastr.success(this.i18n.t('LIVREUR.ZONE.ENREGISTREE'));
        // De nouvelles communes : de nouvelles courses peuvent apparaitre.
        this.charger();
      },
      error: (error: unknown) => {
        this.enregistrementCommunes.set(false);
        this.toastr.error(this.messageErreur(error));
      },
    });
  }

  charger(): void {
    this.chargement.set(true);
    this.coursesService.coursesOuvertes().subscribe({
      next: (response) => {
        this.courses.set(response.data ?? []);
        this.chargement.set(false);
      },
      error: (error: unknown) => {
        this.chargement.set(false);
        this.toastr.error(this.messageErreur(error));
      },
    });
  }

  formulaire(id: string): OffreForm {
    return this.formulaires()[id] ?? { prixGnf: '', delaiMinutes: '' };
  }

  modifier(id: string, champ: keyof OffreForm, valeur: string): void {
    this.formulaires.update((forms) => ({
      ...forms,
      [id]: { ...this.formulaire(id), [champ]: valeur },
    }));
  }

  peutEnvoyer(course: CourseLivreurView): boolean {
    const form = this.formulaire(course.id);
    // Hors service, l'API refuserait l'offre : on ne propose pas de l'envoyer.
    // Profil inconnu (null) : on laisse l'API trancher.
    return !this.envoi()
      && this.zone()?.enService !== false
      && Number.isSafeInteger(Number(form.prixGnf)) && Number(form.prixGnf) > 0
      && Number.isSafeInteger(Number(form.delaiMinutes)) && Number(form.delaiMinutes) > 0;
  }

  proposer(course: CourseLivreurView): void {
    if (!this.peutEnvoyer(course)) return;
    const form = this.formulaire(course.id);
    const dto: ProposerOffreCourseDto = {
      prixGnf: Number(form.prixGnf),
      delaiMinutes: Number(form.delaiMinutes),
    };
    this.envoi.set(course.id);
    this.coursesService.proposer(course.id, dto).subscribe({
      next: () => {
        this.envoi.set(null);
        this.envoyees.update((items) => ({ ...items, [course.id]: true }));
      },
      error: (error: unknown) => {
        this.envoi.set(null);
        this.toastr.error(this.messageErreur(error));
      },
    });
  }

  private messageErreur(error: unknown): string {
    const response = error as { error?: { error?: string } };
    return response?.error?.error ?? 'Une erreur est survenue.';
  }
}
