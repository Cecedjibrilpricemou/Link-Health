// src/services/ordonnance-vue.service.ts
// Lecture et impression d'une ordonnance (EF-05-07/08, EF-06-02).
//
// Separe de ordonnance.service.ts, qui porte les regles d'ecriture
// (numerotation, signature, statuts) : ici on ne fait que restituer.
//
// Le code de verification n'apparait que dans ces vues-la — celles du patient
// et de son prescripteur. Il n'est jamais rendu dans une liste destinee a un
// tiers : c'est le secret que le patient presente au comptoir.
import { Prisma } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { NotFoundError } from '../utils/app-error';
import { assertCanAccessConsultation } from './access-control.service';
import { echapper } from './hopital.service';
import { estExpiree, renouvellementsRestants } from './ordonnance.service';
import { identiteDocument, structureDeConsultation } from './document-emetteur.service';
import type { OrdonnanceView } from '@baobaoheath/shared-types';

const ORDONNANCE_INCLUDE = {
  lignes: { include: { medicament: true }, orderBy: { creeLe: 'asc' } },
  signataire: { select: { prenom: true, nom: true } },
  consultation: {
    include: {
      asc: { include: { utilisateur: { select: { prenom: true, nom: true } } } },
      patient: {
        include: { utilisateur: { select: { prenom: true, nom: true, telephone: true } } },
      },
    },
  },
} as const;

type OrdonnanceChargee = Prisma.OrdonnanceGetPayload<{ include: typeof ORDONNANCE_INCLUDE }>;

function versVue(o: OrdonnanceChargee): OrdonnanceView {
  // A defaut de signataire, l'agent qui a mene la consultation : c'est lui que
  // le patient reconnaitra sur le papier.
  const signataire = o.signataire ?? o.consultation.asc?.utilisateur ?? null;

  return {
    id: o.id,
    numero: o.numero,
    statut: o.statut,
    codeVerification: o.codeVerification,
    valideJusquau: o.valideJusquau.toISOString(),
    expiree: estExpiree(o),
    signeLe: o.signeLe ? o.signeLe.toISOString() : null,
    signataire: signataire ? { prenom: signataire.prenom, nom: signataire.nom } : null,
    creeLe: o.creeLe.toISOString(),
    renouvellementsAutorises: o.renouvellementsAutorises,
    renouvellementsUtilises: o.renouvellementsUtilises,
    renouvellementsRestants: renouvellementsRestants(o),
    contientProduitReglemente: o.lignes.some((l) => l.medicament.estReglemente),
    lignes: o.lignes.map((l) => ({
      id: l.id,
      statut: l.statut,
      posologie: l.posologie,
      frequence: l.frequence,
      dureeJours: l.dureeJours,
      quantite: l.quantite,
      instructions: l.instructions,
      medicament: l.medicament,
    })),
  };
}

/** Une ordonnance, vue par le patient ou par son prescripteur. */
export async function getOrdonnance(user: JwtPayload, idOrdonnance: string): Promise<OrdonnanceView> {
  const ordonnance = await prisma.ordonnance.findUnique({
    where: { id: idOrdonnance },
    include: ORDONNANCE_INCLUDE,
  });
  if (!ordonnance) throw new NotFoundError('Ordonnance non trouvee');

  // L'habilitation se juge sur la consultation : c'est elle qui porte le
  // patient, l'ASC et la structure.
  await assertCanAccessConsultation(user, ordonnance.idConsultation);

  return versVue(ordonnance);
}

/** Les ordonnances du patient connecte, la plus recente d'abord. */
export async function getOrdonnancesPatient(user: JwtPayload): Promise<OrdonnanceView[]> {
  const patient = await prisma.patientProfile.findUnique({
    where: { idUtilisateur: user.userId },
    select: { id: true },
  });
  if (!patient) throw new NotFoundError('Profil patient non trouve');

  const ordonnances = await prisma.ordonnance.findMany({
    where: { consultation: { idPatient: patient.id } },
    include: ORDONNANCE_INCLUDE,
    orderBy: { creeLe: 'desc' },
    take: 50,
  });

  return ordonnances.map(versVue);
}

/**
 * Ordonnance imprimable. Le couple numero + code y figure en clair et encadre :
 * c'est ce que le pharmacien saisit pour controler le papier. Une ordonnance
 * non signee ou expiree porte un filigrane, comme le compte rendu de
 * laboratoire non valide — rien ne doit laisser croire qu'elle est opposable.
 */
