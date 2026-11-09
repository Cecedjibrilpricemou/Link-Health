// Dictee vocale : le patient parle, le texte s'ecrit dans le champ.
//
// Le moteur est celui du navigateur (Web Speech API). Ici il est simule :
// on verifie ce que l'ecran en fait, pas la reconnaissance elle-meme.
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  speechRecognition: {
    available: vi.fn(() => Promise.resolve({ available: true })),
    requestPermissions: vi.fn(() => Promise.resolve({ speechRecognition: 'granted' })),
    start: vi.fn(() => Promise.resolve({})),
    stop: vi.fn(() => Promise.resolve()),
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn(() => Promise.resolve()) })),
  },
}));

vi.mock('@capacitor-community/speech-recognition', () => ({
  SpeechRecognition: mocks.speechRecognition,
}));

import { DicteeComponent, CLE_AVIS_DICTEE, choisirMoteur } from './dictee.component';
import { MoteurNatif } from './moteur-natif';

/** Faux moteur : garde la derniere instance pour la piloter depuis le test. */
class FauxMoteur {
  static dernier: FauxMoteur | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  demarre = false;
  arrete = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FauxMoteur.dernier = this; }
  start() { this.demarre = true; }
  stop() { this.arrete = true; this.onend?.(); }
  abort() { this.arrete = true; }
  /** Simule une phrase reconnue (definitive ou provisoire). */
  dire(texte: string, definitif = true) {
    const resultat = Object.assign([{ transcript: texte }], { isFinal: definitif });
    this.onresult?.({ resultIndex: 0, results: [resultat] });
  }
}

@Component({
  standalone: true,
  imports: [DicteeComponent],
  template: `<app-dictee [(texte)]="motif" [max]="40" />`,
})
class HoteComponent {
  motif = signal('Fièvre.');
}

const w = window as unknown as Record<string, unknown>;

function monter(options: { api?: boolean; avisVu?: boolean } = {}) {
  FauxMoteur.dernier = null;
  delete w['SpeechRecognition'];
  if (options.api !== false) w['webkitSpeechRecognition'] = FauxMoteur;
  else delete w['webkitSpeechRecognition'];
  localStorage.removeItem(CLE_AVIS_DICTEE);
  if (options.avisVu) localStorage.setItem(CLE_AVIS_DICTEE, '1');
  TestBed.configureTestingModule({ imports: [HoteComponent], providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(HoteComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const rendre = async () => { await fixture.whenStable(); fixture.detectChanges(); };
  const bouton = () => el.querySelector<HTMLButtonElement>('.bb-dictee__micro');
  return { el, rendre, bouton, hote: fixture.componentInstance };
}

describe('dictée vocale', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => { delete w['webkitSpeechRecognition']; localStorage.removeItem(CLE_AVIS_DICTEE); });

  it('ne montre rien si le navigateur ne sait pas dicter', () => {
    const { bouton } = monter({ api: false });
    expect(bouton()).toBeNull();
  });

  it('prévient une première fois que la voix part au service du navigateur', async () => {
    const { bouton, el, rendre } = monter();
    bouton()!.click();
    await rendre();
    expect(el.querySelector('.bb-dictee__avis')!.textContent).toMatch(/navigateur/i);
    expect(FauxMoteur.dernier).toBeNull();          // rien ne demarre avant l'accord
    el.querySelector<HTMLButtonElement>('.bb-dictee__accepter')!.click();
    await rendre();
    expect(FauxMoteur.dernier!.demarre).toBe(true);
    expect(localStorage.getItem(CLE_AVIS_DICTEE)).toBe('1');
  });

  it('ne repose pas la question ensuite', async () => {
    const { bouton, el, rendre } = monter({ avisVu: true });
    bouton()!.click();
    await rendre();
    expect(el.querySelector('.bb-dictee__avis')).toBeNull();
    expect(FauxMoteur.dernier!.demarre).toBe(true);
    expect(FauxMoteur.dernier!.lang).toBe('fr-FR');
  });

  it('ajoute ce qui est dit à la suite du texte déjà écrit', async () => {
    const { bouton, rendre, hote } = monter({ avisVu: true });
    bouton()!.click();
    await rendre();
    FauxMoteur.dernier!.dire("j'ai mal à la tête");
    await rendre();
    expect(hote.motif()).toBe("Fièvre. J'ai mal à la tête");
  });

  it('montre le texte provisoire sans l’écrire dans le champ', async () => {
    const { bouton, el, rendre, hote } = monter({ avisVu: true });
    bouton()!.click();
    await rendre();
    FauxMoteur.dernier!.dire('depuis trois', false);
    await rendre();
    expect(el.querySelector('.bb-dictee__provisoire')!.textContent).toContain('depuis trois');
    expect(hote.motif()).toBe('Fièvre.');
  });

  it('respecte la longueur maximale du champ', async () => {
    const { bouton, rendre, hote } = monter({ avisVu: true });
    bouton()!.click();
    await rendre();
    FauxMoteur.dernier!.dire('une phrase beaucoup trop longue pour tenir dans le champ');
    await rendre();
    expect(hote.motif().length).toBe(40);
  });

  it('s’arrête au second appui, et le bouton le dit', async () => {
    const { bouton, rendre } = monter({ avisVu: true });
    bouton()!.click();
    await rendre();
    expect(bouton()!.getAttribute('aria-pressed')).toBe('true');
    bouton()!.click();
    await rendre();
    expect(FauxMoteur.dernier!.arrete).toBe(true);
    expect(bouton()!.getAttribute('aria-pressed')).toBe('false');
  });

  it('explique un micro refusé', async () => {
    const { bouton, el, rendre } = monter({ avisVu: true });
    bouton()!.click();
    await rendre();
    FauxMoteur.dernier!.onerror?.({ error: 'not-allowed' });
    FauxMoteur.dernier!.onend?.();
    await rendre();
    expect(el.querySelector('.bb-dictee__erreur')!.textContent).toMatch(/micro/i);
    expect(bouton()!.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('choix du moteur', () => {
  it('choisit le moteur natif sur la plateforme native', () => {
    expect(choisirMoteur(true)).toBe(MoteurNatif);
  });

  it('choisit le moteur du navigateur quand Web Speech API existe', () => {
    w['webkitSpeechRecognition'] = FauxMoteur;
    expect(choisirMoteur(false)).toBe(FauxMoteur);
  });

  it('ne choisit aucun moteur du navigateur si Web Speech API est absente', () => {
    delete w['webkitSpeechRecognition'];
    expect(choisirMoteur(false)).toBeNull();
  });
});
