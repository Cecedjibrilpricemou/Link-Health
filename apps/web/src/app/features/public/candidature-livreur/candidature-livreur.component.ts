// Candidature publique d'un motard livreur.
//
// **Le seul ecran de candidature qui ecrive sans compte.** Un motard qui veut
// rejoindre la plateforme n'a personne pour le proposer : il depose lui-meme
// son dossier, et attend une decision.
//
// Le depot n'est pas encore actif : ENVOI_ACTIF a faux desactive le bouton
// d'envoi et affiche un bandeau d'attente. Le service est pret, la route
// serveur manque.
import { Component, type OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';

import {
  CandidatureLivreurService,
  TYPES_PIECES_LIVREUR,
  type TypePieceLivreur,
  type DepotCandidatureLivreurDto,
} from '../../../core/services/candidature-livreur.service';
import { GeographieService } from '../../../core/services/geographie.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { PublicShellComponent } from '../../../shared/components/public-shell/public-shell.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/** Le depot n'est pas encore raccorde au serveur. */
const ENVOI_ACTIF = false;

/** 5 Mo, comme les pieces d'agrement : un scan de permis depasse souvent 2 Mo. */
const TAILLE_MAX_PIECE = 5 * 1024 * 1024;

/** Les types MIME acceptes : un motard photographie ses papiers. */
const TYPES_ACCEPTES = ['image/jpeg', 'image/png', 'application/pdf'];

/** Les extensions correspondantes, pour les navigateurs qui ne renseignent pas le type. */
const EXTENSIONS_ACCEPTEES = ['.jpg', '.jpeg', '.png', '.pdf'];

interface FormulaireCandidat {
  prenom: string;
  nom: string;
  dateNaissance: string;
  sexe: string;
  telephone: string;
  email: string;
  prefecture: string;
  commune: string;
  quartier: string;
  horsVille: boolean;
}

@Component({
  selector: 'app-candidature-livreur',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    PublicShellComponent,
    TranslatePipe,
  ],
  templateUrl: './candidature-livreur.component.html',
  styleUrl: './candidature-livreur.component.scss',
})
export class CandidatureLivreurComponent implements OnInit {
  private readonly service = inject(CandidatureLivreurService);
  private readonly i18n = inject(I18nService);
  readonly geo = inject(GeographieService);

  readonly envoiActif = ENVOI_ACTIF;
  readonly typesPieces = TYPES_PIECES_LIVREUR;

  readonly prefectures = signal<string[]>([]);
  readonly communes = signal<string[]>([]);

  readonly formulaire = signal<FormulaireCandidat>({
    prenom: '',
    nom: '',
    dateNaissance: '',
    sexe: '',
    telephone: '',
    email: '',
    prefecture: '',
    commune: '',
    quartier: '',
    horsVille: false,
  });

  readonly pieces = signal<Partial<Record<TypePieceLivreur, File>>>({});
  readonly refusPiece = signal<Partial<Record<TypePieceLivreur, string>>>({});
  readonly erreur = signal<string | null>(null);
  readonly envoi = signal(false);
  readonly confirmation = signal<string | null>(null);

  /**
   * L'indicatif du pays installe, tire du referentiel geographique.
   *
   * Il est lu par la methode `indicatif()` plutot que par un computed() : la
   * propriete `indicatifTelephone` est sur l'objet de configuration, qui est
   * un signal — la lecture dans une methode est correcte et toujours fraiche.
   */
  indicatif(): string {
    return this.geo.configuration()?.indicatifTelephone ?? '';
  }

  /**
   * La longueur attendue du numero national, sans indicatif.
   *
   * L'API expose `longueurNumero` dans la configuration geographique
   * (`ParametresPaysView`), mais le type `ConfigurationGeoView` ne le declare
   * pas formellement. La valeur est neanmoins presente dans la reponse JSON
   * grace au spread de `ParametresPaysView`. On la lit sans mentir au
   * compilateur : si elle est absente, on ne controle pas la longueur.
   */
  longueurNumero(): number | null {
    const conf = this.geo.configuration() as Record<string, unknown> | null;
    const v = conf?.['longueurNumero'];
    return typeof v === 'number' ? v : null;
  }

  /**
   * Vrai si la prefecture choisie est Conakry.
   *
   * Methode et non computed : elle lit le signal `formulaire()`, ce qui suffit
   * a reagir. Conakry est la seule « ville-region » dont les communes sont
   * toujours presentes dans le referentiel : la logique d'affichage differe.
   */
  estConakry(): boolean {
    return this.formulaire().prefecture.trim().toLowerCase() === 'conakry';
  }

