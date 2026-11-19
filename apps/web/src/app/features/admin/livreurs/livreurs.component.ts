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
import {
  refusPieceLivreur,
  tailleLisible,
  TYPES_PIECES_LIVREUR,
  type TypePieceLivreur,
} from '../../../core/services/candidature-livreur.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { GeographieService } from '../../../core/services/geographie.service';
import { SuggestionsLieuxComponent } from '../../../shared/components/suggestions-lieux/suggestions-lieux.component';

/** Tous les champs en texte : le sexe et l'email se resolvent a l'envoi. */
type FormulaireLivreur = { [K in keyof Required<CreerLivreurDto>]: string };

/** Le seul champ qu'on peut laisser vide : beaucoup de motards n'ont pas d'email. */
const CHAMPS_FACULTATIFS: readonly (keyof FormulaireLivreur)[] = ['email'];

/** Majeur, comme l'exige le serveur. */
const AGE_MINIMUM = 18;

function formulaireVide(): FormulaireLivreur {
  return {
    prenom: '', nom: '', dateNaissance: '', sexe: '', telephone: '', email: '',
    quartier: '', commune: '', prefecture: '',
  };
}

/** L'age revolu aujourd'hui, ou `null` si la date ne se lit pas. */
function ageDe(dateNaissance: string): number | null {
  const naissance = new Date(dateNaissance);
  if (!dateNaissance || isNaN(naissance.getTime())) return null;
  const aujourd = new Date();
  let age = aujourd.getFullYear() - naissance.getFullYear();
  const m = aujourd.getMonth() - naissance.getMonth();
  if (m < 0 || (m === 0 && aujourd.getDate() < naissance.getDate())) age -= 1;
  return age;
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
    SuggestionsLieuxComponent,
  ],
  templateUrl: './livreurs.component.html',
  styleUrl: './livreurs.component.scss',
})
export class LivreursComponent implements OnInit {
  private readonly service = inject(LivreurAdminService);
  private readonly i18n = inject(I18nService);
  /** M1 : « Commune », « LGA »... selon le pays installe. */
  readonly geo = inject(GeographieService);

  readonly livreurs = signal<LivreurAdminView[]>([]);
  readonly chargement = signal(true);
  readonly creationEnCours = signal(false);
  readonly activiteEnCours = signal<string | null>(null);
  readonly erreur = signal('');
  readonly succes = signal('');
  /** Le mot de passe a communiquer, quand il n'est pas parti par courriel. */
  readonly creation = signal<{ livreur: LivreurAdminView; motDePasseTemporaire: string } | null>(null);

  // Tous les champs sont exiges ici, sauf l'email : la commune est la zone
  // qui decide quelles courses le livreur voit et recoit.
  readonly formulaire = signal<FormulaireLivreur>(formulaireVide());

  /**
   * Les six pieces du dossier. **Un livreur cree ici a le meme dossier que
   * celui qui candidate** : sans elles, on ne saurait pas sur quoi il a ete
   * admis, et cette porte deviendrait celle par ou l'on passe pour eviter
   * d'en fournir.
   */
  readonly typesPieces = TYPES_PIECES_LIVREUR;
  readonly pieces = signal<Partial<Record<TypePieceLivreur, File>>>({});
  readonly refusPiece = signal<Partial<Record<TypePieceLivreur, string>>>({});

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  ngOnInit(): void {
    this.charger();
    this.geo.chargerConfiguration().subscribe();
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

  /** Methode et non computed : elle lit le formulaire, un signal. */
  estMineur(): boolean {
    const age = ageDe(this.formulaire().dateNaissance);
    return age !== null && age < AGE_MINIMUM;
  }

  piecesManquantes(): TypePieceLivreur[] {
    const jointes = this.pieces();
    return TYPES_PIECES_LIVREUR.filter((t) => !(t in jointes));
  }

  peutCreer(): boolean {
    const form = this.formulaire();
    const champsRemplis = (Object.keys(form) as (keyof FormulaireLivreur)[])
      .filter((champ) => !CHAMPS_FACULTATIFS.includes(champ))
      .every((champ) => form[champ].trim().length > 0);
    return champsRemplis
      && !this.estMineur()
      && this.piecesManquantes().length === 0
      && !this.creationEnCours();
  }

  /** Les memes controles que l'ecran public, lus au meme endroit. */
  choisirPiece(type: TypePieceLivreur, event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichier = input.files?.[0];
    input.value = '';
    if (!fichier) return;

    const motif = refusPieceLivreur(fichier);
    if (motif) {
      this.refusPiece.update((r) => ({
        ...r,
        [type]: this.i18n.t(`PUBLIC.LIVREUR_REQUEST.${motif}`, {
          piece: this.i18n.t('PUBLIC.LIVREUR_REQUEST.PIECE_' + type),
          taille: tailleLisible(fichier.size),
        }),
      }));
      return;
    }
    this.refusPiece.update(({ [type]: _, ...reste }) => reste as Partial<Record<TypePieceLivreur, string>>);
    this.pieces.update((p) => ({ ...p, [type]: fichier }));
  }

  retirerPiece(type: TypePieceLivreur): void {
    this.pieces.update(({ [type]: _, ...reste }) => reste as Partial<Record<TypePieceLivreur, File>>);
  }

  nomDe(type: TypePieceLivreur): string | null {
    return this.pieces()[type]?.name ?? null;
  }

  tailleDe(type: TypePieceLivreur): string {
    const f = this.pieces()[type];
    return f ? tailleLisible(f.size) : '';
  }

  refusDe(type: TypePieceLivreur): string | null {
    return this.refusPiece()[type] ?? null;
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
      dateNaissance: form.dateNaissance,
      sexe: form.sexe as CreerLivreurDto['sexe'],
      telephone: form.telephone.trim(),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      quartier: form.quartier.trim(),
      commune: form.commune.trim(),
      prefecture: form.prefecture.trim(),
    };
    this.service.creer(dto, this.pieces()).subscribe({
      next: (response) => {
        this.creationEnCours.set(false);
        const data = response.data;
        if (!data) {
          this.erreur.set(this.i18n.t('ADMIN.LIVREURS.ERR_CREATION'));
          return;
        }
        // Parti par courriel, le mot de passe n'a pas a s'afficher : l'agent
        // n'a aucune raison de connaitre celui d'un tiers.
        const motDePasse = data.motDePasseTemporaire;
        this.creation.set(motDePasse ? { livreur: data.livreur, motDePasseTemporaire: motDePasse } : null);
        const nom = `${data.livreur.prenom} ${data.livreur.nom}`;
        this.succes.set(this.i18n.t(
          motDePasse ? 'ADMIN.LIVREURS.SUCCES_CREATION' : 'ADMIN.LIVREURS.SUCCES_CREATION_EMAIL',
          { nom, numero: data.numeroDossier },
        ));
        this.formulaire.set(formulaireVide());
        this.pieces.set({});
        this.refusPiece.set({});
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
