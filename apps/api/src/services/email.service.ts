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
    // Le nom et l'etablissement viennent d'un formulaire public : un `<a>`
    // dans le prenom deviendrait un lien dans un courriel signe de nous.
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: `Demande reçue - ${dto.numero}`,
        salutation: `Votre demande est bien arrivée, ${echapperHtml(dto.prenomNom)}`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Nous avons reçu la demande de rattachement de <strong>${echapperHtml(dto.nomStructure)}</strong>
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
        salutation: `Bonjour ${echapperHtml(dto.prenomNom)},`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                La demande de rattachement de <strong>${echapperHtml(dto.nomStructure)}</strong>
                (dossier <strong>${dto.numero}</strong>) n'a pas été retenue en l'état.
              </p>

              ${blocMotif(dto.motif)}

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

/**
 * Le motif d'une action, tel que l'agent l'a ecrit.
 *
 * Echappe : il est saisi a la main, et une balise copiee depuis un autre
 * document ne doit pas devenir du HTML dans un courriel signe de nous.
 */
function blocMotif(motif: string): string {
    return `
              <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0 0 6px;color:#92400e;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motif</p>
                <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;white-space:pre-line;">${echapperHtml(motif)}</p>
              </div>`;
}

/**
 * Le dossier est en cours de verification, et voici pourquoi.
 *
 * **Le candidat n'a aucun compte : ce courriel est tout ce qu'il voit de
 * l'examen.** Sans lui, il ne sait ni que son dossier est lu, ni ce qu'on
 * attend de lui - une piece illisible, une reference a confirmer.
 */
export async function envoyerSuiviDemandeAgrement(dto: {
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
        titre: `Dossier ${dto.numero} en cours de vérification`,
        salutation: `Bonjour ${echapperHtml(dto.prenomNom)},`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                La demande de rattachement de <strong>${echapperHtml(dto.nomStructure)}</strong>
                (dossier <strong>${dto.numero}</strong>) est en cours de vérification.
              </p>

              ${blocMotif(dto.motif)}

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0;">
                Vous recevrez notre décision à cette même adresse. Rappelez le
                numéro ci-dessus dans tout échange au sujet de ce dossier.
              </p>`,
    });

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Dossier ${dto.numero} en cours de vérification`,
        html,
    });
}

/**
 * La demande est acceptee : le motif, et les identifiants du compte qui vient
 * de naitre.
 *
 * **Un seul courriel, et non deux.** L'acceptation et les identifiants
 * arrivant coup sur coup, le second ferait douter du premier. Le mot de passe
 * temporaire est a changer des la premiere connexion.
 *
 * Pour une compagnie d'assurance, le code retenu figure aussi : c'est celui
 * des cartes de ses assures, et l'administration a pu corriger celui que la
 * compagnie avait propose.
 */
export async function envoyerValidationDemandeAgrement(dto: {
    destinataire: string;
    prenomNom: string;
    nomStructure: string;
    numero: string;
    motif: string;
    telephone: string;
    motDePasseTemporaire: string;
    codeAssureur?: string | null;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const ligneCode = dto.codeAssureur
        ? `
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Code de la compagnie</span><br>
                    <strong style="color:#1e293b;font-size:16px;font-family:monospace;">${echapperHtml(dto.codeAssureur)}</strong>
                  </td>
                </tr>`
        : '';
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: `Dossier ${dto.numero} accepté`,
        salutation: `Bienvenue, ${echapperHtml(dto.prenomNom)} !`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                La demande de rattachement de <strong>${echapperHtml(dto.nomStructure)}</strong>
                (dossier <strong>${dto.numero}</strong>) est acceptée. Votre compte
                responsable est créé sur la plateforme ${nom}.
              </p>

              ${blocMotif(dto.motif)}

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 24px;">${ligneCode}
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Téléphone</span><br>
                    <strong style="color:#1e293b;font-size:16px;">${echapperHtml(dto.telephone)}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Mot de passe temporaire</span><br>
                    <strong style="color:#1B5E35;font-size:20px;font-family:monospace;letter-spacing:2px;">${dto.motDePasseTemporaire}</strong>
                  </td>
                </tr>
              </table>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Ce mot de passe est à changer dès votre première connexion.
              </p>

              <div style="text-align:center;margin:0 0 8px;">
                <a href="${lienConnexion()}"
                   style="background:#1B5E35;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
                  Se connecter à ${nom}
                </a>
              </div>`,
    });

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Dossier ${dto.numero} accepté - vos identifiants ${nom}`,
        html,
    });
}

// ── Les candidatures de motards livreurs ─────────────────────────
//
// **Tout ce qui vient du candidat est echappe.** Son nom arrive d'un
// formulaire public : insere tel quel, un `<a href>` dans le prenom
// deviendrait un lien dans un courriel signe de la plateforme.

function echapperHtml(texte: string): string {
    return texte
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** L'accuse de reception, avec le numero que le motard devra rappeler. */
export async function envoyerAccuseCandidatureLivreur(dto: {
    destinataire: string;
    prenomNom: string;
    numero: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: `Candidature reçue - ${dto.numero}`,
        salutation: `Votre candidature est bien arrivée, ${echapperHtml(dto.prenomNom)}`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Nous avons reçu votre candidature de livreur sur la plateforme ${nom},
                accompagnée de vos pièces.
              </p>

              <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px 20px;margin:0 0 24px;text-align:center;">
                <span style="color:#15803d;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Numéro de dossier</span><br>
                <strong style="color:#15803d;font-size:22px;font-family:monospace;letter-spacing:2px;">${dto.numero}</strong>
              </div>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0;">
                Votre dossier va être examiné. Si votre candidature est acceptée,
                vous recevrez vos identifiants de connexion à cette même adresse.
              </p>`,
    });

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Candidature reçue - dossier ${dto.numero}`,
        html,
    });
}

