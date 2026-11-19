// core/services/candidature-livreur.service.ts
// Les candidatures des motards livreurs : le depot public, et l'examen par
// l'administration.
//
// **Le depot est public** — le motard n'a pas de compte, et c'est
// precisement parce qu'il n'en a pas qu'il candidate. Tout le reste est
// reserve aux roles qui recrutent les livreurs.
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type {
  ApiResponse,
  CandidatureLivreurListeView,
  CandidatureLivreurView,
  DepotCandidatureLivreurView,
  StatutCandidatureLivreur,
  TypePieceLivreur,
  ValidationCandidatureLivreurView,
} from '@baobaoheath/shared-types';
import { ApiService } from './api.service';

export type { TypePieceLivreur, DepotCandidatureLivreurView };

/** Les champs texte du formulaire, hors fichiers. */
export interface DepotCandidatureLivreurDto {
  prenom: string;
  nom: string;
  dateNaissance: string;
  sexe: 'M' | 'F';
  telephone: string;
  email?: string;
  prefecture: string;
  commune?: string;
  quartier: string;
}

/** Les six pieces exigees d'un motard, dans l'ordre de l'ecran. */
export const TYPES_PIECES_LIVREUR: readonly TypePieceLivreur[] = [
  'CNI_RECTO',
  'CNI_VERSO',
  'PERMIS_CONDUIRE',
  'CARTE_GRISE',
  'ASSURANCE',
  'CERTIFICAT_RESIDENCE',
];

/** 5 Mo, la borne du serveur : un scan de permis depasse souvent 2 Mo. */
export const TAILLE_MAX_PIECE_LIVREUR = 5 * 1024 * 1024;

/** Ce que le serveur sait lire : un motard photographie ses papiers. */
const TYPES_ACCEPTES = ['image/jpeg', 'image/png', 'application/pdf'];

/** Pour les navigateurs qui ne renseignent pas le type d'un fichier. */
const EXTENSIONS_ACCEPTEES = ['.jpg', '.jpeg', '.png', '.pdf'];

/** La cle du refus, sous `PUBLIC.LIVREUR_REQUEST`. */
export type RefusPieceLivreur = 'PIECE_BAD_FORMAT' | 'PIECE_TOO_LARGE' | 'PIECE_EMPTY';

/**
 * Pourquoi une piece serait refusee, avant tout envoi - ou `null`.
 *
 * Les controles sont faits ici **avant** le televersement : sur un reseau
 * guineen, decouvrir apres dix minutes qu'un fichier etait trop gros se paie
 * en temps perdu. Les deux ecrans - le depot du motard et la creation par
 * l'administration - lisent cette fonction, pour ne jamais diverger.
 */
export function refusPieceLivreur(fichier: File): RefusPieceLivreur | null {
  const nom = fichier.name.toLowerCase();
  const formatConnu = TYPES_ACCEPTES.includes(fichier.type)
    || EXTENSIONS_ACCEPTEES.some((ext) => nom.endsWith(ext));
  if (!formatConnu) return 'PIECE_BAD_FORMAT';
  if (fichier.size > TAILLE_MAX_PIECE_LIVREUR) return 'PIECE_TOO_LARGE';
  if (fichier.size === 0) return 'PIECE_EMPTY';
  return null;
}

/** `200 Ko`, `2.0 Mo` - jamais `0 Ko`, qui ressemble a un televersement rate. */
export function tailleLisible(octets: number): string {
  return octets >= 1024 * 1024
    ? `${(octets / (1024 * 1024)).toFixed(1)} Mo`
    : `${Math.max(1, Math.round(octets / 1024))} Ko`;
}

/**
 * Le corps multipart d'un dossier : les champs dans `donnees`, chaque piece
 * sous son type. Angular laisse le navigateur poser Content-Type et sa
 * frontiere des que le corps est un FormData.
 *
 * Partage par les deux portes - le depot du motard et la creation par
 * l'administration - pour que l'une n'envoie jamais autre chose que l'autre.
 */
export function corpsDossierLivreur(
  donnees: object,
  pieces: Partial<Record<TypePieceLivreur, File>>,
): FormData {
  const corps = new FormData();
  corps.append('donnees', JSON.stringify(donnees));
  for (const [type, fichier] of Object.entries(pieces)) {
    if (fichier instanceof File) corps.append(type, fichier, fichier.name);
  }
  return corps;
}

@Injectable({ providedIn: 'root' })
export class CandidatureLivreurService {
  private readonly api = inject(ApiService);

  /** Deposer une candidature, pieces comprises. */
  deposer(
    dto: DepotCandidatureLivreurDto,
    pieces: Partial<Record<TypePieceLivreur, File>>,
  ): Observable<ApiResponse<DepotCandidatureLivreurView>> {
    return this.api.post<ApiResponse<DepotCandidatureLivreurView>>(
      '/livreurs/candidatures',
      corpsDossierLivreur(dto, pieces),
    );
  }

  // ── L'examen ──────────────────────────────────────────────────

  /** Le filtre est applique par le serveur, pas sur ce qu'on a deja recu. */
  lister(statut?: StatutCandidatureLivreur | 'TOUTES'): Observable<ApiResponse<CandidatureLivreurListeView[]>> {
    const params = statut && statut !== 'TOUTES' ? { statut } : undefined;
    return this.api.get<ApiResponse<CandidatureLivreurListeView[]>>('/livreurs/candidatures', params);
  }

  detail(id: string): Observable<ApiResponse<CandidatureLivreurView>> {
    return this.api.get<ApiResponse<CandidatureLivreurView>>(`/livreurs/candidatures/${id}`);
  }

  /** Le contenu d'une piece, par une requete authentifiee. */
  piece(id: string): Observable<Blob> {
    return this.api.getBlob(`/livreurs/candidatures/pieces/${id}`);
  }

  mettreEnAnalyse(id: string): Observable<ApiResponse<CandidatureLivreurView>> {
    return this.api.post<ApiResponse<CandidatureLivreurView>>(`/livreurs/candidatures/${id}/analyse`, {});
  }

  valider(id: string): Observable<ApiResponse<ValidationCandidatureLivreurView>> {
    return this.api.post<ApiResponse<ValidationCandidatureLivreurView>>(
      `/livreurs/candidatures/${id}/validation`,
      {},
    );
  }

  refuser(id: string, motif: string): Observable<ApiResponse<CandidatureLivreurView>> {
    return this.api.post<ApiResponse<CandidatureLivreurView>>(`/livreurs/candidatures/${id}/refus`, { motif });
  }
}
