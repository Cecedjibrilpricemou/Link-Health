// Les fichiers televerses arrivent de l'API par leur chemin (/uploads/...).
// Le site les cherche la ou vit l'API : sur le port 3000 en developpement,
// sur sa propre origine en production (nginx relaie /uploads/).
import { urlMedia } from './url-media';

describe('urlMedia', () => {
  it('cherche un fichier téléversé sur l’origine de l’API', () => {
    expect(urlMedia('/uploads/logos/logo-1.png', 'http://10.0.2.2:3000/api/v1'))
      .toBe('http://10.0.2.2:3000/uploads/logos/logo-1.png');
    expect(urlMedia('/uploads/avatars/u1.webp', 'http://localhost:3000/api/v1'))
      .toBe('http://localhost:3000/uploads/avatars/u1.webp');
  });

  it('en production (API relative), reste sur l’origine du site', () => {
    expect(urlMedia('/uploads/logos/logo-1.png', '/api/v1')).toBe('/uploads/logos/logo-1.png');
  });

  it('laisse une adresse complète, une image intégrée ou un vide tels quels', () => {
    const api = 'http://localhost:3000/api/v1';
    expect(urlMedia('https://cdn.example.org/logo.png', api)).toBe('https://cdn.example.org/logo.png');
    expect(urlMedia('data:image/png;base64,AAAA', api)).toBe('data:image/png;base64,AAAA');
    expect(urlMedia('', api)).toBe('');
    expect(urlMedia(null, api)).toBe('');
    expect(urlMedia(undefined, api)).toBe('');
  });
});
