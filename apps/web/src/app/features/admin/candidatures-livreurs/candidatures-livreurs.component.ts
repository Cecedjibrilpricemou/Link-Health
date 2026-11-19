// L'examen des candidatures de motards livreurs.
//
// **Le meme ecran que l'examen des demandes d'agrement, et la meme feuille de
// style** : un agent qui passe de l'un a l'autre retrouve les memes gestes -
// filtrer, ouvrir, consulter chaque piece, prendre en charge, valider ou
// refuser avec un motif. Les styles sont lus a la source plutot que recopies,
// pour que les deux ecrans ne divergent jamais.
//
// **Une decision ne se reprend pas.** Valider cree le compte du livreur ;
// refuser envoie le motif au candidat qui a un email. Le serveur refuse de
// revenir sur un dossier decide, et cet ecran n'offre plus d'action sur lui.
//
// **Le mot de passe s'affiche une fois, et seulement s'il le faut** : quand
// le livreur n'a pas d'email, ou que le courriel n'est pas parti. Sinon
// l'agent ne le voit jamais. Il s'affiche sur la page et non dans le dossier,
// et y reste jusqu'a ce que l'agent dise l'avoir note : une touche Echap
// malheureuse ne doit pas laisser un livreur sans aucun moyen d'entrer.
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
import type { Observable } from 'rxjs';
import type {
  CandidatureLivreurListeView,
  CandidatureLivreurView,
  PieceCandidatureLivreurView,
  StatutCandidatureLivreur,
} from '@baobaoheath/shared-types';

import { CandidatureLivreurService } from '../../../core/services/candidature-livreur.service';
import { GeographieService } from '../../../core/services/geographie.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

/** Le motif exige par le serveur : dix caracteres au moins. */
const MOTIF_MINIMUM = 10;

@Component({
  selector: 'app-candidatures-livreurs',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, TranslatePipe],
  templateUrl: './candidatures-livreurs.component.html',
  styleUrls: [
    '../demandes-agrement/demandes-agrement.component.scss',
    './candidatures-livreurs.component.scss',
  ],
})
export class CandidaturesLivreursComponent implements OnInit, OnDestroy {
  private readonly service = inject(CandidatureLivreurService);
  private readonly i18n = inject(I18nService);
  private readonly sanitizer = inject(DomSanitizer);
  /** « Commune », « Préfecture »... selon le pays installe. */
  readonly geo = inject(GeographieService);

  readonly etats: readonly (StatutCandidatureLivreur | 'TOUTES')[] = [
    'TOUTES',
    'RECUE',
    'EN_ANALYSE',
    'VALIDEE',
    'REFUSEE',
  ];

  readonly candidatures = signal<CandidatureLivreurListeView[]>([]);
  readonly filtreEtat = signal<StatutCandidatureLivreur | 'TOUTES'>('TOUTES');
  readonly chargement = signal(false);
  readonly erreur = signal<string | null>(null);
  readonly succes = signal<string | null>(null);

  readonly menuOuvert = signal<string | null>(null);
  readonly candidatureOuverte = signal<CandidatureLivreurView | null>(null);
  readonly action = signal(false);

  readonly saisieMotifOuverte = signal(false);
  readonly motifRefus = signal('');
  readonly erreurMotif = signal(false);

  /** Le mot de passe a communiquer au livreur, quand il n'a pas pu partir. */
  readonly motDePasse = signal<{ nom: string; motDePasse: string } | null>(null);

  /** L'apercu d'une piece, charge par une requete authentifiee. */
  readonly apercu = signal<{ libelle: string; url: SafeResourceUrl } | null>(null);
  private urlApercu: string | null = null;

  /** Un dossier decide ne se reprend pas : plus aucune action sur lui. */
  readonly decidable = computed(() => {
    const statut = this.candidatureOuverte()?.statut;
    return statut === 'RECUE' || statut === 'EN_ANALYSE';
  });

  readonly motifSuffisant = computed(() => this.motifRefus().trim().length >= MOTIF_MINIMUM);

