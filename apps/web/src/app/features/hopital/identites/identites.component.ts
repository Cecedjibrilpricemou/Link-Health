// features/hopital/identites/identites.component.ts
//
// Vérifier l'identité d'un patient au comptoir (EF-01-04/10).
//
// **L'écran dit ce que la vérification ouvre, et ce qu'elle n'ouvre pas.**
// Elle ouvre le tiers payant. Elle ne conditionne pas les soins : un patient
// à l'identité provisoire est consulté, suivi et prescrit normalement. Sans
// cette phrase, un agent finirait par croire qu'il doit refuser quelqu'un
// sans papiers — et ce serait une faute grave.
//
// Tous les champs sont des signaux : l'application est zoneless.
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type {
  CandidatDoublonView, CorrectionIdentiteView, CorrigerIdentiteDto, FusionView, IdentitePatientView,
  NiveauIdentite, TypePieceIdentite,
} from '@baobaoheath/shared-types';
import { HopitalService } from '../../../core/services/hopital.service';
import { AuthService } from '../../../core/services/auth.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

const PIECES: TypePieceIdentite[] = [
  'CARTE_NATIONALE', 'PASSEPORT', 'ACTE_NAISSANCE', 'CARTE_CONSULAIRE', 'PERMIS_CONDUIRE', 'AUTRE',
];

/** Les mêmes longueurs que l'API et la contrainte SQL. */
const NUMERO_MIN = 3;

/**
 * Le motif de fusion, en caracteres.
 *
 * La meme valeur que le schema de l'API et que la contrainte SQL
 * `fusions_dossier_motif_dit_quelque_chose`. Un acte de cette portee sans
 * motif n'est pas contestable.
 */
const MOTIF_MIN = 10;
const LIEU_MIN = 2;

/** Une date de naissance telle qu'on la lit sur une piece : AAAA-MM-JJ, sans heure. */
function jourDe(date: string | Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

@Component({
  selector: 'app-identites',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslatePipe,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatCheckboxModule, MatProgressSpinnerModule,
  ExportListeComponent,
  ],
  templateUrl: './identites.component.html',
  styleUrl: './identites.component.scss',
})
export class IdentitesComponent implements OnInit {
  private hopital = inject(HopitalService);
  private auth = inject(AuthService);
  private i18n = inject(I18nService);

  pieces = PIECES;
  numeroMin = NUMERO_MIN;

  // ── Les critères ───────────────────────────────────────────────────
  q = signal('');
  niveau = signal<NiveauIdentite | ''>('PROVISOIRE');

  // ── L'état ─────────────────────────────────────────────────────────
  patients = signal<IdentitePatientView[]>([]);

