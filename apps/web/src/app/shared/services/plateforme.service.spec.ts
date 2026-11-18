// L'icone de l'onglet et celle de l'ecran d'accueil suivent le logo
// televerse par le super-admin, comme le nom et le logo des barres laterales.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { IDENTITE_PAR_DEFAUT, PlateformeService } from './plateforme.service';
import { ApiService } from '../../core/services/api.service';
import { urlMedia } from '../utils/url-media';

describe('PlateformeService : icones du navigateur', () => {
  let service: PlateformeService;
  let doc: Document;

  const icone = (rel: string) => doc.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ApiService, useValue: {} },
        { provide: Title, useValue: { setTitle() {} } },
      ],
    });
    doc = TestBed.inject(DOCUMENT);
    doc.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => l.remove());
    // Ce que pose index.html.
    const favicon = doc.createElement('link');
    favicon.rel = 'icon';
    favicon.href = 'favicon.ico';
    doc.head.appendChild(favicon);
    service = TestBed.inject(PlateformeService);
  });

  it('prend le logo téléversé pour l’onglet et l’écran d’accueil', () => {
    service.appliquer({ ...IDENTITE_PAR_DEFAUT, nom: 'Lead Health', logoUrl: 'https://cdn.example.org/logo.png' });
    expect(icone('icon')?.getAttribute('href')).toBe('https://cdn.example.org/logo.png');
    expect(icone('icon')?.type).toBe('');
    expect(icone('apple-touch-icon')?.getAttribute('href')).toBe('https://cdn.example.org/logo.png');
    expect(doc.head.querySelectorAll('link[rel="icon"]').length).toBe(1);
  });

  it('revient à l’icône d’origine quand le logo est retiré', () => {
    service.appliquer({ ...IDENTITE_PAR_DEFAUT, logoUrl: '/uploads/logo.png' });
    service.appliquer({ ...IDENTITE_PAR_DEFAUT, logoUrl: '' });
    expect(icone('icon')?.getAttribute('href')).toBe('favicon.ico');
    expect(icone('apple-touch-icon')).toBeNull();
  });

  it('cherche un logo téléversé (chemin /uploads/...) chez l’API, pour la marque comme pour l’onglet', () => {
    service.appliquer({ ...IDENTITE_PAR_DEFAUT, logoUrl: '/uploads/logos/logo-1.png' });
    const attendu = urlMedia('/uploads/logos/logo-1.png');
    expect(attendu).toMatch(/^https?:\/\/[^/]+:3000\/uploads\/logos\/logo-1\.png$/);
    expect(service.logoUrl()).toBe(attendu);
    expect(icone('icon')?.getAttribute('href')).toBe(attendu);
    // L'identite garde le chemin : c'est lui que les parametres renvoient.
    expect(service.identite().logoUrl).toBe('/uploads/logos/logo-1.png');
  });

  it('ne touche à rien sans logo', () => {
    service.appliquer({ ...IDENTITE_PAR_DEFAUT, logoUrl: '   ' });
    expect(icone('icon')?.getAttribute('href')).toBe('favicon.ico');
    expect(icone('apple-touch-icon')).toBeNull();
  });
});
