import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError } from 'rxjs';
import type { DefinirHorairesDto, HorairesView } from '@baobaoheath/shared-types';

import { HorairesComponent } from './horaires.component';
import { PharmacienService } from '../../../core/services/pharmacien.service';
import { ToastrService } from 'ngx-toastr';
import { I18nService } from '../../../shared/services/i18n.service';

const ETAT_INCONNU = { ouvert: null, fermeA: null, prochaine: null };

function monter(horaires: HorairesView = {}, erreurChargement = false) {
  const appels = { lecture: 0, ecriture: [] as DefinirHorairesDto[] };
  const messages = { succes: [] as string[], erreur: [] as string[] };
  const pharma = {
    getHoraires: () => {
      appels.lecture++;
      if (erreurChargement) return throwError(() => new Error('Réseau indisponible'));
      return of({ success: true, data: { horaires, etat: ETAT_INCONNU } });
    },
    definirHoraires: (dto: DefinirHorairesDto) => {
      appels.ecriture.push(dto);
      return of({ success: true, data: { horaires: dto.horaires, etat: ETAT_INCONNU } });
    },
  };

  TestBed.configureTestingModule({
    imports: [HorairesComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: PharmacienService, useValue: pharma },
      {
        provide: ToastrService,
        useValue: {
          success: (message: string) => messages.succes.push(message),
          error: (message: string) => messages.erreur.push(message),
        },
      },
      { provide: I18nService, useValue: { t: (key: string) => key } },
    ],
  });
  TestBed.overrideComponent(HorairesComponent, { set: { template: '' } });
  const fixture = TestBed.createComponent(HorairesComponent);
  fixture.detectChanges();

  return { c: fixture.componentInstance, appels, messages };
}

describe('horaires pharmacien', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('se crée et charge les horaires à l’initialisation', () => {
    const { c, appels } = monter();

    expect(c).toBeTruthy();
    expect(appels.lecture).toBe(1);
    expect(c.chargement()).toBe(false);
  });

  it('signale une erreur si le chargement échoue', () => {
    const { c, messages } = monter({}, true);

    expect(c.chargement()).toBe(false);
    expect(messages.erreur).toContain('COMMON.ERROR_GENERIC');
  });

  it('attribue le créneau par défaut quand un jour fermé est coché', () => {
    const { c } = monter();

    c.majJour('0', 'ouvert', true);

    expect(c.lignes().find((ligne) => ligne.cle === '0')).toEqual(
      expect.objectContaining({ ouvert: true, ouvre: '08:00', ferme: '20:00' }),
    );
  });

  it('envoie null pour un jour décoché', () => {
    const { c, appels } = monter({ '1': { ouvre: '09:00', ferme: '18:00' } });

    c.majJour('1', 'ouvert', false);
    c.enregistrer();

    expect(appels.ecriture[0].horaires['1']).toBeNull();
  });

  it('signale un créneau invalide et bloque son enregistrement', () => {
    const { c, appels, messages } = monter({ '1': { ouvre: '09:00', ferme: '17:00' } });

    c.majJour('1', 'ferme', '09:00');
    expect(c.joursFautifs()).toEqual(['COMMON.DAYS.1']);
    c.enregistrer();

    expect(appels.ecriture).toHaveLength(0);
    expect(messages.erreur).toContain('PHARMACIEN.HORAIRES.ERREUR_CRENEAU');
  });

  it('applique le premier créneau ouvert aux autres jours ouverts seulement', () => {
    const { c } = monter({
      '1': { ouvre: '09:00', ferme: '17:00' },
      '2': { ouvre: '10:00', ferme: '18:00' },
    });

    c.appliquerPartout();

    expect(c.lignes().find((ligne) => ligne.cle === '2')).toEqual(
      expect.objectContaining({ ouvert: true, ouvre: '09:00', ferme: '17:00' }),
    );
    expect(c.lignes().find((ligne) => ligne.cle === '3')).toEqual(
      expect.objectContaining({ ouvert: false, ouvre: '08:00', ferme: '20:00' }),
    );
  });

  it('enregistre les clés 0 à 6 et affiche le succès', () => {
    const { c, appels, messages } = monter({ '1': { ouvre: '09:00', ferme: '17:00' } });

    c.enregistrer();

    expect(Object.keys(appels.ecriture[0].horaires).sort()).toEqual([
      '0', '1', '2', '3', '4', '5', '6',
    ]);
    expect(messages.succes).toContain('PHARMACIEN.HORAIRES.ENREGISTRE');
  });
});