  /**
   * L'age calcule a partir de la date de naissance saisie.
   *
   * Methode et non computed : un computed() qui lit un champ d'un objet
   * signal ne depend que de la reference de l'objet, ce qui est correct ici
   * puisque `formulaire()` change de reference a chaque mise a jour.
   */
  age(): number | null {
    const dn = this.formulaire().dateNaissance;
    if (!dn) return null;
    const naissance = new Date(dn);
    if (isNaN(naissance.getTime())) return null;
    const aujourd = new Date();
    let a = aujourd.getFullYear() - naissance.getFullYear();
    const m = aujourd.getMonth() - naissance.getMonth();
    if (m < 0 || (m === 0 && aujourd.getDate() < naissance.getDate())) a--;
    return a;
  }

  estMineur(): boolean {
    const a = this.age();
    return a !== null && a < 18;
  }

  /** Nombre de pieces deja jointes (sans erreur). */
  piecesJointes(): number {
    return Object.keys(this.pieces()).length;
  }

  /** Les pieces qui manquent encore, par type. */
  piecesManquantes(): TypePieceLivreur[] {
    const jointes = this.pieces();
    return TYPES_PIECES_LIVREUR.filter((t) => !(t in jointes));
  }

  /**
   * La raison pour laquelle l'envoi est bloque, affichee au-dessus du bouton.
   *
   * Methode : elle lit plusieurs signaux (formulaire, pieces, envoi) et son
   * resultat ne serait pas correctement suivi par un computed() impur.
   */
  raisonBlocage(): string | null {
    if (!ENVOI_ACTIF) return this.i18n.t('PUBLIC.LIVREUR_REQUEST.NOT_ACTIVE_YET');
    if (this.envoi()) return null;

    const f = this.formulaire();
    if (!f.prenom.trim() || !f.nom.trim()) {
      return this.i18n.t('PUBLIC.LIVREUR_REQUEST.MISSING_IDENTITY');
    }
    if (!f.dateNaissance) {
      return this.i18n.t('PUBLIC.LIVREUR_REQUEST.MISSING_BIRTH_DATE');
    }
    if (this.estMineur()) {
      return this.i18n.t('PUBLIC.LIVREUR_REQUEST.MINOR');
    }
    if (!f.sexe) {
      return this.i18n.t('PUBLIC.LIVREUR_REQUEST.MISSING_GENDER');
    }
    if (!this.telephoneValide()) {
      return this.i18n.t('PUBLIC.LIVREUR_REQUEST.MISSING_PHONE');
    }
    if (!f.prefecture.trim()) {
      return this.i18n.t('PUBLIC.LIVREUR_REQUEST.MISSING_ADDRESS');
    }

    const manquantes = this.piecesManquantes();
    if (manquantes.length > 0) {
      return this.i18n.t('PUBLIC.LIVREUR_REQUEST.MISSING_PIECES', {
        jointes: this.piecesJointes(),
        total: TYPES_PIECES_LIVREUR.length,
      });
    }

    return null;
  }

  /**
   * Le telephone est valide si ses chiffres correspondent a la longueur du
   * pays. Sans longueur configuree, on accepte au moins 6 chiffres.
   */
  telephoneValide(): boolean {
    const chiffres = this.formulaire().telephone.replace(/\D/g, '');
    const longueur = this.longueurNumero();
    return longueur ? chiffres.length === longueur : chiffres.length >= 6;
  }

  peutEnvoyer(): boolean {
    if (!ENVOI_ACTIF) return false;
    return this.raisonBlocage() === null && !this.envoi();
  }

  ngOnInit(): void {
    this.geo.chargerConfiguration().subscribe(() => {
      this.geo.nomsSuggeres('elargissement').subscribe((noms) =>
        this.prefectures.set(noms),
      );
    });
  }

  modifierChamp<K extends keyof FormulaireCandidat>(
    champ: K,
    valeur: FormulaireCandidat[K],
  ): void {
    this.formulaire.update((f) => ({ ...f, [champ]: valeur }));
  }

  /**
   * Changer de prefecture vide la commune et recharge la liste.
   *
   * Si la nouvelle prefecture est Conakry, les communes sont chargees d'office.
   * Sinon, elles ne sont chargees que si la case « hors ville » est cochee.
   */
  changerPrefecture(prefecture: string): void {
    this.formulaire.update((f) => ({
      ...f,
      prefecture,
      commune: '',
      horsVille: false,
    }));
    this.communes.set([]);
    if (!prefecture.trim()) return;
    // Conakry : on charge toujours les communes
    if (prefecture.trim().toLowerCase() === 'conakry') {
      this.geo
        .nomsSuggeres('base', prefecture)
        .subscribe((noms) => this.communes.set(noms));
    }
  }

