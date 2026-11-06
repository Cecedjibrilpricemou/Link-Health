// src/services/consultation-document.service.ts
// Compte rendu de consultation imprimable (EF-05-03, EF-06-02).
//
// Meme facture que l'ordonnance, le bon d'examen et le compte rendu de
// laboratoire : un HTML rendu par l'API, que le navigateur imprime.
//
// **Ce qui y figure** : ce qu'un autre soignant doit savoir pour reprendre le
// patient — motif, constantes, diagnostics, observations, conclusion du
// medecin, prescriptions, orientation — et qui en repond.
//
// **Ce qui n'y figure pas** :
//   - le resume et l'indice de confiance de l'IA : une aide a la decision,
//     pas l'avis du soignant ; le papier ne doit pas les confondre ;
//   - le code de verification des ordonnances : c'est le secret que le
//     patient presente au comptoir, il a son propre document.
//
// **Un compte rendu non signe porte un filigrane.** Tant qu'un medecin n'a
// pas valide la consultation, rien ne doit laisser croire qu'il engage
// quelqu'un.
import { Prisma } from '../config/generated/client/client';
import { prisma } from '../config/prisma';
import { JwtPayload } from '../types/auth.types';
import { NotFoundError } from '../utils/app-error';
import { assertCanAccessConsultation } from './access-control.service';
import { echapper } from './hopital.service';
import { getIdentitePlateforme } from './parametres.service';

const CONSULTATION_DOCUMENT_INCLUDE = {
  patient: {
    select: {
      dateNaissance: true, sexe: true, allergies: true, qrCode: true,
      utilisateur: { select: { prenom: true, nom: true, telephone: true } },
    },
  },
  asc: { select: { utilisateur: { select: { prenom: true, nom: true } } } },
  medecinValideur: { select: { prenom: true, nom: true } },
  constantes: true,
  diagnostics: { orderBy: { creeLe: 'asc' } },
  ordonnances: {
    orderBy: { creeLe: 'asc' },
    select: {
      numero: true, signeLe: true, creeLe: true,
      lignes: {
        orderBy: { creeLe: 'asc' },
        select: {
          posologie: true, frequence: true, dureeJours: true, quantite: true,
          medicament: { select: { nomCommercial: true, dci: true, dosage: true, forme: true } },
        },
      },
    },
  },
  referencement: { include: { structureCible: { select: { nom: true } } } },
} as const;

type ConsultationDocument = Prisma.ConsultationGetPayload<{ include: typeof CONSULTATION_DOCUMENT_INCLUDE }>;

const LIBELLE_STATUT: Record<string, string> = {
  PLANIFIEE: 'Planifi&eacute;e',
  EN_COURS: 'En cours',
  TERMINEE: 'Termin&eacute;e',
  ANNULEE: 'Annul&eacute;e',
  REFERENCEE: 'R&eacute;f&eacute;r&eacute;e',
};

const LIBELLE_URGENCE: Record<string, string> = {
  ROUTINE: 'Routine',
  URGENT: 'Urgent',
  URGENCE_VITALE: 'Urgence vitale',
};

const LIBELLE_TYPE_DIAGNOSTIC: Record<string, string> = {
  PRINCIPAL: 'Principal',
  SECONDAIRE: 'Secondaire',
  DIFFERENTIEL: 'Diff&eacute;rentiel',
};

const LIBELLE_SEVERITE: Record<string, string> = {
  LEGER: 'L&eacute;ger',
  MODERE: 'Mod&eacute;r&eacute;',
  SEVERE: 'S&eacute;v&egrave;re',
  CRITIQUE: 'Critique',
};

const date = (v: Date) =>
  v.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateHeure = (v: Date) =>
  date(v) + ' &agrave; ' + v.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Les constantes saisies, et elles seules : une case vide ne dit rien au lecteur. */
function constantesSaisies(c: ConsultationDocument['constantes']): [string, string][] {
  if (!c) return [];
  const tension = c.tensionSystolique != null && c.tensionDiastolique != null
    ? `${c.tensionSystolique}/${c.tensionDiastolique} mmHg`
    : c.tensionSystolique != null ? `${c.tensionSystolique} mmHg (systolique)` : null;
  const lignes: [string, string | null][] = [
    ['Temp&eacute;rature', c.temperature != null ? `${c.temperature} &deg;C` : null],
    ['Tension art&eacute;rielle', tension],
    ['Fr&eacute;quence cardiaque', c.frequenceCardiaque != null ? `${c.frequenceCardiaque} /min` : null],
    ['Fr&eacute;quence respiratoire', c.frequenceRespiratoire != null ? `${c.frequenceRespiratoire} /min` : null],
    ['SpO<sub>2</sub>', c.spo2 != null ? `${c.spo2} %` : null],
    ['Glyc&eacute;mie', c.glycemie != null ? `${c.glycemie} g/L` : null],
    ['Poids', c.poidsKg != null ? `${c.poidsKg} kg` : null],
    ['Taille', c.tailleCm != null ? `${c.tailleCm} cm` : null],
    ['P&eacute;rim&egrave;tre brachial', c.perimetreBrachial != null ? `${c.perimetreBrachial} cm` : null],
  ];
  return lignes.filter((l): l is [string, string] => l[1] !== null);
}

