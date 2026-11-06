import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { NotFoundError, ValidationError } from '../utils/app-error';
import { echapper } from './hopital.service';
import { getIdentitePlateforme } from './parametres.service';

/** Le mode lisible par le patient, pas le code de l'enumeration. */
const LIBELLE_MODE: Record<string, string> = {
  ESPECES: 'Esp&egrave;ces',
  ORANGE_MONEY: 'Orange Money',
  MTN_MOMO: 'MTN Mobile Money',
};

const date = (v: Date) =>
  v.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateHeure = (v: Date) =>
  date(v) + ' &agrave; ' + v.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export async function documentRecu(user: JwtPayload, idFacture: string): Promise<string> {
  const patient = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: user.userId },
    select: { id: true },
  });
  if (!patient) throw new NotFoundError('Patient non trouve');

  const facture = await prisma.facture.findUnique({
    where: { id: idFacture },
    include: {
      patient: {
        select: {
          id: true,
          qrCode: true,
          utilisateur: { select: { prenom: true, nom: true, telephone: true } },
        },
      },
      consultation: { select: { consulteeLE: true, motifPrincipal: true } },
    },
  });
  if (!facture || facture.patient.id !== patient.id) throw new NotFoundError('Facture non trouvee');
  if (facture.statut !== 'PAYEE') {
    throw new ValidationError("Cette facture n'est pas payee : aucun recu ne peut etre emis");
  }

  const identite = await getIdentitePlateforme();
  const coordonnees = [identite.telephone, identite.emailContact].filter(Boolean).map(echapper).join(' &middot; ');
  const montant = new Intl.NumberFormat('fr-FR').format(facture.montantGnf);
  const p = facture.patient;
  const c = facture.consultation;

  const styles = [
    '@page{size:A4;margin:14mm}',
    'body{font-family:Arial,sans-serif;color:#0d2b1a;margin:0;background:white}',
    'header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2D7D46;padding-bottom:12px;margin-bottom:20px}',
    'h1{margin:0;font-size:20px;color:#2D7D46}',
    'h2{font-size:14px;margin:18px 0 6px;color:#1A5C35;text-transform:uppercase;letter-spacing:.05em}',
    'p{margin:4px 0;line-height:1.45}',
    '.meta{font-size:12px;color:#3a5848}',
    'table{width:100%;border-collapse:collapse;margin-top:6px}',
    'th,td{border:1px solid #DDE8E2;padding:6px 9px;text-align:left;vertical-align:top}',
    'th{background:#F3F7F5;font-size:11.5px}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}.grid div{padding:3px 0}',
    '.montant{margin:22px 0;padding:14px;border:1px solid #DDE8E2;background:#F3F7F5;font-size:22px;color:#1A5C35}',
    '.mention{margin-top:22px;font-size:12px;color:#3a5848}',
    'footer{margin-top:28px;padding-top:10px;border-top:1px solid #DDE8E2;font-size:11px;color:#7a9485;display:flex;justify-content:space-between}',
    '@media print{body{margin:14mm}}',
  ].join('');

  return [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Re&ccedil;u de paiement</title>',
    '<style>', styles, '</style></head><body>',
    '<header><div>',
    identite.logoUrl ? '<img src="' + echapper(identite.logoUrl) + '" alt="" style="height:40px;margin-bottom:6px"><br>' : '',
    '<h1>', echapper(identite.nom), '</h1><div class="meta">Re&ccedil;u de paiement</div></div>',
    '<div style="text-align:right"><div class="meta">Re&ccedil;u N&deg; <strong>', echapper(facture.id), '</strong></div>',
    '<div class="meta">Pay&eacute; le <strong>', facture.payeeLe ? dateHeure(facture.payeeLe) : '&mdash;', '</strong></div></div></header>',
    '<h2>Patient</h2><div class="grid">',
    '<div><strong>', echapper(p.utilisateur.prenom), ' ', echapper(p.utilisateur.nom), '</strong></div>',
    '<div>T&eacute;l&eacute;phone : ', echapper(p.utilisateur.telephone), '</div>',
    '<div>Identifiant : ', echapper(p.qrCode), '</div></div>',
    '<h2>Consultation concern&eacute;e</h2>',
    c ? '<p><strong>' + date(c.consulteeLE) + '</strong> &mdash; ' + echapper(c.motifPrincipal) + '</p>'
      : '<p>&mdash;</p>',
    '<div class="montant"><strong>', montant, ' GNF</strong></div>',
    '<table><tbody>',
    '<tr><th>Mode de paiement</th><td>', facture.modePaiement ? (LIBELLE_MODE[facture.modePaiement] ?? echapper(facture.modePaiement)) : '&mdash;', '</td></tr>',
    '<tr><th>R&eacute;f&eacute;rence de l\'op&eacute;rateur</th><td>', facture.referenceOperateur ? echapper(facture.referenceOperateur) : '&mdash;', '</td></tr>',
    '</tbody></table>',
    '<p class="mention">Ce re&ccedil;u atteste du paiement. Il ne remplace pas une facture d&eacute;taill&eacute;e.</p>',
    '<footer><span>', echapper(identite.copyright), '</span><span>', coordonnees, '</span></footer>',
    '</body></html>',
  ].join('');
}
