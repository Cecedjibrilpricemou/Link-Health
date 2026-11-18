// Maquette non raccordée : le branchement viendra après.
import { Component, HostListener, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import type { TypePieceAgrement } from '@baobaoheath/shared-types';

import { TranslatePipe } from '../../../shared/pipes/translate.pipe';

type TypeEtablissement = 'PHARMACIE' | 'CLINIQUE' | 'LABORATOIRE';
type EtatDemande = 'RECUE' | 'EN_ANALYSE' | 'VALIDEE' | 'REFUSEE';

interface PieceDemande {
  id: string;
  type: TypePieceAgrement;
  nomFichier: string;
  libelle?: string;
}

interface DemandeRattachement {
  id: string;
  numero: string;
  type: TypeEtablissement;
  nom: string;
  prefecture: string;
  commune: string;
  quartier: string;
  adresse: string;
  telephone: string;
  recueLe: string;
  etat: EtatDemande;
  rccm: string;
  numeroAgrementCreation: string;
  numeroAgrementExploitation: string;
  lieuAutorise: string;
  responsable: {
    prenom: string;
    nom: string;
    telephone: string;
    email: string;
  };
  pieces: PieceDemande[];
}

const TYPES_PIECES: readonly TypePieceAgrement[] = [
  'AGREMENT_CREATION',
  'AGREMENT_EXPLOITATION',
  'DIPLOME_RESPONSABLE',
  'INSCRIPTION_ORDRE',
];

function creerPieces(prefixe: string, autres: string[] = []): PieceDemande[] {
  const pieces = TYPES_PIECES.map((type) => ({
    id: `${prefixe}-${type}`,
    type,
    nomFichier: `${prefixe}-${type.toLowerCase()}.pdf`,
  }));
  return [
    ...pieces,
    ...autres.map((libelle, index) => ({
      id: `${prefixe}-autre-${index + 1}`,
      type: 'AUTRE' as const,
      nomFichier: `${prefixe}-complement-${index + 1}.pdf`,
      libelle,
    })),
  ];
}

const DEMANDES_INITIALES: DemandeRattachement[] = [
  {
    id: 'demande-001', numero: 'DA-2026-0041', type: 'PHARMACIE',
    nom: 'Pharmacie du Marché', prefecture: 'Conakry', commune: 'Matam',
    quartier: 'Madina', adresse: 'Avenue de la République', telephone: '+224620000101',
    recueLe: '2026-11-12', etat: 'RECUE', rccm: 'GN.TCC.2026.A.041',
    numeroAgrementCreation: 'ARR/2026/041', numeroAgrementExploitation: 'ARR/2026/141',
    lieuAutorise: 'Madina, Matam',
    responsable: { prenom: 'Mamadou', nom: 'Barry', telephone: '+224620000102', email: 'm.barry@example.gn' },
    pieces: creerPieces('marche', ['Plan des locaux']),
  },
  {
    id: 'demande-002', numero: 'DA-2026-0040', type: 'CLINIQUE',
    nom: 'Clinique La Colombe', prefecture: 'Conakry', commune: 'Dixinn',
    quartier: 'Belle-Vue', adresse: 'Rue de Dixinn', telephone: '+224620000201',
    recueLe: '2026-11-10', etat: 'EN_ANALYSE', rccm: 'GN.TCC.2026.A.040',
    numeroAgrementCreation: 'ARR/2026/040', numeroAgrementExploitation: 'ARR/2026/140',
    lieuAutorise: 'Belle-Vue, Dixinn',
    responsable: { prenom: 'Fatoumata', nom: 'Camara', telephone: '+224620000202', email: 'f.camara@example.gn' },
    pieces: creerPieces('colombe'),
  },
  {
    id: 'demande-003', numero: 'DA-2026-0039', type: 'LABORATOIRE',
    nom: 'Laboratoire Kankan Bio', prefecture: 'Kankan', commune: 'Kankan-Centre',
    quartier: 'Centre', adresse: 'Route de Siguiri', telephone: '+224620000301',
    recueLe: '2026-11-08', etat: 'VALIDEE', rccm: 'GN.TCC.2026.A.039',
    numeroAgrementCreation: 'ARR/2026/039', numeroAgrementExploitation: 'ARR/2026/139',
    lieuAutorise: 'Kankan-Centre',
    responsable: { prenom: 'Ibrahima', nom: 'Keita', telephone: '+224620000302', email: 'i.keita@example.gn' },
    pieces: creerPieces('kankan'),
  },
  {
    id: 'demande-004', numero: 'DA-2026-0038', type: 'PHARMACIE',
    nom: 'Pharmacie du Fleuve', prefecture: 'Kindia', commune: 'Kindia-Centre',
    quartier: 'Manquepas', adresse: 'Rue du Fleuve', telephone: '+224620000401',
    recueLe: '2026-11-06', etat: 'REFUSEE', rccm: 'GN.TCC.2026.A.038',
    numeroAgrementCreation: 'ARR/2026/038', numeroAgrementExploitation: 'ARR/2026/138',
    lieuAutorise: 'Manquepas, Kindia',
    responsable: { prenom: 'Aissatou', nom: 'Diallo', telephone: '+224620000402', email: 'a.diallo@example.gn' },
    pieces: creerPieces('fleuve', ['Attestation complémentaire']),
  },
  {
    id: 'demande-005', numero: 'DA-2026-0037', type: 'CLINIQUE',
    nom: 'Clinique Nongo Santé', prefecture: 'Conakry', commune: 'Ratoma',
    quartier: 'Nongo', adresse: 'Carrefour Nongo', telephone: '+224620000501',
    recueLe: '2026-11-04', etat: 'RECUE', rccm: 'GN.TCC.2026.A.037',
    numeroAgrementCreation: 'ARR/2026/037', numeroAgrementExploitation: 'ARR/2026/137',
    lieuAutorise: 'Nongo, Ratoma',
    responsable: { prenom: 'Mariam', nom: 'Soumah', telephone: '+224620000502', email: 'm.soumah@example.gn' },
    pieces: creerPieces('nongo'),
  },
  {
    id: 'demande-006', numero: 'DA-2026-0036', type: 'LABORATOIRE',
    nom: 'Laboratoire Mamou Analyses', prefecture: 'Mamou', commune: 'Mamou-Centre',
    quartier: 'Boulbinet', adresse: 'Avenue de la Gare', telephone: '+224620000601',
    recueLe: '2026-11-02', etat: 'EN_ANALYSE', rccm: 'GN.TCC.2026.A.036',
    numeroAgrementCreation: 'ARR/2026/036', numeroAgrementExploitation: 'ARR/2026/136',
    lieuAutorise: 'Mamou-Centre',
    responsable: { prenom: 'Alpha', nom: 'Sow', telephone: '+224620000602', email: 'a.sow@example.gn' },
    pieces: creerPieces('mamou', ['Liste des équipements', 'Plan du laboratoire']),
  },
  {
    id: 'demande-007', numero: 'DA-2026-0035', type: 'PHARMACIE',
    nom: 'Pharmacie Belle-Vue', prefecture: 'Conakry', commune: 'Dixinn',
    quartier: 'Belle-Vue', adresse: 'Route du Niger', telephone: '+224620000701',
    recueLe: '2026-10-30', etat: 'VALIDEE', rccm: 'GN.TCC.2026.A.035',
    numeroAgrementCreation: 'ARR/2026/035', numeroAgrementExploitation: 'ARR/2026/135',
    lieuAutorise: 'Belle-Vue, Dixinn',
    responsable: { prenom: 'Boubacar', nom: 'Bah', telephone: '+224620000702', email: 'b.bah@example.gn' },
    pieces: creerPieces('bellevue'),
  },
  {
    id: 'demande-008', numero: 'DA-2026-0034', type: 'CLINIQUE',
    nom: 'Clinique de Coyah', prefecture: 'Coyah', commune: 'Coyah-Centre',
    quartier: 'Sanoyah', adresse: 'Route nationale', telephone: '+224620000801',
    recueLe: '2026-10-28', etat: 'REFUSEE', rccm: 'GN.TCC.2026.A.034',
    numeroAgrementCreation: 'ARR/2026/034', numeroAgrementExploitation: 'ARR/2026/134',
    lieuAutorise: 'Coyah-Centre',
    responsable: { prenom: 'Hawa', nom: 'Kaba', telephone: '+224620000802', email: 'h.kaba@example.gn' },
    pieces: creerPieces('coyah'),
  },
];

@Component({
  selector: 'app-demandes-agrement',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, TranslatePipe],
  templateUrl: './demandes-agrement.component.html',
  styleUrl: './demandes-agrement.component.scss',
})
export class DemandesAgrementComponent {
  readonly etats: readonly (EtatDemande | 'TOUTES')[] = [
    'TOUTES',
    'RECUE',
    'EN_ANALYSE',
    'VALIDEE',
    'REFUSEE',
  ];
  readonly demandes = signal<DemandeRattachement[]>(DEMANDES_INITIALES);
  readonly filtreEtat = signal<EtatDemande | 'TOUTES'>('TOUTES');
  readonly menuOuvert = signal<string | null>(null);
  readonly demandeOuverteId = signal<string | null>(null);
  readonly pieceEnApercu = signal<PieceDemande | null>(null);
  readonly saisieMotifOuverte = signal(false);
  readonly motifRefus = signal('');
  readonly erreurMotif = signal(false);

