// core/services/candidature-livreur.service.ts
// Le depot d'une candidature de motard livreur.
//
// **Le formulaire est public** — le motard n'a pas de compte, et c'est
// precisement parce qu'il n'en a pas qu'il candidate.
//
// La route n'existe pas encore cote serveur : ce service prepare l'appel
// (multipart, sur le modele de demande-agrement.service) pour le jour ou
// elle ouvrira. L'ecran n'appelle rien tant que ENVOI_ACTIF est faux.
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ApiResponse } from '@baobaoheath/shared-types';
import { ApiService } from './api.service';

/** Les champs texte du formulaire, hors fichiers. */
export interface DepotCandidatureLivreurDto {
  prenom: string;
  nom: string;
  dateNaissance: string;
  sexe: string;
  telephone: string;
  email?: string;
  prefecture: string;
  commune?: string;
  quartier?: string;
}

/** Ce que le serveur renverra au depot, quand la route existera. */
export interface DepotCandidatureLivreurView {
  numero: string;
  statut: string;
  deposeLe: string;
}

/** Les six pieces exigees d'un candidat motard. */
export type TypePieceLivreur =
  | 'CNI_RECTO'
  | 'CNI_VERSO'
  | 'PERMIS_CONDUIRE'
  | 'CARTE_GRISE'
  | 'ASSURANCE'
  | 'CERTIFICAT_RESIDENCE';

export const TYPES_PIECES_LIVREUR: readonly TypePieceLivreur[] = [
  'CNI_RECTO',
  'CNI_VERSO',
  'PERMIS_CONDUIRE',
  'CARTE_GRISE',
  'ASSURANCE',
  'CERTIFICAT_RESIDENCE',
];

@Injectable({ providedIn: 'root' })
export class CandidatureLivreurService {
  private readonly api = inject(ApiService);

  /**
   * Deposer une candidature, pieces comprises.
   *
   * Le corps multipart est forme comme celui de demande-agrement : Angular
   * laisse le navigateur poser Content-Type et sa frontiere des que le corps
   * est un FormData. Le nom du champ est le type de piece — le serveur la
   * reconnaitra ainsi.
   */
  deposer(
    dto: DepotCandidatureLivreurDto,
    pieces: Partial<Record<TypePieceLivreur, File>>,
  ): Observable<ApiResponse<DepotCandidatureLivreurView>> {
    const corps = new FormData();
    corps.append('donnees', JSON.stringify(dto));
    for (const [type, fichier] of Object.entries(pieces)) {
      if (fichier instanceof File) corps.append(type, fichier, fichier.name);
    }
    return this.api.post<ApiResponse<DepotCandidatureLivreurView>>(
      '/livreurs/candidatures',
      corps,
    );
  }
}
