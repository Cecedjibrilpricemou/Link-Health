// shared/components/profil-modal/profil-modal.component.ts
import { Component, computed, inject, signal, OnInit, input, output } from '@angular/core';
import type { DemandeChangementTelephoneView } from '@baobaoheath/shared-types';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { I18nService } from '../../services/i18n.service';
import { AvatarComponent } from '../avatar/avatar.component';

type Tab = 'profil' | 'password';

const TAILLE_MAX_PHOTO = 3 * 1024 * 1024;
const TYPES_PHOTO_ACCEPTES = ['image/jpeg', 'image/png', 'image/webp'];

@Component({
  selector: 'app-profil-modal',
  standalone: true,
  imports: [
    MatInputModule,
    MatFormFieldModule,CommonModule, FormsModule, TranslatePipe, AvatarComponent],
  templateUrl: './profil-modal.component.html',
  styleUrl: './profil-modal.component.scss'
})
export class ProfilModalComponent implements OnInit {
  private authService = inject(AuthService);
  private i18n = inject(I18nService);

  // Input/Output
  forcerChangement = input<boolean>(false); // true si doitChangerMotDePasse
  fermer = output<void>();

  currentUser = this.authService.currentUser;
  activeTab   = signal<Tab>('profil');
  isSaving    = signal(false);
  successMsg  = signal('');
  errorMsg    = signal('');

  // Formulaire profil
  // Le numero n'y est plus : il a son propre parcours (voir plus bas).
  profilForm = { prenom: '', nom: '', email: '' };

  // ── Changer de numero ─────────────────────────────────────────────
  //
  // Le numero est la cle du compte (connexion, codes, USSD). Il ne change
  // qu'en deux temps : le mot de passe actuel, puis le code envoye au nouveau
  // numero. Une session restee ouverte ne suffit plus a le detourner.
  etapeTel = signal<'ferme' | 'saisie' | 'code'>('ferme');
  nouveauTel = signal('');
  motDePasseTel = signal('');
  codeTel = signal('');
  demandeTel = signal<DemandeChangementTelephoneView | null>(null);
  telEnCours = signal(false);

  peutDemanderCodeTel = computed(() =>
    !this.telEnCours() && this.nouveauTel().trim().length >= 6 && this.motDePasseTel().length > 0);
  peutConfirmerTel = computed(() => !this.telEnCours() && /^\d{6}$/.test(this.codeTel().trim()));

  ouvrirChangementTel() {
    this.nouveauTel.set('');
    this.motDePasseTel.set('');
    this.codeTel.set('');
    this.demandeTel.set(null);
    this.errorMsg.set('');
    this.etapeTel.set('saisie');
  }

  fermerChangementTel() {
    this.motDePasseTel.set('');
    this.etapeTel.set('ferme');
  }

  demanderCodeTel() {
    if (!this.peutDemanderCodeTel()) return;
    this.telEnCours.set(true);
    this.errorMsg.set('');
    this.authService.demanderChangementTelephone(this.nouveauTel().trim(), this.motDePasseTel()).subscribe({
      next: (demande) => {
        this.telEnCours.set(false);
        // Le mot de passe a servi : il ne reste pas en memoire.
        this.motDePasseTel.set('');
        this.codeTel.set('');
        this.demandeTel.set(demande);
        this.etapeTel.set('code');
      },
      error: (err) => {
        this.telEnCours.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PROFIL_MODAL.TEL_ERR'));
      },
    });
  }

  confirmerCodeTel() {
    if (!this.peutConfirmerTel()) return;
    this.telEnCours.set(true);
    this.errorMsg.set('');
    this.authService.confirmerChangementTelephone(this.codeTel().trim()).subscribe({
      next: () => {
        this.telEnCours.set(false);
        this.etapeTel.set('ferme');
        this.demandeTel.set(null);
        this.showSuccess(this.i18n.t('PROFIL_MODAL.TEL_CHANGE'));
      },
      error: (err) => {
        this.telEnCours.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PROFIL_MODAL.TEL_ERR'));
      },
    });
  }
  isUploadingPhoto = signal(false);

  // Formulaire mot de passe
  passwordForm = { ancienMotDePasse: '', nouveauMotDePasse: '', confirmation: '' };
  showAncien   = signal(false);
  showNouveau  = signal(false);
  showConfirm  = signal(false);

  ngOnInit() {
    const u = this.currentUser();
    if (u) {
      this.profilForm = {
        prenom: u.prenom, nom: u.nom,
        email: u.email ?? ''
      };
    }
    // Si changement forcé → aller directement sur l'onglet mot de passe
    if (this.forcerChangement()) {
      this.activeTab.set('password');
    }
  }

  setTab(tab: Tab) {
    if (this.forcerChangement()) return; // bloquer si changement forcé
    this.activeTab.set(tab);
    this.successMsg.set('');
    this.errorMsg.set('');
  }

