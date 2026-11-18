// core/models/patient.model.ts
import { ConsultationView } from '@baobaoheath/shared-types';
export type { OrdonnanceView as Ordonnance, DiagnosticView as Diagnostic } from '@baobaoheath/shared-types';

export interface Consultation extends ConsultationView {
  medecin?: { utilisateur?: { prenom: string; nom: string } };
  patient?: { utilisateur?: { prenom: string; nom: string; telephone: string } };
}

/**
 * Forme renvoyee par /patients/me (patient.service.ts : getMyProfile) :
 * les champs du profil sont a plat, l'identite est imbriquee sous
 * `utilisateur`, et `structurePreferee` est un objet complet.
 */
export interface Patient {
  id: string;
  numeroPatient?: string;
  groupeSanguin?: string;
  poidsKg?: number;
  tailleCm?: number;
  allergies?: string[];
  maladiesChroniques?: string[];
  // Champs du profil patient, toujours a plat
  dateNaissance?: string;
  sexe?: string;
  prefecture?: string;
  sousPrefecture?: string;
  village?: string;
  photoUrl?: string;
  urgenceNom?: string;
  urgenceTelephone?: string;
  qrCode?: string;
  /** R15 : une fois verifiee sur piece, le patient ne change plus son nom lui-meme. */
  niveauIdentite?: 'PROVISOIRE' | 'VERIFIEE';
  // Identite : imbriquee ici, a plat dans les reponses de recherche
  utilisateur?: {
    prenom: string;
    nom: string;
    telephone: string;
    email?: string;
    photoUrl?: string;
    langue?: string;
  };
  prenom?: string;
  nom?: string;
  telephone?: string;
  // Modele hybride : structure de sante choisie par le patient
  idStructurePreferee?: string;
  structurePreferee?: {
    id: string;
    nom: string;
    type: string;
    prefecture: string;
    adresse?: string;
    telephone?: string;
  };
}

export interface PatientCreatePayload {
  prenom: string;
  nom: string;
  telephone: string;
  email?: string;
  dateNaissance: string;
  genre: string;
  adresse?: string;
  motDePasse?: string;
  groupeSanguin?: string;
  allergies?: string[];
  maladiesChroniques?: string[];
}

export interface PatientUpdatePayload extends Partial<PatientCreatePayload> {}

export interface OrdonnanceLigne {
  id: string;
  posologie: string;
  frequence: string;
  dureeJours: number;
  quantite?: number;
  medicament?: { id: string; nom: string; forme?: string };
}

// La forme reelle vit desormais dans shared-types (VaccinationView), figee par
// l'annotation du controleur : les alias legacy (nomVaccin, dateAdministration,
// prochaineDose) n'etaient jamais renvoyes par l'API et sont supprimes.
export type { VaccinationView as Vaccination } from '@baobaoheath/shared-types';

// `Paiement` a ete retire le 2026-10-08 : ses champs (`montant`, `devise`,
// `methode`, `datePaiement`) n'existaient nulle part cote API. Le contrat
// reel est `FactureView`, dans @baobaoheath/shared-types.
