import { createAgentPharmacieSchema } from '../src/validators/api.schemas';

/**
 * Creer un agent d'officine depuis l'ecran du titulaire.
 *
 * Le formulaire envoie le role choisi (`roleOfficine`) mais le schema,
 * strict, ne le connaissait pas : toute creation etait refusee en 400, quel
 * que soit le role. Le service, lui, lisait bien ce champ.
 *
 * **Jamais TITULAIRE** : un titulaire ne cree pas un second titulaire, qui
 * aurait tous les droits sur l'officine.
 */
const base = { telephone: '620000111', prenom: 'Aissatou', nom: 'Diallo' };

describe('createAgentPharmacieSchema', () => {
  for (const role of ['ADJOINT', 'PREPARATEUR', 'CAISSIER'] as const) {
    it(`accepte le rôle ${role} envoyé par le formulaire`, () => {
      const r = createAgentPharmacieSchema.safeParse({ ...base, roleOfficine: role });
      expect(r.success).toBe(true);
      if (r.success) expect((r.data as Record<string, unknown>)['roleOfficine']).toBe(role);
    });
  }

  it('accepte une création sans rôle (le service retient ADJOINT)', () => {
    expect(createAgentPharmacieSchema.safeParse(base).success).toBe(true);
  });

  it('refuse de créer un TITULAIRE', () => {
    expect(createAgentPharmacieSchema.safeParse({ ...base, roleOfficine: 'TITULAIRE' }).success).toBe(false);
  });

  it('reste strict pour tout autre champ inconnu', () => {
    expect(createAgentPharmacieSchema.safeParse({ ...base, role: 'SUPER_ADMIN' }).success).toBe(false);
  });
});
