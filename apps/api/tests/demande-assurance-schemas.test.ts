// Ce que les routes des demandes acceptent, avant meme le service.
//
// **Une compagnie d'assurance depose en ligne depuis le 2026-11-20**, et
// chaque action de l'administration porte un motif envoye au candidat. Ces
// schemas sont la premiere porte : un motif vide ou un code mal forme ne doit
// pas l'atteindre.
process.env['DATABASE_URL'] ??= 'postgresql://u:p@localhost:5432/test';
process.env['JWT_SECRET'] ??= 'secret-de-test-au-moins-32-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'autre-secret-de-test-au-moins-32-car';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);

import {
  demandeAgrementSchema,
  motifDemandeAgrementSchema,
  refusDemandeAgrementSchema,
  validationDemandeAgrementSchema,
} from '../src/validators/api.schemas';

const COMPAGNIE = {
  type: 'ASSURANCE',
  nom: 'Sunu Assurances',
  prefecture: 'Conakry',
  commune: 'Kaloum',
  adresse: 'Avenue de la République',
  telephone: '620111222',
  rccm: 'GN.TCC.2026.B.00042',
  numeroAgrementCreation: 'D/2009/CAM/LOA/07',
  lieuAutorise: 'Kaloum',
  codeAssureur: 'SUNU',
  modeEchange: 'PORTAIL',
  responsable: { prenom: 'Awa', nom: 'Bah', telephone: '620333444', email: 'Awa.Bah@Sunu.gn' },
};

describe('le depot d une demande d assurance', () => {
  it('accepte une compagnie avec son code et son mode d echange', () => {
    const r = demandeAgrementSchema.safeParse(COMPAGNIE);
    expect(r.success).toBe(true);
    expect(r.data?.responsable.email).toBe('awa.bah@sunu.gn');
  });

  it('exige le code de la compagnie, en nommant le champ', () => {
    const { codeAssureur: _retire, ...sansCode } = COMPAGNIE;
    const r = demandeAgrementSchema.safeParse(sansCode);

    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path.join('.') === 'codeAssureur');
    expect(issue?.message).toMatch(/code de la compagnie/);
  });

  it('refuse un code avec des espaces ou des accents', () => {
    expect(demandeAgrementSchema.safeParse({ ...COMPAGNIE, codeAssureur: 'SU NU' }).success).toBe(false);
    expect(demandeAgrementSchema.safeParse({ ...COMPAGNIE, codeAssureur: 'SÜNU' }).success).toBe(false);
  });

  it('refuse un mode d echange inconnu', () => {
    expect(demandeAgrementSchema.safeParse({ ...COMPAGNIE, modeEchange: 'FAX' }).success).toBe(false);
  });

  it('n exige pas de code d une officine', () => {
    const { codeAssureur: _c, modeEchange: _m, ...officine } = COMPAGNIE;
    expect(demandeAgrementSchema.safeParse({ ...officine, type: 'PHARMACIE' }).success).toBe(true);
  });

  it('refuse toujours un type cree par l administration seule', () => {
    expect(demandeAgrementSchema.safeParse({ ...COMPAGNIE, type: 'POSTE' }).success).toBe(false);
  });
});

describe('le motif de chaque action', () => {
  it.each([
    ['la mise en verification', motifDemandeAgrementSchema],
    ['le refus', refusDemandeAgrementSchema],
    ['la validation', validationDemandeAgrementSchema],
  ])('%s exige un motif explicite', (_action, schema) => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ motif: 'ok' }).success).toBe(false);
    expect(schema.safeParse({ motif: '          ' }).success).toBe(false);
    expect(schema.safeParse({ motif: 'Les pièces sont lisibles et concordent.' }).success).toBe(true);
  });

  it('borne la longueur du motif', () => {
    expect(motifDemandeAgrementSchema.safeParse({ motif: 'x'.repeat(601) }).success).toBe(false);
  });

  it('accepte a la validation un code corrige bien forme, et seulement lui', () => {
    const motif = 'Les pièces sont lisibles et concordent.';
    expect(validationDemandeAgrementSchema.safeParse({ motif, codeAssureur: 'SUNU-GN' }).success).toBe(true);
    expect(validationDemandeAgrementSchema.safeParse({ motif, codeAssureur: 'SU NU' }).success).toBe(false);
    // Un champ inattendu est refuse : rien d'autre ne passe par cette route.
    expect(validationDemandeAgrementSchema.safeParse({ motif, role: 'SUPER_ADMIN' }).success).toBe(false);
  });
});