  ngOnInit(): void {
    this.geo.chargerConfiguration().subscribe();
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
        this.candidatures.set(r.data ?? []);
        this.chargement.set(false);
      },
      error: (e: unknown) => {
        this.chargement.set(false);
        this.erreur.set(this.message(e, 'ADMIN.LIVREUR_REQUESTS.LOAD_ERROR'));
      },
    });
  }

  /** Changer de filtre recharge : le serveur sait ce qu'il n'a pas envoye. */
  changerFiltre(valeur: string): void {
    this.filtreEtat.set(valeur as StatutCandidatureLivreur | 'TOUTES');
    this.charger();
  }

  basculerMenu(id: string, evenement?: Event): void {
    evenement?.stopPropagation();
    this.menuOuvert.update((ouvert) => (ouvert === id ? null : id));
  }

  /**
   * Ouvrir un dossier le charge entierement : un agent qui decide doit voir
   * le dossier tel qu'il est au moment ou il decide, pieces comprises.
   */
  ouvrirCandidature(id: string): void {
    this.menuOuvert.set(null);
    this.reinitialiserDialogue();
    this.service.detail(id).subscribe({
      next: (r) => this.candidatureOuverte.set(r.data ?? null),
      error: (e: unknown) => this.erreur.set(this.message(e, 'ADMIN.LIVREUR_REQUESTS.LOAD_ERROR')),
    });
  }

  fermerDialogue(): void {
    this.candidatureOuverte.set(null);
    this.reinitialiserDialogue();
  }

  /** Le nom d'une piece, tel que le motard l'a vu en la deposant. */
  libellePiece(piece: PieceCandidatureLivreurView): string {
    return this.i18n.t('PUBLIC.LIVREUR_REQUEST.PIECE_' + piece.type);
  }

  /** Une photo ou un PDF : l'icone le dit avant meme d'ouvrir. */
  estImage(piece: PieceCandidatureLivreurView): boolean {
    return piece.typeMime.startsWith('image/');
  }

  /**
   * Afficher une piece, par une requete authentifiee et non par un lien : le
   * fichier vit dans le stockage prive. L'adresse temporaire est liberee des
   * qu'on en change.
   */
  consulterPiece(piece: PieceCandidatureLivreurView): void {
    this.libererApercu();
    this.service.piece(piece.id).subscribe({
      next: (blob) => {
        this.urlApercu = URL.createObjectURL(blob);
        this.apercu.set({
          libelle: this.libellePiece(piece),
          // Un `blob:` cree a l'instant depuis une reponse de notre API, dont
          // le serveur a fixe le type d'apres les octets du fichier.
          url: this.sanitizer.bypassSecurityTrustResourceUrl(this.urlApercu),
        });
      },
      error: (e: unknown) => this.erreur.set(this.message(e, 'ADMIN.LIVREUR_REQUESTS.PIECE_ERROR')),
    });
  }

  fermerApercu(): void {
    this.libererApercu();
  }

  mettreEnAnalyse(): void {
    this.decider(
      (id) => this.service.mettreEnAnalyse(id),
      (r) => r,
      () => 'ADMIN.LIVREUR_REQUESTS.DONE_ANALYSIS',
    );
  }

  valider(): void {
    this.decider(
      (id) => this.service.valider(id),
      (r) => {
        this.motDePasse.set(r.motDePasseTemporaire
          ? { nom: `${r.candidature.prenom} ${r.candidature.nom}`, motDePasse: r.motDePasseTemporaire }
          : null);
        return r.candidature;
      },
      (r) => (r.motDePasseTemporaire
        ? 'ADMIN.LIVREUR_REQUESTS.DONE_VALIDATED_SHOWN'
        : 'ADMIN.LIVREUR_REQUESTS.DONE_VALIDATED_EMAIL'),
    );
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
    this.decider(
      (id) => this.service.refuser(id, motif),
      (r) => r,
      (r) => (r.email ? 'ADMIN.LIVREUR_REQUESTS.DONE_REFUSED_EMAIL' : 'ADMIN.LIVREUR_REQUESTS.DONE_REFUSED'),
    );
  }

  /** Le mot de passe a ete note : il quitte l'ecran. */
  ignorerMotDePasse(): void {
    this.motDePasse.set(null);
  }

  /**
   * Une decision : on l'envoie, on reprend le dossier **tel que le serveur le
   * rend**, et on rafraichit la liste. Garder l'etat d'avant laisserait
   * proposer une seconde action sur un dossier deja clos.
   */
  private decider<R>(
    envoyer: (id: string) => Observable<{ data?: R | null }>,
    dossierDe: (r: R) => CandidatureLivreurView,
    cleSucces: (r: R) => string,
  ): void {
    const dossier = this.candidatureOuverte();
    if (!dossier || this.action()) return;

    this.action.set(true);
    this.erreur.set(null);
    this.succes.set(null);

    envoyer(dossier.id).subscribe({
      next: (reponse) => {
        this.action.set(false);
        const data = reponse.data;
        if (!data) {
          this.erreur.set(this.i18n.t('ADMIN.LIVREUR_REQUESTS.DECISION_ERROR'));
          return;
        }
        this.candidatureOuverte.set(dossierDe(data));
        this.saisieMotifOuverte.set(false);
        this.motifRefus.set('');
        this.erreurMotif.set(false);
        this.succes.set(this.i18n.t(cleSucces(data), { numero: dossier.numero }));
        this.charger();
      },
      error: (e: unknown) => {
        this.action.set(false);
        this.erreur.set(this.message(e, 'ADMIN.LIVREUR_REQUESTS.DECISION_ERROR'));
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
