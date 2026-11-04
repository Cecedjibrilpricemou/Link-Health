import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { QrScannerComponent } from '../../../shared/components/qr-scanner/qr-scanner.component';
import { MedicamentInfo } from '../../../core/models/pharmacien.model';
import type {
  HorodatageApi,
  LigneDelivranceView,
  OrdonnanceDelivranceView,
  OrdonnanceEnAttenteView,
  PatientScanView,
  VerificationOrdonnanceView,
} from '@baobaoheath/shared-types';

@Component({
  selector: 'app-ordonnances',
  standalone: true,
  imports: [
ListeRechercheComponent,     MatRadioModule,
    MatFormFieldModule, MatInputModule, CommonModule, FormsModule, TranslatePipe, QrScannerComponent],
  templateUrl: './ordonnances.component.html',
  styleUrl: './ordonnances.component.scss'
})
export class OrdonnancesComponent implements OnInit {
  private pharmacienService = inject(PharmacienService);
  private router = inject(Router);
  private i18n = inject(I18nService);

  // Scanner State
  qrCode       = '';
  /** Lecture camera (app-qr-scanner) ; la saisie manuelle reste possible. */
  showScanner  = signal(false);
  isScanning   = signal(false);
  errorMessage = signal('');

  // Patient & Ordonnances State
  patient          = signal<PatientScanView | null>(null);
  ordonnances      = signal<OrdonnanceDelivranceView[]>([]);
  // On delivre un medicament, pas une ordonnance : la selection designe donc
  // une ligne, mais garde son document — c'est lui qui porte le numero, la
  // validite et la signature que le pharmacien doit pouvoir verifier a l'ecran.
  selected         = signal<{ ordonnance: OrdonnanceDelivranceView; ligne: LigneDelivranceView } | null>(null);
  isDelivering     = signal(false);
  successMessage   = signal('');

  // Formulaire de délivrance
  modePaiement     = 'ESPECES';
  quantiteDelivree = 0;

  get modesPaiement() {
    return [
      { label: this.i18n.t('PHARMACIEN.ORDONNANCES.MODE_CASH'),   value: 'ESPECES'      },
      { label: this.i18n.t('PHARMACIEN.ORDONNANCES.MODE_ORANGE'), value: 'ORANGE_MONEY' },
      { label: this.i18n.t('PHARMACIEN.ORDONNANCES.MODE_MTN'),    value: 'MTN_MOMO'     }
    ];
  }

  // Ordonnances en attente dans la prefecture (GET /pharmacien/ordonnances) :
  // le pharmacien voit qui est attendu et ouvre la delivrance d'un clic,
  // sans attendre que le patient presente son QR code.
  enAttente          = signal<OrdonnanceEnAttenteView[]>([]);
  isLoadingEnAttente = signal(true);

  // ── Verification par numero + code (EF-07-01) ──────────────────────
  // Le patient peut arriver avec le papier et sans son QR : c'est le cas le
  // plus courant au comptoir.
  numeroSaisi = '';
  codeSaisi   = '';
  isVerifiant = signal(false);
  verification = signal<VerificationOrdonnanceView | null>(null);

  /**
   * Le catalogue, pour proposer un equivalent (EF-07-04).
   *
   * Charge une fois a l'ouverture de l'ecran : une substitution se decide au
   * comptoir, devant le patient, et attendre un aller-retour reseau a ce
   * moment-la se paie en file d'attente.
   */
  medicaments = signal<MedicamentInfo[]>([]);

  verifier() {
    const numero = this.numeroSaisi.trim();
    const code = this.codeSaisi.trim();
    if (!numero || !code || this.isVerifiant()) return;

    this.isVerifiant.set(true);
    this.errorMessage.set('');
    this.verification.set(null);

    this.pharmacienService.verifierOrdonnance({ numero, codeVerification: code }).subscribe({
      next: res => {
        this.isVerifiant.set(false);
        this.verification.set(res.data ?? null);
      },
      error: err => {
        this.isVerifiant.set(false);
        // 400 = numero mal forme (le format est valide cote API) ; un couple
        // faux revient en 200 avec `valide: false`.
        this.errorMessage.set(err?.error?.error ?? this.i18n.t('PHARMACIEN.ORDONNANCES.ERR_VERIFY'));
      }
    });
  }

