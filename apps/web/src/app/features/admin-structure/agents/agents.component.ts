import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { ColonneExport, ExportListeComponent } from '../../../shared/components/export-liste/export-liste.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/components/confirm-dialog/confirm-dialog.component';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';
import {
  Metier, estMetierMedical, libelleSpecialite, metierDe, metiersPour, SPECIALITES_DE_SPECIALISTE, versCreation,
} from '../../../shared/utils/metiers-personnel';
import type {
  AgentStructureView, CreationAgentView, HorodatageApi, ReinitialisationMotDePasseView, ServiceHospitalierView, SpecialiteMedicale, TypeStructure,
} from '@baobaoheath/shared-types';

// Contenu de la modale du mot de passe temporaire : assemble cote client.
// Elle sert a la creation d'un compte et a la reinitialisation.
interface MotDePasseAffiche {
  agentNom: string;
  agentTelephone: string;
  motDePasse: string;
  emailEnvoye?: string;
  /** `creation` ou `reinitialisation` : le titre de la modale. */
  occasion: 'creation' | 'reinitialisation';
}

@Component({
  selector: 'app-agents',
  standalone: true,
  imports: [
    MatFormFieldModule, MatInputModule, MatSelectModule, MatDialogModule, CommonModule, FormsModule, TranslatePipe, ExportListeComponent],
  templateUrl: './agents.component.html',
  styleUrl: './agents.component.scss'
})
export class AgentsComponent implements OnInit {
  private api = inject(ApiService);
  private i18n = inject(I18nService);
  private dialog = inject(MatDialog);

  agents = signal<AgentStructureView[]>([]);
  isLoading = signal(true);
  showForm = signal(false);
  isSaving = signal(false);
  successMsg = signal('');
  errorMsg = signal('');

  mdpAffiche = signal<MotDePasseAffiche | null>(null);

  /** Le type de la structure : il dit quels metiers on y cree. */
  typeStructure = signal<TypeStructure | null>(null);
  readonly metiers = computed(() => metiersPour(this.typeStructure()));
  readonly specialites = SPECIALITES_DE_SPECIALISTE;
  /** Les services ouverts : un medecin y est rattache. Vide si la structure n'en declare pas. */
  services = signal<ServiceHospitalierView[]>([]);

  /**
   * Affiche un message, et **annule celui d'avant**.
   *
   * Chaque annonce programmait son propre effacement sans toucher au
   * precedent : deux gestes a moins de quatre secondes d'intervalle, et la
   * minuterie du premier effacait la confirmation du second — l'agent voyait
   * son message disparaitre aussitot et doutait d'avoir reussi.
   */
  private minuterie?: ReturnType<typeof setTimeout>;

  private annoncer(message: string, type: 'succes' | 'erreur' = 'succes', duree = 4000) {
    clearTimeout(this.minuterie);
    if (type === 'succes') { this.successMsg.set(message); this.errorMsg.set(''); }
    else { this.errorMsg.set(message); this.successMsg.set(''); }
    this.minuterie = setTimeout(() => { this.successMsg.set(''); this.errorMsg.set(''); }, duree);
  }

  newAgent: { telephone: string; email: string; prenom: string; nom: string; metier: Metier | ''; specialite: SpecialiteMedicale | ''; numeroOrdre: string; idService: string } =
    this.formulaireVide();

  private formulaireVide() {
    return { telephone: '', email: '', prenom: '', nom: '', metier: '' as Metier | '', specialite: '' as SpecialiteMedicale | '', numeroOrdre: '', idService: '' };
  }

  estMedical(m: Metier | '') { return !!m && estMetierMedical(m); }

  // ── Le bureau du medecin (addendum, point 2) ───────────────────────
  //
  // **Il ne se saisit pas a la creation du compte.** Un medecin demenage, un
  // service est redecoupe : la valeur serait fausse en quelques mois, et un
  // bureau faux est pire que pas de bureau — le patient y va.
  //
  // Facultatif : beaucoup d'hopitaux ne numerotent pas leurs bureaux, et
  // l'agent d'accueil accompagne le patient a pied. Vider le champ efface.
  bureauEnEdition = signal<string | null>(null);
  bureauSaisi = '';

  ouvrirBureau(agent: AgentStructureView) {
    this.bureauEnEdition.set(agent.id);
    this.bureauSaisi = agent.bureau ?? '';
  }

  annulerBureau() {
    this.bureauEnEdition.set(null);
    this.bureauSaisi = '';
  }

  enregistrerBureau(id: string) {
    const saisi = this.bureauSaisi.trim();
    this.api.put<{ success: boolean; message?: string }>(
      `/admin-structure/agents/${id}/bureau`,
      { bureau: saisi.length > 0 ? saisi : null },
    ).subscribe({
      next: (r) => {
        this.annulerBureau();
        this.annoncer(r?.message ?? this.i18n.t('ADMIN_STRUCTURE.AGENTS.BUREAU_OK'));
        this.loadAgents();
      },
      error: (err) => {
        this.annoncer(err?.error?.error ?? this.i18n.t('ADMIN_STRUCTURE.AGENTS.ERR_CREATE'), 'erreur');
      },
    });
  }

