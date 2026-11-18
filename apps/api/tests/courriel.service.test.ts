// Le choix de l'expediteur decide si un utilisateur peut se connecter : sans
// courriel, pas de code OTP. Ces tests portent sur les decisions, pas sur le
// reseau — aucun envoi reel n'est fait.
jest.mock('../src/config/env', () => ({ env: {} }));
jest.mock('../src/services/parametres.service', () => ({
  getIdentitePlateforme: jest.fn(),
}));

import {
  adresseExpediteur,
  choisirTransport,
  corpsBrevo,
  diagnosticBrevo,
  envoyerCourriel,
  messageNodemailer,
  optionsGmail,
  optionsSmtp,
  type ConfigCourriel,
  type Courriel,
  type Expediteur,
} from '../src/services/courriel.service';

const { env } = jest.requireMock('../src/config/env') as { env: Record<string, unknown> };
const { getIdentitePlateforme } = jest.requireMock('../src/services/parametres.service') as {
  getIdentitePlateforme: jest.Mock;
};

describe('courriel : choix du transport', () => {
  it('prend Brevo avant tout le reste', () => {
    const config: ConfigCourriel = {
      BREVO_API_KEY: 'cle',
      SMTP_HOST: 'smtp.exemple.org',
      GMAIL_USER: 'moi@gmail.com',
    };
    expect(choisirTransport(config)).toBe('brevo');
  });

  it('retombe sur le SMTP quand Brevo manque', () => {
    expect(choisirTransport({ SMTP_HOST: 'smtp.exemple.org', GMAIL_USER: 'moi@gmail.com' })).toBe(
      'smtp',
    );
  });

  it('retombe sur Gmail en dernier', () => {
    expect(choisirTransport({ GMAIL_USER: 'moi@gmail.com' })).toBe('gmail');
  });

  it("ne rend rien quand rien n'est configure", () => {
    expect(choisirTransport({})).toBeNull();
  });

  // Une variable posee mais laissee vide est le cas courant d'un fichier
  // .env recopie : elle ne doit pas faire croire a un transport configure.
  it('ignore une variable vide ou faite d espaces', () => {
    expect(choisirTransport({ BREVO_API_KEY: '   ', SMTP_HOST: '' })).toBeNull();
    expect(choisirTransport({ BREVO_API_KEY: '  ', SMTP_HOST: 'smtp.exemple.org' })).toBe('smtp');
  });
});

describe('courriel : adresse d expedition', () => {
  it('prefere le reglage de la plateforme a la variable d environnement', () => {
    const adresse = adresseExpediteur('contact@sante.gn', { EMAIL_EXPEDITEUR: 'defaut@sante.gn' }, 'brevo');
    expect(adresse).toBe('contact@sante.gn');
  });

  it('retombe sur la variable quand le reglage est vide', () => {
    expect(adresseExpediteur('', { EMAIL_EXPEDITEUR: 'defaut@sante.gn' }, 'brevo')).toBe(
      'defaut@sante.gn',
    );
    expect(adresseExpediteur(undefined, { EMAIL_EXPEDITEUR: 'defaut@sante.gn' }, 'smtp')).toBe(
      'defaut@sante.gn',
    );
  });

  // Gmail n'expedie que depuis le compte authentifie : lui passer une autre
  // adresse la ferait silencieusement remplacer, ou rejeter.
  it('impose le compte Gmail, meme si un autre expediteur est reglé', () => {
    const adresse = adresseExpediteur(
      'contact@sante.gn',
      { GMAIL_USER: 'moi@gmail.com', EMAIL_EXPEDITEUR: 'defaut@sante.gn' },
      'gmail',
    );
    expect(adresse).toBe('moi@gmail.com');
  });

  it('ne rend rien quand aucune adresse n est connue', () => {
    expect(adresseExpediteur(undefined, {}, 'brevo')).toBeNull();
    expect(adresseExpediteur('  ', {}, 'smtp')).toBeNull();
  });

  // Constate le 2026-11-18 sur la base de developpement : le reglage
  // « emailExpediteur » contenait « OmniCare ». Il a longtemps servi de nom
  // affiche, pas d'adresse. Pris pour une adresse, il partait tel quel chez
  // Brevo, qui refusait l'envoi : plus aucun code de connexion ne partait,
  // et l'ecran n'affichait qu'un « l'envoi du code OTP a echoue ».
  it.each([
    ['un nom de plateforme', 'OmniCare'],
    ['un libelle avec espace', 'Omni Care'],
    ['une adresse sans domaine', 'omnicare@'],
    ['une adresse sans point', 'omnicare@localhost'],
    ['une adresse avec un espace', 'omni care@sante.gn'],
  ])('ignore un reglage qui est %s, et prend la variable d environnement', (_titre, reglage) => {
    expect(adresseExpediteur(reglage, { EMAIL_EXPEDITEUR: 'service@sante.gn' }, 'brevo')).toBe(
      'service@sante.gn',
    );
  });

  it("n invente aucune adresse quand le reglage n'en est pas une et qu'il n'y a pas de repli", () => {
    expect(adresseExpediteur('OmniCare', {}, 'brevo')).toBeNull();
  });
});

