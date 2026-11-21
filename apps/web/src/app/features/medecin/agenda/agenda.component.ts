// features/medecin/agenda — les rendez-vous du médecin, dans l'ordre.
//
// Addendum du 2026-09-28, point 8. Le modèle était déjà indexé pour cette
// requête (`@@index([idMedecin, prevuLe])`) : il ne manquait que l'écran.
//
// Aujourd'hui d'abord, parce que c'est la vue dont il se sert le matin.
//
// **La file d'attente, en tete.** L'accueil pointe l'arrivee d'un patient :
// il entre aussitot dans la file du medecin, sans rechargement, dans l'ordre
// d'arrivee - le premier arrive est le premier appele. Le medecin voit depuis
// combien de temps chacun attend, et appelle le suivant d'un geste ; l'accueil
// le voit en direct, et sait vers quel bureau orienter le patient.
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { RendezVousMedecinView, StatutRendezVous } from '@baobaoheath/shared-types';

import { MedecinService } from '../../../core/services/medecin.service';
import { SocketService } from '../../../core/services/socket.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { roleDeLEspace } from '../../../shared/utils/role-espace';

type Groupe = { cle: string; libelle: string; rdvs: RendezVousMedecinView[] };

/** L'evenement emis par l'API a chaque pointage, appel, fin ou absence. */
export const EVENEMENT_RENDEZ_VOUS = 'rendez-vous:maj';

/** Le temps d'attente se recalcule toutes les trente secondes. */
const RAFRAICHISSEMENT_ATTENTE_MS = 30_000;

function estAujourdhui(iso: string | Date, maintenant: number): boolean {
  return new Date(iso).toDateString() === new Date(maintenant).toDateString();
}

@Component({
  selector: 'app-medecin-agenda',
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, TranslatePipe, ExportListeComponent],
  templateUrl: './agenda.component.html',
  styleUrl: './agenda.component.scss',
})
export class AgendaComponent implements OnInit {
  /** « Médecin » ou « Sage-femme » : l'etiquette de l'espace suit le metier. */
  readonly roleEspace = roleDeLEspace();
  private service = inject(MedecinService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);
  private socket = inject(SocketService);
  private destroyRef = inject(DestroyRef);

  /** L'heure courante, pour le temps d'attente : elle avance toute seule. */
  readonly maintenant = signal(Date.now());

  rdvs = signal<RendezVousMedecinView[]>([]);

