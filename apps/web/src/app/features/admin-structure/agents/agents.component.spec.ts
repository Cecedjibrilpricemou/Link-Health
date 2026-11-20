// « Mes agents » : creer selon le metier, gerer un compte.
//
// Ce que ce fichier tient :
//   - seuls les metiers de la structure sont proposes ;
//   - un dentiste ou un specialiste part comme medecin, avec sa specialite et
//     son numero d'ordre ; un specialiste sans specialite est refuse ici ;
//   - un compte desactive reste dans la liste et se reactive ;
//   - reinitialiser et desactiver se confirment ; le mot de passe temporaire
//     est montre une fois.
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';
import type { AgentStructureView } from '@baobaoheath/shared-types';

import { AgentsComponent } from './agents.component';
import { ApiService } from '../../../core/services/api.service';
import { I18nService } from '../../../shared/services/i18n.service';

class I18nMaquette {
  readonly lang = signal<'fr' | 'en'>('fr');
  t(cle: string, p?: Record<string, unknown>): string { return p ? `${cle} ${JSON.stringify(p)}` : cle; }
}

const agent = (o: Partial<AgentStructureView> = {}): AgentStructureView => ({
  id: 'a1', telephone: '620000001', email: 'a@x.test', prenom: 'Alpha', nom: 'Bah', role: 'MEDECIN',
  creeLe: '2026-11-01T00:00:00Z', bureau: null, specialite: 'PEDIATRIE', numeroOrdre: 'GN-1', ordreVerifie: false, estActif: true, ...o,
});

function monter(agents: AgentStructureView[], type = 'CHU', confirme = true) {
  const api = {
    get: vi.fn((url: string) => of(url.endsWith('ma-structure') ? { data: { type } } : { data: agents })),
    post: vi.fn((url: string, _corps?: unknown) => of(url.endsWith('mot-de-passe')
      ? { success: true, data: { motDePasseTemporaire: 'Abcd-Efgh-Jkmn-Pqrs', emailEnvoye: 'a@x.test' } }
      : { data: { agent: { id: 'n', prenom: 'N', nom: 'N', telephone: '1', role: 'MEDECIN' } } })),
    put: vi.fn(() => of({ success: true })),
  };
  const open = vi.fn(() => ({ afterClosed: () => of(confirme) }));
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AgentsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideNoopAnimations(),
      { provide: ApiService, useValue: api },
      { provide: I18nService, useClass: I18nMaquette },
    ],
  });
  TestBed.overrideProvider(MatDialog, { useValue: { open } });
  const fixture = TestBed.createComponent(AgentsComponent);
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, api, open };
}

describe('mes agents', () => {
  it('ne propose que les metiers de la structure', () => {
    expect(monter([], 'CHU').c.metiers()).not.toContain('ASC');
    expect(monter([], 'CENTRE').c.metiers()).toContain('ASC');
  });

  it('un chirurgien-dentiste part comme medecin de specialite dentaire, avec son numero d ordre', () => {
    const { c, api } = monter([]);
    c.newAgent = { telephone: '620', email: 'd@x.test', prenom: 'D', nom: 'K', metier: 'CHIRURGIEN_DENTISTE', specialite: '', numeroOrdre: ' GN-DENT-7 ' };
    c.creerAgent();
    expect(api.post).toHaveBeenCalledWith('/admin-structure/agents', expect.objectContaining({
      role: 'MEDECIN', specialite: 'DENTAIRE', numeroOrdre: 'GN-DENT-7',
    }));
  });

  it('un specialiste sans specialite est refuse avant tout envoi', () => {
    const { c, api } = monter([]);
    c.newAgent = { telephone: '620', email: 'd@x.test', prenom: 'D', nom: 'K', metier: 'MEDECIN_SPECIALISTE', specialite: '', numeroOrdre: '' };
    c.creerAgent();
    expect(api.post).not.toHaveBeenCalled();
    expect(c.errorMsg()).toBe('ADMIN_STRUCTURE.AGENTS.ERR_SPECIALITE');
  });

  it('un agent d accueil part sans specialite ni numero d ordre', () => {
    const { c, api } = monter([]);
    c.newAgent = { telephone: '620', email: 'r@x.test', prenom: 'R', nom: 'T', metier: 'AGENT_ACCUEIL', specialite: '', numeroOrdre: 'X' };
    c.creerAgent();
    const envoi = api.post.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(envoi['role']).toBe('AGENT_ACCUEIL');
    expect(envoi['specialite']).toBeUndefined();
    expect(envoi['numeroOrdre']).toBeUndefined();
  });

  it('affiche le metier et la verification du numero d ordre', () => {
    const { el } = monter([agent()]);
    expect(el.querySelector('.bb-badge--info')?.textContent?.trim()).toBe('SPECIALITE.PEDIATRIE');
    expect(el.querySelector('.bb-agents__ordre')?.textContent?.trim()).toBe('ADMIN_STRUCTURE.AGENTS.ORDRE_A_VERIFIER');
  });

  it('un compte desactive reste visible et se reactive', () => {
    const { el, api } = monter([agent({ estActif: false })]);
    expect(el.querySelector('.bb-agents__item--inactif')).not.toBeNull();
    expect(el.querySelector('.bb-agents__deactivate')).toBeNull();
    el.querySelector<HTMLButtonElement>('.bb-agents__reactiver')!.click();
    expect(api.put).toHaveBeenCalledWith('/admin-structure/agents/a1/reactiver', {});
  });

  it('reinitialiser se confirme, puis montre le mot de passe une fois', () => {
    const { el, fixture, api, open, c } = monter([agent()]);
    el.querySelector<HTMLButtonElement>('.bb-agents__reinit')!.click();
    fixture.detectChanges();
    expect(open).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/admin-structure/agents/a1/mot-de-passe', {});
    expect(c.mdpAffiche()?.motDePasse).toBe('Abcd-Efgh-Jkmn-Pqrs');
    expect(el.querySelector('#agent-mdp-title')?.textContent).toContain('ADMIN_STRUCTURE.AGENTS.REINIT_FAIT_TITRE');
  });

  it('desactiver sans confirmer ne fait rien', () => {
    const { el, api } = monter([agent()], 'CHU', false);
    el.querySelector<HTMLButtonElement>('.bb-agents__deactivate')!.click();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('modifier le metier d un medecin envoie specialite et numero', () => {
    const { el, fixture, api, c } = monter([agent()]);
    el.querySelector<HTMLButtonElement>('.bb-agents__modifier')!.click();
    fixture.detectChanges();
    c.profilSaisi = { specialite: 'CARDIOLOGIE', numeroOrdre: '' };
    el.querySelector<HTMLButtonElement>('.bb-agents__profil-save')!.click();
    expect(api.put).toHaveBeenCalledWith('/admin-structure/agents/a1/profil', { specialite: 'CARDIOLOGIE', numeroOrdre: null });
  });
});
