// features/pharmacien/commandes/commandes.component.ts
//
// La file du comptoir : les appels du quartier, et ce que l'officine a pris
// (P6 / EF-07).
//
// **Une course, pas une file d'attente.** Toutes les pharmacies partenaires du
// quartier reçoivent le même appel, et la première qui déclare détenir la
// totalité prend la commande. L'attribution est atomique côté serveur : deux
// réponses simultanées donnent un gagnant et un perdant, jamais deux gagnants.
// L'écran doit donc assumer qu'une commande visible peut déjà être partie.
//
// **Répondre « je n'ai pas tout » est définitif pour cette officine** : l'appel
// disparaît de sa file. L'écran le dit avant, pas après.
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import type { CommandeView } from '@baobaoheath/shared-types';
import { CourseService } from '../../../core/services/course.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { QrScannerComponent } from '../../../shared/components/qr-scanner/qr-scanner.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

@Component({
  selector: 'app-pharmacien-commandes',
  standalone: true,
  imports: [CommonModule, TranslatePipe, ExportListeComponent, QrScannerComponent, AvatarComponent],
  templateUrl: './commandes.component.html',
  styleUrl: './commandes.component.scss',
})
export class PharmacienCommandesComponent implements OnInit {
  private pharma = inject(PharmacienService);
  private coursesService = inject(CourseService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  commandes = signal<CommandeView[]>([]);

  /**
   * Les commandes prises en charge, sur une feuille de preparation.
   *
   * Le nombre de lignes et non les produits : le detail est a l'ecran, et une
   * feuille qui enumere les traitements de chaque patient circule mal au
   * comptoir. Ce qu'on vient chercher ici, c'est qui attend quoi et depuis
   * quand.
   */
  readonly colonnes: ColonneExport<CommandeView>[] = [
    { titre: 'EXPORT.COL.ORDONNANCE', valeur: (c) => c.numeroOrdonnance },
    { titre: 'EXPORT.COL.PATIENT', valeur: (c) => `${c.patient.prenom} ${c.patient.nom}` },
    { titre: 'EXPORT.COL.LIGNES', valeur: (c) => c.lignes.length, nombre: true },
    { titre: 'EXPORT.COL.STATUT', valeur: (c) => c.statut },
    { titre: 'EXPORT.COL.REMISE', valeur: (c) => this.libelleMode(c.modeRemise) },
    { titre: 'EXPORT.COL.RECUE_LE', valeur: (c) => new Date(c.creeLe) },
  ];
  chargement = signal(true);
  /** La commande sur laquelle une réponse est en cours. */
  enCours = signal<string | null>(null);
  /** Celle dont on s'apprête à dire qu'on ne l'a pas : on demande confirmation. */
  confirmeRefus = signal<CommandeView | null>(null);

  /** Les appels auxquels cette officine n'a pas encore répondu. */
  readonly appels = computed(() =>
    this.commandes().filter((c) => c.statut === 'RECHERCHE_PHARMACIE'));

  /**
   * Ce qu'elle a pris et qui lui demande encore quelque chose.
   *
   * **Les commandes closes en sortent.** C'est une file de travail : une
   * commande terminee ou annulee n'y a plus rien a faire, et la laisser
   * gonfler le compteur ferait chercher une action qui n'existe pas. Elles
   * restent visibles plus bas, pour qu'un pharmacien puisse verifier ce
   * qu'il a servi ce matin.
   */
  readonly miennes = computed(() =>
    this.commandes().filter((c) =>
      c.estLaMienne && !['CLOTUREE', 'ANNULEE'].includes(c.statut)));

  /** Ce qui est derriere nous, pour relecture. */
  readonly closes = computed(() =>
    this.commandes().filter((c) =>
      c.estLaMienne && ['CLOTUREE', 'ANNULEE'].includes(c.statut)));

  /** Celle qu'on s'apprete a annuler : on demande un motif. */
  confirmeAnnulation = signal<CommandeView | null>(null);
  motifAnnulation = signal('');
  readonly scannerPour = signal<CommandeView | null>(null);
  readonly erreurRemise = signal<string | null>(null);

  /** Celle qu'on encaisse au comptoir, et le numero du recu. */
  encaisse = signal<CommandeView | null>(null);
  referenceRecu = signal('');

  ngOnInit(): void {
    this.charger();
  }

  charger(): void {
    this.chargement.set(true);
    this.pharma.commandesDeLaPharmacie().subscribe({
      next: (r) => {
        this.commandes.set(r.data ?? []);
        this.chargement.set(false);
      },
      error: (err) => {
        this.chargement.set(false);
        const e = err as { error?: { error?: string } };
        // Une officine non partenaire reçoit un message precis cote API :
        // le repeter evite de chercher du cote des droits.
        this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  // ── De la prise en charge a la remise (EF-07-02) ────────────────────
  //
  // **Un geste, un appel, et le serveur decide.** L'ecran ne calcule pas
  // l'etat suivant : il demande, et relit. Un 409 n'est pas une panne — la
  // commande a change entre-temps, et c'est le message du serveur qui le dit
  // le mieux.

  /** Le libelle de l'etat, pour que le pharmacien sache quoi faire. */
  libelleEtat(statut: string): string {
    return this.i18n.t(`PHARMACIEN.COMMANDES.ETAT_${statut}`);
  }

  montant(gnf: number | null | undefined): string {
    return gnf == null ? '—' : new Intl.NumberFormat('fr-FR').format(gnf);
  }

  /** Les initiales du motard, quand il n'a pas mis de photo. */
  initiales(prenom: string, nom: string): string {
    return `${prenom.trim().charAt(0)}${nom.trim().charAt(0)}`.toUpperCase();
  }

  /** Un geste de la machine a etats, avec son message de reussite. */
  private avancer(
    c: CommandeView,
    appel: (id: string) => ReturnType<PharmacienService['chiffrerCommande']>,
    clefSucces: string,
  ): void {
    if (this.enCours()) return;
    this.enCours.set(c.id);
    appel.call(this.pharma, c.id).subscribe({
      next: () => {
        this.enCours.set(null);
        this.toastr.success(this.i18n.t(clefSucces));
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { status?: number; error?: { error?: string } };
        // Le serveur nomme le refus — « une commande payee ne peut pas passer
        // a... » — et c'est plus utile qu'un message generique.
        this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
        this.charger();
      },
    });
  }

  chiffrer(c: CommandeView): void {
    this.avancer(c, this.pharma.chiffrerCommande, 'PHARMACIEN.COMMANDES.CHIFFRE_OK');
  }

  preparer(c: CommandeView): void {
    this.avancer(c, this.pharma.preparerCommande, 'PHARMACIEN.COMMANDES.PREPARE_OK');
  }

  prete(c: CommandeView): void {
    this.avancer(c, this.pharma.commandePrete, 'PHARMACIEN.COMMANDES.PRETE_OK');
  }

  remettre(c: CommandeView): void {
    this.avancer(c, this.pharma.remettreCommande, 'PHARMACIEN.COMMANDES.REMISE_OK');
  }

  ouvrirScanner(c: CommandeView): void {
    this.erreurRemise.set(null);
    this.scannerPour.set(c);
  }

  fermerScanner(): void {
    this.scannerPour.set(null);
  }

  qrDetecte(qrCodeScanne: string): void {
    const commande = this.scannerPour();
    if (!commande?.idCourse || this.enCours()) return;
    this.erreurRemise.set(null);
    this.enCours.set(commande.id);
    this.coursesService.remettreAuMotard(commande.idCourse, { qrCodeScanne }).subscribe({
      next: () => {
        this.enCours.set(null);
        this.scannerPour.set(null);
        this.toastr.success(this.i18n.t('PHARMACIEN.COMMANDES.REMISE_OK'));
        this.charger();
      },
      error: (error: unknown) => {
        this.enCours.set(null);
        const response = error as { error?: { error?: string; message?: string } };
        this.erreurRemise.set(
          response?.error?.error ?? response?.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
        );
      },
    });
  }

  // ── Encaisser au comptoir ───────────────────────────────────────────
  //
  // Les especes ne passent par aucune passerelle : le pharmacien recoit
  // l'argent et le declare. C'est le seul chemin qui ne depende pas d'une
  // adresse HTTPS publique, et c'est le moyen dominant ici.

  demanderEncaissement(c: CommandeView): void {
    this.referenceRecu.set('');
    this.encaisse.set(c);
  }

  fermerEncaissement(): void {
    this.encaisse.set(null);
  }

  peutEncaisser(): boolean {
    return !this.enCours() && this.referenceRecu().trim().length >= 3;
  }

  confirmerEncaissement(): void {
    const c = this.encaisse();
    if (!c || !this.peutEncaisser()) return;
    this.enCours.set(c.id);
    this.pharma.encaisserCommande(c.id, this.referenceRecu().trim()).subscribe({
      next: () => {
        this.enCours.set(null);
        this.encaisse.set(null);
        this.toastr.success(this.i18n.t('PHARMACIEN.COMMANDES.ENCAISSE_OK'));
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { error?: { error?: string } };
        this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  // ── L'annulation ────────────────────────────────────────────────────

  demanderAnnulation(c: CommandeView): void {
    this.motifAnnulation.set('');
    this.confirmeAnnulation.set(c);
  }

  fermerAnnulation(): void {
    this.confirmeAnnulation.set(null);
  }

  /** Le motif est exige — par l'ecran, par l'API, et par la base. */
  peutAnnuler(): boolean {
    return !this.enCours() && this.motifAnnulation().trim().length >= 5;
  }

  confirmerAnnulation(): void {
    const c = this.confirmeAnnulation();
    if (!c || !this.peutAnnuler()) return;
    this.enCours.set(c.id);
    this.pharma.annulerCommande(c.id, this.motifAnnulation().trim()).subscribe({
      next: () => {
        this.enCours.set(null);
        this.confirmeAnnulation.set(null);
        this.toastr.success(this.i18n.t('PHARMACIEN.COMMANDES.ANNULEE_OK'));
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { error?: { error?: string } };
        this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  /** Nombre total de boîtes à sortir : ce qu'on regarde avant de s'engager. */
  totalBoites(c: CommandeView): number {
    return c.lignes.reduce((t, l) => t + l.quantite, 0);
  }

  /** Combien d'officines ont déjà dit non : le contexte de sa propre réponse. */
  refusAvant(c: CommandeView): number {
    return c.reponses.filter((r) => !r.aTousLesProduits).length;
  }

  // ── Répondre ───────────────────────────────────────────────────────
  /**
   * « J'ai tout » : l'officine tente de prendre la commande.
   *
   * Un 409 n'est pas une panne — une autre a été plus rapide. On le dit
   * comme tel et on relit la file, au lieu d'afficher une erreur.
   */
  jePrends(c: CommandeView): void {
    if (this.enCours()) return;
    this.enCours.set(c.id);
    this.pharma.repondreDisponibilite(c.id, true).subscribe({
      next: () => {
        this.enCours.set(null);
        this.toastr.success(this.i18n.t('PHARMACIEN.COMMANDES.PRISE_OK'));
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { status?: number; error?: { error?: string } };
        if (e?.status === 409) {
          this.toastr.info(this.i18n.t('PHARMACIEN.COMMANDES.TROP_TARD'));
        } else {
          this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
        }
        this.charger();
      },
    });
  }

  demanderRefus(c: CommandeView): void {
    this.confirmeRefus.set(c);
  }

  fermerRefus(): void {
    this.confirmeRefus.set(null);
  }

  /** « Je n'ai pas tout » : l'appel quitte définitivement sa file. */
  confirmerRefus(): void {
    const c = this.confirmeRefus();
    if (!c || this.enCours()) return;
    this.enCours.set(c.id);
    this.pharma.repondreDisponibilite(c.id, false).subscribe({
      next: () => {
        this.enCours.set(null);
        this.confirmeRefus.set(null);
        this.toastr.info(this.i18n.t('PHARMACIEN.COMMANDES.REFUS_OK'));
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { error?: { error?: string } };
        this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  /**
   * L'officine rend une commande qu'elle avait prise : elle n'avait pas tout,
   * finalement. Le verrou se rouvre et les autres retrouvent la main.
   */
  rendre(c: CommandeView): void {
    const motif = window.prompt(this.i18n.t('PHARMACIEN.COMMANDES.MOTIF_PROMPT'))?.trim() ?? '';
    if (motif.length < 5) {
      if (motif.length > 0) this.toastr.error(this.i18n.t('PHARMACIEN.COMMANDES.MOTIF_COURT'));
      return;
    }
    this.enCours.set(c.id);
    this.pharma.retirerPriseEnCharge(c.id, motif).subscribe({
      next: () => {
        this.enCours.set(null);
        this.toastr.info(this.i18n.t('PHARMACIEN.COMMANDES.RENDUE'));
        this.charger();
      },
      error: (err) => {
        this.enCours.set(null);
        const e = err as { error?: { error?: string } };
        this.toastr.error(e?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  /**
   * Le dosage, sauf quand le libellé le porte déjà.
   *
   * « Doliprane Pricemou 500mg 500mg » : le catalogue met souvent le dosage
   * dans le nom, et l'afficher à côté le répète.
   */
  dosageUtile(libelle: string, dosage?: string | null): string | null {
    if (!dosage) return null;
    return libelle.toLowerCase().includes(dosage.toLowerCase()) ? null : dosage;
  }

  libelleMode(m: string | null | undefined): string {
    return m ? this.i18n.t(`PHARMACIEN.COMMANDES.MODE_${m}`) : '';
  }
}