  // ── Le metier d'un medecin : specialite, numero d'ordre ────────────
  profilEnEdition = signal<string | null>(null);
  profilSaisi: { specialite: SpecialiteMedicale; numeroOrdre: string; idService: string } = { specialite: 'MEDECINE_GENERALE', numeroOrdre: '', idService: '' };
  readonly toutesSpecialites: SpecialiteMedicale[] = ['MEDECINE_GENERALE', 'DENTAIRE', ...SPECIALITES_DE_SPECIALISTE];

  ouvrirProfil(agent: AgentStructureView) {
    this.annulerBureau();
    this.profilEnEdition.set(agent.id);
    // Une specialite d'avant la liste, non reconnue : on repart du generaliste.
    const connue = agent.specialite && this.toutesSpecialites.includes(agent.specialite) ? agent.specialite : 'MEDECINE_GENERALE';
    this.profilSaisi = { specialite: connue, numeroOrdre: agent.numeroOrdre ?? '', idService: agent.service?.id ?? '' };
  }

  annulerProfil() { this.profilEnEdition.set(null); }

  enregistrerProfil(agent: AgentStructureView) {
    const numero = this.profilSaisi.numeroOrdre.trim();
    this.api.put<{ success: boolean; message?: string }>(`/admin-structure/agents/${agent.id}/profil`, {
      specialite: this.profilSaisi.specialite,
      numeroOrdre: numero.length ? numero : null,
      // Envoye seulement si la structure a des services : sinon rien a dire.
      ...(this.services().length ? { idService: this.profilSaisi.idService || null } : {}),
    }).subscribe({
      next: (r) => {
        this.annulerProfil();
        this.annoncer(r?.message ?? this.i18n.t('ADMIN_STRUCTURE.AGENTS.PROFIL_OK'));
        this.loadAgents();
      },
      error: (err) => this.annoncer(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), 'erreur'),
    });
  }

  /** Le metier affiche : « Médecin généraliste », « Cardiologie », « Agent d'accueil »... */
  libelleMetier(agent: AgentStructureView): string {
    const metier = metierDe(agent.role, agent.specialite);
    if (metier === 'MEDECIN_SPECIALISTE') {
      return libelleSpecialite((c) => this.i18n.t(c), agent.specialite) ?? this.i18n.t('ADMIN_STRUCTURE.AGENTS.METIER_MEDECIN_SPECIALISTE');
    }
    return metier ? this.i18n.t('ADMIN_STRUCTURE.AGENTS.METIER_' + metier) : agent.role;
  }

  /** Les colonnes du document imprime **et** du fichier : les memes.
   * C'est ce qui empeche la feuille et le tableur de se contredire. */
  readonly colonnes: ColonneExport<AgentStructureView>[] = [
    { titre: 'EXPORT.COL.NOM', valeur: (a) => `${a.prenom} ${a.nom}` },
    { titre: 'EXPORT.COL.ROLE', valeur: (a) => this.libelleMetier(a) },
    { titre: 'EXPORT.COL.TELEPHONE', valeur: (a) => a.telephone },
    { titre: 'EXPORT.COL.COURRIEL', valeur: (a) => a.email },
    { titre: 'EXPORT.COL.BUREAU', valeur: (a) => a.bureau },
    { titre: 'EXPORT.COL.AJOUTE_LE', valeur: (a) => new Date(a.creeLe) },
  ];

  ngOnInit() {
    this.loadAgents();
    this.api.get<{ data?: { type?: TypeStructure } }>('/admin-structure/ma-structure').subscribe({
      next: (r) => this.typeStructure.set(r.data?.type ?? null),
    });
    // Les services ouverts, s'il y en a (une structure sans services repond 403 : rien a proposer).
    this.api.get<{ data?: ServiceHospitalierView[] }>('/admin-structure/services').subscribe({
      next: (r) => this.services.set((r.data ?? []).filter((s) => s.actif)),
      error: () => this.services.set([]),
    });
  }

  loadAgents() {
    this.isLoading.set(true);
    this.api.get<{ data?: AgentStructureView[]; success?: boolean } | AgentStructureView[]>('/admin-structure/agents').subscribe({
      next: r => { this.agents.set(Array.isArray(r) ? r : (r as { data?: AgentStructureView[] })?.data ?? []); this.isLoading.set(false); },
      error: () => { this.isLoading.set(false); }
    });
  }

  creerAgent() {
    const a = this.newAgent;
    if (!a.telephone || !a.prenom || !a.nom || !a.email || !a.metier) {
      this.errorMsg.set(this.i18n.t('ADMIN_STRUCTURE.AGENTS.ERR_REQUIRED')); return;
    }
    if (a.metier === 'MEDECIN_SPECIALISTE' && !a.specialite) {
      this.errorMsg.set(this.i18n.t('ADMIN_STRUCTURE.AGENTS.ERR_SPECIALITE')); return;
    }
    this.isSaving.set(true); this.errorMsg.set('');

    const { role, specialite } = versCreation(a.metier, a.specialite || undefined);
    const numeroOrdre = this.estMedical(a.metier) ? a.numeroOrdre.trim() : '';
    const payload = {
      telephone: a.telephone,
      prenom: a.prenom,
      nom: a.nom,
      role,
      email: a.email || undefined,
      ...(specialite ? { specialite } : {}),
      ...(numeroOrdre ? { numeroOrdre } : {}),
      ...(this.estMedical(a.metier) && a.idService ? { idService: a.idService } : {}),
    };

    this.api.post<{ data?: CreationAgentView } | CreationAgentView>('/admin-structure/agents', payload).subscribe({
      next: (r) => {
        const data = ((r as { data?: CreationAgentView })?.data ?? r) as CreationAgentView;
        this.isSaving.set(false);
        this.showForm.set(false);
        this.newAgent = this.formulaireVide();

        // Le mot de passe temporaire est toujours affiché ici : l'envoi d'email
        // peut échouer silencieusement côté serveur, il ne faut jamais faire
        // dépendre l'accès au compte de sa réception.
        if (data.motDePasseTemporaire) {
          this.mdpAffiche.set({
            agentNom: `${data.agent?.prenom ?? ''} ${data.agent?.nom ?? ''}`,
            agentTelephone: data.agent?.telephone ?? payload.telephone,
            motDePasse: data.motDePasseTemporaire,
            emailEnvoye: payload.email,
            occasion: 'creation',
          });
        } else {
          this.annoncer(this.i18n.t('ADMIN_STRUCTURE.AGENTS.SUCCESS_CREATED'));
        }
        this.loadAgents();
      },
      error: err => { this.isSaving.set(false); this.errorMsg.set(err?.error?.error ?? this.i18n.t('ADMIN_STRUCTURE.AGENTS.ERR_CREATE')); }
    });
  }

  fermerMdp() {
    const occasion = this.mdpAffiche()?.occasion;
    this.mdpAffiche.set(null);
    this.annoncer(this.i18n.t(occasion === 'reinitialisation' ? 'ADMIN_STRUCTURE.AGENTS.REINIT_OK' : 'ADMIN_STRUCTURE.AGENTS.SUCCESS_CREATED'));
  }

  // ── Les gestes sur un compte : tous confirmes ──────────────────────

  private confirmer(titreCle: string, texteCle: string, agent: AgentStructureView, confirmerCle: string, danger = false) {
    const nom = `${agent.prenom} ${agent.nom}`;
    const data: ConfirmDialogData = {
      titre: this.i18n.t(titreCle),
      texte: this.i18n.t(texteCle, { nom }),
      confirmer: this.i18n.t(confirmerCle),
      annuler: this.i18n.t('COMMON.CANCEL'),
      icone: danger ? 'pi-ban' : 'pi-key',
      danger,
    };
    return this.dialog.open(ConfirmDialogComponent, { data, width: '420px', autoFocus: false }).afterClosed();
  }

  desactiver(agent: AgentStructureView) {
    this.confirmer('ADMIN_STRUCTURE.AGENTS.DESACTIVER_TITRE', 'ADMIN_STRUCTURE.AGENTS.DESACTIVER_TEXTE', agent, 'ADMIN_STRUCTURE.AGENTS.DESACTIVER', true)
      .subscribe((ok) => {
        if (!ok) return;
        this.api.put<{ success: boolean }>(`/admin-structure/agents/${agent.id}/desactiver`, {}).subscribe({
          next: () => { this.annoncer(this.i18n.t('ADMIN_STRUCTURE.AGENTS.SUCCESS_DEACTIVATED')); this.loadAgents(); },
          error: (err) => this.annoncer(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), 'erreur'),
        });
      });
  }

  reactiver(agent: AgentStructureView) {
    this.api.put<{ success: boolean; message?: string }>(`/admin-structure/agents/${agent.id}/reactiver`, {}).subscribe({
      next: (r) => { this.annoncer(r?.message ?? this.i18n.t('ADMIN_STRUCTURE.AGENTS.REACTIVE_OK')); this.loadAgents(); },
      error: (err) => this.annoncer(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), 'erreur'),
    });
  }

  reinitialiser(agent: AgentStructureView) {
    this.confirmer('ADMIN_STRUCTURE.AGENTS.REINIT_TITRE', 'ADMIN_STRUCTURE.AGENTS.REINIT_TEXTE', agent, 'ADMIN_STRUCTURE.AGENTS.REINIT')
      .subscribe((ok) => {
        if (!ok) return;
        this.api.post<{ success: boolean; data?: ReinitialisationMotDePasseView }>(`/admin-structure/agents/${agent.id}/mot-de-passe`, {}).subscribe({
          next: (r) => {
            if (!r.data) return;
            this.mdpAffiche.set({
              agentNom: `${agent.prenom} ${agent.nom}`,
              agentTelephone: agent.telephone,
              motDePasse: r.data.motDePasseTemporaire,
              emailEnvoye: r.data.emailEnvoye ?? undefined,
              occasion: 'reinitialisation',
            });
          },
          error: (err) => this.annoncer(err?.error?.error ?? this.i18n.t('COMMON.ERROR_GENERIC'), 'erreur'),
        });
      });
  }

  formatDate(d: HorodatageApi | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
