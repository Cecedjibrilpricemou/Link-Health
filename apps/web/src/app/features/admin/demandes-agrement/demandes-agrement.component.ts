// L'examen des demandes de rattachement, cote administration nationale.
//
// **Une decision ne se reprend pas.** Valider cree la structure et le compte
// de son responsable ; refuser envoie un motif au candidat. Le serveur refuse
// de revenir sur un dossier deja decide, et cet ecran n'offre donc plus
// d'action sur lui - plutot que de proposer un bouton qui echouerait.
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

  readonly saisieMotifOuverte = signal(false);
  readonly motifRefus = signal('');
  readonly erreurMotif = signal(false);

  /** L'apercu d'une piece, charge par une requete authentifiee. */
  readonly apercu = signal<{ libelle: string; url: SafeResourceUrl } | null>(null);
  private urlApercu: string | null = null;

  /** Un dossier decide ne se reprend pas : plus aucune action sur lui. */
  readonly decidable = computed(() => {
    const statut = this.demandeOuverte()?.statut;
    return statut === 'RECUE' || statut === 'EN_ANALYSE';
  });

  readonly motifSuffisant = computed(() => this.motifRefus().trim().length >= MOTIF_MINIMUM);

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

  mettreEnAnalyse(): void {
    this.decider((id) => this.service.mettreEnAnalyse(id), 'ADMIN.AGREMENT_REQUESTS.DONE_ANALYSIS');
  }

  valider(): void {
    this.decider((id) => this.service.valider(id), 'ADMIN.AGREMENT_REQUESTS.DONE_VALIDATED');
  }

  ouvrirSaisieMotif(): void {
    this.saisieMotifOuverte.set(true);
    this.erreurMotif.set(false);
  }

  refuser(): void {
    if (!this.motifSuffisant()) {
      this.erreurMotif.set(true);
      return;
    }
    const motif = this.motifRefus().trim();
    this.decider((id) => this.service.refuser(id, motif), 'ADMIN.AGREMENT_REQUESTS.DONE_REFUSED');
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
        this.demandeOuverte.set(r.data ?? null);
        this.saisieMotifOuverte.set(false);
        this.motifRefus.set('');
        this.erreurMotif.set(false);
        this.succes.set(this.i18n.t(cleSucces, { numero: dossier.numero }));
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
    this.saisieMotifOuverte.set(false);
    this.motifRefus.set('');
    this.erreurMotif.set(false);
    this.succes.set(null);
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