  // ── Sauvegarder le profil ───────────────────────────────────────
  saveProfil() {
    if (!this.profilForm.prenom || !this.profilForm.nom) {
      this.errorMsg.set(this.i18n.t('PROFIL_MODAL.ERR_NAME_REQUIRED')); return;
    }
    this.isSaving.set(true); this.errorMsg.set('');

    this.authService.updateProfil(this.profilForm).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.showSuccess(this.i18n.t('PROFIL_MODAL.SUCCESS_UPDATED'));
      },
      error: err => {
        this.isSaving.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PROFIL_MODAL.ERR_UPDATE'));
      }
    });
  }

  // ── Changer le mot de passe ─────────────────────────────────────
  savePassword() {
    // Meme regle que l'API (utils/politique-mot-de-passe.ts) : 6 pour un
    // patient, 12 pour tout autre compte. Le serveur reste celui qui decide.
    const min = this.currentUser()?.role === 'PATIENT' ? 6 : 12;
    if (this.passwordForm.nouveauMotDePasse.length < min) {
      this.errorMsg.set(this.i18n.t('PROFIL_MODAL.ERR_PWD_SHORT', { min })); return;
    }
    if (this.passwordForm.nouveauMotDePasse !== this.passwordForm.confirmation) {
      this.errorMsg.set(this.i18n.t('PROFIL_MODAL.ERR_PWD_MATCH')); return;
    }
    if (!this.forcerChangement() && !this.passwordForm.ancienMotDePasse) {
      this.errorMsg.set(this.i18n.t('PROFIL_MODAL.ERR_OLD_PWD_REQUIRED')); return;
    }

    this.isSaving.set(true); this.errorMsg.set('');

    const dto = this.forcerChangement()
      ? { nouveauMotDePasse: this.passwordForm.nouveauMotDePasse }
      : { ancienMotDePasse: this.passwordForm.ancienMotDePasse, nouveauMotDePasse: this.passwordForm.nouveauMotDePasse };

    this.authService.changerMotDePasse(dto).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.passwordForm = { ancienMotDePasse: '', nouveauMotDePasse: '', confirmation: '' };
        this.showSuccess(this.i18n.t('PROFIL_MODAL.SUCCESS_PWD_CHANGED'));
        // Si changement forcé → fermer après 1.5s
        if (this.forcerChangement()) {
          setTimeout(() => this.fermer.emit(), 1500);
        }
      },
      error: err => {
        this.isSaving.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PROFIL_MODAL.ERR_PWD_CHANGE'));
      }
    });
  }

  // ── Photo de profil ──────────────────────────────────────────────
  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permet de resélectionner le même fichier plus tard
    if (!file) return;

    if (!TYPES_PHOTO_ACCEPTES.includes(file.type)) {
      this.errorMsg.set(this.i18n.t('PROFIL_MODAL.ERR_PHOTO_TYPE')); return;
    }
    if (file.size > TAILLE_MAX_PHOTO) {
      this.errorMsg.set(this.i18n.t('PROFIL_MODAL.ERR_PHOTO_SIZE')); return;
    }

    this.isUploadingPhoto.set(true); this.errorMsg.set('');
    this.authService.uploadAvatar(file).subscribe({
      next: ({ url }) => {
        this.authService.updateProfil({ photoUrl: url }).subscribe({
          next: () => {
            this.isUploadingPhoto.set(false);
            this.showSuccess(this.i18n.t('PROFIL_MODAL.SUCCESS_PHOTO_UPDATED'));
          },
          error: err => {
            this.isUploadingPhoto.set(false);
            this.errorMsg.set(err?.error?.error ?? this.i18n.t('PROFIL_MODAL.ERR_UPDATE'));
          }
        });
      },
      error: err => {
        this.isUploadingPhoto.set(false);
        this.errorMsg.set(err?.error?.error ?? this.i18n.t('PROFIL_MODAL.ERR_PHOTO_UPLOAD'));
      }
    });
  }

  fermerModal() {
    if (this.forcerChangement()) return; // impossible de fermer sans changer
    this.fermer.emit();
  }

  getRoleLabel(): string {
    const map: Record<string, string> = {
      'PATIENT': this.i18n.t('PATIENT.ROLE'),
      'ASC': this.i18n.t('ASC.ROLE'),
      'ASC_SUPERVISOR': this.i18n.t('ADMIN_STRUCTURE.AGENTS.ROLE_ASC_SUPERVISOR'),
      'MEDECIN': this.i18n.t('MEDECIN.ROLE'),
      'PHARMACIEN': this.i18n.t('PHARMACIEN.ROLE'),
      'ADMIN_STRUCTURE': this.i18n.t('ADMIN_STRUCTURE.ROLE'),
      'ADMIN_REGIONAL': this.i18n.t('PROFIL_MODAL.ROLE_ADMIN_REGIONAL'),
      'ASSUREUR': this.i18n.t('PROFIL_MODAL.ROLE_ASSUREUR'),
      'ADMIN_NATIONAL': this.i18n.t('PROFIL_MODAL.ROLE_ADMIN_NATIONAL'),
      'SUPER_ADMIN': this.i18n.t('PROFIL_MODAL.ROLE_SUPER_ADMIN')
    };
    return map[this.currentUser()?.role ?? ''] ?? '';
  }

  getInitiales(): string {
    const u = this.currentUser();
    if (!u) return '??';
    return `${u.prenom?.charAt(0) ?? ''}${u.nom?.charAt(0) ?? ''}`.toUpperCase();
  }

  private showSuccess(msg: string) {
    this.successMsg.set(msg);
    setTimeout(() => this.successMsg.set(''), 3000);
  }
}