  /** Ouvre la delivrance du dossier verifie : meme parcours que le scan. */
  ouvrirDepuisVerification() {
    const v = this.verification();
    if (!v?.valide || !v.ordonnance || !v.patient) return;
    this.patient.set(v.patient);
    this.ordonnances.set([v.ordonnance]);
    this.verification.set(null);
    this.numeroSaisi = '';
    this.codeSaisi = '';
  }

  fermerVerification() { this.verification.set(null); }

  ngOnInit() {
    this.pharmacienService.getMedicaments().subscribe({
      next: (r) => this.medicaments.set(r.data ?? []),
      // Sans catalogue la substitution n'est pas proposable, mais le reste de
      // l'ecran fonctionne : on ne bloque pas un comptoir pour autant.
      error: () => this.medicaments.set([]),
    });

    const nav = this.router.getCurrentNavigation();
    const state = nav?.extras?.state as { scanResult?: { patient?: PatientScanView; ordonnances?: OrdonnanceDelivranceView[] } } | undefined;

    if (state?.scanResult) {
      this.patient.set(state.scanResult.patient ?? null);
      this.ordonnances.set(state.scanResult.ordonnances ?? []);
    }
    // FINI LE BUG : Aucune redirection si aucun scanResult n'est présent !
    // L'interface affichera d'elle-même le composant Scanner (Empty State).

    this.chargerEnAttente();
  }

  chargerEnAttente() {
    this.isLoadingEnAttente.set(true);
    this.pharmacienService.getOrdonnancesEnAttente().subscribe({
      next: res => { this.enAttente.set(res.data ?? []); this.isLoadingEnAttente.set(false); },
      error: () => { this.isLoadingEnAttente.set(false); }
    });
  }

  /** Ouvre la delivrance d'une ordonnance de la liste : meme parcours que le scan. */
  ouvrirDepuisListe(o: OrdonnanceEnAttenteView) {
    this.qrCode = o.patient.qrCode;
    this.scan();
  }

  /** Regroupe la liste par patient : un patient peut avoir plusieurs lignes. */
  get enAttenteParPatient(): { qrCode: string; prenom: string; nom: string; lignes: OrdonnanceEnAttenteView[] }[] {
    const groupes = new Map<string, { qrCode: string; prenom: string; nom: string; lignes: OrdonnanceEnAttenteView[] }>();
    for (const o of this.enAttente()) {
      const g = groupes.get(o.patient.qrCode) ?? { ...o.patient, lignes: [] };
      g.lignes.push(o);
      groupes.set(o.patient.qrCode, g);
    }
    return [...groupes.values()];
  }

  /**
   * Relire les ordonnances du patient.
   *
   * `conserver` garde l'affichage courant pendant l'aller-retour. **Sans lui,
   * l'ecran se vide une fraction de seconde** — et le message de confirmation
   * d'une substitution ou d'un refus, qui vit dans ce bloc, disparaissait
   * avec : le pharmacien ne voyait jamais que son geste avait ete enregistre.
   */
  scan(conserver = false) {
    if (!this.qrCode.trim()) {
      this.errorMessage.set(this.i18n.t('PHARMACIEN.ORDONNANCES.ERR_QR_REQUIRED'));
      return;
    }
    this.isScanning.set(true);
    this.errorMessage.set('');
    if (!conserver) {
      this.patient.set(null);
      this.ordonnances.set([]);
    }

    this.pharmacienService.scanQrCode(this.qrCode.trim()).subscribe({
      next: (response) => {
        this.isScanning.set(false);
        const raw = response.data as unknown as { patient?: PatientScanView; ordonnances?: OrdonnanceDelivranceView[] } | null;
        this.patient.set(raw?.patient ?? null);
        this.ordonnances.set(raw?.ordonnances ?? []);
      },
      error: (err) => {
        this.isScanning.set(false);
        this.errorMessage.set(err?.error?.error ?? err?.error?.message ?? this.i18n.t('PHARMACIEN.ORDONNANCES.ERR_PATIENT_NOT_FOUND'));
      }
    });
  }

