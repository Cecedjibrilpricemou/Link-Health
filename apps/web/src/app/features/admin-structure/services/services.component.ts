// features/admin-structure/services — les services de l'etablissement.
//
// L'administrateur declare ses services (Urgences, Maternite, Pediatrie...)
// et y rattache ses medecins depuis « Mes agents ». L'accueil oriente alors
// un patient vers un service et se voit proposer ses medecins.
//
// **Un service ne se supprime pas, il se ferme** : il n'est plus propose a
// l'accueil, et les episodes passes gardent son nom.
//
// Tous les champs sont des signaux : l'application est zoneless.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ToastrService } from 'ngx-toastr';
import type { ServiceHospitalierView } from '@baobaoheath/shared-types';

import { ApiService } from '../../../core/services/api.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/**
 * Les services les plus courants d'un hopital guineen, proposes en un clic.
 * Ce sont des donnees (le nom enregistre), pas des libelles d'interface.
 */
export const SERVICES_COURANTS = [
  'Urgences', 'Consultations externes', 'Médecine générale', 'Médecine interne', 'Pédiatrie',
  'Maternité', 'Gynécologie-obstétrique', 'Chirurgie', 'Cardiologie', 'Odontologie', 'ORL',
  'Ophtalmologie', 'Imagerie médicale', 'Réanimation',
];

type Reponse<T> = { success: boolean; data?: T };

@Component({
  selector: 'app-admin-services',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, TranslatePipe],
  templateUrl: './services.component.html',
  styleUrl: './services.component.scss',
})
export class ServicesComponent implements OnInit {
  private api = inject(ApiService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  services = signal<ServiceHospitalierView[]>([]);
  isLoading = signal(true);
  enCours = signal(false);
  nouveau = '';

  /** Le service en cours de renommage, et le nom saisi. */
  enRenommage = signal<string | null>(null);
  nomSaisi = '';

  /** Les suggestions qui ne sont pas encore declarees. */
  readonly suggestions = computed(() => {
    const deja = new Set(this.services().map((s) => s.nom.toLocaleLowerCase('fr')));
    return SERVICES_COURANTS.filter((n) => !deja.has(n.toLocaleLowerCase('fr')));
  });

  readonly ouverts = computed(() => this.services().filter((s) => s.actif));
  readonly fermes = computed(() => this.services().filter((s) => !s.actif));

  ngOnInit() { this.charger(); }

  private charger() {
    this.api.get<Reponse<ServiceHospitalierView[]>>('/admin-structure/services').subscribe({
      next: (r) => { this.services.set(r.data ?? []); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.erreur(err); },
    });
  }

  ajouter(nom = this.nouveau) {
    const n = nom.trim();
    if (n.length < 2 || this.enCours()) return;
    this.enCours.set(true);
    this.api.post<Reponse<ServiceHospitalierView>>('/admin-structure/services', { nom: n }).subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.nouveau = '';
        if (r.data) this.services.update((l) => [...l, r.data!].sort((a, b) => Number(b.actif) - Number(a.actif) || a.nom.localeCompare(b.nom, 'fr')));
        this.toastr.success(this.i18n.t('ADMIN_STRUCTURE.SERVICES.AJOUTE', { nom: r.data?.nom ?? n }), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.enCours.set(false); this.erreur(err); },
    });
  }

  ouvrirRenommage(s: ServiceHospitalierView) {
    this.enRenommage.set(s.id);
    this.nomSaisi = s.nom;
  }

  renommer(s: ServiceHospitalierView) {
    const n = this.nomSaisi.trim();
    if (n === s.nom || n.length < 2) { this.enRenommage.set(null); return; }
    this.modifier(s, { nom: n }, 'ADMIN_STRUCTURE.SERVICES.RENOMME');
  }

  basculer(s: ServiceHospitalierView) {
    this.modifier(s, { actif: !s.actif }, s.actif ? 'ADMIN_STRUCTURE.SERVICES.FERME' : 'ADMIN_STRUCTURE.SERVICES.ROUVERT');
  }

  private modifier(s: ServiceHospitalierView, dto: { nom?: string; actif?: boolean }, succes: string) {
    if (this.enCours()) return;
    this.enCours.set(true);
    this.api.put<Reponse<ServiceHospitalierView>>(`/admin-structure/services/${s.id}`, dto).subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.enRenommage.set(null);
        if (r.data) this.services.update((l) => l.map((x) => (x.id === s.id ? r.data! : x)));
        this.toastr.success(this.i18n.t(succes, { nom: r.data?.nom ?? s.nom }), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.enCours.set(false); this.erreur(err); },
    });
  }

  private erreur(err: unknown) {
    const e = err as { status?: number; error?: { error?: string; message?: string } };
    this.toastr.error(
      e?.status === 0 ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE') : e?.error?.error ?? e?.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
      this.i18n.t('COMMON.ERROR_TITLE'),
    );
  }
}
