// src/services/courriel.service.ts
//
// Le seul endroit par ou sortent les courriels de la plateforme.
//
// Chaque message construisait auparavant son propre transporteur Gmail.
// Gmail n'est pas un expediteur de production : le quota est bas, le compte
// se verrouille au moindre doute, et le destinataire ne voit pas le nom de
// la plateforme. Le code OTP d'une connexion dependait de ce transporteur :
// sans lui, personne ne se connecte.
//
// Le transport est choisi selon ce qui est configure :
//   1. BREVO_API_KEY  -> API HTTP de Brevo, sur le port 443
//   2. SMTP_HOST      -> un relais SMTP quelconque
//   3. GMAIL_USER     -> Gmail, garde pour les postes de developpement
//   4. rien           -> erreur 503 qui nomme ce qui manque
//
// L'API HTTP passe avant le SMTP parce qu'un hebergeur ferme volontiers les
// ports 25, 465 et 587 en sortie pour lutter contre le pourriel, jamais le
// 443. Un envoi qui marche en developpement derriere un SMTP peut donc
// echouer une fois deploye ; par l'API, la question ne se pose pas.
import nodemailer from 'nodemailer';

import { env } from '../config/env';
import { AppError } from '../utils/app-error';
import { getIdentitePlateforme } from './parametres.service';

const URL_BREVO = 'https://api.brevo.com/v3/smtp/email';

// Un envoi bloque bloque la connexion de l'utilisateur qui attend son code.
const DELAI_MAX_MS = 15_000;

export type Courriel = {
  destinataire: string;
  nomDestinataire?: string;
  sujet: string;
  html: string;
};

export type Expediteur = { nom: string; adresse: string };

/** Ce que le choix du transport regarde, et rien d'autre. */
export type ConfigCourriel = {
  BREVO_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  GMAIL_USER?: string;
  GMAIL_APP_PASSWORD?: string;
  EMAIL_EXPEDITEUR?: string;
  EMAIL_REPONSE?: string;
};

export type Transport = 'brevo' | 'smtp' | 'gmail';

const vide = (v: string | undefined): boolean => !v || v.trim() === '';

/**
 * Le premier transport configure gagne. Rien de configure rend `null` : a
 * l'appelant de le dire clairement plutot que d'echouer sur un envoi.
 */
export function choisirTransport(config: ConfigCourriel): Transport | null {
  if (!vide(config.BREVO_API_KEY)) return 'brevo';
  if (!vide(config.SMTP_HOST)) return 'smtp';
  if (!vide(config.GMAIL_USER)) return 'gmail';
  return null;
}

/**
 * L'adresse d'expedition vient d'abord des reglages de la plateforme, que le
 * super admin peut changer sans redeployer ; la variable d'environnement sert
 * de reglage par defaut. Gmail ferme la marche : il impose d'expedier depuis
 * le compte authentifie, donc l'adresse y est imposee, pas choisie.
 */
export function adresseExpediteur(
  reglageEnBase: string | undefined,
  config: ConfigCourriel,
  transport: Transport,
): string | null {
  if (transport === 'gmail') return config.GMAIL_USER?.trim() || null;
  const candidats = [reglageEnBase, config.EMAIL_EXPEDITEUR, config.GMAIL_USER];
  for (const c of candidats) {
    if (!vide(c)) return c!.trim();
  }
  return null;
}

/**
 * Brevo repond en clair quand il refuse : le dire a l'exploitant plutot que
 * de lui laisser un « 400 Bad Request ».
 *
 * Le dernier cas recopie la reponse de Brevo, et ce message finit dans les
 * journaux : la cle d'API est masquee avant, car un corps renvoye par un
 * tiers n'est pas une chose dont on connait le contenu a l'avance.
 */
export function diagnosticBrevo(
  statut: number,
  corps: string,
  adresse: string,
  cle?: string,
): string {
  const sur = cle && cle.length > 0 ? corps.split(cle).join('***') : corps;

  if (statut === 401) {
    return "Brevo refuse la cle d'API. Verifiez BREVO_API_KEY, et qu'elle n'a pas ete revoquee.";
  }
  if (statut === 400 && /sender/i.test(sur)) {
    return `Brevo refuse l'adresse d'expedition ${adresse} : validez-la dans Brevo, rubrique des expediteurs, avant de l'utiliser.`;
  }
  if (statut === 429) {
    return "Brevo a atteint sa limite d'envoi. Reessayez plus tard, ou relevez le quota du compte.";
  }
  return `Brevo a refuse l'envoi (${statut}). ${sur.slice(0, 300)}`;
}

