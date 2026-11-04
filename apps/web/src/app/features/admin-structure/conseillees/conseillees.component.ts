// features/admin-structure/conseillees — le carnet d'adresses de l'etablissement.
//
// **Ce n'est pas un contrat.** Le laboratoire conseille n'a rien a accepter :
// la plateforme autorise deja d'adresser une demande a n'importe quel
// laboratoire actif. La declaration met en tete de liste chez les medecins de
// l'etablissement, sous « Partenaires declares ». Elle ne donne aucun droit,
// n'engage aucun tarif, et se retire d'un geste.
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import type { StructureConseilleeView, StructureRefView } from '@baobaoheath/shared-types';

import { AdminService } from '../../../core/services/admin.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { ListeRechercheComponent, OptionListe } from '../../../shared/components/liste-recherche/liste-recherche.component';

@Component({
  selector: 'app-admin-structure-conseillees',
  standalone: true,
  imports: [ListeRechercheComponent, DatePipe, FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatDialogModule, TranslatePipe],
  templateUrl: './conseillees.component.html',
  styleUrl: './conseillees.component.scss',
})
export class ConseilleesComponent implements OnInit {
  readonly optionsCandidats = computed<OptionListe[]>(() =>
    this.candidats().map((s) => ({ valeur: s.id, libelle: s.nom, detail: s.prefecture })));

  private admin  = inject(AdminService);
  private toastr = inject(ToastrService);
  private i18n   = inject(I18nService);
  private dialog = inject(MatDialog);

  isLoading = signal(true);
  isSaving  = signal(false);
  liste     = signal<StructureConseilleeView[]>([]);
  candidats = signal<StructureRefView[]>([]);
  choix     = signal('');

  ngOnInit() { this.charger(); }

  private charger() {
    this.isLoading.set(true);
    this.admin.conseillees().subscribe({
      next: (r) => { this.liste.set(r.data ?? []); this.isLoading.set(false); },
      error: (err) => { this.isLoading.set(false); this.erreur(err); },
    });
    this.rechargerCandidats();
  }

  // Le serveur retire deja soi-meme et les deja-conseillees : la liste se relit
  // donc apres chaque ajout ou retrait, elle ne se filtre pas ici.
  private rechargerCandidats() {
    this.admin.candidatsConseil().subscribe({
      next: (r) => { this.candidats.set(r.data ?? []); this.choix.set(''); },
      error: (err) => this.erreur(err),
    });
  }

  private erreur(err: unknown) {
    const e = err as { error?: { error?: string; message?: string } };
    this.toastr.error(
      e?.error?.error ?? e?.error?.message ?? this.i18n.t('COMMON.ERROR_GENERIC'),
      this.i18n.t('COMMON.ERROR_TITLE')
    );
  }

  ajouter() {
    const id = this.choix();
    if (!id || this.isSaving()) return;
    this.isSaving.set(true);
    this.admin.conseiller(id).subscribe({
      next: (r) => {
        this.isSaving.set(false);
        const ligne = r.data;
        if (ligne) this.liste.update((l) => [ligne, ...l]);
        this.rechargerCandidats();
        this.toastr.success(this.i18n.t('ADMIN_STRUCTURE.CONSEILLEES.AJOUTE'), this.i18n.t('COMMON.SUCCESS'));
      },
      error: (err) => { this.isSaving.set(false); this.erreur(err); },
    });
  }

  // Retirer ne casse rien : les demandes deja envoyees a ce laboratoire
  // restent, et il reste adressable. Seul l'ordre de la liste change.
  retirer(c: StructureConseilleeView) {
    const data: ConfirmDialogData = {
      titre: this.i18n.t('ADMIN_STRUCTURE.CONSEILLEES.RETIRER'),
      texte: this.i18n.t('ADMIN_STRUCTURE.CONSEILLEES.RETIRER_CONFIRM', { nom: c.nom }),
      confirmer: this.i18n.t('COMMON.CONFIRM'),
      annuler: this.i18n.t('COMMON.CANCEL'),
      icone: 'pi-times-circle',
    };
    this.dialog.open(ConfirmDialogComponent, { data, width: '420px', autoFocus: false })
      .afterClosed().subscribe((ok) => {
        if (!ok) return;
        this.admin.retirerConseil(c.id).subscribe({
          next: () => {
            this.liste.update((l) => l.filter((x) => x.id !== c.id));
            this.rechargerCandidats();
            this.toastr.success(this.i18n.t('ADMIN_STRUCTURE.CONSEILLEES.RETIRE'), this.i18n.t('COMMON.SUCCESS'));
          },
          error: (err) => this.erreur(err),
        });
      });
  }
}
