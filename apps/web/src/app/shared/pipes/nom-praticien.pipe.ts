// Le nom d'un praticien : « Dr » pour le medecin, et pour lui seul.
//
// Une sage-femme n'est pas docteur : l'appeler ainsi a l'accueil ou dans le
// parcours du patient, c'est lui preter un titre qu'elle n'a pas. Sans role
// connu, on garde l'usage d'avant : le medecin. Meme regle que
// `nomDuPraticien` cote API.
import { Pipe, PipeTransform } from '@angular/core';

export function nomPraticien(p: { prenom: string; nom: string; role?: string | null } | null | undefined): string {
  if (!p) return '';
  return p.role === 'SAGE_FEMME' ? `${p.prenom} ${p.nom}` : `Dr ${p.prenom} ${p.nom}`;
}

@Pipe({ name: 'nomPraticien', standalone: true })
export class NomPraticienPipe implements PipeTransform {
  transform(p: { prenom: string; nom: string; role?: string | null } | null | undefined): string {
    return nomPraticien(p);
  }
}
