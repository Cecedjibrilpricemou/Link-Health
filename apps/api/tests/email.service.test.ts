// Deux defauts constates le 2026-11-18 en debranchant Gmail :
//
//  - l'objet du courriel de reinitialisation etait ecrit entre guillemets
//    simples, « '...${nom}' » : les destinataires recevaient la variable en
//    toutes lettres dans l'objet du message.
//  - les deux courriels de bienvenue pointaient vers
//    http://localhost:4200/auth/login, ecrit en dur. En production, le bouton
//    « Se connecter » menait nulle part, alors que FRONTEND_URL existait.
//
// Les deux se voient depuis ce qui part reellement : le sujet et le HTML.
jest.mock('../src/config/env', () => ({
  env: { FRONTEND_URL: 'https://sante.exemple.gn' },
}));
jest.mock('../src/services/courriel.service', () => ({ envoyerCourriel: jest.fn() }));
jest.mock('../src/services/parametres.service', () => ({
  getIdentitePlateforme: jest.fn(),
}));

import {
  envoyerEmailAdminStructure,
  envoyerEmailAgent,
  envoyerEmailResetMotDePasse,
  envoyerOtpConnexion,
} from '../src/services/email.service';

const { envoyerCourriel } = jest.requireMock('../src/services/courriel.service') as {
  envoyerCourriel: jest.Mock;
};
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as {
  getIdentitePlateforme: jest.Mock;
};

const IDENTITE = {
  nom: 'Lead Health',
  slogan: 'La sante a portee de main',
  copyright: '(c) Lead Health',
  emailExpediteur: '',
};

/** Le dernier message confie au transport. */
const dernierEnvoi = () => envoyerCourriel.mock.calls.at(-1)![0] as { sujet: string; html: string };

beforeEach(() => {
  jest.clearAllMocks();
  getIdentitePlateforme.mockResolvedValue(IDENTITE);
});

describe('courriels : objet du message', () => {
  it("nomme la plateforme dans l'objet de la reinitialisation, sans laisser la variable", async () => {
    await envoyerEmailResetMotDePasse({
      destinataire: 'pro@exemple.gn',
      prenomNom: 'Awa Diallo',
      lienReset: 'https://sante.exemple.gn/auth/reset?jeton=abc',
      expireDansMinutes: 30,
    });

    const { sujet } = dernierEnvoi();
    expect(sujet).toContain('Lead Health');
    expect(sujet).not.toContain('${nom}');
  });

  it("met le code dans l'objet du courriel de connexion", async () => {
    await envoyerOtpConnexion({
      destinataire: 'pro@exemple.gn',
      prenomNom: 'Awa Diallo',
      code: '123456',
      expireDansMinutes: 10,
    });

    const { sujet, html } = dernierEnvoi();
    expect(sujet).toContain('123456');
    expect(html).toContain('123456');
  });
});

describe('courriels : lien de connexion', () => {
  const bienvenueAdmin = () =>
    envoyerEmailAdminStructure({
      destinataire: 'admin@exemple.gn',
      prenomNom: 'Awa Diallo',
      nomStructure: 'Pharmacie du Port',
      telephone: '+224600000000',
      motDePasseTemporaire: 'temporaire',
    });

  const bienvenueAgent = () =>
    envoyerEmailAgent({
      destinataire: 'agent@exemple.gn',
      prenomNom: 'Awa Diallo',
      role: 'PHARMACIEN',
      nomStructure: 'Pharmacie du Port',
      telephone: '+224600000000',
      motDePasseTemporaire: 'temporaire',
    });

  it.each([
    ["l'admin de structure", bienvenueAdmin],
    ["l'agent", bienvenueAgent],
  ])('mene a l adresse deployee dans le courriel de %s', async (_titre, envoyer) => {
    await envoyer();

    const { html } = dernierEnvoi();
    expect(html).toContain('https://sante.exemple.gn/auth/login');
    expect(html).not.toContain('localhost:4200');
  });
});
