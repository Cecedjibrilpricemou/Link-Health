// features/pharmacien/caisse — la vente au comptoir.
//
// Addendum du 2026-09-28, point 1.1. Le client est facultatif : un passant
// n'ouvre pas un dossier pour acheter du savon.
//
// La caisse part du **stock**, pas du catalogue. Le prix au comptoir vaut le
// tarif de reference plus la marge de l'officine, et la marge vit sur la ligne
// de stock : afficher le catalogue seul donnerait un total different de ce qui
// est encaisse. Partir du stock montre en plus ce qui est disponible.
//
// Chaque champ est un signal. L'application est zoneless : `[(ngModel)]` qui
// ecrit dans un champ ordinaire — ou qui mute un objet range dans un signal —
// ne notifie personne, et le total resterait fige. Le formulaire
// d'approvisionnement avait affiche un total faux et un bouton mort pour
// cette raison le 2026-09-30.
import { Component, OnDestroy, OnInit, WritableSignal, computed, inject, signal } from '@angular/core';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import QRCode from 'qrcode';
import { ToastrService } from 'ngx-toastr';
import type {
  CarteAssuranceVerifieeView,
  CreerVenteDto,
  LigneVenteDto,
  ModePaiement,
  PriseEnChargeView,
  SessionCaisseView,
  VenteComptoirView,
} from '@baobaoheath/shared-types';

import { PharmacienService } from '../../../core/services/pharmacien.service';
import { PharmacieStock } from '../../../core/models/pharmacien.model';
import { CategorieProduitPipe } from '../../../shared/pipes/categorie-produit.pipe';
import { QrScannerComponent } from '../../../shared/components/qr-scanner/qr-scanner.component';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { formaterQuantite } from '../../../shared/pipes/quantite-unite.pipe';

/** Une ligne du panier en cours de saisie. */
type LignePanier = {
  idMedicament: WritableSignal<string>;
  quantite: WritableSignal<number | null>;
};