  /**
   * La feuille de la journee. Le telephone y est : rappeler un patient qui
   * n'est pas venu est le geste qui suit, et chercher son numero dans
   * l'application alors qu'on a la feuille en main ne sert personne.
   */
  readonly colonnes: ColonneExport<RendezVousMedecinView>[] = [
    { titre: 'EXPORT.COL.PREVU_LE', valeur: (r) => new Date(r.prevuLe) },
    { titre: 'EXPORT.COL.HEURE', valeur: (r) => new Date(r.prevuLe).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) },
    { titre: 'EXPORT.COL.PATIENT', valeur: (r) => `${r.patient.prenom} ${r.patient.nom}` },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (r) => r.patient.telephone },
    { titre: 'EXPORT.COL.MOTIF', valeur: (r) => r.motif },
    { titre: 'EXPORT.COL.STATUT', valeur: (r) => r.statut },
    { titre: 'EXPORT.COL.ARRIVEE', valeur: (r) => (r.arriveeLe ? new Date(r.arriveeLe) : null) },
    { titre: 'EXPORT.COL.EPISODE', valeur: (r) => r.numeroEpisode },
  ];
  isLoading = signal(true);
  enCours = signal<string | null>(null);

  /** Groupés par jour : « aujourd'hui », « demain », puis les dates. */
  readonly groupes = computed<Groupe[]>(() => {
    const parJour = new Map<string, RendezVousMedecinView[]>();
    for (const r of this.rdvs()) {
      const cle = new Date(r.prevuLe).toDateString();
      parJour.set(cle, [...(parJour.get(cle) ?? []), r]);
    }
    return [...parJour.entries()].map(([cle, liste]) => ({
      cle,
      libelle: this.libelleJour(new Date(cle)),
      rdvs: liste,
    }));
  });

  /**
   * Les patients pointes aujourd'hui et pas encore appeles, **dans l'ordre
   * d'arrivee** : c'est l'ordre de la salle d'attente, pas celui des creneaux.
   * Un patient venu en avance pour 11 h ne passe pas devant celui qui attend
   * depuis 9 h.
   */
  readonly fileAttente = computed(() =>
    this.rdvs()
      .filter((r) => r.statut === 'PRESENT' && !!r.arriveeLe && estAujourdhui(r.arriveeLe, this.maintenant()))
      .sort((a, b) => new Date(a.arriveeLe!).getTime() - new Date(b.arriveeLe!).getTime()),
  );

  /** Le patient dans le cabinet, s'il y en a un. */
  readonly enConsultation = computed(() =>
    this.rdvs().find((r) => r.statut === 'EN_CONSULTATION' && estAujourdhui(r.prevuLe, this.maintenant())) ?? null,
  );

  ngOnInit() {
    this.charger();

    // Un pointage a l'accueil, ou un changement fait depuis un autre poste :
    // la file se met a jour d'elle-meme. Plusieurs evenements rapproches ne
    // donnent qu'un rechargement.
    this.socket
      .on(EVENEMENT_RENDEZ_VOUS)
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.charger(false));

    const minuterie = setInterval(() => this.maintenant.set(Date.now()), RAFRAICHISSEMENT_ATTENTE_MS);
    this.destroyRef.onDestroy(() => clearInterval(minuterie));
  }

  /** Depuis combien de temps ce patient attend, en clair. */
  attente(r: RendezVousMedecinView): string {
    if (!r.arriveeLe) return '';
    const minutes = Math.max(0, Math.floor((this.maintenant() - new Date(r.arriveeLe).getTime()) / 60_000));
    if (minutes < 1) return this.i18n.t('MEDECIN.AGENDA.ATTENTE_INSTANT');
    if (minutes < 60) return this.i18n.t('MEDECIN.AGENDA.ATTENTE_MIN', { n: minutes });
    return this.i18n.t('MEDECIN.AGENDA.ATTENTE_H', {
      h: Math.floor(minutes / 60),
      m: String(minutes % 60).padStart(2, '0'),
    });
  }

  /**
   * Appeler le premier de la file.
   *
   * Pas tant qu'un patient est dans le cabinet : un medecin n'en recoit qu'un
   * a la fois, et un second « en consultation » ferait croire a l'accueil que
   * le bureau est libre pour deux.
   */
  appelerSuivant() {
    const suivant = this.fileAttente()[0];
    if (!suivant || this.enConsultation()) return;
    this.changer(suivant, 'EN_CONSULTATION');
  }

  private charger(afficherChargement = true) {
    // Un rechargement venu de la socket ne fait pas clignoter l'ecran.
    if (afficherChargement) this.isLoading.set(true);
    this.service.getAgenda().subscribe({
      next: (r) => {
        this.rdvs.set(r.data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.i18n.t('MEDECIN.AGENDA.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
      },
    });
  }

  private libelleJour(d: Date): string {
    const jour = new Date(d); jour.setHours(0, 0, 0, 0);
    const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
    const ecart = Math.round((jour.getTime() - aujourdhui.getTime()) / 86_400_000);
    if (ecart === 0) return this.i18n.t('MEDECIN.AGENDA.AUJOURDHUI');
    if (ecart === 1) return this.i18n.t('MEDECIN.AGENDA.DEMAIN');
    return d.toLocaleDateString(this.i18n.lang() === 'en' ? 'en-GB' : 'fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }

  /** Le patient est là et attend : c'est ce que le médecin doit voir en premier. */
  attend(r: RendezVousMedecinView): boolean {
    return r.statut === 'PRESENT';
  }

  /** Un créneau dépassé sans que le patient soit pointé. */
  enRetard(r: RendezVousMedecinView): boolean {
    return r.statut === 'PLANIFIE' && new Date(r.prevuLe).getTime() < Date.now();
  }

  changer(r: RendezVousMedecinView, statut: 'EN_CONSULTATION' | 'TERMINE' | 'ABSENT') {
    if (this.enCours()) return;
    this.enCours.set(r.id);
    this.service.changerStatutRendezVous(r.id, statut).subscribe({
      next: (res) => {
        this.enCours.set(null);
        const maj = res.data;
        if (maj) this.rdvs.update((l) => l.map((x) => (x.id === maj.id ? maj : x)));
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { status?: number; error?: { error?: string } };
        this.toastr.error(
          e?.status === 0
            ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
            : e?.error?.error ?? this.i18n.t('MEDECIN.AGENDA.ERR_STATUT'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
        this.charger();
      },
    });
  }

  libelleStatut(s: StatutRendezVous): string {
    return this.i18n.t('MEDECIN.STATUT_RDV.' + s);
  }

  age(dateNaissance: string | Date): number | null {
    const n = new Date(dateNaissance);
    if (Number.isNaN(n.getTime())) return null;
    const now = new Date();
    let a = now.getFullYear() - n.getFullYear();
    if (now < new Date(now.getFullYear(), n.getMonth(), n.getDate())) a -= 1;
    return a;
  }
}
