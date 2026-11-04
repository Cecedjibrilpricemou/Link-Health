// features/pharmacien/approvisionnements — l'entrée en stock par facture.
//
// Addendum du 2026-09-28, point 1.3. Chaque ligne de la facture devient un
// lot, avec sa propre date de péremption : c'est ce que l'ancien modèle ne
// savait pas porter.
//
// Saisie assistée, pas extraction automatique. La facture est attachée en
// justificatif ; la lecture du document viendra ensuite, et devra toujours
// être relue avant enregistrement.
import { Component, OnInit, WritableSignal, computed, inject, signal } from '@angular/core';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ToastrService } from 'ngx-toastr';
import type { ApprovisionnementView, LigneApprovisionnementDto } from '@baobaoheath/shared-types';

import { PharmacienService } from '../../../core/services/pharmacien.service';
import { MedicamentInfo } from '../../../core/models/pharmacien.model';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

// Chaque champ est un signal, pas une propriété.
//
// L'application est zoneless : `[(ngModel)]` qui écrit dans un champ ordinaire
// — ou qui mute un objet rangé dans un signal — ne notifie personne, et le
// `computed` du total reste figé sur sa dernière valeur. Le formulaire s'était
// ainsi retrouvé avec un total faux et un bouton mort le 2026-09-30, alors que
// la compilation était verte. Angular sait lier `[(ngModel)]` à un signal
// inscriptible : le gabarit n'a pas besoin de changer.
type LigneSaisie = {
  idMedicament: WritableSignal<string>;
  quantite: WritableSignal<number | null>;
  numeroLot: WritableSignal<string>;
  datePeremption: WritableSignal<string>;
  prixAchatGnf: WritableSignal<number | null>;
};

@Component({
  selector: 'app-pharmacien-approvisionnements',
  standalone: true,
  imports: [ListeRechercheComponent, DatePipe, DecimalPipe, FormsModule, MatButtonModule, TranslatePipe, ExportListeComponent],
  templateUrl: './approvisionnements.component.html',
  styleUrl: './approvisionnements.component.scss',
})
export class ApprovisionnementsComponent implements OnInit {
  private pharma = inject(PharmacienService);
  private toastr = inject(ToastrService);
  private i18n = inject(I18nService);

  historique = signal<ApprovisionnementView[]>([]);

  /** Ce qu'on rapproche des factures du fournisseur, ligne par ligne. */
  readonly colonnes: ColonneExport<ApprovisionnementView>[] = [
    { titre: 'EXPORT.COL.NUMERO', valeur: (a) => a.numero },
    { titre: 'EXPORT.COL.DATE_FACTURE', valeur: (a) => new Date(a.dateFacture) },
    { titre: 'EXPORT.COL.FOURNISSEUR', valeur: (a) => a.fournisseur },
    { titre: 'EXPORT.COL.NUMERO_FACTURE', valeur: (a) => a.numeroFacture },
    { titre: 'EXPORT.COL.LOTS', valeur: (a) => a.lots.length, nombre: true },
    { titre: 'EXPORT.COL.MONTANT_GNF', valeur: (a) => a.montantTotalGnf, nombre: true },
    { titre: 'EXPORT.COL.SAISI_PAR', valeur: (a) => `${a.saisiPar.prenom} ${a.saisiPar.nom}` },
    { titre: 'EXPORT.COL.SAISI_LE', valeur: (a) => new Date(a.creeLe) },
  ];
  /** Le catalogue, a plat : l'API rend des medicaments, pas des lignes de stock. */
  medicaments = signal<MedicamentInfo[]>([]);
  isLoading = signal(true);
  enCours = signal(false);
  formulaireOuvert = signal(false);

  fournisseur = signal('');
  dateFacture = signal(this.aujourdhui());
  numeroFacture = signal('');
  justificatifUrl = signal('');
  lignes = signal<LigneSaisie[]>([this.ligneVide()]);

  /** Le total de la facture, recalculé à chaque frappe. */
  readonly total = computed(() =>
    this.lignes().reduce((t, l) => t + (l.prixAchatGnf() ?? 0) * (l.quantite() ?? 0), 0)
  );

