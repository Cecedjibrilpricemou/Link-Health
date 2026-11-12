// R4 : l'adresse precise (point de repere, position) et les traits d'identite
// (lieu de naissance, nom de la mere) du patient sont chiffres en base. Une
// sauvegarde volee ne doit donner ni le domicile d'un patient, ni les reponses
// aux questions qui servent a l'identifier.
//
// Le nom de la mere doit pourtant rester cherchable (detection de doublons) :
// une empreinte HMAC, posee par l'extension a chaque ecriture.

// Une cle de test, jamais celle d'une base.
process.env.DB_ENCRYPTION_KEY = 'cd'.repeat(32);

import { createHmac } from 'crypto';
import { EMPREINTES, ENCRYPTED_FIELDS, withFieldEncryption } from '../src/config/prisma-encryption.extension';
import { decryptField, empreinteRecherche } from '../src/utils/encryption.utils';
import { lirePosition, positionEnTexte } from '../src/utils/coordonnees';

type Crochet = (p: { model?: string; args: Record<string, unknown>; query: (a: unknown) => Promise<unknown> }) => Promise<unknown>;

/** Le crochet de l'extension, sorti d'un faux client. */
function crochet(): Crochet {
  let config: { query: { $allModels: { $allOperations: Crochet } } } | undefined;
  const faux = { $extends: (c: typeof config) => { config = c; return faux; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withFieldEncryption(faux as any);
  return config!.query.$allModels.$allOperations;
}

/** Ce que la base aurait recu, fige avant que le resultat ne soit dechiffre. */
async function ecrire(model: string, args: Record<string, unknown>) {
  let recu: Record<string, unknown> = {};
  const resultat = await crochet()({
    model,
    args,
    query: async (a) => {
      recu = JSON.parse(JSON.stringify(a));
      return JSON.parse(JSON.stringify((a as { data?: unknown }).data ?? {}));
    },
  });
  return { recu, resultat: resultat as Record<string, unknown> };
}

const MERE = 'Fatoumata Condé';

describe('les champs chiffres du dossier patient', () => {
  it('comprennent l adresse precise et les traits d identite', () => {
    expect(ENCRYPTED_FIELDS['PatientProfile']!.scalar).toEqual(
      expect.arrayContaining(['pointRepere', 'position', 'lieuNaissance', 'nomMere']),
    );
    expect(EMPREINTES['PatientProfile']).toEqual({ nomMere: 'nomMereEmpreinte' });
  });

  it('partent chiffres en base, et reviennent en clair', async () => {
    const { recu, resultat } = await ecrire('PatientProfile', {
      data: { pointRepere: 'Derriere la mosquee de Kipe', position: '9.64,-13.58', lieuNaissance: 'Kankan', nomMere: MERE },
    });
    const data = recu['data'] as Record<string, string>;
    for (const champ of ['pointRepere', 'position', 'lieuNaissance', 'nomMere']) {
      expect(data[champ]).toMatch(/^enc:v1:/);
    }
    expect(JSON.stringify(recu)).not.toMatch(/mosquee|9\.64|Kankan|Fatoumata/);
    expect(decryptField(data['position'])).toBe('9.64,-13.58');
    expect(resultat).toMatchObject({ pointRepere: 'Derriere la mosquee de Kipe', nomMere: MERE });
  });

  it('pose l empreinte du nom de la mere, calculee sur le clair', async () => {
    const { recu } = await ecrire('PatientProfile', { where: { id: 'p1' }, data: { nomMere: MERE } });
    expect((recu['data'] as Record<string, string>)['nomMereEmpreinte']).toBe(empreinteRecherche(MERE));
  });

  it('efface l empreinte avec le nom, et n y touche pas sans lui', async () => {
    const efface = await ecrire('PatientProfile', { data: { nomMere: null } });
    expect(efface.recu['data']).toEqual({ nomMere: null, nomMereEmpreinte: null });

    const autre = await ecrire('PatientProfile', { data: { groupeSanguin: 'O+' } });
    expect(autre.recu['data']).not.toHaveProperty('nomMereEmpreinte');
  });

  it('chiffre aussi les deux branches d un upsert, et chaque ligne d un createMany', async () => {
    const upsert = await ecrire('PatientProfile', { create: { nomMere: MERE }, update: { lieuNaissance: 'Labe' } });
    expect((upsert.recu['create'] as Record<string, string>)['nomMere']).toMatch(/^enc:v1:/);
    expect((upsert.recu['create'] as Record<string, string>)['nomMereEmpreinte']).toBe(empreinteRecherche(MERE));
    expect((upsert.recu['update'] as Record<string, string>)['lieuNaissance']).toMatch(/^enc:v1:/);

    const lot = await ecrire('PatientProfile', { data: [{ pointRepere: 'A' }, { pointRepere: 'B' }] });
    expect((lot.recu['data'] as { pointRepere: string }[]).every((l) => l.pointRepere.startsWith('enc:v1:'))).toBe(true);
  });

  it('ne touche pas aux autres modeles', async () => {
    const { recu } = await ecrire('Utilisateur', { data: { prenom: 'Fatoumata', nomMere: MERE } });
    expect(recu['data']).toEqual({ prenom: 'Fatoumata', nomMere: MERE });
  });
});

describe('empreinteRecherche', () => {
  it('rapproche les ecritures d un meme nom', () => {
    const e = empreinteRecherche(MERE);
    expect(empreinteRecherche('fatoumata   CONDE')).toBe(e);
    expect(empreinteRecherche('  Fatoumata Conde ')).toBe(e);
  });

  it('distingue deux noms, et ne laisse rien lire du nom', () => {
    expect(empreinteRecherche('Fatoumata Camara')).not.toBe(empreinteRecherche(MERE));
    expect(empreinteRecherche(MERE)).toMatch(/^emp:v1:[0-9a-f]{64}$/);
    expect(empreinteRecherche(MERE)).not.toMatch(/fatoumata|conde/i);
  });

  // Sans la cle, une empreinte ne se calcule ni ne se retourne : c'est un
  // HMAC sous une cle derivee de DB_ENCRYPTION_KEY, pas un simple codage.
  it('est un HMAC sous une cle derivee, qui ne se decode pas en nom', () => {
    const cle = createHmac('sha256', Buffer.from(process.env.DB_ENCRYPTION_KEY!, 'hex'))
      .update('keneya:empreinte-recherche:v1').digest();
    const attendue = 'emp:v1:' + createHmac('sha256', cle).update('fatoumata conde', 'utf8').digest('hex');
    expect(empreinteRecherche(MERE)).toBe(attendue);

    const octets = Buffer.from(empreinteRecherche(MERE)!.slice('emp:v1:'.length), 'hex').toString('latin1');
    expect(octets).not.toMatch(/fatoumata|conde/i);
  });

  it('ne rend rien pour une valeur vide', () => {
    expect([empreinteRecherche(''), empreinteRecherche('   '), empreinteRecherche(null), empreinteRecherche(undefined)])
      .toEqual([null, null, null, null]);
  });
});

describe('la position, en « lat,lng »', () => {
  it('fait l aller-retour', () => {
    expect(lirePosition(positionEnTexte(9.64, -13.58))).toEqual({ latitude: 9.64, longitude: -13.58 });
  });

  // Mieux vaut ne pas guider le motard que l'envoyer ailleurs.
  it.each([
    ['', 'vide'], ['9.64', 'sans longitude'], ['9.64,-13.58,1', 'trois morceaux'], ['abc,def', 'illisible'],
    ['91,0', 'latitude hors bornes'], ['0,181', 'longitude hors bornes'], ['enc:v1:AAAA', 'encore chiffree'],
  ])('rend une position absente plutot que fausse : %s (%s)', (texte) => {
    expect(lirePosition(texte)).toBeNull();
  });
});
