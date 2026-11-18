// Maquette non raccordée : le branchement viendra après.
import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import type { TypePieceAgrement } from '@baobaoheath/shared-types';

import { PiecesAgrementComponent } from '../../../shared/components/pieces-agrement/pieces-agrement.component';
import { PublicShellComponent } from '../../../shared/components/public-shell/public-shell.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { refusLocal } from '../../../shared/components/pieces-agrement/piece-agrement.util';

type TypeEtablissement = 'PHARMACIE' | 'CLINIQUE' | 'LABORATOIRE';

interface FormulaireDemande {
  type: TypeEtablissement;
  nom: string;
  prefecture: string;
  commune: string;
  quartier: string;
  adresse: string;
  telephone: string;
  rccm: string;
  numeroAgrementCreation: string;
  numeroAgrementExploitation: string;
  lieuAutorise: string;
  responsable: {
    prenom: string;
    nom: string;
    telephone: string;
    email: string;
  };
}

interface PieceComplementaire {
  id: string;
  type: 'AUTRE';
  libelle: string;
  fichier: File;
}

const PIECES_ATTENDUES: readonly TypePieceAgrement[] = [
  'AGREMENT_CREATION',
  'AGREMENT_EXPLOITATION',
  'DIPLOME_RESPONSABLE',
  'INSCRIPTION_ORDRE',
];

const COMMUNES_PAR_PREFECTURE: Record<string, string[]> = {
  Conakry: ['Dixinn', 'Matam', 'Ratoma'],
  Coyah: ['Coyah-Centre'],
  Kindia: ['Kindia-Centre'],
  Mamou: ['Mamou-Centre'],
};

@Component({
  selector: 'app-demande-agrement',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    PiecesAgrementComponent,
    PublicShellComponent,
    TranslatePipe,
  ],
  templateUrl: './demande-agrement.component.html',
  styleUrl: './demande-agrement.component.scss',
})
export class DemandeAgrementComponent {
  readonly prefectures = Object.keys(COMMUNES_PAR_PREFECTURE);
  readonly communes = computed(
    () => COMMUNES_PAR_PREFECTURE[this.formulaire().prefecture] ?? [],
  );

  readonly formulaire = signal<FormulaireDemande>({
    type: 'PHARMACIE',
    nom: '',
    prefecture: '',
    commune: '',
    quartier: '',
    adresse: '',
    telephone: '',
    rccm: '',
    numeroAgrementCreation: '',
    numeroAgrementExploitation: '',
    lieuAutorise: '',
    responsable: { prenom: '', nom: '', telephone: '', email: '' },
  });

  readonly pieces = signal<Partial<Record<TypePieceAgrement, File>>>({});
  readonly piecesCompletes = signal(false);
  readonly piecesAutres = signal<PieceComplementaire[]>([]);
  readonly libelleAutre = signal('');
  readonly fichierAutre = signal<File | null>(null);
  readonly erreurAutre = signal<string | null>(null);
  readonly confirmation = signal<string | null>(null);

  private prochainAutreId = 1;
  private prochainNumero = 1;

  readonly formulaireValide = computed(() => {
    const f = this.formulaire();
    const responsable = f.responsable;
    const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsable.email.trim());
    return [
      f.nom,
      f.prefecture,
      f.commune,
      f.quartier,
      f.adresse,
      f.telephone,
      f.rccm,
      f.numeroAgrementCreation,
      f.numeroAgrementExploitation,
      f.lieuAutorise,
      responsable.prenom,
      responsable.nom,
      responsable.telephone,
    ].every((v) => v.trim().length > 0) && emailValide;
  });

  readonly peutEnvoyer = computed(() =>
    this.formulaireValide()
    && this.piecesCompletes()
    && PIECES_ATTENDUES.every((type) => !!this.pieces()[type]),
  );

  modifierChamp<K extends keyof FormulaireDemande>(
    champ: K,
    valeur: FormulaireDemande[K],
  ): void {
    this.formulaire.update((f) => ({ ...f, [champ]: valeur }));
  }

  modifierResponsable<K extends keyof FormulaireDemande['responsable']>(
    champ: K,
    valeur: FormulaireDemande['responsable'][K],
  ): void {
    this.formulaire.update((f) => ({
      ...f,
      responsable: { ...f.responsable, [champ]: valeur },
    }));
  }

  changerPrefecture(prefecture: string): void {
    this.formulaire.update((f) => ({ ...f, prefecture, commune: '' }));
  }

  choisirFichierAutre(evenement: Event): void {
    const champ = evenement.target as HTMLInputElement;
    const fichier = champ.files?.[0] ?? null;
    this.erreurAutre.set(null);
    if (!fichier) {
      this.fichierAutre.set(null);
      return;
    }

    const refus = refusLocal(fichier);
    if (refus) {
      champ.value = '';
      this.fichierAutre.set(null);
      this.erreurAutre.set(refus);
      return;
    }
    champ.value = '';
    this.fichierAutre.set(fichier);
  }

  ajouterPieceAutre(): void {
    const libelle = this.libelleAutre().trim();
    const fichier = this.fichierAutre();
    if (!libelle) {
      this.erreurAutre.set('AGREMENT.DOSSIER.LIBELLE_REQUIS');
      return;
    }
    if (!fichier) {
      this.erreurAutre.set('PUBLIC.STRUCTURE_REQUEST.OTHER_FILE_REQUIRED');
      return;
    }

    this.piecesAutres.update((pieces) => [
      ...pieces,
      { id: `autre-${this.prochainAutreId++}`, type: 'AUTRE', libelle, fichier },
    ]);
    this.libelleAutre.set('');
    this.fichierAutre.set(null);
    this.erreurAutre.set(null);
  }

  retirerPieceAutre(id: string): void {
    this.piecesAutres.update((pieces) => pieces.filter((piece) => piece.id !== id));
  }

  envoyer(): void {
    if (!this.peutEnvoyer()) return;
    const annee = new Date().getFullYear();
    this.confirmation.set(`DA-${annee}-${String(this.prochainNumero++).padStart(4, '0')}`);
  }
}
