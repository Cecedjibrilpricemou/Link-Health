// features/assureur/formulaire-personne — la fiche d'identite d'un assure.
//
// Les champs de la piece d'identite et la photo, partages par les trois
// formulaires qui en ont besoin : ajouter un travailleur, assurer une
// personne a titre individuel, mettre une fiche a jour.
//
// Le parent lit le formulaire par `viewChild` : `valide()`, `donnees()` pour
// une creation, `modifications()` pour une mise a jour, et `photo()`.
//
// Chaque champ est un signal : l'application est zoneless.
import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type {
  ModifierPersonneAssureeDto,
  PersonneAssureeDto,
  PersonneAssureeView,
  TypePieceIdentite,
} from '@baobaoheath/shared-types';

import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { SuggestionsLieuxComponent } from '../../../shared/components/suggestions-lieux/suggestions-lieux.component';
import { GeographieService } from '../../../core/services/geographie.service';

/** Les pieces acceptees, dans l'ordre ou on les rencontre au guichet. */
const TYPES_PIECE: TypePieceIdentite[] = [
  'CARTE_NATIONALE', 'PASSEPORT', 'CARTE_CONSULAIRE', 'PERMIS_CONDUIRE', 'ACTE_NAISSANCE', 'AUTRE',
];
const TYPES_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const TAILLE_PHOTO_MAX = 5 * 1024 * 1024;

/** « 2026-10-21T00:00:00.000Z » -> « 2026-10-21 », la valeur d'un champ date. */
function jour(valeur: string | Date | null | undefined): string {
  if (!valeur) return '';
  return new Date(valeur).toISOString().slice(0, 10);
}

@Component({
  selector: 'app-formulaire-personne',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, TranslatePipe, SuggestionsLieuxComponent],
  templateUrl: './formulaire-personne.component.html',
  styleUrl: './formulaire-personne.component.scss',
})
export class FormulairePersonneComponent implements OnDestroy {
  /** R9 : le nom du niveau (« Prefecture », « LGA »...) et ses lieux viennent du pays installe. */
  readonly geo = inject(GeographieService);

  /** La fiche a modifier ; absente pour une nouvelle personne. */
  initial = input<PersonneAssureeView | null>(null);
  /** L'image de la photo deja enregistree (URL d'objet), s'il y en a une. */
  photoExistante = input<string | null>(null);

  readonly typesPiece = TYPES_PIECE;
  readonly aujourdhui = jour(new Date());

  nom = signal('');
  prenoms = signal('');
  sexe = signal<'M' | 'F' | ''>('');
  dateNaissance = signal('');
  lieuNaissance = signal('');
  nationalite = signal('Guinéenne');
  typePiece = signal<TypePieceIdentite>('CARTE_NATIONALE');
  numeroPiece = signal('');
  dateDelivrance = signal('');
  dateExpiration = signal('');
  telephone = signal('');
  adresse = signal('');
  prefecture = signal('Conakry');

  photo = signal<File | null>(null);
  apercu = signal<string | null>(null);
  erreurPhoto = signal('');

  readonly enEdition = computed(() => !!this.initial());

  readonly valide = computed(() => {
    const identite = this.nom().trim().length >= 1 && this.prenoms().trim().length >= 1 && !!this.sexe()
      && !!this.dateNaissance() && this.dateNaissance() <= this.aujourdhui
      && this.lieuNaissance().trim().length >= 2 && this.nationalite().trim().length >= 2
      && this.numeroPiece().trim().length >= 3
      && (!this.dateDelivrance() || !this.dateExpiration() || this.dateExpiration() > this.dateDelivrance());
    if (this.enEdition()) return identite;
    return identite && this.telephone().replace(/\D/g, '').length >= 9 && this.prefecture().trim().length >= 2;
  });

  constructor() {
    // Une fiche a modifier remplit le formulaire ; en changer le reremplit.
    effect(() => {
      const f = this.initial();
      if (!f) return;
      this.nom.set(f.nom);
      this.prenoms.set(f.prenoms);
      this.sexe.set(f.sexe);
      this.dateNaissance.set(jour(f.dateNaissance));
      this.lieuNaissance.set(f.lieuNaissance);
      this.nationalite.set(f.nationalite);
      this.typePiece.set(f.typePiece);
      this.numeroPiece.set(f.numeroPiece);
      this.dateDelivrance.set(jour(f.dateDelivrancePiece));
      this.dateExpiration.set(jour(f.dateExpirationPiece));
      this.telephone.set(f.telephone);
      this.adresse.set(f.adresse ?? '');
    });
  }

