// features/auth/reset-password/reset-password.component.ts
import { Component, inject, signal, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AuthShellComponent } from '../../../shared/components/auth-shell/auth-shell.component';
import { ToastrService } from 'ngx-toastr';
import { PlateformeSecuriseeComponent } from '../../../shared/components/plateforme-securisee/plateforme-securisee.component';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [PlateformeSecuriseeComponent, 
    MatButtonModule,
    MatFormFieldModule, MatInputModule,
    FormsModule, RouterLink,
    TranslatePipe, AuthShellComponent
  ],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss'
})
export class ResetPasswordComponent implements OnInit {
  private authService   = inject(AuthService);
  private router        = inject(Router);
  private route         = inject(ActivatedRoute);
  private i18nService   = inject(I18nService);
  private toastr        = inject(ToastrService);

  token             = '';
  nouveauMotDePasse = '';
  confirmMotDePasse = '';

  showPassword = signal(false);
  showConfirm  = signal(false);
  isLoading    = signal(false);
  success      = signal(false);
  tokenInvalid = signal(false);

  togglePassword() { this.showPassword.update(v => !v); }
  toggleConfirm()  { this.showConfirm.update(v => !v); }

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (!token || token.length !== 64) {
      this.tokenInvalid.set(true);
      return;
    }
    this.token = token;
  }

  onSubmit() {
    if (!this.nouveauMotDePasse || this.nouveauMotDePasse.length < 6) {
      this.toastr.error(this.i18nService.t('AUTH.RESET.ERR_PWD_SHORT'), this.i18nService.t('COMMON.ERROR_TITLE'));
      return;
    }
    if (this.nouveauMotDePasse !== this.confirmMotDePasse) {
      this.toastr.error(this.i18nService.t('AUTH.RESET.ERR_PWD_MATCH'), this.i18nService.t('COMMON.ERROR_TITLE'));
      return;
    }

    this.isLoading.set(true);
    this.authService.resetPassword(this.token, this.nouveauMotDePasse).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.success.set(true);
        setTimeout(() => this.router.navigate(['/auth/login']), 3000);
      },
      error: (err) => {
        this.isLoading.set(false);
        if (err?.status === 400 || err?.status === 404) {
          this.tokenInvalid.set(true);
        } else {
          this.toastr.error(
            err?.error?.error ?? err?.error?.message ?? this.i18nService.t('AUTH.RESET.ERR_GENERIC'),
            this.i18nService.t('COMMON.ERROR_TITLE')
          );
        }
      }
    });
  }
}
