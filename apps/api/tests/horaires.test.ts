// Les horaires d'une officine : ce qu'on affiche a quelqu'un qui va se
// deplacer. Une erreur ici lui fait traverser la ville pour rien.
//
// Les dates des tests sont ecrites avec leur jour en commentaire : c'est la
// que se glissent les decalages d'un jour, et une date nue ne se relit pas.
import {
  enMinutes,
  etatOuverture,
  horairesDepuisLaBase,
  joursInvalides,
} from '../src/utils/horaires';
import type { Horaires } from '../src/utils/horaires';

// 0 = dimanche, comme Date.getDay(). Ouvert du lundi au samedi, ferme le
// dimanche : l'horaire d'une officine de quartier.
const SEMAINE: Horaires = {
  '0': null,
  '1': { ouvre: '08:00', ferme: '20:00' },
  '2': { ouvre: '08:00', ferme: '20:00' },
  '3': { ouvre: '08:00', ferme: '20:00' },
  '4': { ouvre: '08:00', ferme: '20:00' },
  '5': { ouvre: '08:00', ferme: '20:00' },
  '6': { ouvre: '09:00', ferme: '14:00' },
};

/** Une date locale, pour que les heures du test soient celles du serveur. */
const le = (iso: string) => new Date(iso);

describe('enMinutes', () => {
  it('lit une heure du jour', () => {
    expect(enMinutes('00:00')).toBe(0);
    expect(enMinutes('08:30')).toBe(510);
    expect(enMinutes('23:59')).toBe(1439);
  });

  it('refuse ce qui n est pas une heure', () => {
    for (const faux of ['24:00', '08:60', '8:00', '0800', '', 'midi', '08:0a', '08:00:00', 'vers 08:00']) {
      expect(enMinutes(faux)).toBeNull();
    }
  });
});

describe('joursInvalides', () => {
  it('accepte une semaine coherente', () => {
    expect(joursInvalides(SEMAINE)).toEqual([]);
  });

  it('refuse une fermeture avant l ouverture', () => {
    // Sinon l'officine parait fermee toute la journee sans qu'on comprenne.
    expect(joursInvalides({ '1': { ouvre: '20:00', ferme: '08:00' } })).toEqual(['1']);
  });

  it('refuse un creneau de duree nulle', () => {
    expect(joursInvalides({ '1': { ouvre: '08:00', ferme: '08:00' } })).toEqual(['1']);
  });

  it('refuse une heure mal ecrite', () => {
    expect(joursInvalides({ '3': { ouvre: '8h', ferme: '20:00' } })).toEqual(['3']);
  });

  it('un jour ferme n est pas une erreur', () => {
    expect(joursInvalides({ '0': null })).toEqual([]);
  });
});

describe('etatOuverture : sans horaires saisis', () => {
  it('ne dit ni ouvert ni ferme', () => {
    // Afficher « ferme » ferait fuir les clients d'une officine qui n'a
    // simplement rien rempli.
    expect(etatOuverture(null).ouvert).toBeNull();
    expect(etatOuverture(undefined).ouvert).toBeNull();
    expect(etatOuverture({}).ouvert).toBeNull();
  });
});

describe('etatOuverture : pendant la journee', () => {
  it('ouvert en pleine journee, avec l heure de fermeture', () => {
    const e = etatOuverture(SEMAINE, le('2026-11-10T10:30:00')); // mardi
    expect(e.ouvert).toBe(true);
    expect(e.fermeA).toBe('20:00');
    expect(e.prochaine).toBeNull();
  });

  it('ouvert des la minute d ouverture', () => {
    expect(etatOuverture(SEMAINE, le('2026-11-10T08:00:00')).ouvert).toBe(true);
  });

  it('ferme a la minute de fermeture : la porte est close a 20h00', () => {
    const e = etatOuverture(SEMAINE, le('2026-11-10T20:00:00'));
    expect(e.ouvert).toBe(false);
  });

  it('avant l ouverture, renvoie a aujourd hui et non a demain', () => {
    const e = etatOuverture(SEMAINE, le('2026-11-10T06:00:00')); // mardi matin
    expect(e.ouvert).toBe(false);
    expect(e.prochaine).toEqual({ dansJours: 0, heure: '08:00' });
  });

  it('apres la fermeture, renvoie au lendemain', () => {
    const e = etatOuverture(SEMAINE, le('2026-11-10T21:00:00')); // mardi soir
    expect(e.prochaine).toEqual({ dansJours: 1, heure: '08:00' });
  });
});

