// Demande publique de rattachement d'un etablissement a la plateforme.
//
// **Le seul ecran de l'application qui ecrive sans compte.** Un etablissement
// qui n'est pas encore sur la plateforme n'a personne pour l'y inscrire : il
// depose lui-meme son dossier, et attend une decision.
//
// Trois choses viennent du serveur et ne sont **jamais** recopiees ici :
//   - la liste des types qui se demandent ;
//   - les pieces exigees de chaque type, toutes obligatoires ;
//   - le libelle de chaque piece, qui change avec le type - « agrement de
//     creation » pour une officine, « acte de creation » pour un CHU.
// Une liste recopiee finirait par mentir le jour ou l'administration exigera
// une piece de plus, et personne ne s'en apercevrait avant un refus.
//
// **Une compagnie d'assurance depose ici aussi**, depuis le 2026-11-20 : la
// tuile « Inscrire mon assurance » de l'accueil ouvre ce formulaire deja regle
// sur ce type (`?type=ASSURANCE`). Elle y propose en plus le code de ses
// cartes et son mode d'echange ; sa seule reference d'agrement est celle de
// la Banque Centrale.
import { Component, type OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import type { PiecesAttenduesView, TypePieceAgrement } from '@baobaoheath/shared-types';

import {
  DemandeAgrementService,
  type DepotDemandeDto,
} from '../../../core/services/demande-agrement.service';
import { GeographieService } from '../../../core/services/geographie.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { PiecesAgrementComponent } from '../../../shared/components/pieces-agrement/pieces-agrement.component';
import { PublicShellComponent } from '../../../shared/components/public-shell/public-shell.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

interface FormulaireDemande {
  type: string;
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
  /** Assurance seulement : le code propose pour les cartes des assures. */
  codeAssureur: string;
  /** Assurance seulement ; vide tant que la compagnie ne sait pas. */
  modeEchange: '' | 'MANUEL' | 'PORTAIL' | 'API';
  responsable: {
    prenom: string;
    nom: string;
    telephone: string;
    email: string;
  };
}

/** Le code d'une compagnie, tel que le serveur l'accepte. */
const FORME_CODE = /^[A-Za-z0-9-]{2,16}$/;

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
export class DemandeAgrementComponent implements OnInit {
  private readonly service = inject(DemandeAgrementService);
  private readonly i18n = inject(I18nService);
  private readonly route = inject(ActivatedRoute);
  readonly geo = inject(GeographieService);

  readonly modesEchange = ['MANUEL', 'PORTAIL', 'API'] as const;

  readonly prefectures = signal<string[]>([]);
  readonly communes = signal<string[]>([]);

  /** Ce que le serveur exige, par type. Vide tant qu'il n'a pas repondu. */
  readonly attendues = signal<PiecesAttenduesView[]>([]);

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
    codeAssureur: '',
    modeEchange: '',
    responsable: { prenom: '', nom: '', telephone: '', email: '' },
  });

  readonly pieces = signal<Partial<Record<TypePieceAgrement, File>>>({});
  readonly piecesCompletes = signal(false);
  readonly confirmation = signal<string | null>(null);
  readonly erreur = signal<string | null>(null);
  readonly envoi = signal(false);

  /**
   * Les types proposes, dans l'ordre ou le serveur les donne.
   *
   * La liste recue couvre **tous** les types qui produisent un dossier, y
   * compris ceux que l'administration cree elle-meme - un poste, un centre,
   * un assureur. Seuls les types demandables figurent ici : proposer les
   * autres ferait deposer un dossier que l'API refuserait.
   */
  readonly typesProposes = computed(() =>
    this.attendues().filter((a) => a.demandable).map((a) => a.type),
  );

  private readonly entreeDuType = computed(
    () => this.attendues().find((a) => a.type === this.formulaire().type) ?? null,
  );

  /**
   * Vrai pour les trois hopitaux publics.
   *
   * Un hopital prefectoral, un hopital regional ou un CHU est cree par un acte
   * de l'Etat : il n'a ni registre du commerce, ni arrete d'exploitation
   * distinct. Les lui demander serait un obstacle invente, et le serveur
   * efface de toute facon ces deux champs chez eux.
   */
  readonly estPublique = computed(() => this.entreeDuType()?.estPublique ?? false);

  /**
   * Une compagnie d'assurance : elle releve de la Banque Centrale, pas du
   * ministere de la Sante. Une seule reference d'agrement, pas d'arrete
   * d'exploitation, et le code de ses cartes a proposer.
   */
  readonly estAssurance = computed(() => this.formulaire().type === 'ASSURANCE');

  /** Le code propose a-t-il la forme attendue ? Vide, il n'est pas encore faux. */
  readonly codeIncorrect = computed(() => {
    const code = this.formulaire().codeAssureur.trim();
    return code.length > 0 && !FORME_CODE.test(code);
  });

  /**
   * Les pieces a reclamer, telles que le serveur les exige.
   *
   * Nul tant qu'il n'a pas repondu : le composant des pieces retombe alors sur
   * sa propre table, qui vaut pour les trois types prives.
   */
  readonly requisesImposees = computed<readonly TypePieceAgrement[] | null>(() => {
    const entree = this.entreeDuType();
    return entree ? entree.pieces.map((p) => p.type) : null;
  });

  readonly libellesImposes = computed<Partial<Record<TypePieceAgrement, string>>>(() => {
    const libelles: Partial<Record<TypePieceAgrement, string>> = {};
    for (const piece of this.entreeDuType()?.pieces ?? []) libelles[piece.type] = piece.libelle;
    return libelles;
  });

  /**
   * Ce qui est exige, selon le type.
   *
   * La liste suit **exactement** celle du serveur : le quartier y est
   * facultatif, et une etoile de plus a l'ecran ne ferait que bloquer un
   * dossier que l'API aurait accepte.
   */
  readonly formulaireValide = computed(() => {
    const f = this.formulaire();
    const r = f.responsable;
    const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim());
    const communs = [
      f.nom, f.prefecture, f.commune, f.adresse, f.telephone,
      r.prenom, r.nom, r.telephone,
    ];
    const reglementaires = this.estPublique()
      ? [f.numeroAgrementCreation]
      : this.estAssurance()
        ? [f.rccm, f.numeroAgrementCreation, f.lieuAutorise]
        : [f.rccm, f.numeroAgrementCreation, f.numeroAgrementExploitation, f.lieuAutorise];
    const codeValide = !this.estAssurance() || FORME_CODE.test(f.codeAssureur.trim());
    return [...communs, ...reglementaires].every((v) => v.trim().length > 0) && emailValide && codeValide;
  });

  readonly peutEnvoyer = computed(
    () => this.formulaireValide() && this.piecesCompletes() && !this.envoi(),
  );

  ngOnInit(): void {
    // `?type=ASSURANCE` : la tuile de l'accueil ouvre le formulaire deja
    // regle. Le type n'est retenu que si le serveur le dit demandable.
    const typeDemande = this.route.snapshot.queryParamMap.get('type');
    this.service.piecesAttendues().subscribe({
      next: (r) => {
        this.attendues.set(r.data ?? []);
        if (typeDemande && this.typesProposes().includes(typeDemande)) {
          this.modifierChamp('type', typeDemande);
        }
      },
      // Sans cette liste, le composant des pieces retombe sur sa table locale
      // et le dossier d'un hopital serait refuse par le serveur. On le dit
      // plutot que de laisser le candidat televerser pour rien.
      error: () => this.erreur.set(this.i18n.t('PUBLIC.STRUCTURE_REQUEST.PIECES_UNAVAILABLE')),
    });

    this.geo.chargerConfiguration().subscribe(() => {
      this.geo.nomsSuggeres('elargissement').subscribe((noms) => this.prefectures.set(noms));
    });
  }

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

  /**
   * Changer de prefecture vide la commune et recharge la liste.
   *
   * Garder la commune precedente laisserait « Dixinn » sous « Kankan » : le
   * serveur l'accepterait, et la structure serait introuvable sur la carte.
   */
  changerPrefecture(prefecture: string): void {
    this.formulaire.update((f) => ({ ...f, prefecture, commune: '' }));
    this.communes.set([]);
    if (!prefecture.trim()) return;
    this.geo.nomsSuggeres('base', prefecture).subscribe((noms) => this.communes.set(noms));
  }

  /** Le dossier a envoyer : les champs vides et ceux qui ne concernent pas ce type partent. */
  private aEnvoyer(): DepotDemandeDto {
    const f = this.formulaire();
    const texte = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);
    const hopital = this.estPublique();
    const assurance = this.estAssurance();

    return {
      type: f.type,
      nom: f.nom.trim(),
      prefecture: f.prefecture.trim(),
      commune: f.commune.trim(),
      ...(texte(f.quartier) ? { quartier: f.quartier.trim() } : {}),
      adresse: f.adresse.trim(),
      telephone: f.telephone.trim(),
      // Un hopital public n'a ni l'un ni l'autre : les envoyer quand meme
      // ferait croire plus tard qu'il en possede.
      ...(hopital || !texte(f.rccm) ? {} : { rccm: f.rccm.trim() }),
      ...(texte(f.numeroAgrementCreation)
        ? { numeroAgrementCreation: f.numeroAgrementCreation.trim() }
        : {}),
      // Une assurance n'a pas d'arrete d'exploitation : sa seule reference
      // est celle de la Banque Centrale.
      ...(hopital || assurance || !texte(f.numeroAgrementExploitation)
        ? {}
        : { numeroAgrementExploitation: f.numeroAgrementExploitation.trim() }),
      ...(texte(f.lieuAutorise) ? { lieuAutorise: f.lieuAutorise.trim() } : {}),
      ...(assurance ? { codeAssureur: f.codeAssureur.trim().toUpperCase() } : {}),
      ...(assurance && f.modeEchange ? { modeEchange: f.modeEchange } : {}),
      responsable: {
        prenom: f.responsable.prenom.trim(),
        nom: f.responsable.nom.trim(),
        telephone: f.responsable.telephone.trim(),
        email: f.responsable.email.trim(),
      },
    };
  }

  /**
   * Envoyer le dossier.
   *
   * En cas d'echec, **la saisie et les fichiers choisis restent en place** :
   * sur un reseau guineen, perdre dix minutes de televersement parce qu'un
   * champ a ete refuse se paie en abandon.
   */
  envoyer(): void {
    if (!this.peutEnvoyer()) return;
    this.envoi.set(true);
    this.erreur.set(null);

    this.service.deposer(this.aEnvoyer(), this.pieces()).subscribe({
      next: (reponse) => {
        this.envoi.set(false);
        const numero = reponse.data?.numero;
        if (!numero) {
          this.erreur.set(this.i18n.t('PUBLIC.STRUCTURE_REQUEST.SEND_ERROR'));
          return;
        }
        // Le numero vient de l'API. L'ecran n'en fabrique aucun : un faux
        // numero de dossier ne servirait a rien au telephone.
        this.confirmation.set(numero);
      },
      error: (e: { error?: { error?: string; message?: string } }) => {
        this.envoi.set(false);
        this.erreur.set(
          e?.error?.error
            ?? e?.error?.message
            ?? this.i18n.t('PUBLIC.STRUCTURE_REQUEST.SEND_ERROR'),
        );
      },
    });
  }
}
