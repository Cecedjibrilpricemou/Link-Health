// features/hopital/admission — recherche obligatoire du patient (EF-03-01)
// puis ouverture d'un episode de soins (EF-03-02).
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ToastrService } from 'ngx-toastr';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError } from 'rxjs';
import type { PatientRechercheView } from '@baobaoheath/shared-types';
import { HopitalService, MedecinRefView } from '../../../core/services/hopital.service';
import type { ServiceHospitalierView } from '@baobaoheath/shared-types';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { SuggestionsLieuxComponent } from '../../../shared/components/suggestions-lieux/suggestions-lieux.component';
import { GeographieService } from '../../../core/services/geographie.service';
import { RACINE_ACCUEIL } from '../../../core/navigation/racines';
import { libelleSpecialite } from '../../../shared/utils/metiers-personnel';
import { nomPraticien } from '../../../shared/pipes/nom-praticien.pipe';

@Component({
  selector: 'app-hopital-admission',
  standalone: true,
  imports: [ListeRechercheComponent, RouterLink, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, TranslatePipe, SuggestionsLieuxComponent],
  templateUrl: './admission.component.html',
})
export class AdmissionComponent implements OnInit {
  /** /hopital, ou l'interface de l'administrateur : voir core/navigation/racines.ts. */
  readonly racine = inject(RACINE_ACCUEIL);

  /**
   * Les services ouverts. **S'il y en a, on oriente vers un service** et ses
   * medecins seuls sont proposes ; une structure qui n'en declare aucun garde
   * le champ libre d'avant. L'episode garde le NOM du service.
   */
  services = signal<ServiceHospitalierView[]>([]);
  idService = signal('');

  /** Les medecins : du service choisi s'il en a, tous sinon. */
  readonly optionsMedecins = computed<OptionListe[]>(() => {
    const id = this.idService();
    const duService = id ? this.medecins().filter((m) => m.service?.id === id) : [];
    const liste = duService.length ? duService : this.medecins();
    return liste.map((m) => ({
      valeur: m.id,
      libelle: nomPraticien(m),
      // Specialite et service, sans repeter un meme nom (« Pédiatrie · Pédiatrie »).
      detail: [...new Map([m.role === 'SAGE_FEMME' ? this.i18n.t('ROLE.SAGE_FEMME') : libelleSpecialite((cle) => this.i18n.t(cle), m.specialite), m.service?.nom]
        .filter((v): v is string => !!v).map((v) => [v.toLocaleLowerCase('fr'), v])).values()].join(' · ') || undefined,
    }));
  });

  /** Le service choisi n'a aucun medecin rattache : tous sont proposes, et on le dit. */
  readonly serviceSansMedecin = computed(() => {
    const id = this.idService();
    return !!id && !this.medecins().some((m) => m.service?.id === id);
  });

  private hopital = inject(HopitalService);
  /** R9 : le nom du niveau (« Prefecture », « LGA »...) et ses lieux viennent du pays installe. */
  readonly geo = inject(GeographieService);
  private router  = inject(Router);
  private toastr  = inject(ToastrService);
  private i18n    = inject(I18nService);

  recherche  = '';
  resultats  = signal<PatientRechercheView[]>([]);
  isSearching = signal(false);
  aCherche   = signal(false);

  medecins  = signal<MedecinRefView[]>([]);
  selection = signal<PatientRechercheView | null>(null);
  isSaving  = signal(false);

  formulaire = { motif: '', service: '', idResponsable: '', notes: '' };

  // ── Creer le dossier sur place (EF-03-01) ──────────────────────────
  //
  // **L'accueil ne part plus sur la page publique d'inscription.** Elle est
  // faite pour quelqu'un qui s'inscrit seul chez lui, elle s'ouvrait dans un
  // nouvel onglet, et l'agent y perdait l'admission en cours.
  creation = signal(false);
  isCreating = signal(false);
  /** Rendu une seule fois, pour etre remis au patient. */
  motDePasseRemis = signal<{ nom: string; motDePasse: string } | null>(null);

  nouveau = {
    prenom: '', nom: '', telephone: '', email: '',
    dateNaissance: '', sexe: 'M' as 'M' | 'F',
    prefecture: '', sousPrefecture: '',
  };

  /** Le minimum pour qu'un dossier soit retrouvable plus tard. */
  peutCreer(): boolean {
    const n = this.nouveau;
    return !this.isCreating()
      && n.prenom.trim().length > 0
      && n.nom.trim().length > 0
      && n.telephone.trim().length >= 6
      && n.dateNaissance.length > 0
      && n.prefecture.trim().length > 0;
  }

