// La photo de profil arrive de l'API par son chemin (/uploads/avatars/...) :
// l'avatar la cherche chez l'API, pas sur le serveur du site.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { AvatarComponent } from './avatar.component';
import { urlMedia } from '../../utils/url-media';

function monter(photoUrl: string | null) {
  TestBed.configureTestingModule({ imports: [AvatarComponent], providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(AvatarComponent);
  fixture.componentRef.setInput('photoUrl', photoUrl);
  fixture.componentRef.setInput('initiales', 'MC');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AvatarComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('cherche une photo téléversée chez l’API', () => {
    const img = monter('/uploads/avatars/u1.webp').querySelector('img');
    expect(img?.getAttribute('src')).toBe(urlMedia('/uploads/avatars/u1.webp'));
    expect(img?.getAttribute('src')).toMatch(/:3000\/uploads\/avatars\/u1\.webp$/);
  });

  it('affiche les initiales sans photo', () => {
    const el = monter(null);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('MC');
  });
});