  readonly demandesFiltrees = computed(() => {
    const filtre = this.filtreEtat();
    return this.demandes().filter((demande) => filtre === 'TOUTES' || demande.etat === filtre);
  });

  readonly demandeOuverte = computed(() =>
    this.demandes().find((demande) => demande.id === this.demandeOuverteId()) ?? null,
  );

  basculerMenu(id: string, evenement?: Event): void {
    evenement?.stopPropagation();
    this.menuOuvert.update((ouvert) => ouvert === id ? null : id);
  }

  ouvrirDemande(id: string): void {
    this.menuOuvert.set(null);
    this.demandeOuverteId.set(id);
    this.pieceEnApercu.set(null);
    this.saisieMotifOuverte.set(false);
    this.motifRefus.set('');
    this.erreurMotif.set(false);
  }

  fermerDialogue(): void {
    this.demandeOuverteId.set(null);
    this.pieceEnApercu.set(null);
  }

  consulterPiece(piece: PieceDemande): void {
    this.pieceEnApercu.set(piece);
  }

  mettreEnAnalyse(): void {
    this.changerEtat('EN_ANALYSE');
  }

  valider(): void {
    this.changerEtat('VALIDEE');
  }

  ouvrirSaisieMotif(): void {
    this.saisieMotifOuverte.set(true);
    this.erreurMotif.set(false);
  }

  refuser(): void {
    if (!this.motifRefus().trim()) {
      this.erreurMotif.set(true);
      return;
    }
    this.changerEtat('REFUSEE');
  }

  private changerEtat(etat: EtatDemande): void {
    const id = this.demandeOuverteId();
    if (!id) return;
    this.demandes.update((demandes) =>
      demandes.map((demande) => demande.id === id ? { ...demande, etat } : demande),
    );
  }

  @HostListener('document:click')
  fermerMenu(): void {
    this.menuOuvert.set(null);
  }

  @HostListener('document:keydown.escape')
  echapper(): void {
    this.menuOuvert.set(null);
    this.fermerDialogue();
  }
}