  ouvrirCreation() {
    // Ce que l'agent vient de taper est souvent le nom ou le numero : on le
    // reprend plutot que de le lui faire resaisir.
    const q = this.recherche.trim();
    if (/^[0-9+\s-]{6,}$/.test(q)) this.nouveau.telephone = q;
    else if (q) this.nouveau.nom = q;
    this.creation.set(true);
  }

  annulerCreation() {
    this.creation.set(false);
  }

  creerDossier() {
    if (!this.peutCreer()) return;
    this.isCreating.set(true);

    const n = this.nouveau;
    this.hopital.creerPatientAuComptoir({
      telephone: n.telephone.trim(),
      prenom: n.prenom.trim(),
      nom: n.nom.trim(),
      dateNaissance: n.dateNaissance,
      sexe: n.sexe,
      prefecture: n.prefecture.trim(),
      sousPrefecture: n.sousPrefecture.trim() || undefined,
      email: n.email.trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.isCreating.set(false);
        const d = res.data;
        if (!d) return;
        this.creation.set(false);
        // Le mot de passe s'affiche jusqu'a ce que l'agent dise l'avoir note :
        // il ne sera plus jamais montre.
        this.motDePasseRemis.set({
          nom: `${d.patient.prenom} ${d.patient.nom}`,
          motDePasse: d.motDePasseTemporaire,
        });
        this.toastr.success(this.i18n.t('HOPITAL.ADMISSION.NEW_FAIT', {
          nom: `${d.patient.prenom} ${d.patient.nom}`,
        }));
      },
      error: (err) => {
        this.isCreating.set(false);
        const e = err as { error?: { error?: string } };
        this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  /** L'agent a note le mot de passe : on relance la recherche sur ce patient. */
  fermerMotDePasse() {
    const remis = this.motDePasseRemis();
    this.motDePasseRemis.set(null);
    if (remis) {
      this.recherche = this.nouveau.telephone.trim();
      this.onRecherche(this.recherche);
    }
    this.nouveau = {
      prenom: '', nom: '', telephone: '', email: '',
      dateNaissance: '', sexe: 'M', prefecture: '', sousPrefecture: '',
    };
  }

  /** Choisir un service : son nom part avec l'episode, ses medecins sont proposes. */
  choisirService(id: string) {
    this.idService.set(id);
    this.formulaire.service = this.services().find((s) => s.id === id)?.nom ?? '';
    const choisi = this.medecins().find((m) => m.id === this.formulaire.idResponsable);
    if (id && choisi && choisi.service?.id !== id && !this.serviceSansMedecin()) this.formulaire.idResponsable = '';
  }

  private terme$ = new Subject<string>();

  ngOnInit() {
    this.hopital.listerMedecins().subscribe({ next: (r) => this.medecins.set(r.data ?? []) });
    this.hopital.listerServices().subscribe({ next: (r) => this.services.set(r.data ?? []), error: () => this.services.set([]) });

    this.terme$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap((q) => {
        if (q.trim().length < 3) { this.resultats.set([]); this.aCherche.set(false); return of(null); }
        this.isSearching.set(true);
        return this.hopital.rechercherPatients(q.trim()).pipe(catchError(() => of({ success: false, data: [] as PatientRechercheView[] })));
      }),
    ).subscribe((r) => {
      if (!r) return;
      this.resultats.set(r.data ?? []);
      this.isSearching.set(false);
      this.aCherche.set(true);
    });
  }

  onRecherche(valeur: string) {
    this.recherche = valeur;
    this.terme$.next(valeur);
  }

  choisir(p: PatientRechercheView) {
    this.selection.set(p);
    this.formulaire = { motif: '', service: '', idResponsable: '', notes: '' };
    this.idService.set('');
  }

  annuler() { this.selection.set(null); }

  ouvrir() {
    const p = this.selection();
    if (!p || this.isSaving() || this.formulaire.motif.trim().length < 3) return;
    this.isSaving.set(true);
    this.hopital.creerEpisode({
      idPatient: p.id,
      motif: this.formulaire.motif.trim(),
      service: this.formulaire.service.trim() || undefined,
      idResponsable: this.formulaire.idResponsable || undefined,
      notes: this.formulaire.notes.trim() || undefined,
    }).subscribe({
      next: (r) => {
        this.isSaving.set(false);
        this.toastr.success(this.i18n.t('HOPITAL.ADMISSION.SUCCESS', { numero: r.data?.numero ?? '' }), this.i18n.t('COMMON.SUCCESS'));
        if (r.data) this.router.navigate([this.racine + '/episodes', r.data.id]);
      },
      error: (err) => {
        this.isSaving.set(false);
        this.toastr.error(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), this.i18n.t('COMMON.ERROR_TITLE'));
      },
    });
  }

  initiales(p: PatientRechercheView): string {
    return `${p.prenom.charAt(0)}${p.nom.charAt(0)}`.toUpperCase();
  }
}