  /** QR lu par la camera : on le traite exactement comme une saisie + Rechercher. */
  onQrDetecte(code: string) {
    this.showScanner.set(false);
    this.qrCode = code;
    this.scan();
  }

  getAge(dateNaissance: string): number | null {
    if (!dateNaissance) return null;
    const n = new Date(dateNaissance);
    if (Number.isNaN(n.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - n.getFullYear();
    if (now < new Date(now.getFullYear(), n.getMonth(), n.getDate())) age--;
    return age;
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter') this.scan();
  }

  resetScan() {
    this.patient.set(null);
    this.ordonnances.set([]);
    this.qrCode = '';
    this.errorMessage.set('');
    this.successMessage.set('');
    this.selected.set(null);
  }

  selectionner(ordonnance: OrdonnanceDelivranceView, ligne: LigneDelivranceView) {
    this.selected.set({ ordonnance, ligne });
    this.geste.set('DELIVRER');
    this.motif.set('');
    this.idSubstitut.set('');
    // Ce qu'il reste, pas ce qui est prescrit : la ligne a pu etre entamee
    // dans une autre officine.
    this.quantiteDelivree = this.resteAServir(ligne);
    this.modePaiement = 'ESPECES';
    this.errorMessage.set('');
  }

  annuler() {
    this.selected.set(null);
    this.geste.set('DELIVRER');
    this.motif.set('');
    this.idSubstitut.set('');
    this.errorMessage.set('');
  }

  // ── Trois gestes au comptoir (EF-07-03/04/05) ──────────────────────
  //
  // **Un seul panneau, trois gestes.** L'officine choisit ce qu'elle fait de
  // la ligne : remettre ce qui est prescrit, remettre autre chose, ou ne rien
  // remettre. Les deux derniers exigent un motif — c'est le prescripteur et
  // le patient qui le liront.

  geste = signal<'DELIVRER' | 'SUBSTITUER' | 'REFUSER'>('DELIVRER');
  motif = signal('');
  idSubstitut = signal('');

  /** Les substituts possibles : tout le catalogue sauf le produit prescrit. */
  readonly optionsSubstituts = computed<OptionListe[]>(() => {
    const prescrit = this.selected()?.ligne.medicament.id;
    return this.medicaments().filter((m) => m.id !== prescrit).map((m) => ({
      valeur: m.id,
      libelle: m.libelle,
      recherche: [m.dci, m.nomCommercial].filter(Boolean).join(' '),
    }));
  });

  choisirGeste(g: 'DELIVRER' | 'SUBSTITUER' | 'REFUSER') {
    this.geste.set(g);
    this.errorMessage.set('');
  }

  /** Le motif est exige par l'ecran, par l'API et par la base. */
  motifSuffisant(): boolean {
    return this.motif().trim().length >= 5;
  }

  peutValider(): boolean {
    const sel = this.selected();
    if (!sel || this.isDelivering() || sel.ligne.alerteAllergie) return false;
    if (this.geste() === 'DELIVRER') return true;
    if (!this.motifSuffisant()) return false;
    return this.geste() === 'REFUSER' || this.idSubstitut().length > 0;
  }

  /** Ce qu'il reste a servir sur la ligne choisie : la borne de la saisie. */
  resteAServir(ligne: LigneDelivranceView): number {
    return ligne.resteAServir ?? ligne.quantite;
  }

  valider() {
    const sel = this.selected();
    if (!sel || !this.peutValider()) return;
    if (this.geste() === 'DELIVRER') { this.delivrer(); return; }

    this.isDelivering.set(true);
    this.errorMessage.set('');
    const motif = this.motif().trim();

    const appel = this.geste() === 'SUBSTITUER'
      ? this.pharmacienService.substituerLigne(sel.ligne.id, {
          idMedicamentDelivre: this.idSubstitut(),
          quantiteDelivree: this.quantiteDelivree,
          motif,
        })
      : this.pharmacienService.refuserLigne(sel.ligne.id, motif);

    appel.subscribe({
      next: () => {
        this.isDelivering.set(false);
        const clef = this.geste() === 'SUBSTITUER'
          ? 'PHARMACIEN.ORDONNANCES.SUBSTITUE_OK'
          : 'PHARMACIEN.ORDONNANCES.REFUSE_OK';
        this.annuler();
        this.successMessage.set(this.i18n.t(clef));
        setTimeout(() => this.successMessage.set(''), 5000);
        this.relire();
      },
      error: (err) => {
        this.isDelivering.set(false);
        this.errorMessage.set(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'));
      },
    });
  }

  /**
   * Relire depuis le serveur plutot que de corriger la liste a la main.
   *
   * **L'ecran retirait la ligne apres chaque delivrance**, quelle que soit la
   * quantite : trois boites remises sur dix, et la ligne disparaissait alors
   * qu'il en restait sept. Le serveur sait ce qui reste ; le recalculer ici
   * serait une occasion de divergence de plus.
   */
  private relire() {
    if (this.qrCode.trim()) this.scan(true);
    this.chargerEnAttente();
  }

  isRenouvelant = signal('');

  /**
   * EF-05-09 : rouvrir le traitement pour un nouveau cycle. On relit ensuite
   * le patient : les lignes repassent en attente cote serveur, et rejouer ce
   * calcul ici serait une occasion de divergence.
   */
  renouveler(ordonnance: OrdonnanceDelivranceView) {
    if (this.isRenouvelant()) return;
    this.isRenouvelant.set(ordonnance.id);
    this.errorMessage.set('');

    this.pharmacienService.renouvelerOrdonnance(ordonnance.id).subscribe({
      next: () => {
        this.isRenouvelant.set('');
        this.successMessage.set(this.i18n.t('PHARMACIEN.ORDONNANCES.RENEW_OK', { numero: ordonnance.numero }));
        setTimeout(() => this.successMessage.set(''), 5000);
        if (this.qrCode.trim()) this.scan();
        this.chargerEnAttente();
      },
      error: (err) => {
        this.isRenouvelant.set('');
        this.errorMessage.set(err?.error?.error ?? this.i18n.t('PHARMACIEN.ORDONNANCES.ERR_RENEW'));
      },
    });
  }

  delivrer() {
    const selection = this.selected();
    if (!selection) return;
    const { ordonnance, ligne } = selection;

    this.isDelivering.set(true);
    this.errorMessage.set('');

    this.pharmacienService.delivrerOrdonnance(ligne.id, {
      modePaiement: this.modePaiement,
      quantiteDelivree: this.quantiteDelivree
    } as unknown as import('../../../core/models/pharmacien.model').DelivrancePayload).subscribe({
      next: (response) => {
        this.isDelivering.set(false);
        this.selected.set(null);

        // **On relit, on ne corrige pas la liste a la main.** La version
        // precedente retirait la ligne apres chaque delivrance, quelle que
        // soit la quantite : trois boites remises sur dix, et la ligne
        // disparaissait alors qu'il en restait sept a servir.
        this.relire();

        const responseData = response?.data as { montantGnf?: number };
        this.successMessage.set(this.i18n.t('PHARMACIEN.ORDONNANCES.SUCCESS_DELIVERED', { amount: this.formatMontant(responseData?.montantGnf ?? 0) }));
        setTimeout(() => this.successMessage.set(''), 5000);
      },
      error: (err) => {
        this.isDelivering.set(false);
        this.errorMessage.set(err?.error?.error ?? this.i18n.t('PHARMACIEN.ORDONNANCES.ERR_DELIVER'));
      }
    });
  }

  getMontantAvecQuantite(ligne: LigneDelivranceView): number {
    return ligne.medicament.prixUnitaireGnf * this.quantiteDelivree;
  }

  formatMontant(m: number): string {
    return new Intl.NumberFormat('fr-GN', { style: 'currency', currency: 'GNF', maximumFractionDigits: 0 }).format(m);
  }

  // Une ordonnance non signee n'a pas de date : le type le dit, l'affichage
  // doit donc prevoir le cas plutot que de rendre « Invalid Date ».
  formatDate(d: HorodatageApi | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
