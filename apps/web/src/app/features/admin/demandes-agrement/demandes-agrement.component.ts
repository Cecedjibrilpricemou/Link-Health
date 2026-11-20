// L'examen des demandes de rattachement, cote administration nationale.
//
// **Une decision ne se reprend pas.** Valider cree la structure et le compte
// de son responsable ; refuser clot le dossier. Le serveur refuse de revenir
// sur un dossier deja decide, et cet ecran n'offre donc plus d'action sur lui
// - plutot que de proposer un bouton qui echouerait.
//
// **Chaque action porte un motif, envoye par courriel au responsable** : la
// mise en verification, la validation, le refus. Le candidat n'a aucun
// compte : ces courriels sont tout ce qu'il voit de l'examen. L'historique du
// dossier garde chaque motif, et dit si le courriel est parti.
//
// Le filtre par etat est applique **par le serveur** : filtrer une liste deja
// recue reviendrait a trier ce qu'on a sous la main en croyant trier tout.
import {
  Component,
  HostListener,
  type OnDestroy,
  type OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type {
  DemandeAgrementListeView,
  DemandeAgrementView,
  PieceDemandeView,
  StatutDemandeAgrement,
} from '@baobaoheath/shared-types';

import { AdminService } from '../../../core/services/admin.service';
import { DemandeAgrementService } from '../../../core/services/demande-agrement.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/** Le motif exige par le serveur : dix caracteres au moins. */
const MOTIF_MINIMUM = 10;

/** Le code d'une compagnie, tel que le serveur l'accepte. */
const FORME_CODE = /^[A-Za-z0-9-]{2,16}$/;

/** Les trois gestes d'un agent sur un dossier ouvert. */
export type ActionExamen = 'ANALYSE' | 'VALIDATION' | 'REFUS';

@Component({
  selector: 'app-demandes-agrement',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, TranslatePipe],
  templateUrl: './demandes-agrement.component.html',
  styleUrl: './demandes-agrement.component.scss',
})
export class DemandesAgrementComponent implements OnInit, OnDestroy {
  private readonly service = inject(DemandeAgrementService);
  private readonly admin = inject(AdminService);
  private readonly i18n = inject(I18nService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly etats: readonly (StatutDemandeAgrement | 'TOUTES')[] = [
    'TOUTES',
    'RECUE',
    'EN_ANALYSE',
    'VALIDEE',
    'REFUSEE',
  ];

  readonly demandes = signal<DemandeAgrementListeView[]>([]);
  readonly filtreEtat = signal<StatutDemandeAgrement | 'TOUTES'>('TOUTES');
  readonly chargement = signal(false);
  readonly erreur = signal<string | null>(null);
  readonly succes = signal<string | null>(null);

  readonly menuOuvert = signal<string | null>(null);
  readonly demandeOuverte = signal<DemandeAgrementView | null>(null);
  readonly action = signal(false);

  /** L'action dont l'agent saisit le motif, ou rien. */
  readonly actionOuverte = signal<ActionExamen | null>(null);
  readonly motif = signal('');
  readonly erreurMotif = signal(false);
  /** Assurance seulement : le code retenu, pre-rempli avec celui propose. */
  readonly codeCorrige = signal('');
  /**
   * La decision est prise, mais le courriel n'est pas parti. Le dire : une
   * validation sans courriel laisse le responsable sans ses identifiants.
   */
  readonly avertissement = signal<string | null>(null);

  /** L'apercu d'une piece, charge par une requete authentifiee. */
  readonly apercu = signal<{ libelle: string; url: SafeResourceUrl } | null>(null);
  private urlApercu: string | null = null;

  /** Un dossier decide ne se reprend pas : plus aucune action sur lui. */
  readonly decidable = computed(() => {
    const statut = this.demandeOuverte()?.statut;
    return statut === 'RECUE' || statut === 'EN_ANALYSE';
  });

  readonly motifSuffisant = computed(() => this.motif().trim().length >= MOTIF_MINIMUM);

  readonly estAssurance = computed(() => this.demandeOuverte()?.type === 'ASSURANCE');

  /** Le code ne bloque que la validation d'une assurance. */
  readonly codeValide = computed(
    () => this.actionOuverte() !== 'VALIDATION' || !this.estAssurance()
      || FORME_CODE.test(this.codeCorrige().trim()),
  );

  ngOnInit(): void {
    this.charger();
  }

  ngOnDestroy(): void {
    this.libererApercu();
  }

  charger(): void {
    this.chargement.set(true);
    this.erreur.set(null);
    this.service.lister(this.filtreEtat()).subscribe({
      next: (r) => {
        this.demandes.set(r.data ?? []);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(this.message(e, 'ADMIN.AGREMENT_REQUESTS.LOAD_ERROR'));
      },
    });
  }

  /** Changer de filtre recharge : le serveur sait ce qu'il n'a pas envoye. */
  changerFiltre(valeur: string): void {
    this.filtreEtat.set(valeur as StatutDemandeAgrement | 'TOUTES');
    this.charger();
  }

  basculerMenu(id: string, evenement?: Event): void {
    evenement?.stopPropagation();
    this.menuOuvert.update((ouvert) => (ouvert === id ? null : id));
  }

  /**
   * Ouvrir un dossier le charge entierement.
   *
   * La liste ne porte pas les pieces ni les references reglementaires : elle
   * sert a trier, pas a instruire. Un agent qui decide doit voir le dossier
   * tel qu'il est au moment ou il decide.
   */
  ouvrirDemande(id: string): void {
    this.menuOuvert.set(null);
    this.reinitialiserDialogue();
    this.service.detail(id).subscribe({
      next: (r) => this.demandeOuverte.set(r.data ?? null),
      error: (e: unknown) => this.erreur.set(this.message(e, 'ADMIN.AGREMENT_REQUESTS.LOAD_ERROR')),
    });
  }

  fermerDialogue(): void {
    this.demandeOuverte.set(null);
    this.reinitialiserDialogue();
  }

  /**
   * Afficher une piece.
   *
   * Par une requete authentifiee et non par un lien : le fichier vit dans le
   * stockage prive, et aucune URL ne doit pouvoir etre devinee. L'adresse
   * temporaire fabriquee ici est liberee des qu'on en change - dix agrements
   * de cinq megaoctets laisses en memoire se voient.
   */
  consulterPiece(piece: PieceDemandeView): void {
    this.libererApercu();
    this.admin.piece(piece.id).subscribe({
      next: (blob) => {
        this.urlApercu = URL.createObjectURL(blob);
        this.apercu.set({
          libelle: piece.libelle,
          // L'adresse est un `blob:` que nous venons de creer a partir d'une
          // reponse de notre propre API : rien d'exterieur n'entre ici.
          url: this.sanitizer.bypassSecurityTrustResourceUrl(this.urlApercu),
        });
      },
      error: (e: unknown) => this.erreur.set(this.message(e, 'ADMIN.AGREMENT_REQUESTS.PIECE_ERROR')),
    });
  }

  /** Refermer l'apercu libere l'adresse temporaire et la memoire du fichier. */
  fermerApercu(): void {
    this.libererApercu();
  }

  /**
   * Ouvrir la saisie du motif d'une action.
   *
   * Rien ne part avant la confirmation : le motif parvient tel quel au
   * candidat, il doit avoir ete ecrit pour lui.
   */
  ouvrirAction(action: ActionExamen): void {
    this.actionOuverte.set(action);
    this.motif.set('');
    this.erreurMotif.set(false);
    this.avertissement.set(null);
    if (action === 'VALIDATION') this.codeCorrige.set(this.demandeOuverte()?.codeAssureur ?? '');
  }

  annulerAction(): void {
    this.actionOuverte.set(null);
    this.motif.set('');
    this.erreurMotif.set(false);
  }

  /** Envoyer l'action ouverte, avec son motif. */
  confirmer(): void {
    const action = this.actionOuverte();
    if (!action) return;
    if (!this.motifSuffisant()) {
      this.erreurMotif.set(true);
      return;
    }
    if (!this.codeValide()) return;
    const motif = this.motif().trim();

    if (action === 'ANALYSE') {
      this.decider((id) => this.service.mettreEnAnalyse(id, motif), 'ADMIN.AGREMENT_REQUESTS.DONE_ANALYSIS');
    } else if (action === 'VALIDATION') {
      // Le code n'est envoye que s'il a ete corrige : sinon le serveur garde
      // celui que la compagnie a propose.
      const code = this.estAssurance() ? this.codeCorrige().trim().toUpperCase() : '';
      const corrige = code && code !== (this.demandeOuverte()?.codeAssureur ?? '') ? code : undefined;
      this.decider((id) => this.service.valider(id, motif, corrige), 'ADMIN.AGREMENT_REQUESTS.DONE_VALIDATED');
    } else {
      this.decider((id) => this.service.refuser(id, motif), 'ADMIN.AGREMENT_REQUESTS.DONE_REFUSED');
    }
  }

  /**
   * Une decision : on l'envoie, on reprend le dossier **tel que le serveur le
   * rend**, et on rafraichit la liste.
   *
   * Ne pas relire le dossier laisserait a l'ecran l'etat d'avant la decision,
   * et l'agent proposerait une seconde action sur un dossier deja clos.
   */
  private decider(
    envoyer: (id: string) => ReturnType<DemandeAgrementService['valider']>,
    cleSucces: string,
  ): void {
    const dossier = this.demandeOuverte();
    if (!dossier || this.action()) return;

    this.action.set(true);
    this.erreur.set(null);
    this.succes.set(null);

    envoyer(dossier.id).subscribe({
      next: (r) => {
        this.action.set(false);
        const rendu = r.data ?? null;
        this.demandeOuverte.set(rendu);
        this.annulerAction();
        // Ce que le serveur a fait, pas ce qu'il aurait du faire : le
        // courriel est-il **parti** ?
        const derniere = rendu?.historique?.at(-1);
        const email = rendu?.responsable.email ?? dossier.responsable.email;
        const succes = this.i18n.t(cleSucces, { numero: dossier.numero });
        if (derniere && !derniere.emailEnvoye) {
          this.succes.set(succes);
          this.avertissement.set(this.i18n.t('ADMIN.AGREMENT_REQUESTS.EMAIL_NOT_SENT', { email }));
        } else {
          this.succes.set(`${succes} ${this.i18n.t('ADMIN.AGREMENT_REQUESTS.EMAIL_SENT', { email })}`);
        }
        this.charger();
      },
      error: (e: unknown) => {
        this.action.set(false);
        this.erreur.set(this.message(e, 'ADMIN.AGREMENT_REQUESTS.DECISION_ERROR'));
      },
    });
  }

  private reinitialiserDialogue(): void {
    this.libererApercu();
    this.annulerAction();
    this.codeCorrige.set('');
    this.succes.set(null);
    this.avertissement.set(null);
  }

  private libererApercu(): void {
    if (this.urlApercu) {
      URL.revokeObjectURL(this.urlApercu);
      this.urlApercu = null;
    }
    this.apercu.set(null);
  }

  /** Le message du serveur s'il en donne un : il est deja ecrit pour l'agent. */
  private message(e: unknown, cleDefaut: string): string {
    const erreur = e as { error?: { error?: string; message?: string } } | null;
    return erreur?.error?.error ?? erreur?.error?.message ?? this.i18n.t(cleDefaut);
  }

  @HostListener('document:click')
  fermerMenu(): void {
    this.menuOuvert.set(null);
  }

  @HostListener('document:keydown.escape')
  echapper(): void {
    this.menuOuvert.set(null);
    this.fermerDialogue();
  }
}