/** Les identifiants d'un livreur admis. Il se connecte avec son telephone. */
export async function envoyerIdentifiantsLivreur(dto: {
    destinataire: string;
    prenomNom: string;
    telephone: string;
    motDePasseTemporaire: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: `Vos identifiants ${nom}`,
        salutation: `Bienvenue, ${echapperHtml(dto.prenomNom)} !`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Votre candidature de livreur a été acceptée. Voici vos identifiants
                de connexion. <strong>Conservez-les précieusement.</strong>
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 24px;">
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #e2e8f0;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Téléphone</span><br>
                    <strong style="color:#1e293b;font-size:16px;">${echapperHtml(dto.telephone)}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Mot de passe temporaire</span><br>
                    <strong style="color:#1B5E35;font-size:20px;font-family:monospace;letter-spacing:2px;">${echapperHtml(dto.motDePasseTemporaire)}</strong>
                  </td>
                </tr>
              </table>

              <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6;">
                  <strong>Important :</strong> lors de votre première connexion, vous devrez changer ce mot de passe temporaire.
                </p>
              </div>

              <div style="text-align:center;margin:0;">
                <a href="${lienConnexion()}"
                   style="background:#1B5E35;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
                  Se connecter à ${nom}
                </a>
              </div>`,
    });

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Votre compte livreur ${nom}`,
        html,
    });
}

/** Le refus d'une candidature, avec son motif. */
export async function envoyerRefusCandidatureLivreur(dto: {
    destinataire: string;
    prenomNom: string;
    numero: string;
    motif: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: `Décision sur le dossier ${dto.numero}`,
        salutation: `Bonjour ${echapperHtml(dto.prenomNom)},`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">
                Votre candidature de livreur (dossier <strong>${dto.numero}</strong>)
                n'a pas été retenue en l'état.
              </p>

              <div style="background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:8px;padding:14px 18px;margin:0 0 24px;">
                <p style="margin:0 0 6px;color:#92400e;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Motif</p>
                <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">${echapperHtml(dto.motif)}</p>
              </div>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0;">
                Vous pouvez déposer une nouvelle candidature une fois ce point corrigé.
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

// ── L'acces d'un medecin a l'historique du patient ──────────────────
/**
 * Le medecin d'un rendez-vous demande a lire l'historique du patient.
 *
 * **Le courriel propose, il ne decide pas** : le lien mene a la page ou le
 * patient accepte ou refuse, une fois connecte. Aucun bouton du courriel
 * n'accorde quoi que ce soit, sans quoi un courriel transfere suffirait a
 * ouvrir un dossier.
 *
 * Ni structure ni motif : un courriel peut etre lu par d'autres que le patient.
 */
export async function envoyerDemandeAccesDossier(dto: {
    destinataire: string;
    prenomNom: string;
    medecin: string;
    quand: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const lien = `${env.FRONTEND_URL.replace(/\/+$/, '')}/patient/acces-dossier`;
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: "Un médecin demande l'accès à votre dossier",
        salutation: `Bonjour ${echapperHtml(dto.prenomNom)},`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 16px;">
                Vous avez rendez-vous le <strong>${echapperHtml(dto.quand)}</strong>
                avec <strong>${echapperHtml(dto.medecin)}</strong>.
              </p>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 16px;">
                Pour mieux vous soigner, ce médecin demande à consulter votre
                historique : consultations passées, résultats d'examens,
                vaccinations. Sans votre accord, il ne voit que la visite en cours.
              </p>

              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
                L'accès dure jusqu'à la fin de votre prise en charge, plus trente
                jours. Vous pouvez le retirer à tout moment.
              </p>

              <div style="text-align:center;margin:0 0 8px;">
                <a href="${lien}"
                   style="background:#1B5E35;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
                  Répondre à la demande
                </a>
              </div>`,
    });

    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Un médecin demande l'accès à votre dossier ${nom}`,
        html,
    });
}

/**
 * Le mot de passe d'un agent vient d'etre reinitialise par l'administrateur
 * de sa structure. Temporaire : a changer des la connexion.
 */
export async function envoyerReinitialisationAgent(dto: {
    destinataire: string;
    prenomNom: string;
    nomStructure: string;
    motDePasseTemporaire: string;
}): Promise<void> {
    const identite = await getIdentitePlateforme();
    const nom = identite.nom;
    const html = gabaritAgrement({
        nom,
        slogan: identite.slogan,
        titre: 'Votre mot de passe a été réinitialisé',
        salutation: `Bonjour ${echapperHtml(dto.prenomNom)},`,
        corps: `
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 16px;">
                L'administrateur de <strong>${echapperHtml(dto.nomStructure)}</strong> a réinitialisé
                votre mot de passe. Voici votre mot de passe temporaire :
              </p>
              <p style="font-family:monospace;font-size:20px;font-weight:700;letter-spacing:1px;text-align:center;margin:0 0 16px;">
                ${echapperHtml(dto.motDePasseTemporaire)}
              </p>
              <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Il est à changer dès votre prochaine connexion. Si vous n'êtes pas à
                l'origine de cette demande, prévenez votre administrateur.
              </p>
              <div style="text-align:center;margin:0 0 8px;">
                <a href="${lienConnexion()}"
                   style="background:#1B5E35;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;display:inline-block;">
                  Se connecter
                </a>
              </div>`,
    });
    await envoyerCourriel({
        destinataire: dto.destinataire,
        nomDestinataire: dto.prenomNom,
        sujet: `Votre mot de passe ${nom} a été réinitialisé`,
        html,
    });
}