describe('courriel : diagnostic des refus de Brevo', () => {
  it('nomme la cle refusee sur un 401', () => {
    expect(diagnosticBrevo(401, '{"message":"Key not found"}', 'contact@sante.gn')).toMatch(
      /BREVO_API_KEY/,
    );
  });

  // Le refus le plus frequent au premier essai : Brevo n'expedie que depuis
  // une adresse validee dans le compte.
  it('dit de valider l adresse sur un 400 qui parle de l expediteur', () => {
    const message = diagnosticBrevo(400, '{"message":"sender email is invalid"}', 'contact@sante.gn');
    expect(message).toContain('contact@sante.gn');
    expect(message).toMatch(/valide/i);
  });

  it('distingue la limite d envoi atteinte', () => {
    expect(diagnosticBrevo(429, '{}', 'contact@sante.gn')).toMatch(/limite/i);
  });

  it('rend le statut et le corps pour un refus inattendu', () => {
    const message = diagnosticBrevo(503, 'maintenance en cours', 'contact@sante.gn');
    expect(message).toContain('503');
    expect(message).toContain('maintenance en cours');
  });

  // Le message part dans les journaux, qui ne sont pas un coffre.
  it('ne laisse jamais filtrer la cle d API', () => {
    const cle = 'xkeysib-secret-a-ne-pas-journaliser';
    for (const statut of [400, 401, 429, 500]) {
      expect(diagnosticBrevo(statut, `refus avec ${cle}`, 'contact@sante.gn', cle)).not.toContain(
        cle,
      );
    }
  });
});

// Le domaine qui expedie n'a pas forcement d'enregistrement MX : une reponse
// envoyee a l'expediteur disparait alors sans rebond ni avertissement.
describe('courriel : adresse de reponse', () => {
  const DE: Expediteur = { nom: 'Lead Health', adresse: 'service@sante.gn' };
  const MESSAGE: Courriel = {
    destinataire: 'patient@exemple.gn',
    nomDestinataire: 'Awa Diallo',
    sujet: 'Votre code',
    html: '<p>123456</p>',
  };

  it('porte le Reply-To dans le corps envoye a Brevo', () => {
    expect(corpsBrevo(DE, MESSAGE, 'reponses@exemple.gn')).toMatchObject({
      replyTo: { email: 'reponses@exemple.gn' },
    });
  });

  it('porte le Reply-To dans le message nodemailer', () => {
    expect(messageNodemailer(DE, MESSAGE, 'reponses@exemple.gn')).toMatchObject({
      replyTo: 'reponses@exemple.gn',
    });
  });

  // Un Reply-To vide dans l'en-tete vaut moins que pas d'en-tete du tout :
  // certains clients l'affichent comme destinataire de la reponse.
  it.each([
    ['absente', undefined],
    ['vide', ''],
    ['faite d espaces', '   '],
  ])('n ajoute aucun Reply-To quand l adresse est %s', (_titre, valeur) => {
    expect(corpsBrevo(DE, MESSAGE, valeur)).not.toHaveProperty('replyTo');
    expect(messageNodemailer(DE, MESSAGE, valeur)).not.toHaveProperty('replyTo');
  });

  it("garde l'expediteur distinct de l'adresse de reponse", () => {
    const corps = corpsBrevo(DE, MESSAGE, 'reponses@exemple.gn');
    expect(corps.sender).toEqual({ name: 'Lead Health', email: 'service@sante.gn' });
    expect(corps.to).toEqual([{ email: 'patient@exemple.gn', name: 'Awa Diallo' }]);
  });
});

describe('courriel : options du relais SMTP', () => {
  it('prend le port 587 et STARTTLS par defaut', () => {
    const options = optionsSmtp({ SMTP_HOST: 'smtp-relay.brevo.com' });
    expect(options.port).toBe(587);
    expect(options.secure).toBe(false);
  });

  it('passe en TLS implicite sur le port 465', () => {
    expect(optionsSmtp({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: 465 }).secure).toBe(true);
  });

  it('n envoie pas d authentification quand aucun compte n est donne', () => {
    expect(optionsSmtp({ SMTP_HOST: 'smtp.interne' }).auth).toBeUndefined();
  });

  it('transmet le compte quand il est donne', () => {
    const options = optionsSmtp({
      SMTP_HOST: 'smtp-relay.brevo.com',
      SMTP_USER: 'compte',
      SMTP_PASSWORD: 'motdepasse',
    });
    expect(options.auth).toEqual({ user: 'compte', pass: 'motdepasse' });
  });
});

