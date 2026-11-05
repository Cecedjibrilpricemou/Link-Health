// Un jeton de rafraichissement n'est pas un jeton d'acces (lot A1).
//
// Les deux etaient signes avec le meme secret et sans type : presente en
// `Authorization: Bearer`, un jeton de rafraichissement passait
// `authenticate`, qui recharge le role depuis la base — tous les droits du
// compte pendant sept jours. Et dans l'autre sens, rien ne verifiait qu'un
// jeton soumis a /auth/refresh en etait bien un.

// `jwt.utils` lit ses secrets au chargement : sans eux la suite ne demarrait
// pas hors CI. `??=` garde les valeurs fournies par l'environnement. Les deux
// secrets doivent differer, c'est precisement ce que ce fichier verifie.
process.env['JWT_SECRET'] ??= 'test-secret-au-moins-seize-caracteres';
process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-au-moins-seize-caracteres';
process.env['DB_ENCRYPTION_KEY'] ??= '0'.repeat(64);
process.env['DATABASE_URL'] ??= 'postgresql://127.0.0.1:5432/test';

import jwt from 'jsonwebtoken';

jest.mock('../src/config/prisma', () => ({
  prisma: {
    session: { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn() },
  },
}));

import { prisma } from '../src/config/prisma';
import { authenticate, AuthRequest } from '../src/middlewares/auth.middleware';
import { refreshTokens } from '../src/services/auth.service';
import { generateTokenPair } from '../src/utils/jwt.utils';
import { UnauthorizedError } from '../src/utils/app-error';

const findUnique = prisma.session.findUnique as jest.Mock;

const PAYLOAD = { userId: 'u-1', role: 'MEDECIN' as const, sessionId: 's-1' };

// La session que la base renverrait pour ce compte : vivante, compte actif.
const sessionVivante = {
  id: 's-1',
  idUtilisateur: 'u-1',
  expireLe: new Date(Date.now() + 60 * 60 * 1000),
  ipAdresse: null,
  userAgent: null,
  utilisateur: { id: 'u-1', role: 'MEDECIN', estActif: true },
};

/** Fait passer un jeton par `authenticate` comme le ferait GET /auth/me. */
async function authentifier(token: string): Promise<unknown> {
  const req = { headers: { authorization: `Bearer ${token}` }, cookies: {}, method: 'GET' } as unknown as AuthRequest;
  const next = jest.fn();
  await authenticate(req, {} as never, next);
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0];
}

beforeEach(() => {
  findUnique.mockReset();
  findUnique.mockResolvedValue(sessionVivante);
});

describe("jeton d'acces et jeton de rafraichissement", () => {
  it("le jeton d'acces ouvre une session", async () => {
    const { accessToken } = generateTokenPair(PAYLOAD);
    expect(await authentifier(accessToken)).toBeUndefined();
  });

  it("un jeton de rafraichissement presente en Bearer est refuse (401)", async () => {
    const { refreshToken } = generateTokenPair(PAYLOAD);
    const erreur = await authentifier(refreshToken);
    expect(erreur).toBeInstanceOf(UnauthorizedError);
    expect((erreur as UnauthorizedError).statusCode).toBe(401);
  });

  it("un jeton sans type, meme signe avec le secret d'acces, est refuse", async () => {
    // Tous les jetons emis avant la correction sont dans ce cas.
    const ancien = jwt.sign(PAYLOAD, process.env.JWT_SECRET as string, { expiresIn: '15m' });
    expect(await authentifier(ancien)).toBeInstanceOf(UnauthorizedError);
  });

  it("le jeton de rafraichissement n'est pas signe avec le secret d'acces", () => {
    const { refreshToken } = generateTokenPair(PAYLOAD);
    expect(() => jwt.verify(refreshToken, process.env.JWT_SECRET as string)).toThrow();
  });

  it("un jeton d'acces soumis au rafraichissement est refuse, meme si la base le trouvait", async () => {
    const { accessToken } = generateTokenPair(PAYLOAD);
    await expect(refreshTokens(accessToken)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('un jeton de rafraichissement valide renouvelle la paire', async () => {
    const { refreshToken } = generateTokenPair(PAYLOAD);
    const paire = await refreshTokens(refreshToken);
    expect(paire.accessToken).toEqual(expect.any(String));
    expect(paire.refreshToken).toEqual(expect.any(String));
  });
});
