import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ApiResponse, RoleOfficine } from '@baobaoheath/shared-types';
import { ApiService } from '../../../core/services/api.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import { ToastrService } from 'ngx-toastr';

type RoleOperateur = Exclude<RoleOfficine, 'TITULAIRE'>;

type AgentOfficine = {
  id: string;
  telephone: string;
  email: string | null;
  prenom: string;
  nom: string;
  estActif: boolean;
  pharmacienProfile: {
    roleOfficine: RoleOfficine;
    roleOfficineTemporaire: RoleOfficine | null;
    roleOfficineExpireLe: string | null;
  } | null;
};

type AgentCree = { agent: AgentOfficine; motDePasseTemporaire?: string };

@Component({
  selector: 'app-pharmacien-agents',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './agents.component.html',
  styleUrl: './agents.component.scss',
})
export class AgentsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toastr = inject(ToastrService);
  private readonly i18n = inject(I18nService);

  readonly agents = signal<AgentOfficine[]>([]);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly motDePasseTemporaire = signal('');
  readonly error = signal(false);

  readonly roles: RoleOperateur[] = ['ADJOINT', 'PREPARATEUR', 'CAISSIER'];
  rolesTemporaires: Record<string, RoleOperateur> = {};
  rolesPermanents: Record<string, RoleOperateur> = {};
  expirations: Record<string, string> = {};
  nouveau: {
    telephone: string;
    email: string;
    prenom: string;
    nom: string;
    roleOfficine: RoleOperateur;
  } = { telephone: '', email: '', prenom: '', nom: '', roleOfficine: 'ADJOINT' };

  ngOnInit(): void {
    this.charger();
  }

  charger(): void {
    this.isLoading.set(true);
    this.error.set(false);
    this.api.get<ApiResponse<AgentOfficine[]>>('/pharmacien/agents').subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.agents.set(response.data);
          for (const agent of response.data) {
            this.rolesTemporaires[agent.id] =
              (agent.pharmacienProfile?.roleOfficineTemporaire as RoleOperateur | null) ?? 'ADJOINT';
            this.rolesPermanents[agent.id] =
              (agent.pharmacienProfile?.roleOfficine as RoleOperateur | undefined) ?? 'ADJOINT';
            this.expirations[agent.id] = '';
          }
        } else {
          this.error.set(true);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.isLoading.set(false);
      },
    });
  }

  creer(): void {
    this.isSaving.set(true);
    this.motDePasseTemporaire.set('');
    const { email, ...champsRequis } = this.nouveau;
    const dto = email.trim() ? { ...champsRequis, email: email.trim() } : champsRequis;
    this.api.post<ApiResponse<AgentCree>>('/pharmacien/agents', dto).subscribe({
      next: (response) => {
        this.isSaving.set(false);
        if (!response.success || !response.data) {
          this.toastr.error(this.i18n.t('PHARMACIEN.AGENTS.CREATE_ERROR'));
          return;
        }
        this.motDePasseTemporaire.set(response.data.motDePasseTemporaire ?? '');
        this.nouveau = { telephone: '', email: '', prenom: '', nom: '', roleOfficine: 'ADJOINT' };
        this.charger();
        this.toastr.success(this.i18n.t('PHARMACIEN.AGENTS.CREATE_SUCCESS'));
      },
      error: (err: { error?: { error?: string; message?: string } }) => {
        this.isSaving.set(false);
        // La raison donnee par l'API (numero deja pris, donnees invalides...)
        // plutot qu'un « echec » generique qui ne dit pas quoi corriger.
        this.toastr.error(err?.error?.error ?? err?.error?.message ?? this.i18n.t('PHARMACIEN.AGENTS.CREATE_ERROR'));
      },
    });
  }

  changerEtat(agent: AgentOfficine): void {
    this.api.patch<ApiResponse<{ id: string; estActif: boolean }>>(
      `/pharmacien/agents/${agent.id}/statut`,
      { estActif: !agent.estActif },
    ).subscribe({
      next: () => this.charger(),
      error: () => this.toastr.error(this.i18n.t('PHARMACIEN.AGENTS.UPDATE_ERROR')),
    });
  }

  changerRole(agent: AgentOfficine): void {
    this.api.put<ApiResponse<unknown>>(`/pharmacien/agents/${agent.id}/role-permanent`, {
      roleOfficine: this.rolesPermanents[agent.id],
    }).subscribe({
      next: () => {
        this.toastr.success(this.i18n.t('PHARMACIEN.AGENTS.ROLE_SUCCESS'));
        this.charger();
      },
      error: () => this.toastr.error(this.i18n.t('PHARMACIEN.AGENTS.UPDATE_ERROR')),
    });
  }

  accorderPermission(agent: AgentOfficine): void {
    const expireLe = this.expirations[agent.id];
    if (!expireLe) {
      this.toastr.warning(this.i18n.t('PHARMACIEN.AGENTS.EXPIRY_REQUIRED'));
      return;
    }
    const expiration = new Date(expireLe);
    if (!Number.isFinite(expiration.getTime()) || expiration <= new Date()) {
      this.toastr.warning(this.i18n.t('PHARMACIEN.AGENTS.EXPIRY_REQUIRED'));
      return;
    }
    const expirationIso = expiration.toISOString();
    this.api.put<ApiResponse<unknown>>(`/pharmacien/agents/${agent.id}/permission-temporaire`, {
      roleOfficine: this.rolesTemporaires[agent.id],
      expireLe: expirationIso,
    }).subscribe({
      next: () => {
        this.toastr.success(this.i18n.t('PHARMACIEN.AGENTS.PERMISSION_SUCCESS'));
        this.charger();
      },
      error: () => this.toastr.error(this.i18n.t('PHARMACIEN.AGENTS.PERMISSION_ERROR')),
    });
  }

  revoquerPermission(agent: AgentOfficine): void {
    this.api.delete<ApiResponse<unknown>>(`/pharmacien/agents/${agent.id}/permission-temporaire`).subscribe({
      next: () => {
        this.toastr.success(this.i18n.t('PHARMACIEN.AGENTS.PERMISSION_REVOKED'));
        this.charger();
      },
      error: () => this.toastr.error(this.i18n.t('PHARMACIEN.AGENTS.PERMISSION_ERROR')),
    });
  }

  roleLabel(role: string): string {
    return this.i18n.t(`PHARMACIEN.AGENTS.ROLES.${role}`);
  }

  permissionDate(agent: AgentOfficine): string {
    const expiration = agent.pharmacienProfile?.roleOfficineExpireLe;
    return expiration ? new Date(expiration).toLocaleString() : '';
  }
}