describe('etatOuverture : les jours fermes', () => {
  it('le dimanche, renvoie au lundi', () => {
    const e = etatOuverture(SEMAINE, le('2026-11-15T11:00:00')); // dimanche
    expect(e.ouvert).toBe(false);
    expect(e.prochaine).toEqual({ dansJours: 1, heure: '08:00' });
  });

  it('le samedi soir, saute le dimanche ferme et vise le lundi', () => {
    // Le cas qui attrape les decalages d'un jour : samedi 15h, deja ferme
    // (14h), dimanche ferme, donc lundi — deux jours plus loin.
    const e = etatOuverture(SEMAINE, le('2026-11-14T15:00:00')); // samedi
    expect(e.prochaine).toEqual({ dansJours: 2, heure: '08:00' });
  });

  it('le samedi matin, l officine ouvre plus tard que les autres jours', () => {
    const e = etatOuverture(SEMAINE, le('2026-11-14T08:30:00')); // samedi
    expect(e.ouvert).toBe(false);
    expect(e.prochaine).toEqual({ dansJours: 0, heure: '09:00' });
    expect(etatOuverture(SEMAINE, le('2026-11-14T09:30:00')).ouvert).toBe(true);
  });

  it('une semaine entierement fermee ne promet aucune ouverture', () => {
    const fermee: Horaires = { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null };
    const e = etatOuverture(fermee, le('2026-11-10T10:00:00'));
    expect(e.ouvert).toBe(false);
    expect(e.prochaine).toBeNull();
  });

  it('un creneau fautif n est pas propose comme prochaine ouverture', () => {
    // Mercredi est mal saisi. Le proposer enverrait quelqu'un devant une
    // porte close : on passe au jour suivant qui tient debout.
    const bancale: Horaires = {
      '3': { ouvre: '20:00', ferme: '08:00' },
      '4': { ouvre: '08:00', ferme: '20:00' },
    };
    const e = etatOuverture(bancale, le('2026-11-10T21:00:00')); // mardi soir
    expect(e.prochaine).toEqual({ dansJours: 2, heure: '08:00' });
  });

  it('un creneau fautif est ignore plutot que de dire « ouvert »', () => {
    const e = etatOuverture({ '2': { ouvre: '20:00', ferme: '08:00' } }, le('2026-11-10T10:00:00'));
    expect(e.ouvert).toBe(false);
  });
});

describe('horairesDepuisLaBase', () => {
  it('garde ce qui est exploitable', () => {
    expect(horairesDepuisLaBase({ '1': { ouvre: '08:00', ferme: '20:00' }, '0': null })).toEqual({
      '1': { ouvre: '08:00', ferme: '20:00' },
      '0': null,
    });
  });

  it('ecarte un jour hors de la semaine', () => {
    expect(horairesDepuisLaBase({ '9': { ouvre: '08:00', ferme: '20:00' } })).toBeNull();
  });

  it('ecarte une heure qui n en est pas une', () => {
    expect(horairesDepuisLaBase({ '1': { ouvre: 'matin', ferme: '20:00' } })).toBeNull();
  });

  it('ecarte ce qui n est pas un objet de jours', () => {
    expect(horairesDepuisLaBase(null)).toBeNull();
    expect(horairesDepuisLaBase('08:00-20:00')).toBeNull();
    expect(horairesDepuisLaBase([{ ouvre: '08:00', ferme: '20:00' }])).toBeNull();
  });
});