export async function documentOrdonnance(user: JwtPayload, idOrdonnance: string): Promise<string> {
  const ordonnance = await prisma.ordonnance.findUnique({
    where: { id: idOrdonnance },
    include: ORDONNANCE_INCLUDE,
  });
  if (!ordonnance) throw new NotFoundError('Ordonnance non trouvee');
  await assertCanAccessConsultation(user, ordonnance.idConsultation);

  const o = versVue(ordonnance);
  // L'en-tete : la structure ou l'ordonnance a ete redigee.
  const identite = await identiteDocument(await structureDeConsultation(ordonnance.idConsultation));
  const p = ordonnance.consultation.patient;

  const date = (v: string | Date) =>
    new Date(v).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const lignes = o.lignes
    .map(
      (l) =>
        '<tr><td><strong>' +
        echapper(l.medicament?.nomCommercial ?? l.medicament?.dci) +
        '</strong><br><span class="meta">' +
        echapper(l.medicament?.dci) + ' &mdash; ' +
        echapper(l.medicament?.forme) + ' ' + echapper(l.medicament?.dosage) +
        '</span></td><td>' + echapper(l.posologie) +
        '</td><td>' + echapper(l.frequence) +
        '</td><td>' + l.dureeJours + ' j</td><td>' + (l.quantite ?? 1) +
        '</td><td>' + echapper(l.instructions) + '</td></tr>'
    )
    .join('');

  const allergies = p.allergies.filter(Boolean);
  const coordonnees = [identite.telephone, identite.emailContact].filter(Boolean).map(echapper).join(' &middot; ');

  const styles = [
    'body{font-family:Arial,sans-serif;color:#0d2b1a;margin:32px;font-size:13px;position:relative}',
    'header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2D7D46;padding-bottom:12px;margin-bottom:20px}',
    'h1{margin:0;font-size:20px;color:#2D7D46}',
    'h2{font-size:14px;margin:18px 0 6px;color:#1A5C35;text-transform:uppercase;letter-spacing:.05em}',
    '.meta{font-size:12px;color:#3a5848}',
    'table{width:100%;border-collapse:collapse;margin-top:6px}',
    'th,td{border:1px solid #DDE8E2;padding:7px 9px;text-align:left;vertical-align:top}',
    'th{background:#F3F7F5;font-size:11.5px}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}.grid div{padding:3px 0}',
    '.controle{margin-top:18px;border:2px dashed #2D7D46;border-radius:8px;padding:12px 16px;display:flex;gap:32px;align-items:center;background:#F7FBF9}',
    '.controle .bloc{display:flex;flex-direction:column}',
    '.controle .lab{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:#3a5848}',
    '.controle .val{font-family:"Courier New",monospace;font-size:22px;font-weight:700;letter-spacing:.14em;color:#12351f}',
    '.controle .aide{font-size:11px;color:#3a5848;flex:1}',
    '.alerte{margin-top:14px;padding:9px 12px;border-radius:6px;background:#FEF2F2;color:#B91C1C;font-size:12px;font-weight:600}',
    '.filigrane{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:58px;color:rgba(185,28,28,.12);transform:rotate(-18deg);pointer-events:none;font-weight:800}',
    '.sign{margin-top:36px;display:flex;justify-content:flex-end}',
    '.sign div{width:240px;border-top:1px solid #0d2b1a;padding-top:6px;text-align:center}',
    'footer{margin-top:28px;padding-top:10px;border-top:1px solid #DDE8E2;font-size:11px;color:#7a9485;display:flex;justify-content:space-between}',
    '@media print{body{margin:14mm}}',
  ].join('');

  return [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Ordonnance ',
    echapper(o.numero),
    '</title><style>', styles, '</style></head><body>',
    o.signeLe ? '' : '<div class="filigrane">NON SIGNEE</div>',
    o.expiree ? '<div class="filigrane">EXPIREE</div>' : '',
    '<header><div>',
    identite.logoUrl ? '<img src="' + echapper(identite.logoUrl) + '" alt="" style="height:40px;margin-bottom:6px"><br>' : '',
    '<h1>', echapper(identite.nom), '</h1><div class="meta">Ordonnance medicale</div></div>',
    '<div style="text-align:right"><div class="meta">N&deg; <strong>', echapper(o.numero), '</strong></div>',
    '<div class="meta">Emise le ', date(o.creeLe), '</div>',
    '<div class="meta">Valable jusqu\'au <strong>', date(o.valideJusquau), '</strong></div></div></header>',
    '<h2>Patient</h2><div class="grid">',
    '<div><strong>', echapper(p.utilisateur.prenom), ' ', echapper(p.utilisateur.nom), '</strong></div>',
    '<div>N&eacute;(e) le ', date(p.dateNaissance), ' &middot; ', echapper(p.sexe), '</div>',
    '<div>T&eacute;l&eacute;phone : ', echapper(p.utilisateur.telephone), '</div>',
    '<div>Identifiant : ', echapper(p.qrCode), '</div></div>',
    allergies.length ? '<div class="alerte">Allergies connues : ' + allergies.map(echapper).join(', ') + '</div>' : '',
    '<h2>Prescription</h2><table><thead><tr><th>M&eacute;dicament</th><th>Posologie</th><th>Fr&eacute;quence</th><th>Dur&eacute;e</th><th>Qt&eacute;</th><th>Instructions</th></tr></thead><tbody>',
    lignes,
    '</tbody></table>',
    '<div class="controle">',
    '<div class="bloc"><span class="lab">Num&eacute;ro</span><span class="val">', echapper(o.numero), '</span></div>',
    '<div class="bloc"><span class="lab">Code de v&eacute;rification</span><span class="val">', echapper(o.codeVerification), '</span></div>',
    '<div class="aide">Le pharmacien saisit ce couple pour v&eacute;rifier l\'ordonnance. Ne le communiquez qu\'au comptoir.</div>',
    '</div>',
    '<h2>Prescripteur</h2><div class="grid"><div>',
    o.signataire ? echapper(o.signataire.prenom) + ' ' + echapper(o.signataire.nom) : '&mdash;',
    '</div><div>',
    o.signeLe ? 'Sign&eacute;e le ' + date(o.signeLe) : 'Non sign&eacute;e',
    '</div></div>',
    '<div class="sign"><div>Cachet et signature</div></div>',
    '<footer><span>', echapper(identite.copyright), '</span><span>', coordonnees, '</span></footer>',
    '</body></html>',
  ].join('');
}