  ngOnDestroy(): void {
    this.liberer();
  }

  /** La personne a creer, telle que l'API l'attend. */
  donnees(): PersonneAssureeDto {
    return {
      nom: this.nom().trim(),
      prenoms: this.prenoms().trim(),
      sexe: this.sexe() as 'M' | 'F',
      dateNaissance: this.dateNaissance(),
      lieuNaissance: this.lieuNaissance().trim(),
      nationalite: this.nationalite().trim(),
      typePiece: this.typePiece(),
      numeroPiece: this.numeroPiece().trim(),
      ...(this.dateDelivrance() ? { dateDelivrancePiece: this.dateDelivrance() } : {}),
      ...(this.dateExpiration() ? { dateExpirationPiece: this.dateExpiration() } : {}),
      telephone: this.telephone().trim(),
      ...(this.adresse().trim() ? { adresse: this.adresse().trim() } : {}),
      prefecture: this.prefecture().trim(),
    };
  }

  /** Seulement ce qui a change par rapport a la fiche : rien d'autre n'est reecrit. */
  modifications(): ModifierPersonneAssureeDto {
    const f = this.initial();
    if (!f) return {};
    const m: ModifierPersonneAssureeDto = {};
    const texte = <K extends 'nom' | 'prenoms' | 'lieuNaissance' | 'nationalite' | 'numeroPiece'>(cle: K, valeur: string) => {
      if (valeur.trim() !== f[cle]) m[cle] = valeur.trim();
    };
    texte('nom', this.nom());
    texte('prenoms', this.prenoms());
    texte('lieuNaissance', this.lieuNaissance());
    texte('nationalite', this.nationalite());
    texte('numeroPiece', this.numeroPiece());
    if (this.sexe() && this.sexe() !== f.sexe) m.sexe = this.sexe() as 'M' | 'F';
    if (this.typePiece() !== f.typePiece) m.typePiece = this.typePiece();
    if (this.dateNaissance() !== jour(f.dateNaissance)) m.dateNaissance = this.dateNaissance();
    if (this.dateDelivrance() && this.dateDelivrance() !== jour(f.dateDelivrancePiece)) m.dateDelivrancePiece = this.dateDelivrance();
    if (this.dateExpiration() && this.dateExpiration() !== jour(f.dateExpirationPiece)) m.dateExpirationPiece = this.dateExpiration();
    if (this.adresse().trim() !== (f.adresse ?? '')) m.adresse = this.adresse().trim();
    return m;
  }

  choisirPhoto(evenement: Event): void {
    const champ = evenement.target as HTMLInputElement;
    const fichier = champ.files?.[0] ?? null;
    champ.value = '';
    this.erreurPhoto.set('');
    if (!fichier) return;
    if (!TYPES_IMAGE.includes(fichier.type)) {
      this.erreurPhoto.set('ASSUREUR.PERSONNE.ERR_FORMAT_PHOTO');
      return;
    }
    if (fichier.size > TAILLE_PHOTO_MAX) {
      this.erreurPhoto.set('ASSUREUR.PERSONNE.ERR_TAILLE_PHOTO');
      return;
    }
    this.liberer();
    this.photo.set(fichier);
    this.apercu.set(URL.createObjectURL(fichier));
  }

  reinitialiser(): void {
    for (const s of [this.nom, this.prenoms, this.dateNaissance, this.lieuNaissance, this.numeroPiece,
      this.dateDelivrance, this.dateExpiration, this.telephone, this.adresse]) s.set('');
    this.sexe.set('');
    this.nationalite.set('Guinéenne');
    this.typePiece.set('CARTE_NATIONALE');
    this.prefecture.set('Conakry');
    this.liberer();
    this.photo.set(null);
  }

  private liberer(): void {
    const url = this.apercu();
    if (url) URL.revokeObjectURL(url);
    this.apercu.set(null);
  }
}
