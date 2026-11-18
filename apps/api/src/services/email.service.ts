// src/services/email.service.ts
//
// Le contenu des courriels de la plateforme, et rien d'autre. L'expedition
// est dans `courriel.service.ts`, qui choisit le transport selon ce qui est
// configure : ce fichier ne sait plus par ou le message part, et n'a plus a
// changer quand l'expediteur change.
import { env } from '../config/env';

import { envoyerCourriel } from './courriel.service';
import { getIdentitePlateforme } from './parametres.service';

/** Le lien de connexion depend du deploiement, jamais code en dur. */
const lienConnexion = () => `${env.FRONTEND_URL.replace(/\/+$/, '')}/auth/login`;

export async function envoyerOtpConnexion(dto: {
    destinataire: string;
    prenomNom: string;
    code: string;
    expireDansMinutes: number;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#1B5E35;color:#ffffff;padding:24px;text-align:center;">
              <h1 style="margin:0;font-size:22px;">${nom}</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#d1fae5;">Verification de connexion</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <p style="font-size:15px;color:#334155;margin:0 0 16px;">Bonjour ${dto.prenomNom},</p>
              <p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 20px;">
                Utilisez le code ci-dessous pour finaliser votre connexion a ${nom}.
              </p>
              <div style="text-align:center;margin:24px 0;">
                <span style="display:inline-block;background:#f0fdf4;border:1px solid #86efac;color:#14532d;font-size:34px;font-weight:800;letter-spacing:8px;padding:16px 24px;border-radius:8px;font-family:Consolas,monospace;">
                  ${dto.code}
                </span>
              </div>
              <p style="font-size:14px;color:#64748b;line-height:1.6;margin:0;">
                Ce code expire dans ${dto.expireDansMinutes} minutes. Si vous n'avez pas demande cette connexion, ignorez cet email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Code de verification ${nom}: ${dto.code}`,
        html,
    });
}

// ── Email de réinitialisation de mot de passe ────────────────────
export async function envoyerEmailResetMotDePasse(dto: {
    destinataire: string;
    prenomNom: string;
    lienReset: string;
    expireDansMinutes: number;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:linear-gradient(135deg,#0B2618 0%,#1B5E35 100%);color:#ffffff;padding:28px;text-align:center;">
              <h1 style="margin:0;font-size:22px;">${nom}</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#d1fae5;">Réinitialisation de mot de passe</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <p style="font-size:15px;color:#334155;margin:0 0 16px;">Bonjour ${dto.prenomNom},</p>
              <p style="font-size:15px;color:#334155;line-height:1.6;margin:0 0 24px;">
                Vous avez demandé la réinitialisation de votre mot de passe ${nom}.
                Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
              </p>
              <div style="text-align:center;margin:28px 0;">
                <a href="${dto.lienReset}"
                   style="display:inline-block;background:#1B5E35;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;">
                  Réinitialiser mon mot de passe
                </a>
              </div>
              <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0 0 16px;">
                Ce lien expire dans <strong>${dto.expireDansMinutes} minutes</strong>.
                Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe restera inchangé.
              </p>
              <p style="font-size:12px;color:#94a3b8;margin:0;word-break:break-all;">
                Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
                ${dto.lienReset}
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">${identite.copyright}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        // Le sujet etait entre guillemets simples : les destinataires
        // recevaient « ${nom} » en toutes lettres dans l'objet du message.
        sujet: `Reinitialisation de votre mot de passe ${nom}`,
        html,
    });
}

// ── Email de bienvenue pour un admin de structure ─────────────────
export async function envoyerEmailAdminStructure(dto: {
    destinataire: string;
    prenomNom: string;
    nomStructure: string;
    telephone: string;
    motDePasseTemporaire: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vos identifiants ${nom}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0B2618 0%,#1B5E35 100%);padding:40px 40px 30px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px;">${nom}</h1>
              <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${identite.slogan}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#1B5E35;font-size:20px;margin:0 0 16px;font-weight:700;">Bienvenue, ${dto.prenomNom} !</h2>
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Votre compte <strong>Administrateur de structure</strong> a été créé sur la plateforme ${nom}.
                Vous êtes désormais responsable de la structure suivante :
              </p>

              <!-- Structure -->
              <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
                <p style="margin:0;color:#15803d;font-size:14px;font-weight:600;">🏥 ${dto.nomStructure}</p>
              </div>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Voici vos identifiants de connexion. <strong>Conservez-les précieusement.</strong>
              </p>

              <!-- Identifiants -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Téléphone</span><br>
                    <strong style="color:#1e293b;font-size:16px;">${dto.telephone}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Mot de passe temporaire</span><br>
                    <strong style="color:#1B5E35;font-size:20px;font-family:monospace;letter-spacing:2px;">${dto.motDePasseTemporaire}</strong>
                  </td>
                </tr>
              </table>

              <!-- Alerte -->
              <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
                  ⚠️ <strong>Important :</strong> Lors de votre première connexion, vous serez invité à changer ce mot de passe temporaire.
                </p>
              </div>

              <!-- CTA -->
              <div style="text-align:center;margin:0 0 32px;">
                <a href="${lienConnexion()}"
                   style="background:#1B5E35;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
                  Se connecter à ${nom}
                </a>
              </div>

              <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0;">
                Si vous n'êtes pas à l'origine de cette demande ou si vous rencontrez des difficultés,
                contactez l'administrateur de la plateforme.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                ${identite.copyright}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Vos identifiants ${nom} - ${dto.nomStructure}`,
        html,
    });
}