/** Un paragraphe de texte libre, retours a la ligne compris. */
function texte(v: string | null | undefined): string {
  return echapper(v).replace(/\r?\n/g, '<br>');
}

/** Le compte rendu, pour le patient et pour les soignants habilites. */
export async function documentConsultation(user: JwtPayload, idConsultation: string): Promise<string> {
  // L'habilitation d'abord : un identifiant inconnu et un dossier interdit
  // repondent pareil, on n'apprend rien en sondant.
  await assertCanAccessConsultation(user, idConsultation);
  const c = await prisma.consultation.findUnique({
    where: { id: idConsultation },
    include: CONSULTATION_DOCUMENT_INCLUDE,
  });
  if (!c) throw new NotFoundError('Consultation non trouvee');
  return rendreCompteRendu(c, await getIdentitePlateforme());
}

type Identite = Awaited<ReturnType<typeof getIdentitePlateforme>>;

export function rendreCompteRendu(c: ConsultationDocument, identite: Identite): string {
  const p = c.patient;
  const signe = Boolean(c.signeLe && c.medecinValideur);
  const annulee = c.statut === 'ANNULEE';
  const allergies = p.allergies.filter(Boolean);
  const constantes = constantesSaisies(c.constantes);
  const alertes = (c.constantes?.alertes ?? []).filter(Boolean);
  const symptomes = c.symptomes.filter(Boolean);
  const coordonnees = [identite.telephone, identite.emailContact].filter(Boolean).map(echapper).join(' &middot; ');
  const agent = c.asc?.utilisateur;
  const medecin = c.medecinValideur;

  const section = (titre: string, corps: string) => (corps ? `<h2>${titre}</h2>${corps}` : '');

  const diagnostics = c.diagnostics.length
    ? '<table><thead><tr><th>Diagnostic</th><th>CIM-11</th><th>Type</th><th>S&eacute;v&eacute;rit&eacute;</th></tr></thead><tbody>' +
      c.diagnostics.map((d) =>
        '<tr><td>' + echapper(d.libelle) + '</td><td>' + echapper(d.codeIcd11) +
        '</td><td>' + (LIBELLE_TYPE_DIAGNOSTIC[d.typeDiagnostic] ?? echapper(d.typeDiagnostic)) +
        '</td><td>' + (d.severite ? LIBELLE_SEVERITE[d.severite] ?? echapper(d.severite) : '&mdash;') + '</td></tr>').join('') +
      '</tbody></table>'
    : '';

  const tableConstantes = constantes.length
    ? '<table class="constantes"><tbody>' +
      constantes.map(([lib, val]) => `<tr><th>${lib}</th><td>${val}</td></tr>`).join('') +
      '</tbody></table>' +
      (alertes.length ? '<div class="alerte">Alertes : ' + alertes.map(echapper).join(' &middot; ') + '</div>' : '')
    : '';

  const ordonnances = c.ordonnances.length
    ? c.ordonnances.map((o) =>
        '<div class="ordo"><div class="meta">Ordonnance N&deg; <strong>' + echapper(o.numero) + '</strong> &middot; ' +
        (o.signeLe ? 'sign&eacute;e le ' + date(o.signeLe) : 'non sign&eacute;e') + '</div><ul>' +
        o.lignes.map((l) =>
          '<li><strong>' + echapper(l.medicament?.nomCommercial ?? l.medicament?.dci) + '</strong> ' +
          echapper(l.medicament?.dosage) + ' &mdash; ' + echapper(l.posologie) +
          (l.frequence ? ', ' + echapper(l.frequence) : '') + ', ' + l.dureeJours + ' j</li>').join('') +
        '</ul></div>').join('') +
      '<p class="meta">Le code de v&eacute;rification figure sur chaque ordonnance imprim&eacute;e, pas sur ce compte rendu.</p>'
    : '';

  const r = c.referencement;
  const referencement = r
    ? '<div class="grid"><div>Vers : <strong>' + echapper(r.structureCible.nom) + '</strong></div>' +
      '<div>Urgence : ' + (LIBELLE_URGENCE[r.urgence] ?? echapper(r.urgence)) + '</div></div>' +
      '<p>' + texte(r.resumeClinique) + '</p>'
    : '';

  const styles = [
    'body{font-family:Arial,sans-serif;color:#0d2b1a;margin:32px;font-size:13px;position:relative}',
    'header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2D7D46;padding-bottom:12px;margin-bottom:20px}',
    'h1{margin:0;font-size:20px;color:#2D7D46}',
    'h2{font-size:14px;margin:18px 0 6px;color:#1A5C35;text-transform:uppercase;letter-spacing:.05em}',
    'p{margin:4px 0;line-height:1.45}',
    '.meta{font-size:12px;color:#3a5848}',
    'table{width:100%;border-collapse:collapse;margin-top:6px}',
    'th,td{border:1px solid #DDE8E2;padding:6px 9px;text-align:left;vertical-align:top}',
    'th{background:#F3F7F5;font-size:11.5px}',
    'table.constantes{width:auto;min-width:50%}table.constantes th{width:200px}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}.grid div{padding:3px 0}',
    '.alerte{margin-top:10px;padding:9px 12px;border-radius:6px;background:#FEF2F2;color:#B91C1C;font-size:12px;font-weight:600}',
    '.ordo{margin-top:6px}.ordo ul{margin:4px 0 0 18px;padding:0}',
    '.filigrane{position:absolute;top:40%;left:0;right:0;text-align:center;font-size:58px;color:rgba(185,28,28,.12);transform:rotate(-18deg);pointer-events:none;font-weight:800}',
    '.sign{margin-top:36px;display:flex;justify-content:flex-end}',
    '.sign div{width:260px;border-top:1px solid #0d2b1a;padding-top:6px;text-align:center}',
    'footer{margin-top:28px;padding-top:10px;border-top:1px solid #DDE8E2;font-size:11px;color:#7a9485;display:flex;justify-content:space-between}',
    '@media print{body{margin:14mm}}',
  ].join('');

  return [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Compte rendu de consultation</title>',
    '<style>', styles, '</style></head><body>',
    annulee ? '<div class="filigrane">ANNULEE</div>' : signe ? '' : '<div class="filigrane">NON SIGNE</div>',
    '<header><div>',
    identite.logoUrl ? '<img src="' + echapper(identite.logoUrl) + '" alt="" style="height:40px;margin-bottom:6px"><br>' : '',
    '<h1>', echapper(identite.nom), '</h1><div class="meta">Compte rendu de consultation</div></div>',
    '<div style="text-align:right"><div class="meta">Consultation du <strong>', dateHeure(c.consulteeLE), '</strong></div>',
    '<div class="meta">Statut : ', LIBELLE_STATUT[c.statut] ?? echapper(c.statut), '</div>',
    '<div class="meta">R&eacute;f. ', echapper(c.id), '</div></div></header>',

    '<h2>Patient</h2><div class="grid">',
    '<div><strong>', echapper(p.utilisateur.prenom), ' ', echapper(p.utilisateur.nom), '</strong></div>',
    '<div>N&eacute;(e) le ', date(p.dateNaissance), ' &middot; ', echapper(p.sexe), '</div>',
    '<div>T&eacute;l&eacute;phone : ', echapper(p.utilisateur.telephone), '</div>',
    '<div>Identifiant : ', echapper(p.qrCode), '</div></div>',
    allergies.length ? '<div class="alerte">Allergies connues : ' + allergies.map(echapper).join(', ') + '</div>' : '',

    '<h2>Motif</h2><p>', texte(c.motifPrincipal), '</p>',
    symptomes.length ? '<p class="meta">Sympt&ocirc;mes : ' + symptomes.map(echapper).join(', ') + '</p>' : '',
    section('Constantes', tableConstantes),
    section('Diagnostics', diagnostics),
    section('Observations de l\'agent de sant&eacute;', c.notesAsc ? '<p>' + texte(c.notesAsc) + '</p>' : ''),
    section('Conclusion du m&eacute;decin', c.notesMedecin ? '<p>' + texte(c.notesMedecin) + '</p>' : ''),
    section('Prescriptions', ordonnances),
    section('Orientation', referencement),

    '<h2>Intervenants</h2><div class="grid">',
    '<div>Agent de sant&eacute; : ', agent ? echapper(agent.prenom) + ' ' + echapper(agent.nom) : '&mdash;', '</div>',
    '<div>M&eacute;decin : ', medecin ? 'Dr ' + echapper(medecin.prenom) + ' ' + echapper(medecin.nom) : '&mdash;', '</div>',
    '</div>',
    '<div class="sign"><div>',
    signe ? 'Sign&eacute; le ' + dateHeure(c.signeLe!) + '<br>Dr ' + echapper(medecin!.prenom) + ' ' + echapper(medecin!.nom)
      : 'Non sign&eacute; par un m&eacute;decin',
    '</div></div>',
    '<footer><span>', echapper(identite.copyright), '</span><span>', coordonnees, '</span></footer>',
    '</body></html>',
  ].join('');
}