// Les tests ci-dessus jugent chaque decision isolement. Celui-ci juge le
// cablage : que la configuration arrive bien jusqu'au message envoye. Sans
// lui, remplacer `config.EMAIL_REPONSE` par `undefined` dans `envoyerCourriel`
// ne faisait tomber aucun test.
describe('courriel : du reglage au message envoye', () => {
  const IDENTITE = { nom: 'Lead Health', emailExpediteur: '' };
  let appels: jest.Mock;

  /** Le corps JSON confie a Brevo, relu depuis l'appel reseau simule. */
  const corpsEnvoye = () => JSON.parse((appels.mock.calls.at(-1)![1] as { body: string }).body);

  beforeEach(() => {
    for (const cle of Object.keys(env)) delete env[cle];
    getIdentitePlateforme.mockResolvedValue(IDENTITE);
    appels = jest.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    (globalThis as { fetch: unknown }).fetch = appels;
  });

  it('porte EMAIL_REPONSE jusque dans le message', async () => {
    env['BREVO_API_KEY'] = 'cle-de-test';
    env['EMAIL_EXPEDITEUR'] = 'service@sante.gn';
    env['EMAIL_REPONSE'] = 'reponses@exemple.gn';

    await envoyerCourriel({ destinataire: 'patient@exemple.gn', sujet: 'Code', html: '<p>1</p>' });

    expect(corpsEnvoye().replyTo).toEqual({ email: 'reponses@exemple.gn' });
  });

  it('n ajoute pas de Reply-To quand EMAIL_REPONSE n est pas posee', async () => {
    env['BREVO_API_KEY'] = 'cle-de-test';
    env['EMAIL_EXPEDITEUR'] = 'service@sante.gn';

    await envoyerCourriel({ destinataire: 'patient@exemple.gn', sujet: 'Code', html: '<p>1</p>' });

    expect(corpsEnvoye()).not.toHaveProperty('replyTo');
  });

  it("envoie la cle d'API dans l'en-tete attendu par Brevo", async () => {
    env['BREVO_API_KEY'] = 'cle-de-test';
    env['EMAIL_EXPEDITEUR'] = 'service@sante.gn';

    await envoyerCourriel({ destinataire: 'patient@exemple.gn', sujet: 'Code', html: '<p>1</p>' });

    const [url, options] = appels.mock.calls.at(-1)! as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers['api-key']).toBe('cle-de-test');
  });

  // Sans expediteur, reveler le code vaudrait mieux que rien pour l'appelant
  // naif : l'erreur doit etre explicite pour qu'il refuse la connexion.
  it('refuse clairement quand aucun transport n est configure', async () => {
    await expect(
      envoyerCourriel({ destinataire: 'patient@exemple.gn', sujet: 'Code', html: '<p>1</p>' }),
    ).rejects.toThrow(/BREVO_API_KEY/);
    expect(appels).not.toHaveBeenCalled();
  });

  it('refuse clairement quand aucune adresse d expedition n est connue', async () => {
    env['BREVO_API_KEY'] = 'cle-de-test';

    await expect(
      envoyerCourriel({ destinataire: 'patient@exemple.gn', sujet: 'Code', html: '<p>1</p>' }),
    ).rejects.toThrow(/adresse d'expedition/);
    expect(appels).not.toHaveBeenCalled();
  });

  it("remonte le refus de Brevo sans laisser filtrer la cle", async () => {
    env['BREVO_API_KEY'] = 'xkeysib-secrete';
    env['EMAIL_EXPEDITEUR'] = 'service@sante.gn';
    appels.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'sender email is invalid, cle xkeysib-secrete',
    });

    const envoi = envoyerCourriel({
      destinataire: 'patient@exemple.gn',
      sujet: 'Code',
      html: '<p>1</p>',
    });

    await expect(envoi).rejects.toThrow(/service@sante\.gn/);
    await expect(envoi).rejects.not.toThrow(/xkeysib-secrete/);
  });
});

describe('courriel : options Gmail', () => {
  // Gmail veut un mot de passe d'application, que son interface affiche par
  // groupes de quatre : le copier-coller ramene les espaces.
  it('retire les espaces du mot de passe d application', () => {
    const options = optionsGmail({ GMAIL_USER: 'moi@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });
    expect(options.auth.pass).toBe('abcdefghijklmnop');
  });

  it('refuse un mot de passe qui n a pas seize caracteres', () => {
    expect(() =>
      optionsGmail({ GMAIL_USER: 'moi@gmail.com', GMAIL_APP_PASSWORD: 'trop-court' }),
    ).toThrow(/16 caracteres/);
  });

  it('refuse une configuration incomplete', () => {
    expect(() => optionsGmail({ GMAIL_USER: 'moi@gmail.com' })).toThrow(/incomplete/i);
  });
});