  /**
   * Cocher ou decocher « je ne reside pas dans la ville meme ».
   *
   * Quand la case est cochee, on charge les communes (= sous-prefectures)
   * de la prefecture choisie. Quand elle est decochee, on vide la commune.
   */
  basculerHorsVille(valeur: boolean): void {
    this.formulaire.update((f) => ({
      ...f,
      horsVille: valeur,
      commune: '',
    }));
    this.communes.set([]);
    if (valeur) {
      const pref = this.formulaire().prefecture.trim();
      if (pref) {
        this.geo
          .nomsSuggeres('base', pref)
          .subscribe((noms) => this.communes.set(noms));
      }
    }
  }

  /**
   * Choisir un fichier pour une piece donnee.
   *
   * Les controles sont faits **avant** tout envoi : sur un reseau guineen,
   * decouvrir apres dix minutes de televersement qu'un fichier etait trop
   * gros ou dans un mauvais format se paie en temps perdu.
   */
  choisirPiece(type: TypePieceLivreur, event: Event): void {
    const input = event.target as HTMLInputElement;
    const fichier = input.files?.[0];
    // Remet l'input pour permettre de choisir le meme fichier apres un refus
    input.value = '';
    if (!fichier) return;

    const refus = this.refusPiece();
    const pieces = this.pieces();

    // Controle du format
    const nomLower = fichier.name.toLowerCase();
    const typeOk =
      TYPES_ACCEPTES.includes(fichier.type) ||
      EXTENSIONS_ACCEPTEES.some((ext) => nomLower.endsWith(ext));
    if (!typeOk) {
      this.refusPiece.set({
        ...refus,
        [type]: this.i18n.t('PUBLIC.LIVREUR_REQUEST.PIECE_BAD_FORMAT', {
          piece: this.i18n.t('PUBLIC.LIVREUR_REQUEST.PIECE_' + type),
        }),
      });
      return;
    }

    // Controle de la taille
    if (fichier.size > TAILLE_MAX_PIECE) {
      this.refusPiece.set({
        ...refus,
        [type]: this.i18n.t('PUBLIC.LIVREUR_REQUEST.PIECE_TOO_LARGE', {
          piece: this.i18n.t('PUBLIC.LIVREUR_REQUEST.PIECE_' + type),
          taille: tailleLisible(fichier.size),
        }),
      });
      return;
    }

    if (fichier.size === 0) {
      this.refusPiece.set({
        ...refus,
        [type]: this.i18n.t('PUBLIC.LIVREUR_REQUEST.PIECE_EMPTY'),
      });
      return;
    }

    // Accepte
    const { [type]: _, ...refusRestants } = refus;
    this.refusPiece.set(refusRestants as Partial<Record<TypePieceLivreur, string>>);
    this.pieces.set({ ...pieces, [type]: fichier });
  }

  retirerPiece(type: TypePieceLivreur): void {
    const { [type]: _, ...reste } = this.pieces();
    this.pieces.set(reste as Partial<Record<TypePieceLivreur, File>>);
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

  envoyer(): void {
    if (!this.peutEnvoyer()) return;
    this.envoi.set(true);
    this.erreur.set(null);

    const f = this.formulaire();
    const dto: DepotCandidatureLivreurDto = {
      prenom: f.prenom.trim(),
      nom: f.nom.trim(),
      dateNaissance: f.dateNaissance,
      sexe: f.sexe,
      telephone: f.telephone.trim(),
      ...(f.email.trim() ? { email: f.email.trim() } : {}),
      prefecture: f.prefecture.trim(),
      ...(f.commune.trim() ? { commune: f.commune.trim() } : {}),
      ...(f.quartier.trim() ? { quartier: f.quartier.trim() } : {}),
    };

    this.service.deposer(dto, this.pieces()).subscribe({
      next: (reponse) => {
        this.envoi.set(false);
        const numero = reponse.data?.numero;
        if (!numero) {
          this.erreur.set(this.i18n.t('PUBLIC.LIVREUR_REQUEST.SEND_ERROR'));
          return;
        }
        this.confirmation.set(numero);
      },
      error: (e: { error?: { error?: string; message?: string } }) => {
        this.envoi.set(false);
        this.erreur.set(
          e?.error?.error ??
            e?.error?.message ??
            this.i18n.t('PUBLIC.LIVREUR_REQUEST.SEND_ERROR'),
        );
      },
    });
  }
}

/** `200 Ko`, `2.0 Mo` — jamais `0 Ko`, qui ressemble a un televersement rate. */
function tailleLisible(octets: number): string {
  return octets >= 1024 * 1024
    ? `${(octets / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(octets / 1024))} Ko`;
}
