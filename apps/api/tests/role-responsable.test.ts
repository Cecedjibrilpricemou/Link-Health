// Le role que recoit le responsable d'une structure, selon son metier.
//
// **Creer le compte ne suffit pas : encore faut-il le creer au bon endroit.**
// Tous les responsables recevaient `ADMIN_STRUCTURE`, et atterrissaient dans
// un espace d'administration d'etablissement de soins.
//
// Pour le titulaire d'une officine, cet espace ne sait rien faire de son
// metier : ni stock, ni caisse, ni ordonnance recue.
//
// Pour le responsable d'une compagnie d'assurance, c'etait pire : son propre
// espace - contrats, assures, reglements, regles de couverture - existait
// depuis le debut et n'etait accessible a personne. Le role `ASSUREUR` etait
// declare, les routes `/assurances/moi` le reclamaient, la redirection le
// prevoyait, mais **aucune ligne du serveur ne creait jamais un compte qui le
// porte**. L'espace entier etait inatteignable.
import { TypeStructure } from '../src/config/generated/client/client';
import { roleDuResponsable } from '../src/utils/officine.util';

describe('le role du responsable suit le metier de sa structure', () => {
  // Une officine : le titulaire tient un comptoir, pas un etablissement.
  it('donne PHARMACIEN au responsable d une officine', () => {
    expect(roleDuResponsable(TypeStructure.PHARMACIE)).toBe('PHARMACIEN');
  });

  // Une compagnie d'assurance ne soigne personne : elle couvre.
  it('donne ASSUREUR au responsable d une compagnie', () => {
    expect(roleDuResponsable(TypeStructure.ASSURANCE)).toBe('ASSUREUR');
  });

  it.each([
    TypeStructure.POSTE,
    TypeStructure.CENTRE,
    TypeStructure.HOPITAL_PREF,
    TypeStructure.HOPITAL_REG,
    TypeStructure.CHU,
    TypeStructure.CLINIQUE,
    TypeStructure.LABORATOIRE,
  ])('laisse ADMIN_STRUCTURE au responsable d un %s', (type) => {
    expect(roleDuResponsable(type)).toBe('ADMIN_STRUCTURE');
  });

  /**
   * **Tout type doit recevoir un role, et un seul.**
   *
   * Un type ajoute au schema sans etre pense ici retomberait silencieusement
   * sur `ADMIN_STRUCTURE` : ce test ne l'empeche pas, mais il oblige a
   * regarder la liste en face le jour ou elle s'allonge.
   */
  it('attribue un role connu a chacun des types declares', () => {
    const roles = Object.values(TypeStructure).map((t) => roleDuResponsable(t));

    expect(roles).toHaveLength(Object.values(TypeStructure).length);
    for (const role of roles) {
      expect(['PHARMACIEN', 'ASSUREUR', 'ADMIN_STRUCTURE']).toContain(role);
    }
  });
});
