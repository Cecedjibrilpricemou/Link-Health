// features/auth/forgot-password/forgot-password.component.ts
import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';
import { I18nService } from '../../../shared/services/i18n.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { AuthShellComponent } from '../../../shared/components/auth-shell/auth-shell.component';
import { ToastrService } from 'ngx-toastr';
import { PlateformeSecuriseeComponent } from '../../../shared/components/plateforme-securisee/plateforme-securisee.component';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [PlateformeSecuriseeComponent, 
    MatButtonModule,
    MatFormFieldModule, MatInputModule,
    FormsModule, RouterLink,
    TranslatePipe, AuthShellComponent
  ],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss'
})
export class ForgotPasswordComponent {
  private authService   = inject(AuthService);
  private i18nService   = inject(I18nService);
  private toastr        = inject(ToastrService);

  email     = '';
  isLoading = signal(false);
  submitted = signal(false);

  onSubmit() {
    if (!this.email || !this.email.includes('@')) {
      this.toastr.error(this.i18nService.t('AUTH.FORGOT.ERR_EMAIL'), this.i18nService.t('COMMON.ERROR_TITLE'));
      return;
    }
    this.isLoading.set(true);

    this.authService.forgotPassword(this.email.trim().toLowerCase()).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.submitted.set(true);
      },
      error: () => {
        // Always show success to prevent email enumeration
        this.isLoading.set(false);
        this.submitted.set(true);
      }
    });
  }
}