  /**
   * **Le numero de piece reste masque, meme imprime.** Il est masque a
   * l'ecran parce qu'il ne doit pas etre recopie ; une feuille qui le porte
   * en entier contournerait exactement cette regle, et une feuille circule
   * plus loin qu'un ecran de comptoir.
   */
  readonly colonnes: ColonneExport<IdentitePatientView>[] = [
    { titre: 'EXPORT.COL.PATIENT', valeur: (p) => p.nomComplet },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (p) => p.telephone },
    { titre: 'EXPORT.COL.NAISSANCE', valeur: (p) => new Date(p.dateNaissance) },
    { titre: 'EXPORT.COL.SEXE', valeur: (p) => p.sexe },
    { titre: 'EXPORT.COL.PREFECTURE', valeur: (p) => p.prefecture },
    { titre: 'EXPORT.COL.NIVEAU', valeur: (p) => p.niveauIdentite },
    { titre: 'EXPORT.COL.PIECE', valeur: (p) => p.typePiece },
    { titre: 'EXPORT.COL.NUMERO_PIECE_MASQUE', valeur: (p) => p.numeroPieceMasque },
    { titre: 'EXPORT.COL.VERIFIEE_LE', valeur: (p) => (p.verifieeLe ? new Date(p.verifieeLe) : null) },
    { titre: 'EXPORT.COL.TRAITS_MANQUANTS', valeur: (p) => p.traitsManquants.join(', ') },
  ];
  chargement = signal(true);
  erreur = signal('');
  succes = signal('');

  // ── La boîte de vérification ───────────────────────────────────────
  cible = signal<IdentitePatientView | null>(null);
  typePiece = signal<TypePieceIdentite | ''>('');
  numeroPiece = signal('');
  lieuNaissance = signal('');
  nomMere = signal('');
  remplacerPiece = signal(false);
  enCours = signal(false);

  /** Revérifier n'est pas une erreur — une pièce se renouvelle — mais c'est un geste conscient. */
  dejaVerifiee = computed(() => this.cible()?.niveauIdentite === 'VERIFIEE');

  peutVerifier = computed(() => {
    if (!this.typePiece() || this.enCours()) return false;
    if (this.numeroPiece().trim().length < NUMERO_MIN) return false;
    if (this.lieuNaissance().trim().length < LIEU_MIN) return false;
    return !this.dejaVerifiee() || this.remplacerPiece();
  });

  provisoires = computed(() => this.patients().filter((p) => p.niveauIdentite === 'PROVISOIRE').length);

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  // ── Les doublons possibles (EF-01-05) ──────────────────────────────
  //
  // **Ce ne sont pas des verdicts, et rien n'est fusionne.** L'ecran propose
  // des dossiers a regarder ; un agent decide. Fusionner deux personnes
  // distinctes melangerait leurs dossiers medicaux, ce qui est bien plus
  // dangereux que de laisser un doublon.
  //
  // La fusion n'est pas encore outillee : l'ecran le dit, plutot que d'offrir
  // un bouton qui ne ferait rien.
  patientDoublons = signal<IdentitePatientView | null>(null);
  candidats = signal<CandidatDoublonView[]>([]);
  chargementDoublons = signal(false);
  erreurDoublons = signal('');

  ngOnInit() {
    this.charger();
  }

  /** Charge a la demande : dix lignes affichees ne doivent pas faire dix requetes. */
  voirDoublons(p: IdentitePatientView) {
    this.patientDoublons.set(p);
    this.candidats.set([]);
    this.erreurDoublons.set('');
    this.chargementDoublons.set(true);
    this.hopital.doublons(p.id).subscribe({
      next: (res) => {
        this.candidats.set(res.data ?? []);
        this.chargementDoublons.set(false);
      },
      error: (err) => {
        this.chargementDoublons.set(false);
        this.erreurDoublons.set(this.messageDe(err, 'HOPITAL.IDENTITES.DOUBLONS_ERREUR'));
      },
    });
  }

  fermerDoublons() {
    this.patientDoublons.set(null);
    this.candidats.set([]);
  }

  // ── La fusion (EF-01-06) ───────────────────────────────────────────
  //
  // **Reservee a ADMIN_STRUCTURE.** L'API le fait respecter ; l'ecran ne
  // montre le bouton qu'a ce role, parce que proposer une action qu'on n'a pas
  // le droit de faire est une facon de mentir a l'utilisateur.
  //
  // Le dossier qui survit est **choisi par l'agent** : lui seul sait lequel
  // des deux porte l'histoire la plus complete. L'ecran propose un sens et
  // permet de l'inverser d'un clic.
  peutFusionner = computed(() => this.auth.userRole() === 'ADMIN_STRUCTURE');

  /** L'écran vit dans deux espaces : le badge doit dire lequel. */
  badgeEspace = computed(() =>
    this.auth.userRole() === 'ADMIN_STRUCTURE' ? 'ADMIN_STRUCTURE.ROLE' : 'HOPITAL.ROLE');

  /** Le candidat qu'on s'apprete a fusionner, et dans quel sens. */
  aFusionner = signal<CandidatDoublonView | null>(null);
  garderLeCandidat = signal(false);
  motifFusion = signal('');
  fusionEnCours = signal(false);
  derniereFusion = signal<FusionView | null>(null);

  /** L'historique, et l'annulation. */
  historique = signal<FusionView[]>([]);
  aAnnuler = signal<FusionView | null>(null);
  motifAnnulation = signal('');

  /** Le meme minimum que l'API et que la contrainte SQL. */
  motifMin = MOTIF_MIN;

  peutConfirmerFusion = computed(
    () => this.motifFusion().trim().length >= MOTIF_MIN && !this.fusionEnCours()
  );
  peutConfirmerAnnulation = computed(
    () => this.motifAnnulation().trim().length >= MOTIF_MIN && !this.fusionEnCours()
  );

  /** Qui survit, qui est absorbe — dans le sens choisi. */
  sensFusion = computed(() => {
    const c = this.aFusionner();
    const p = this.patientDoublons();
    if (!c || !p) return null;
    return this.garderLeCandidat()
      ? { principal: { id: c.id, nom: c.nomComplet }, absorbe: { id: p.id, nom: p.nomComplet } }
      : { principal: { id: p.id, nom: p.nomComplet }, absorbe: { id: c.id, nom: c.nomComplet } };
  });

  ouvrirFusion(c: CandidatDoublonView) {
    this.aFusionner.set(c);
    this.garderLeCandidat.set(false);
    this.motifFusion.set('');
    this.erreurDoublons.set('');
    this.derniereFusion.set(null);
  }

  fermerFusion() {
    this.aFusionner.set(null);
    this.motifFusion.set('');
  }

  confirmerFusion() {
    const sens = this.sensFusion();
    if (!sens || !this.peutConfirmerFusion()) return;

    this.fusionEnCours.set(true);
    this.erreurDoublons.set('');
    this.hopital.fusionner(sens.principal.id, {
      idAbsorbe: sens.absorbe.id,
      motif: this.motifFusion().trim(),
    }).subscribe({
      next: (res) => {
        this.fusionEnCours.set(false);
        this.aFusionner.set(null);
        this.derniereFusion.set(res.data ?? null);
        this.fermerDoublons();
        this.charger();
      },
      error: (err) => {
        this.fusionEnCours.set(false);
        this.erreurDoublons.set(this.messageDe(err, 'HOPITAL.IDENTITES.FUSION_ERREUR'));
      },
    });
  }

  /** Combien de lignes ont bouge, toutes operations confondues. */
  lignesBougees(f: FusionView): number {
    return f.lignes.reduce((n, l) => n + l.nombre, 0);
  }

  consentementsRestreints(f: FusionView): number {
    return f.lignes
      .filter((l) => l.operation === 'RESTRICTION_CONSENTEMENT')
      .reduce((n, l) => n + l.nombre, 0);
  }

  voirFusions(p: IdentitePatientView) {
    this.patientDoublons.set(null);
    this.historique.set([]);
    this.hopital.fusions(p.id).subscribe({
      next: (res) => this.historique.set(res.data ?? []),
      error: (err) => this.erreur.set(this.messageDe(err, 'HOPITAL.IDENTITES.FUSION_ERREUR')),
    });
  }

  ouvrirAnnulation(f: FusionView) {
    this.aAnnuler.set(f);
    this.motifAnnulation.set('');
    this.erreur.set('');
  }

  confirmerAnnulation() {
    const f = this.aAnnuler();
    if (!f || !this.peutConfirmerAnnulation()) return;

    this.fusionEnCours.set(true);
    this.hopital.annulerFusion(f.id, {
      motifAnnulation: this.motifAnnulation().trim(),
    }).subscribe({
      next: (res) => {
        this.fusionEnCours.set(false);
        this.aAnnuler.set(null);
        this.historique.set([]);
        this.succes.set(this.i18n.t('HOPITAL.IDENTITES.FUSION_ANNULEE_MSG', {
          absorbe: res.data?.absorbe.nomComplet ?? '',
        }));
        setTimeout(() => this.succes.set(''), 10000);
        this.charger();
      },
      error: (err) => {
        this.fusionEnCours.set(false);
        this.erreur.set(this.messageDe(err, 'HOPITAL.IDENTITES.FUSION_ERREUR'));
      },
    });
  }

  charger() {
    this.chargement.set(true);
    this.erreur.set('');
    this.hopital.identites({
      q: this.q().trim() || undefined,
      niveau: this.niveau() || undefined,
    }).subscribe({
      next: (res) => {
        this.patients.set(res.data ?? []);
        this.chargement.set(false);
      },
      error: (err) => {
        this.chargement.set(false);
        this.erreur.set(this.messageDe(err, 'HOPITAL.IDENTITES.ERR_CHARGEMENT'));
      },
    });
  }

  ouvrir(p: IdentitePatientView) {
    this.cible.set(p);
    this.typePiece.set('');
    this.numeroPiece.set('');
    // Les traits déjà connus sont pré-remplis : l'agent n'a pas à les
    // redemander au patient, qui les a peut-être donnés la semaine dernière.
    this.lieuNaissance.set(p.lieuNaissance ?? '');
    this.nomMere.set(p.nomMere ?? '');
    this.remplacerPiece.set(false);
    this.erreur.set('');
  }

  annuler() {
    this.cible.set(null);
  }

  // ── La correction (R15) ────────────────────────────────────────────
  //
  // Une erreur de saisie a l'admission restait pour toujours : un enfant ne
  // en 2020 enregistre en 2002 recevait des doses d'adulte. L'agent corrige
  // ici, avec un motif ; chaque trait garde son ancienne valeur et son
  // auteur. Corriger n'est pas verifier : le niveau d'identite ne bouge pas.
  aCorriger = signal<IdentitePatientView | null>(null);
  corPrenom = signal('');
  corNom = signal('');
  corSexe = signal('');
  corNaissance = signal('');
  corMotif = signal('');
  corrections = signal<CorrectionIdentiteView[]>([]);
  /** Une date de naissance ne peut pas etre dans le futur. */
  readonly aujourdhui = new Date().toISOString().slice(0, 10);

  /** Seuls les traits modifies partent ; sans aucun, rien a confirmer. */
  private correctionDemandee = computed<CorrigerIdentiteDto | null>(() => {
    const p = this.aCorriger();
    if (!p) return null;
    const dto: CorrigerIdentiteDto = { motif: this.corMotif().trim() };
    const prenom = this.corPrenom().trim();
    const nom = this.corNom().trim();
    if (prenom && prenom !== p.prenom) dto.prenom = prenom;
    if (nom && nom !== p.nom) dto.nom = nom;
    if (this.corSexe() && this.corSexe() !== p.sexe) dto.sexe = this.corSexe() as 'M' | 'F';
    if (this.corNaissance() && this.corNaissance() !== jourDe(p.dateNaissance)) {
      dto.dateNaissance = this.corNaissance();
    }
    return dto.prenom || dto.nom || dto.sexe || dto.dateNaissance ? dto : null;
  });

  peutCorriger = computed(() =>
    !!this.correctionDemandee() && this.corMotif().trim().length >= MOTIF_MIN && !this.enCours());

  ouvrirCorrection(p: IdentitePatientView) {
    this.aCorriger.set(p);
    this.corPrenom.set(p.prenom);
    this.corNom.set(p.nom);
    this.corSexe.set(p.sexe);
    this.corNaissance.set(jourDe(p.dateNaissance));
    this.corMotif.set('');
    this.corrections.set([]);
    this.erreur.set('');
    this.hopital.corrections(p.id).subscribe({
      next: (res) => this.corrections.set(res.data ?? []),
      error: () => this.corrections.set([]),
    });
  }

  fermerCorrection() {
    this.aCorriger.set(null);
  }

  confirmerCorrection() {
    const p = this.aCorriger();
    const dto = this.correctionDemandee();
    if (!p || !dto || !this.peutCorriger()) return;

    this.enCours.set(true);
    this.erreur.set('');
    this.hopital.corrigerIdentite(p.id, dto).subscribe({
      next: (res) => {
        this.enCours.set(false);
        this.aCorriger.set(null);
        this.succes.set(this.i18n.t('HOPITAL.IDENTITES.CORRIGEE_MSG', { nom: res.data?.nomComplet ?? '' }));
        setTimeout(() => this.succes.set(''), 8000);
        this.charger();
      },
      error: (err) => {
        this.enCours.set(false);
        this.erreur.set(this.messageDe(err, 'HOPITAL.IDENTITES.ERR_CORRECTION'));
      },
    });
  }

  confirmer() {
    const p = this.cible();
    if (!p || !this.peutVerifier()) return;

    this.enCours.set(true);
    this.erreur.set('');
    this.hopital.verifierIdentite(p.id, {
      typePiece: this.typePiece() as TypePieceIdentite,
      numeroPiece: this.numeroPiece().trim(),
      lieuNaissance: this.lieuNaissance().trim(),
      nomMere: this.nomMere().trim() || undefined,
      remplacerPiece: this.remplacerPiece() || undefined,
    }).subscribe({
      next: (res) => {
        this.enCours.set(false);
        this.cible.set(null);
        this.succes.set(this.i18n.t('HOPITAL.IDENTITES.VERIFIEE_MSG', {
          nom: res.data?.nomComplet ?? '',
        }));
        setTimeout(() => this.succes.set(''), 8000);
        this.charger();
      },
      error: (err) => {
        this.enCours.set(false);
        this.erreur.set(this.messageDe(err, 'HOPITAL.IDENTITES.ERR_VERIFICATION'));
      },
    });
  }

  private messageDe(err: unknown, cleDefaut: string): string {
    const e = err as { error?: { error?: string; message?: string } };
    return e?.error?.error ?? e?.error?.message ?? this.i18n.t(cleDefaut);
  }
}