  readonly peutEnregistrer = computed(() =>
    this.fournisseur().trim().length >= 2 &&
    !!this.dateFacture() &&
    this.lignes().some((l) => l.idMedicament() && (l.quantite() ?? 0) > 0)
  );

  ngOnInit() {
    this.charger();
    this.pharma.getMedicaments().subscribe({ next: (r) => this.medicaments.set(r.data ?? []) });
  }

  private aujourdhui(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private ligneVide(): LigneSaisie {
    return {
      idMedicament: signal(''),
      quantite: signal<number | null>(null),
      numeroLot: signal(''),
      datePeremption: signal(''),
      prixAchatGnf: signal<number | null>(null),
    };
  }

  private charger() {
    this.isLoading.set(true);
    this.pharma.getApprovisionnements().subscribe({
      next: (r) => {
        this.historique.set(r.data ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.toastr.error(this.i18n.t('PHARMACIEN.APPRO.ERR_LOAD'), this.i18n.t('COMMON.ERROR_TITLE'));
      },
    });
  }

  ajouterLigne() {
    this.lignes.update((l) => [...l, this.ligneVide()]);
  }

  retirerLigne(index: number) {
    this.lignes.update((l) => (l.length === 1 ? l : l.filter((_, i) => i !== index)));
  }

  enregistrer() {
    if (this.enCours() || !this.peutEnregistrer()) return;
    this.enCours.set(true);

    const lignes: LigneApprovisionnementDto[] = this.lignes()
      .filter((l) => l.idMedicament() && (l.quantite() ?? 0) > 0)
      .map((l) => ({
        idMedicament: l.idMedicament(),
        quantite: Number(l.quantite()),
        numeroLot: l.numeroLot().trim() || undefined,
        datePeremption: l.datePeremption() ? new Date(l.datePeremption()).toISOString() : undefined,
        prixAchatGnf: l.prixAchatGnf() === null ? undefined : Number(l.prixAchatGnf()),
      }));

    this.pharma.enregistrerApprovisionnement({
      fournisseur: this.fournisseur().trim(),
      dateFacture: new Date(this.dateFacture()).toISOString(),
      numeroFacture: this.numeroFacture().trim() || undefined,
      justificatifUrl: this.justificatifUrl().trim() || undefined,
      lignes,
    }).subscribe({
      next: (r) => {
        this.enCours.set(false);
        this.toastr.success(
          this.i18n.t('PHARMACIEN.APPRO.OK', { numero: r.data?.numero ?? '' }),
          this.i18n.t('COMMON.SUCCESS')
        );
        this.reinitialiser();
        this.charger();
      },
      error: (err) => {
        this.enCours.set(false);
        const e = err as { status?: number; error?: { error?: string } };
        this.toastr.error(
          e?.status === 0
            ? this.i18n.t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE')
            : e?.error?.error ?? this.i18n.t('PHARMACIEN.APPRO.ERR_ENREGISTRER'),
          this.i18n.t('COMMON.ERROR_TITLE')
        );
      },
    });
  }

  private reinitialiser() {
    this.formulaireOuvert.set(false);
    this.fournisseur.set('');
    this.dateFacture.set(this.aujourdhui());
    this.numeroFacture.set('');
    this.justificatifUrl.set('');
    this.lignes.set([this.ligneVide()]);
  }

  /** Le produit de chaque ligne de facture : on peut taper pour filtrer. */
  readonly optionsProduits = computed<OptionListe[]>(() => this.medicaments().map((m) => ({
    valeur: m.id,
    libelle: this.libelleProduit(m),
    recherche: [m.dci, m.nomCommercial].filter(Boolean).join(' '),
  })));

  libelleProduit(m: MedicamentInfo): string {
    return this.composer(m.libelle, m.dosage, m.forme);
  }
  /**
   * Le libelle est le nom complet du produit. On n'ajoute la forme et le
   * dosage que s'ils n'y figurent pas deja : « Doliprane 500mg · 500mg » est
   * du bruit, et un article non medicamenteux n'a ni l'un ni l'autre.
   */
  private composer(libelle: string, dosage?: string | null, forme?: string | null): string {
    const bas = libelle.toLowerCase();
    const sup = [dosage, forme].filter((x): x is string => !!x && !bas.includes(x.toLowerCase()));
    return [libelle, ...sup].join(' · ');
  }

}
