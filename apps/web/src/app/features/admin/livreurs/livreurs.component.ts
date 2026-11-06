import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { CreerLivreurDto, LivreurAdminView } from '@baobaoheath/shared-types';
import { LivreurAdminService } from '../../../core/services/livreur-admin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

type FormulaireLivreur = Required<CreerLivreurDto>;

function formulaireVide(): FormulaireLivreur {
  return { prenom: '', nom: '', telephone: '', quartier: '', commune: '', prefecture: '' };
}

@Component({
  selector: 'app-admin-livreurs',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
  ],
  templateUrl: './livreurs.component.html',
  styleUrl: './livreurs.component.scss',
})
export class LivreursComponent implements OnInit {
  private readonly service = inject(LivreurAdminService);
  private readonly i18n = inject(I18nService);

  readonly livreurs = signal<LivreurAdminView[]>([]);
  readonly chargement = signal(true);
  readonly creationEnCours = signal(false);
  readonly activiteEnCours = signal<string | null>(null);
  readonly erreur = signal('');
  readonly succes = signal('');
  readonly creation = signal<{ livreur: LivreurAdminView; motDePasseTemporaire: string } | null>(null);

  // Tous les champs sont exiges ici : la commune est la zone qui decide
  // quelles courses le livreur voit et recoit.
  readonly formulaire = signal<FormulaireLivreur>(formulaireVide());

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  ngOnInit(): void {
    this.charger();
  }

  charger(): void {
    this.chargement.set(true);
    this.erreur.set('');
    this.service.lister().subscribe({
      next: (response) => {
        this.livreurs.set(response.data ?? []);
        this.chargement.set(false);
      },
      error: (error: unknown) => {
        this.chargement.set(false);
        this.erreur.set(this.messageDe(error, 'ADMIN.LIVREURS.ERR_CHARGEMENT'));
      },
    });
  }

  modifier(champ: keyof FormulaireLivreur, valeur: string): void {
    this.formulaire.update((form) => ({ ...form, [champ]: valeur }));
  }

  peutCreer(): boolean {
    return Object.values(this.formulaire()).every((valeur) => valeur.trim().length > 0)
      && !this.creationEnCours();
  }

  creer(): void {
    if (!this.peutCreer()) return;
    this.creationEnCours.set(true);
    this.erreur.set('');
    this.succes.set('');
    this.creation.set(null);
    const form = this.formulaire();
    const dto: CreerLivreurDto = {
      prenom: form.prenom.trim(),
      nom: form.nom.trim(),
      telephone: form.telephone.trim(),
      quartier: form.quartier.trim(),
      commune: form.commune.trim(),
      prefecture: form.prefecture.trim(),
    };
    this.service.creer(dto).subscribe({
      next: (response) => {
        this.creationEnCours.set(false);
        const data = response.data;
        if (!data) {
          this.erreur.set(this.i18n.t('ADMIN.LIVREURS.ERR_CREATION'));
          return;
        }
        this.creation.set(data);
        this.succes.set(this.i18n.t('ADMIN.LIVREURS.SUCCES_CREATION', {
          nom: `${data.livreur.prenom} ${data.livreur.nom}`,
        }));
        this.formulaire.set(formulaireVide());
        this.charger();
      },
      error: (error: unknown) => {
        this.creationEnCours.set(false);
        this.erreur.set(this.messageDe(error, 'ADMIN.LIVREURS.ERR_CREATION'));
      },
    });
  }

  basculerActivite(livreur: LivreurAdminView, estActif: boolean): void {
    if (this.activiteEnCours()) return;
    this.activiteEnCours.set(livreur.id);
    this.erreur.set('');
    this.service.definirActivite(livreur.id, estActif).subscribe({
      next: (response) => {
        this.activiteEnCours.set(null);
        const data = response.data;
        if (!data) {
          this.retablirActivite(livreur);
          this.erreur.set(this.i18n.t('ADMIN.LIVREURS.ERR_ACTIVITE'));
          return;
        }
        this.livreurs.update((items) => items.map((item) =>
          item.id === livreur.id ? data : item));
      },
      error: (error: unknown) => {
        this.activiteEnCours.set(null);
        this.retablirActivite(livreur);
        this.erreur.set(this.messageDe(error, 'ADMIN.LIVREURS.ERR_ACTIVITE'));
      },
    });
  }

  ignorerMotDePasse(): void {
    this.creation.set(null);
  }

  private retablirActivite(livreur: LivreurAdminView): void {
    this.livreurs.update((items) => items.map((item) =>
      item.id === livreur.id ? { ...item, estActif: livreur.estActif } : item));
  }

  private messageDe(error: unknown, cleDefaut: string): string {
    const e = error as { error?: { error?: string; message?: string } };
    return e?.error?.error ?? e?.error?.message ?? this.i18n.t(cleDefaut);
  }
}
