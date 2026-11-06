// features/auth/login/login.component.ts
import { Component, inject, signal, ViewChildren, ElementRef, QueryList, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { LoginPayload } from '../../../core/models/user.model';
import type { OtpLoginChallenge } from '@baobaoheath/shared-types';

// La forme du defi OTP vit dans shared-types. La redeclarer ici avait un cout
// concret : le champ devOtp — que l'API renvoie en developpement quand l'envoi
// de l'email echoue — etait absent du type, donc jamais lu ni affiche.
type LoginResponseData = Partial<OtpLoginChallenge> & { authenticated?: boolean };
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AuthShellComponent } from '../../../shared/components/auth-shell/auth-shell.component';
import { ToastrService } from 'ngx-toastr';
import { accueilDuRole } from '../../../core/navigation/accueil-par-role';


/** Le message a afficher pour un echec de connexion ou de verification OTP. */
export function messageErreurConnexion(
  t: (cle: string) => string,
  err: unknown,
  cleParDefaut: string,
): string {
  const e = err as { status?: number; error?: { error?: string; message?: string } };
  // **Si l'API a repondu avec son propre message, c'est lui qu'on montre**,
  // quel que soit le statut. Elle repond 503 quand le mot de passe est juste
  // mais que le code OTP n'a pas pu partir : afficher « serveur injoignable »
  // faisait chercher une panne de reseau qui n'existait pas.
  const messageApi = typeof e?.error === 'object' && typeof e.error?.error === 'string' ? e.error.error.trim() : '';
  if (e?.status !== 0 && messageApi) return messageApi;
  // status 0 : la requete n'a jamais atteint le serveur (arrete, CORS, reseau).
  // 502/503/504 : le relais (nginx en production, proxy de developpement) est
  // joignable mais pas l'API ; il repond par une page HTML, sans corps JSON.
  if (e?.status === 0 || e?.status === 502 || e?.status === 503 || e?.status === 504) {
    return t('AUTH.LOGIN.ERR_SERVEUR_INJOIGNABLE');
  }
  // 429 : le limiteur de connexions repond en texte brut, sans corps JSON.
  // Sans ce cas, on retombait sur « identifiants incorrects » alors que le
  // mot de passe etait juste : c'est arrive le 2026-10-21.
  if (e?.status === 429) return t('AUTH.LOGIN.ERR_TROP_DE_TENTATIVES');
  return e?.error?.error ?? e?.error?.message ?? t(cleParDefaut);
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    MatButtonModule,
    MatFormFieldModule, MatInputModule,
    FormsModule, RouterLink,
    TranslatePipe, AuthShellComponent
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnDestroy {
  private authService   = inject(AuthService);
  private router        = inject(Router);
  private route         = inject(ActivatedRoute);
  private i18nService   = inject(I18nService);
  private toastr        = inject(ToastrService);

  // identifiant = téléphone ou email — détection automatique côté backend
  formData: LoginPayload = { identifiant: '', motDePasse: '' };

  isLoading    = signal(false);
  showPassword = signal(false);

  requiresOtp  = signal(false);
  otpEmail     = signal('');
  /** Code OTP renvoye par l'API en developpement (jamais rempli en production). */
  codeDeveloppement = signal('');
  otpCode      = '';
  otpDigits: string[] = ['', '', '', '', '', ''];

  otpSecondsLeft = signal(0);
  private otpTimerRef: ReturnType<typeof setInterval> | null = null;
  private otpTimerActive = false;

  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef<HTMLInputElement>>;

  get identifiantIcon(): string {
    return this.formData.identifiant.includes('@') ? 'pi pi-envelope' : 'pi pi-phone';
  }

  get otpTimeDisplay(): string {
    const s = this.otpSecondsLeft();
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  get otpExpired(): boolean {
    return this.requiresOtp() && this.otpTimerActive && this.otpSecondsLeft() === 0;
  }

  togglePassword() { this.showPassword.update(v => !v); }

  ngOnDestroy() { this.clearOtpTimer(); }

  onSubmit() {
    if (!this.formData.identifiant || !this.formData.motDePasse) {
      this.toastr.error(this.i18nService.t('AUTH.LOGIN.ERR_FIELDS'), this.i18nService.t('AUTH.LOGIN.ERR_TITLE'));
      return;
    }
    this.isLoading.set(true);

    this.authService.login(this.formData).subscribe({
      next: (response: LoginResponseData) => {
        this.isLoading.set(false);
        if (response.requiresOtp) {
          this.requiresOtp.set(true);
          this.otpEmail.set(response.email ?? '');
          // Present uniquement hors production, quand l'envoi de l'email a
          // echoue : l'affichage evite d'aller chercher le code dans les logs.
          this.codeDeveloppement.set(response.devOtp ?? '');
          this.startOtpTimer(response.expiresInMinutes ?? 10);
        } else {
          const role = this.authService.userRole();
          this.redirectAfterLogin(role);
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.toastr.error(
          this.messageErreur(err, 'AUTH.LOGIN.ERR_CREDENTIALS'),
          this.i18nService.t('AUTH.LOGIN.ERR_LOGIN_TITLE')
        );
      }
    });
  }

  /**
   * Un serveur injoignable n'est pas un mauvais mot de passe.
   *
   * Sans cette distinction, une API arretee produisait « identifiants
   * incorrects » : la reponse n'ayant pas de corps JSON, on retombait sur le
   * message par defaut. Le message envoyait chercher l'erreur du mauvais cote.
   */
  private messageErreur(err: unknown, cleParDefaut: string): string {
    return messageErreurConnexion((cle) => this.i18nService.t(cle), err, cleParDefaut);
  }

  verifyOtp() {
    if (!this.otpCode || this.otpCode.length !== 6) {
      this.toastr.error(this.i18nService.t('AUTH.LOGIN.ERR_OTP_INCOMPLETE'), this.i18nService.t('AUTH.LOGIN.ERR_OTP_INVALID_TITLE'));
      return;
    }
    this.isLoading.set(true);

    this.authService.verifyOtp(this.otpEmail(), this.otpCode).subscribe({
      next: (user) => {
        this.isLoading.set(false);
        this.clearOtpTimer();
        this.redirectAfterLogin(user?.role);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.toastr.error(
          this.messageErreur(err, 'AUTH.LOGIN.ERR_OTP_INCORRECT'),
          this.i18nService.t('AUTH.LOGIN.ERR_OTP_VERIFY_TITLE')
        );
        this.otpCode = '';
        this.otpDigits = ['', '', '', '', '', ''];
      }
    });
  }

  resendOtp() {
    if (this.isLoading()) return;
    this.isLoading.set(true);
    this.clearOtpTimer();
    this.otpCode = '';
    this.otpDigits = ['', '', '', '', '', ''];

    this.authService.login(this.formData).subscribe({
      next: (response: LoginResponseData) => {
        this.isLoading.set(false);
        if (response.requiresOtp) {
          this.startOtpTimer(response.expiresInMinutes ?? 10);
          this.toastr.success(this.i18nService.t('AUTH.LOGIN.OTP_RESENT'), this.i18nService.t('AUTH.LOGIN.OTP_RESENT_TITLE'));
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.toastr.error(this.messageErreur(err, 'AUTH.LOGIN.ERR_OTP_RESEND'), this.i18nService.t('AUTH.LOGIN.ERR_TITLE'));
      }
    });
  }

  cancelOtp() {
    this.requiresOtp.set(false);
    this.clearOtpTimer();
    this.otpCode = '';
    this.otpDigits = ['', '', '', '', '', ''];
  }

  onOtpChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) {
      setTimeout(() => this.otpDigits[index] = '', 0);
      return;
    }

    this.otpCode = this.otpDigits.join('');

    if (value && index < 5) {
      this.otpInputs.toArray()[index + 1].nativeElement.focus();
    }

    if (this.otpCode.length === 6) {
      this.verifyOtp();
    }
  }

  onOtpKeyDown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace') {
      if (!this.otpDigits[index] && index > 0) {
        this.otpDigits[index - 1] = '';
        this.otpCode = this.otpDigits.join('');
        this.otpInputs.toArray()[index - 1].nativeElement.focus();
      } else {
        this.otpDigits[index] = '';
        this.otpCode = this.otpDigits.join('');
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      this.otpInputs.toArray()[index - 1].nativeElement.focus();
    } else if (event.key === 'ArrowRight' && index < 5) {
      this.otpInputs.toArray()[index + 1].nativeElement.focus();
    }
  }

  onOtpPaste(event: ClipboardEvent) {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text');
    if (!pastedData) return;

    const numbers = pastedData.replace(/\D/g, '').substring(0, 6);
    if (numbers.length === 0) return;

    for (let i = 0; i < numbers.length; i++) {
      this.otpDigits[i] = numbers[i];
    }
    this.otpCode = this.otpDigits.join('');

    const focusIndex = Math.min(numbers.length, 5);
    this.otpInputs.toArray()[focusIndex].nativeElement.focus();

    if (this.otpCode.length === 6) {
      this.verifyOtp();
    }
  }

  private startOtpTimer(minutes: number) {
    this.clearOtpTimer();
    this.otpTimerActive = true;
    this.otpSecondsLeft.set(minutes * 60);
    this.otpTimerRef = setInterval(() => {
      if (this.otpSecondsLeft() > 0) {
        this.otpSecondsLeft.update(s => s - 1);
      } else {
        this.clearOtpTimer();
      }
    }, 1000);
  }

  private clearOtpTimer() {
    if (this.otpTimerRef) {
      clearInterval(this.otpTimerRef);
      this.otpTimerRef = null;
    }
    this.otpTimerActive = false;
  }

  private redirectAfterLogin(role: string | null | undefined) {
    const destination = accueilDuRole(role);
    if (!destination) {
      this.toastr.error(
        this.i18nService.t('AUTH.LOGIN.ERR_SPACE_NOT_ACCESSIBLE'),
        this.i18nService.t('COMMON.ERROR_TITLE'),
        { timeOut: 8000 }
      );
      this.authService.logout();
      return;
    }

    if (this.authService.doitChangerMotDePasse()) {
      this.toastr.warning(
        this.i18nService.t('AUTH.LOGIN.CHANGE_PWD_REQUIRED'),
        'Action requise',
        { timeOut: 7000 }
      );
    }

    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    if (returnUrl && !returnUrl.startsWith('/auth')) {
      this.router.navigateByUrl(returnUrl);
      return;
    }

    this.router.navigate([destination]);
  }
}
