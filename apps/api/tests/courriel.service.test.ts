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
  diagnosticBrevo,
  optionsGmail,
  optionsSmtp,
  type ConfigCourriel,
} from '../src/services/courriel.service';

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