@Component({
  selector: 'app-pharmacien-caisse',
  standalone: true,
  imports: [ListeRechercheComponent, DatePipe, DecimalPipe, FormsModule, MatButtonModule, CategorieProduitPipe, TranslatePipe, ExportListeComponent, QrScannerComponent],
  templateUrl: './caisse.component.html',
  styleUrl: './caisse.component.scss',
})
export class CaisseComponent implements OnInit, OnDestroy {
  private pharma = inject(PharmacienService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  /** Le stock de l'officine : il contient aussi des articles non medicamenteux. */
  stocks = signal<PharmacieStock[]>([]);
  ventes = signal<VenteComptoirView[]>([]);
  session = signal<SessionCaisseView | null>(null);
  ouvertureMontant = signal<number | null>(0);
  clotureMontant = signal<number | null>(0);
  motifEcart = signal('');
  sessionEnCours = signal(false);
  readonly caisseOuverte = computed(() => this.session()?.statut === 'OUVERTE');
  readonly peutCloturer = computed(() => {
    const compte = this.clotureMontant();
    const attendu = this.session()?.montantTheoriqueGnf;
    return this.caisseOuverte()
      && compte !== null
      && Number.isInteger(compte)
      && compte >= 0
      && (compte === attendu || this.motifEcart().trim().length >= 5);
  });

  /**
   * Le journal de caisse, tel qu'on le rend en fin de journee.
   *
   * **Les produits n'y sont pas.** Une feuille de caisse circule, et ce qu'un
   * patient a achete ne la regarde pas : les montants et le moyen de paiement
   * suffisent a justifier le tiroir. Le detail reste a l'ecran, sur la vente.
   *
   * Une vente annulee figure quand meme, avec son statut : un tiroir qui ne
   * montre pas ses annulations ne se rapproche pas.
   */
  readonly colonnes: ColonneExport<VenteComptoirView>[] = [
    { titre: 'EXPORT.COL.NUMERO', valeur: (v) => v.numero },
    { titre: 'EXPORT.COL.HEURE', valeur: (v) => new Date(v.creeLe) },
    { titre: 'EXPORT.COL.CLIENT', valeur: (v) => (v.patient ? `${v.patient.prenom} ${v.patient.nom}` : 'Passage') },
    { titre: 'EXPORT.COL.ORDONNANCE', valeur: (v) => v.numeroOrdonnance },
    { titre: 'EXPORT.COL.PAIEMENT', valeur: (v) => v.modePaiement },
    { titre: 'EXPORT.COL.BRUT_GNF', valeur: (v) => v.montantBrutGnf, nombre: true },
    { titre: 'EXPORT.COL.REMISE_HISTORIQUE_GNF', valeur: (v) => v.remiseGnf, nombre: true },
    { titre: 'EXPORT.COL.NET_GNF', valeur: (v) => v.montantNetGnf, nombre: true },
    { titre: 'EXPORT.COL.PART_ASSUREUR_GNF', valeur: (v) => v.montantAssureGnf, nombre: true },
    { titre: 'EXPORT.COL.PART_PATIENT_GNF', valeur: (v) => v.montantPatientGnf, nombre: true },
    { titre: 'EXPORT.COL.STATUT', valeur: (v) => v.statut },
    { titre: 'EXPORT.COL.VENDEUR', valeur: (v) => `${v.vendeur.prenom} ${v.vendeur.nom}` },
  ];
  isLoading = signal(true);
  enCours = signal(false);

  lignes = signal<LignePanier[]>([this.ligneVide()]);
  /**
   * La vente qui attend son paiement, et le QR a montrer au client.
   *
   * **Le client scanne avec son propre telephone.** La caisse ne manipule pas
   * son compte : elle affiche un lien, il tape son code chez lui. C'est aussi
   * ce qui evite que le pharmacien connaisse son numero de compte.
   */
  attente = signal<VenteComptoirView | null>(null);
  qrImage = signal<string>('');
  verifieEnCours = signal(false);
  annulationVente = signal<VenteComptoirView | null>(null);
  motifAnnulation = signal('');
  validationTitulaireRequise = signal(false);
  telephoneTitulaire = signal('');
  motDePasseTitulaire = signal('');
  annulationEnCours = signal(false);

  modePaiement = signal<ModePaiement>('ESPECES');
  numeroOperateur = signal('');
  idOrdonnance = signal('');

  readonly montantBrut = computed(() =>
    this.lignes().reduce((t, l) => t + this.prixDe(l.idMedicament()) * (l.quantite() ?? 0), 0)
  );

  readonly montantNet = computed(() => this.montantBrut());

  /**
   * Les produits du panier qui ne sortent pas sans ordonnance. L'API applique
   * la regle de toute facon (EF-05-12) ; l'ecran la dit avant que le vendeur
   * encaisse, pour qu'il ne le decouvre pas au refus.
   */
  readonly exigentOrdonnance = computed(() =>
    this.lignes()
      .map((l) => this.stockDe(l.idMedicament()))
      .filter((s): s is PharmacieStock => !!s && !!s.medicament.estReglemente)
      .map((s) => s.medicament.libelle)
  );

  /** Les lignes qui demandent plus que ce qui reste en rayon. */
  readonly depassements = computed(() =>
    this.lignes()
      .map((l) => ({ stock: this.stockDe(l.idMedicament()), demande: l.quantite() ?? 0 }))
      .filter((x) => x.stock && x.demande > x.stock.quantite)
      .map((x) => `${x.stock!.medicament.libelle} (${x.stock!.quantite} en stock)`)
  );

  readonly peutEncaisser = computed(() =>
    this.caisseOuverte() &&
    this.lignes().some((l) => l.idMedicament() && (l.quantite() ?? 0) > 0) &&
    this.depassements().length === 0 &&
    (this.modePaiement() === 'ESPECES' || this.numeroOperateur().trim().length > 0) &&
    (this.exigentOrdonnance().length === 0 || this.idOrdonnance().trim().length > 0) &&
    // Le tiers payant demande une carte reconnue eligible, et un calcul fait
    // sur le panier tel qu'il est : l'API refuserait ou recalculerait de toute
    // facon, autant ne pas afficher un reste a charge perime.
    (!this.avecAssurance() || (this.peutAppliquerAssurance() && this.priseAJour() && this.identiteConfirmee()))
  );

  /** Ce que la caisse encaisse reellement du patient. */
  readonly aEncaisser = computed(() =>
    this.avecAssurance() && this.priseAJour() ? this.prise()!.montantPatientGnf : this.montantNet()
  );

  // ── Tiers payant (lot assurance) ─────────────────────────────────
  //
  // Le patient presente sa carte d'assurance : son QR ne porte qu'un jeton
  // opaque, et c'est le serveur qui dit si la couverture joue aujourd'hui.
  // Une carte imprimee ou une capture d'ecran ne suffit donc pas.
  jetonCarte = signal('');
  showScanner = signal(false);
  carte = signal<CarteAssuranceVerifieeView | null>(null);
  /**
   * La photo de la fiche de l'assure (URL d'objet). La comparer a la personne
   * presente est ce qui empeche une carte d'etre pretee : l'API refuse le
   * tiers payant sans cette confirmation.
   */
  photoCarte = signal<string | null>(null);
  photoComparee = signal(false);
  readonly identiteConfirmee = computed(() => !this.carte()?.photoAComparer || this.photoComparee());
  patient = signal<{ id: string; prenom: string; nom: string } | null>(null);
  prise = signal<PriseEnChargeView | null>(null);
  avecAssurance = signal(false);
  enCoursAssurance = signal(false);

  /** Le panier tel qu'il etait au dernier calcul de prise en charge. */
  readonly signaturePanier = computed(() =>
    this.lignes().map((l) => `${l.idMedicament()}:${l.quantite() ?? 0}`).join('|')
  );
  signaturePrise = signal('');
  /** Faux des que le panier a change depuis le calcul : il faut recalculer. */
  readonly priseAJour = computed(() => !!this.prise() && this.signaturePrise() === this.signaturePanier());

  readonly peutAppliquerAssurance = computed(
    () => this.carte()?.eligible === true && this.montantBrut() > 0
  );

  readonly modes: ModePaiement[] = ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO'];

  ngOnInit() {
    this.charger();
    this.pharma.getStocks().subscribe({ next: (r) => this.stocks.set(r.data ?? []) });
  }

  private ligneVide(): LignePanier {
    return { idMedicament: signal(''), quantite: signal<number | null>(1) };
  }

  private charger() {
    this.chargerSession();
    this.isLoading.set(true);
    this.pharma.getVentes(20).subscribe({
      next: (r) => {
        this.ventes.set(r.data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.i18n.t('PHARMACIEN.CAISSE.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
      },
    });
  }

  private chargerSession() {
    this.pharma.getSessionCaisse().subscribe({
      next: (r) => {
        this.session.set(r.data ?? null);
        if (r.data?.statut === 'OUVERTE') {
          this.clotureMontant.set(r.data.montantTheoriqueGnf);
        }
      },
      error: (err) => this.signaler(err, 'PHARMACIEN.CAISSE.ERR_SESSION'),
    });
  }

  ouvrirSession() {
    const montant = this.ouvertureMontant();
    if (this.sessionEnCours() || montant === null || !Number.isInteger(montant) || montant < 0) return;
    this.sessionEnCours.set(true);
    this.pharma.ouvrirSessionCaisse(montant).subscribe({
      next: (r) => {
        this.sessionEnCours.set(false);
        this.session.set(r.data ?? null);
        this.clotureMontant.set(r.data?.montantTheoriqueGnf ?? montant);
        this.toastr.success(this.i18n.t('PHARMACIEN.CAISSE.SESSION_OUVERTE'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => {
        this.sessionEnCours.set(false);
        this.signaler(err, 'PHARMACIEN.CAISSE.ERR_SESSION');
      },
    });
  }

  cloturerSession() {
    const session = this.session();
    if (!session || !this.peutCloturer() || this.sessionEnCours()) return;
    this.sessionEnCours.set(true);
    this.pharma.cloturerSessionCaisse(session.id, {
      montantCompteGnf: this.clotureMontant()!,
      ...(this.motifEcart().trim() ? { motifEcart: this.motifEcart().trim() } : {}),
    }).subscribe({
      next: (r) => {
        this.sessionEnCours.set(false);
        this.session.set(r.data ?? null);
        this.toastr.success(this.i18n.t('PHARMACIEN.CAISSE.SESSION_CLOTUREE'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => {
        this.sessionEnCours.set(false);
        this.signaler(err, 'PHARMACIEN.CAISSE.ERR_SESSION');
      },
    });
  }

  stockDe(idMedicament: string): PharmacieStock | undefined {
    return this.stocks().find((s) => s.medicament.id === idMedicament);
  }

  /** Le prix au comptoir, tel que l'API le calcule : reference plus marge. */
  prixDe(idMedicament: string): number {
    const s = this.stockDe(idMedicament);
    return s ? s.medicament.prixUnitaireGnf + (s.margeGnf ?? 0) : 0;
  }

  /** Le choix du produit vendu : on peut taper pour filtrer (nom, DCI, nom commercial). */
  readonly optionsProduits = computed<OptionListe[]>(() => this.stocks().map((s) => ({
    valeur: s.medicament.id,
    libelle: this.libelleProduit(s),
    detail: formaterQuantite((c) => this.i18n.t(c), s.quantite, s.unite),
    recherche: [s.medicament.dci, s.medicament.nomCommercial].filter(Boolean).join(' '),
  })));

  libelleProduit(s: PharmacieStock): string {
    const m = s.medicament;
    const bas = m.libelle.toLowerCase();
    const sup = [m.dosage, m.forme].filter((x): x is string => !!x && !bas.includes(x.toLowerCase()));
    return [m.libelle, ...sup].join(' · ');
  }

  /** Le jeton lu par la camera, ou tape par une douchette qui emule un clavier. */
  onCarteScannee(texte: string) {
    this.showScanner.set(false);
    this.jetonCarte.set(texte.trim());
    this.verifierCarte();
  }

  /**
   * Controle de la carte presentee. La reponse est enregistree cote API : un
   * refus n'est pas une erreur, il porte son motif et s'affiche tel quel.
   */
  verifierCarte() {
    const jeton = this.jetonCarte().trim();
    if (!jeton || this.enCoursAssurance()) return;
    this.enCoursAssurance.set(true);
    this.prise.set(null);
    this.avecAssurance.set(false);
    this.pharma.verifierCarteAssurance(jeton).subscribe({
      next: (r) => {
        this.enCoursAssurance.set(false);
        const carte = r.data ?? null;
        this.carte.set(carte);
        // Le beneficiaire vient de la carte : la vente est rattachee a son dossier.
        this.patient.set(carte?.patient ?? null);
        this.chargerPhotoCarte(carte);
        if (carte?.eligible) this.simuler();
      },
      error: (err) => {
        this.enCoursAssurance.set(false);
        this.carte.set(null);
        this.patient.set(null);
        this.signaler(err, 'PHARMACIEN.CAISSE.ERR_CARTE');
      },
    });
  }

  ngOnDestroy(): void {
    this.libererPhotoCarte();
  }

  private chargerPhotoCarte(carte: CarteAssuranceVerifieeView | null) {
    this.libererPhotoCarte();
    this.photoComparee.set(false);
    if (!carte?.photoDisponible) return;
    this.pharma.photoCarteAssurance(carte.jetonCarte).subscribe({
      next: (image) => this.photoCarte.set(URL.createObjectURL(image)),
      // Sans photo affichable, la confirmation reste impossible : le tiers
      // payant aussi. On le dit plutot que de laisser un bouton grise muet.
      error: () => this.toastr.error(this.i18n.t('PHARMACIEN.CAISSE.ERR_PHOTO'), this.i18n.t('COMMON.ERROR_TITLE')),
    });
  }

  private libererPhotoCarte() {
    const url = this.photoCarte();
    if (url) URL.revokeObjectURL(url);
    this.photoCarte.set(null);
  }

  oublierCarte() {
    this.libererPhotoCarte();
    this.photoComparee.set(false);
    this.patient.set(null);
    this.jetonCarte.set('');
    this.carte.set(null);
    this.prise.set(null);
    this.signaturePrise.set('');
    this.avecAssurance.set(false);
  }

  /** Les lignes du panier, telles que l'API les chiffre. */
  private lignesAChiffrer() {
    return this.lignes()
      .map((l) => ({ stock: this.stockDe(l.idMedicament()), quantite: l.quantite() ?? 0 }))
      .filter((x) => x.stock && x.quantite > 0)
      .map((x) => ({
        idMedicament: x.stock!.medicament.id,
        libelle: x.stock!.medicament.libelle,
        categorie: x.stock!.medicament.categorie,
        montantGnf: this.prixDe(x.stock!.medicament.id) * x.quantite,
      }));
  }

  /** Chiffre la prise en charge avant le paiement, sans rien enregistrer. */
  simuler() {
    const carte = this.carte();
    if (!carte?.eligible || this.montantBrut() <= 0) return;
    const lignes = this.lignesAChiffrer();
    if (lignes.length === 0) return;

    const signature = this.signaturePanier();
    this.enCoursAssurance.set(true);
    this.pharma.simulerPriseEnCharge(carte.jetonCarte, lignes, this.montantNet()).subscribe({
      next: (r) => {
        this.enCoursAssurance.set(false);
        this.prise.set(r.data ?? null);
        this.signaturePrise.set(r.data ? signature : '');
        if (r.data) this.avecAssurance.set(true);
      },
      error: (err) => {
        this.enCoursAssurance.set(false);
        this.prise.set(null);
        this.signaturePrise.set('');
        this.avecAssurance.set(false);
        this.signaler(err, 'PHARMACIEN.CAISSE.ERR_SIMULATION');
      },
    });
  }

  ajouterLigne() {
    this.lignes.update((l) => [...l, this.ligneVide()]);
  }

  retirerLigne(index: number) {
    this.lignes.update((l) => (l.length === 1 ? l : l.filter((_, i) => i !== index)));
  }

  encaisser() {
    if (this.enCours() || !this.peutEncaisser()) return;
    this.enCours.set(true);

    const lignes: LigneVenteDto[] = this.lignes()
      .filter((l) => l.idMedicament() && (l.quantite() ?? 0) > 0)
      .map((l) => ({ idMedicament: l.idMedicament(), quantite: Number(l.quantite()) }));

    const dto: CreerVenteDto = {
      lignes,
      modePaiement: this.modePaiement(),
      ...(this.modePaiement() !== 'ESPECES' ? { numeroOperateur: this.numeroOperateur().trim() } : {}),
      ...(this.idOrdonnance().trim() ? { idOrdonnance: this.idOrdonnance().trim() } : {}),
      ...(this.patient() ? { idPatient: this.patient()!.id } : {}),
      ...(this.avecAssurance() && this.peutAppliquerAssurance() && this.carte()
        ? {
            avecAssurance: true,
            jetonCarteAssurance: this.carte()!.jetonCarte,
            ...(this.carte()!.photoAComparer ? { photoComparee: this.photoComparee() } : {}),
          }
        : {}),
    };

    this.pharma.enregistrerVente(dto).subscribe({
      next: (r) => {
        this.enCours.set(false);
        const vente = r.data;

        // **Une vente mobile n'est pas payee parce qu'elle est enregistree.**
        // Elle attend que le client paie : on montre le QR au lieu d'annoncer
        // un succes qui n'a pas eu lieu.
        if (vente?.statut === 'EN_ATTENTE' && vente.urlPaiement) {
          this.ouvrirAttente(vente);
        } else {
          this.toastr.success(
            this.i18n.t('PHARMACIEN.CAISSE.OK', { numero: vente?.numero ?? '' }),
            this.i18n.t('COMMON.SUCCESS')
          );
        }
        this.reinitialiser();
        this.charger();
        // Le stock a baisse : le relire evite d'autoriser une seconde vente
        // sur une quantite qui n'existe plus.
        this.pharma.getStocks().subscribe({ next: (s) => this.stocks.set(s.data ?? []) });
      },
      error: (err) => this.signaler(err, 'PHARMACIEN.CAISSE.ERR_ENCAISSER'),
    });
  }

  /** Affiche le QR du lien de paiement, a tourner vers le client. */
  private async ouvrirAttente(vente: VenteComptoirView): Promise<void> {
    this.attente.set(vente);
    this.qrImage.set('');
    if (!vente.urlPaiement) return;
    try {
      // Marge et contraste eleves : le code est scanne a bout de bras, sur un
      // ecran de caisse souvent mal oriente.
      this.qrImage.set(await QRCode.toDataURL(vente.urlPaiement, {
        width: 280, margin: 2, errorCorrectionLevel: 'M',
      }));
    } catch {
      // Sans image, le lien reste affiche en clair : le client peut le taper.
      this.qrImage.set('');
    }
  }

  /**
   * Relit l'etat du paiement.
   *
   * C'est le geste du pharmacien qui attend, pas une tache de fond : il
   * appuie quand le client lui dit avoir paye.
   */
  verifierPaiement(): void {
    const vente = this.attente();
    if (!vente || this.verifieEnCours()) return;
    this.verifieEnCours.set(true);

    this.pharma.rafraichirPaiement(vente.id).subscribe({
      next: (r) => {
        this.verifieEnCours.set(false);
        const maj = r.data;
        if (!maj) return;
        if (maj.statut === 'PAYEE') {
          this.attente.set(null);
          this.toastr.success(
            this.i18n.t('PHARMACIEN.CAISSE.PAIEMENT_CONFIRME', { numero: maj.numero }),
            this.i18n.t('COMMON.SUCCESS')
          );
          this.charger();
        } else {
          this.attente.set(maj);
          this.toastr.info(this.i18n.t('PHARMACIEN.CAISSE.PAS_ENCORE'));
        }
      },
      error: (err) => {
        this.verifieEnCours.set(false);
        this.signaler(err, 'PHARMACIEN.CAISSE.ERR_VERIFIER');
      },
    });
  }

  /**
   * Le client s'en va sans payer : la vente est annulee et les boites
   * repartent en stock.
   *
   * Sans ce geste, elles resteraient sorties sans que rien ne les y ramene.
   */
  abandonnerAttente(): void {
    const vente = this.attente();
    if (!vente) return;
    this.demanderAnnulation(vente, this.i18n.t('PHARMACIEN.CAISSE.MOTIF_ABANDON'));
  }

  /** Le montant que le client doit payer : la part de l'assureur est deduite. */
  montantAPayer(): number {
    return this.attente()?.montantPatientGnf ?? 0;
  }

  annuler(vente: VenteComptoirView) {
    this.demanderAnnulation(vente);
  }

  demanderAnnulation(vente: VenteComptoirView, motif = ''): void {
    this.annulationVente.set(vente);
    this.motifAnnulation.set(motif);
    this.validationTitulaireRequise.set(false);
    this.telephoneTitulaire.set('');
    this.motDePasseTitulaire.set('');
  }

  fermerAnnulation(): void {
    if (this.annulationEnCours()) return;
    this.annulationVente.set(null);
    this.motDePasseTitulaire.set('');
  }

  confirmerAnnulation(): void {
    const vente = this.annulationVente();
    const motif = this.motifAnnulation().trim();
    if (!vente || this.annulationEnCours()) return;
    if (motif.length < 5) {
      this.toastr.error(this.i18n.t('PHARMACIEN.CAISSE.MOTIF_COURT'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }
    if (this.validationTitulaireRequise() && (
      !this.telephoneTitulaire().trim() || !this.motDePasseTitulaire()
    )) {
      this.toastr.error(this.i18n.t('PHARMACIEN.CAISSE.AUTH_TITULAIRE_REQUISE'), this.i18n.t('COMMON.ERROR_TITLE'));
      return;
    }

    this.annulationEnCours.set(true);
    this.pharma.annulerVente(vente.id, {
      motif,
      ...(this.validationTitulaireRequise() ? {
        autorisationTitulaire: {
          telephone: this.telephoneTitulaire().trim(),
          motDePasse: this.motDePasseTitulaire(),
        },
      } : {}),
    }).subscribe({
      next: () => {
        this.annulationEnCours.set(false);
        this.annulationVente.set(null);
        this.motDePasseTitulaire.set('');
        if (this.attente()?.id === vente.id) this.attente.set(null);
        this.toastr.success(this.i18n.t('PHARMACIEN.CAISSE.ANNULEE'), this.i18n.t('COMMON.SUCCESS'));
        this.charger();
        this.pharma.getStocks().subscribe({ next: (s) => this.stocks.set(s.data ?? []) });
      },
      error: (err) => {
        this.annulationEnCours.set(false);
        const e = err as { status?: number };
        if (e?.status === 403 && !this.validationTitulaireRequise()) {
          this.validationTitulaireRequise.set(true);
          return;
        }
        this.motDePasseTitulaire.set('');
        this.signaler(err, 'PHARMACIEN.CAISSE.ERR_ANNULER');
      },
    });
  }

  /**
   * Un serveur injoignable n'est pas une erreur de saisie : le dire evite de
   * chercher la faute dans le panier.
   */
  private signaler(err: unknown, cleDefaut: string) {
    this.enCours.set(false);
    const e = err as { status?: number; error?: { error?: string } };
    this.toastr.error(
      e?.status === 0
        ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
        : e?.error?.error ?? this.i18n.t(cleDefaut),
      this.i18n.t('COMMON.ERROR_TITLE')
    );
  }

  private reinitialiser() {
    this.oublierCarte();
    this.lignes.set([this.ligneVide()]);
    this.modePaiement.set('ESPECES');
    this.numeroOperateur.set('');
    this.idOrdonnance.set('');
  }
}