// ── Courriels d'une demande d'agrément ───────────────────────────
/**
 * L'ossature commune aux courriels d'agrement : en-tete, corps, pied.
 *
 * Elle existe parce que les deux courriels qui suivent ne different que par
 * trois phrases. Les ecrire deux fois en entier aurait garanti qu'ils
 * divergent au premier changement de couleur.
 */
function gabaritAgrement(dto: {
    nom: string;
    slogan: string;
    titre: string;
    salutation: string;
    corps: string;
}): string {
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${dto.titre}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0B2618 0%,#1B5E35 100%);padding:40px 40px 30px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:800;letter-spacing:-0.5px;">${dto.nom}</h1>
              <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${dto.slogan}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#1B5E35;font-size:20px;margin:0 0 16px;font-weight:700;">${dto.salutation}</h2>
              ${dto.corps}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
                Ce message vous est adressé automatiquement par ${dto.nom}.<br>
                Vous pouvez y répondre : votre réponse nous parviendra.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * L'accusé de réception d'une demande d'agrément.
 *
 * **Le numéro de dossier est la seule chose utile de ce courriel.** Le
 * candidat n'a aucun compte sur la plateforme et ne peut donc rien y suivre :
 * ce numéro est tout ce qu'il possède pour se faire reconnaître quand il
 * rappellera. Un accusé qui ne le porterait pas ne servirait à rien.
 *
 * Aucune promesse de délai : l'examen dépend de l'administration, pas de nous.
 */
export async function envoyerAccuseDemandeAgrement(dto: {
    destinataire: string;
    prenomNom: string;
    nomStructure: string;
    numero: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: `Demande reçue - ${dto.numero}`,
        salutation: `Votre demande est bien arrivée, ${dto.prenomNom}`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Nous avons reçu la demande de rattachement de <strong>${dto.nomStructure}</strong>
                à la plateforme ${nom}, accompagnée de ses pièces justificatives.
              </p>

              <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px 20px;margin:0 0 24px;text-align:center;">
                <span style="color:#15803d;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Numéro de dossier</span><br>
                <strong style="color:#15803d;font-size:22px;font-family:monospace;letter-spacing:2px;">${dto.numero}</strong>
              </div>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Conservez ce numéro : c'est la référence de votre dossier, à rappeler
                dans tout échange à son sujet.
              </p>
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0;">
                Votre dossier va être examiné. Vous recevrez notre décision à cette
                même adresse. Si votre demande est acceptée, ce courriel sera suivi de
                vos identifiants de connexion.
              </p>`,
    });

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Demande reçue - dossier ${dto.numero}`,
        html,
    });
}

/**
 * Le refus d'une demande, avec son motif.
 *
 * **Le motif n'est pas une politesse : sans lui, le candidat redépose un
 * dossier identique**, et personne n'y gagne. Il est obligatoire côté API
 * pour cette raison.
 *
 * Il n'y a pas de courriel d'acceptation ici : une demande acceptée fait
 * naître un compte, et `envoyerEmailAdminStructure` annonce déjà cette
 * naissance avec les identifiants. Deux courriels coup sur coup diraient deux
 * fois la même chose.
 */
export async function envoyerRefusDemandeAgrement(dto: {
    destinataire: string;
    prenomNom: string;
    nomStructure: string;
    numero: string;
    motif: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: `Décision sur le dossier ${dto.numero}`,
        salutation: `Bonjour ${dto.prenomNom},`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                La demande de rattachement de <strong>${dto.nomStructure}</strong>
                (dossier <strong>${dto.numero}</strong>) n'a pas été retenue en l'état.
              </p>

              <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0 0 6px;color:#92400e;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motif</p>
                <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">${dto.motif}</p>
              </div>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0;">
                Vous pouvez déposer une nouvelle demande une fois ce point corrigé.
                Rappelez le numéro ci-dessus si vous souhaitez des précisions.
              </p>`,
    });

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Décision sur votre dossier ${dto.numero}`,
        html,
    });
}

// ── Email de bienvenue pour un agent (ASC, Médecin, Pharmacien) ───
export async function envoyerEmailAgent(dto: {
    destinataire: string;
    prenomNom: string;
    role: string;
    nomStructure: string;
    telephone: string;
    motDePasseTemporaire: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const roleLabel: Record<string, string> = {
        'ASC': 'Agent de Santé Communautaire',
        'ASC_SUPERVISOR': 'Superviseur ASC',
        'AGENT_ACCUEIL': "Agent d'accueil",
        'MEDECIN': 'Médecin',
        'PHARMACIEN': 'Pharmacien'
    };

    const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0B2618 0%,#1B5E35 100%);padding:40px 40px 30px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:800;">${nom}</h1>
              <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${identite.slogan}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="color:#1B5E35;font-size:20px;margin:0 0 16px;font-weight:700;">Bienvenue, ${dto.prenomNom} !</h2>
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Votre compte <strong>${roleLabel[dto.role] ?? dto.role}</strong> a été créé sur ${nom}
                pour la structure <strong>${dto.nomStructure}</strong>.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Téléphone</span><br>
                    <strong style="color:#1e293b;font-size:16px;">${dto.telephone}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;">Mot de passe temporaire</span><br>
                    <strong style="color:#1B5E35;font-size:20px;font-family:monospace;letter-spacing:2px;">${dto.motDePasseTemporaire}</strong>
                  </td>
                </tr>
              </table>
              <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0;color:#92400e;font-size:13px;">⚠️ <strong>Changez ce mot de passe</strong> lors de votre première connexion.</p>
              </div>
              <div style="text-align:center;margin:0 0 24px;">
                <a href="${lienConnexion()}" style="background:#1B5E35;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
                  Se connecter
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">${identite.copyright}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Vos identifiants ${nom} - ${dto.nomStructure}`,
        html,
    });
}