/** Nodemailer impose le TLS implicite sur 465, et STARTTLS ailleurs. */
export function optionsSmtp(config: ConfigCourriel) {
  const port = config.SMTP_PORT ?? 587;
  return {
    host: config.SMTP_HOST!.trim(),
    port,
    secure: port === 465,
    auth: vide(config.SMTP_USER)
      ? undefined
      : { user: config.SMTP_USER!.trim(), pass: config.SMTP_PASSWORD ?? '' },
  };
}

/**
 * Gmail veut un mot de passe d'application de 16 caracteres, pas celui du
 * compte. La confusion est si courante que le controle vaut un message.
 */
export function optionsGmail(config: ConfigCourriel) {
  const user = config.GMAIL_USER?.trim();
  const pass = config.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
  if (!user || !pass) {
    throw new AppError(
      'Configuration Gmail incomplete : GMAIL_USER ou GMAIL_APP_PASSWORD absent.',
      503,
    );
  }
  if (pass.length !== 16) {
    throw new AppError(
      "Configuration Gmail invalide : GMAIL_APP_PASSWORD doit etre le mot de passe d'application de 16 caracteres, pas le mot de passe du compte.",
      503,
    );
  }
  return { service: 'gmail' as const, auth: { user, pass } };
}

/**
 * Le corps que Brevo attend.
 *
 * `replyTo` compte autant que l'expediteur : le domaine qui expedie n'a pas
 * forcement de boite aux lettres, et une reponse partie vers une adresse qui
 * ne recoit rien disparait sans que personne ne le sache.
 */
export function corpsBrevo(de: Expediteur, c: Courriel, repondreA?: string) {
  return {
    sender: { name: de.nom, email: de.adresse },
    to: [{ email: c.destinataire, ...(c.nomDestinataire ? { name: c.nomDestinataire } : {}) }],
    subject: c.sujet,
    htmlContent: c.html,
    ...(vide(repondreA) ? {} : { replyTo: { email: repondreA!.trim() } }),
  };
}

/** Le meme message, pour nodemailer. */
export function messageNodemailer(de: Expediteur, c: Courriel, repondreA?: string) {
  return {
    from: `"${de.nom}" <${de.adresse}>`,
    to: c.destinataire,
    subject: c.sujet,
    html: c.html,
    ...(vide(repondreA) ? {} : { replyTo: repondreA!.trim() }),
  };
}

async function envoyerParBrevo(
  cle: string,
  de: Expediteur,
  c: Courriel,
  repondreA?: string,
): Promise<void> {
  let reponse: Response;
  try {
    reponse = await fetch(URL_BREVO, {
      method: 'POST',
      headers: {
        'api-key': cle,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(corpsBrevo(de, c, repondreA)),
      signal: AbortSignal.timeout(DELAI_MAX_MS),
    });
  } catch (erreur) {
    const cause = erreur instanceof Error ? erreur.message : String(erreur);
    throw new AppError(`Brevo injoignable : ${cause}`, 503);
  }

  if (reponse.ok) return;
  const corps = await reponse.text().catch(() => '');
  throw new AppError(diagnosticBrevo(reponse.status, corps, de.adresse, cle), 503);
}

async function envoyerParNodemailer(
  options: ReturnType<typeof optionsSmtp> | ReturnType<typeof optionsGmail>,
  de: Expediteur,
  c: Courriel,
  repondreA?: string,
): Promise<void> {
  await nodemailer.createTransport(options).sendMail(messageNodemailer(de, c, repondreA));
}

/**
 * Envoie un courriel. Leve une AppError 503 lisible si l'expedition est mal
 * configuree : l'appelant decide alors quoi faire — pour l'OTP, refuser la
 * connexion plutot que de reveler le code.
 */
export async function envoyerCourriel(c: Courriel): Promise<void> {
  const config = env as unknown as ConfigCourriel;
  const transport = choisirTransport(config);

  if (!transport) {
    throw new AppError(
      "Aucun expediteur de courriel configure : posez BREVO_API_KEY (recommande), ou SMTP_HOST, ou GMAIL_USER et GMAIL_APP_PASSWORD.",
      503,
    );
  }

  const identite = await getIdentitePlateforme();
  const adresse = adresseExpediteur(identite.emailExpediteur, config, transport);
  if (!adresse) {
    throw new AppError(
      "Aucune adresse d'expedition : renseignez-la dans les reglages de la plateforme, ou posez EMAIL_EXPEDITEUR.",
      503,
    );
  }

  const de: Expediteur = { nom: identite.nom, adresse };
  const repondreA = config.EMAIL_REPONSE;

  if (transport === 'brevo') {
    return envoyerParBrevo(config.BREVO_API_KEY!.trim(), de, c, repondreA);
  }
  if (transport === 'smtp') return envoyerParNodemailer(optionsSmtp(config), de, c, repondreA);
  return envoyerParNodemailer(optionsGmail(config), de, c, repondreA);
}
