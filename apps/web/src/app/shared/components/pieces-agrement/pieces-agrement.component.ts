// Les pièces d'agrément à joindre, selon le type de structure.
//
// **La création n'exigeait aucune preuve réglementaire.** Une pharmacie sans
// agrément, une clinique sans autorisation d'exploitation entraient sur la
// plateforme comme les autres. Depuis le 2026-10-28, le dossier bloque.
//
// Partagé par les deux écrans qui créent — les structures côté administration
// nationale, les pharmacies côté établissement. Les dupliquer aurait fait
// diverger la liste des pièces exigées.
//
// Les contrôles faits ici **ne remplacent pas ceux du serveur**, qui lit les
// octets de tête de chaque fichier. Ils existent pour une raison pratique :
// sur un réseau guinéen, découvrir après dix minutes d'envoi qu'un fichier
// était trop gros ou n'était pas un PDF se paie en temps perdu.
import { Component, computed, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { TypePieceAgrement } from '@baobaoheath/shared-types';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { refusLocal, tailleLisible } from './piece-agrement.util';

/**
 * Ce que chaque type doit produire, **pour les écrans d'administration
 * seulement**.
 *
 * Copie assumée de la table du serveur, qui reste seul juge : l'écran ne peut
 * pas deviner une règle qu'il n'appliquerait qu'à moitié, mais il doit savoir
 * quoi demander avant d'envoyer quoi que ce soit.
 *
 * **Elle ne connaît pas les hôpitaux publics**, et c'est juste ici : à la
 * création administrative, l'administration sait ce qu'elle crée et n'a rien à
 * produire. Une demande d'agrément, elle, vient de n'importe qui : le serveur
 * en exige trois pièces, et le formulaire public reçoit donc sa liste par
 * `requisesImposees` plutôt que de la lire ici.
 */
const PIECES_PAR_TYPE: Readonly<Record<string, readonly TypePieceAgrement[]>> = {
  PHARMACIE: ['AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE'],
  CLINIQUE: ['AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE'],
  LABORATOIRE: ['AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE'],
  ASSURANCE: ['AGREMENT_ASSURANCE', 'EXTRAIT_RCCM', 'PIECE_IDENTITE_RESPONSABLE', 'CERTIFICAT_RESIDENCE_RESPONSABLE'],
};

/**
 * Deux listes identiques le sont-elles pour Angular ?
 *
 * **Sans ces comparaisons, un fichier choisi disparaissait aussitot.** Les
 * appelants construisent `requisesImposees` et `libellesImposes` dans des
 * methodes, avec `.map()` : un tableau neuf a chaque detection de changement.
 * Angular compare les entrees par identite, voyait donc une valeur nouvelle a
 * chaque passe, rejouait l'effet qui remet les choix a zero — et bouclait.
 *
 * Comparer le contenu plutot que l'identite remet les choses d'aplomb pour
 * tous les appelants a la fois, plutot que d'exiger de chacun qu'il stabilise
 * ses references et se souvienne de le faire la prochaine fois.
 */
function memeListe(
  a: readonly TypePieceAgrement[] | null,
  b: readonly TypePieceAgrement[] | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.length === b.length && a.every((type, i) => type === b[i]);
}

@Component({
  selector: 'app-pieces-agrement',
  standalone: true,
  imports: [CommonModule, MatIconModule, TranslatePipe],
  templateUrl: './pieces-agrement.component.html',
  styleUrl: './pieces-agrement.component.scss',
})
export class PiecesAgrementComponent {
  /** Le type de structure en cours de création. */
  readonly type = input.required<string>();

  /**
   * Vrai quand la structure opère sous l'autorisation d'une autre — une
   * pharmacie hospitalière. Elle n'a pas d'agrément propre à produire.
   */
  readonly sousAutoriteDuParent = input(false);

  readonly pieces = output<Partial<Record<TypePieceAgrement, File>>>();
  /** Le parent désactive son bouton d'envoi tant que c'est faux. */
  readonly complet = output<boolean>();

  readonly choisies = signal<Partial<Record<TypePieceAgrement, File>>>({});
  readonly refus = signal<Partial<Record<TypePieceAgrement, string>>>({});

  /**
   * La liste des pièces exigées, imposée par l'appelant.
   *
   * Le formulaire public de demande d'agrément la tient du serveur, et elle
   * prime alors sur la table locale : celle-ci ne connaît pas les hôpitaux
   * publics, dont l'API exige pourtant trois pièces. Laissée nulle — le cas
   * des écrans d'administration —, la table locale continue de décider.
   */
  readonly requisesImposees = input<readonly TypePieceAgrement[] | null>(null);

  /**
   * La meme liste, mais dont l'identite ne change que si le contenu change.
   *
   * **Sans cet intermediaire, un fichier choisi disparaissait aussitot.** Les
   * appelants construisent la liste dans une methode, avec `.map()` : un
   * tableau neuf a chaque detection de changement. Angular compare les
   * entrees par identite — et n'accepte pas de comparateur sur une entree —,
   * donc tout ce qui lit cette entree se rejouait a chaque passe, y compris
   * l'effet qui remet les choix a zero. La detection bouclait, et le fichier
   * a peine choisi etait efface.
   *
   * `computed` accepte, lui, une egalite sur le contenu : ses dependants ne
   * sont prevenus que si la liste a vraiment change. Tous les appelants en
   * profitent, sans avoir a stabiliser leurs references ni a y penser la
   * prochaine fois.
   */
  private readonly imposeesStables = computed(() => this.requisesImposees(), { equal: memeListe });

  /**
   * Les libellés venus du serveur, par type de pièce.
   *
   * La même pièce ne porte pas le même nom partout : `AGREMENT_CREATION` est
   * « l'agrément de création » d'une officine et « l'acte de création » d'un
   * CHU. Un directeur d'hôpital cherchant un « agrément » dans ses archives
   * ne trouverait rien. À défaut, le catalogue de traduction reprend la main.
   */
  readonly libellesImposes = input<Readonly<Partial<Record<TypePieceAgrement, string>>>>({});

  readonly requises = computed<readonly TypePieceAgrement[]>(() => {
    if (this.sousAutoriteDuParent()) return [];
    return this.imposeesStables() ?? PIECES_PAR_TYPE[this.type()] ?? [];
  });

  readonly exigeDesPieces = computed(() => this.requises().length > 0);

  readonly manquantes = computed(() => {
    const prises = this.choisies();
    return this.requises().filter((p) => !prises[p]);
  });

  constructor() {
    // Changer de type change la liste des pièces exigées : les fichiers déjà
    // choisis pour un autre type ne doivent pas rester. Sans cette remise à
    // zéro, on enverrait le diplôme saisi pour une clinique avec un poste de
    // santé, qui n'en demande aucun.
    effect(() => {
      this.type();
      this.sousAutoriteDuParent();
      // La liste imposée arrive du serveur, donc après le premier affichage.
      // Sans cette lecture, l'effet ne se rejouerait pas quand elle arrive et
      // `complet` resterait à vrai — calculé sur une liste encore vide. Le
      // parent croirait son dossier complet sans une seule pièce.
      //
      // On lit la version stabilisee, et non l'entree : celle-ci change
      // d'identite a chaque detection de changement, ce qui rejouerait cet
      // effet sans cesse et effacerait le fichier a peine choisi.
      this.imposeesStables();
      this.choisies.set({});
      this.refus.set({});
      this.pieces.emit({});
      this.complet.emit(this.requises().length === 0);
    });
  }

  /** Le nom du fichier retenu, pour l'afficher à la place du champ vide. */
  nomDe(piece: TypePieceAgrement): string | null {
    return this.choisies()[piece]?.name ?? null;
  }

  tailleDe(piece: TypePieceAgrement): string {
    return tailleLisible(this.choisies()[piece]?.size ?? 0);
  }

  refusDe(piece: TypePieceAgrement): string | null {
    return this.refus()[piece] ?? null;
  }

  /** Le libellé du serveur, ou rien — le gabarit retombe alors sur le catalogue. */
  libelleImpose(piece: TypePieceAgrement): string | null {
    return this.libellesImposes()[piece] ?? null;
  }

  choisir(piece: TypePieceAgrement, evenement: Event) {
    const champ = evenement.target as HTMLInputElement;
    const fichier = champ.files?.[0] ?? null;
    this.refus.update((r) => ({ ...r, [piece]: undefined }));

    if (!fichier) {
      this.retirer(piece);
      return;
    }

    // Refus avant l'envoi, pour ne pas faire monter 20 Mo inutilement. Le
    // serveur, lui, lit les octets de tête : c'est lui qui fait foi.
    const refuse = refusLocal(fichier);
    if (refuse) {
      champ.value = '';
      this.refus.update((r) => ({ ...r, [piece]: refuse }));
      this.retirer(piece);
      return;
    }

    this.choisies.update((c) => ({ ...c, [piece]: fichier }));
    this.emettre();
  }

  retirer(piece: TypePieceAgrement) {
    this.choisies.update((c) => {
      const copie = { ...c };
      delete copie[piece];
      return copie;
    });
    this.emettre();
  }

  private emettre() {
    this.pieces.emit(this.choisies());
    this.complet.emit(this.manquantes().length === 0);
  }
}
