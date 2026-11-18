// L'adresse a laquelle afficher un fichier televerse (logo, photo de profil).
//
// L'API enregistre ces fichiers par leur chemin, /uploads/<dossier>/<fichier>,
// sans hote. Le site les cherche la ou vit l'API :
//   - en developpement, sur son port 3000 (localhost depuis le PC, 10.0.2.2
//     depuis l'emulateur Android, l'adresse du PC depuis un telephone) ;
//   - en production, sur la meme origine que le site, dont nginx relaie
//     /uploads/ vers l'API.
import { environment } from '../../../environments/environment';

/** L'origine de l'API (« http://hote:3000 »), ou '' quand elle est relative. */
function origineApi(apiUrl: string): string {
  return /^https?:\/\//i.test(apiUrl) ? new URL(apiUrl).origin : '';
}

export function urlMedia(chemin: string | null | undefined, apiUrl = environment.apiUrl): string {
  const c = (chemin ?? '').trim();
  if (!c.startsWith('/uploads/')) return c;
  return origineApi(apiUrl) + c;
}
