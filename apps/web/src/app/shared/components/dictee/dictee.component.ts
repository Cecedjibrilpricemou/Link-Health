// shared/components/dictee — bouton micro : on parle, le texte s'ecrit.
//
// Moteur : la reconnaissance vocale du navigateur (Web Speech API) ; dans
// l'application Android, celle du telephone (moteur-natif.ts). Rien a
// installer ni a payer, mais deux limites assumees :
// - le son part au service du navigateur (Google pour Chrome, Microsoft
//   pour Edge). Pour des symptomes, c'est une donnee de sante : le patient
//   est prevenu au premier usage, et ecrire au clavier reste toujours possible ;
// - Firefox et certains iPhone ne savent pas dicter : le bouton n'apparait
//   pas, le champ reste un champ normal.
// Rien n'est enregistre : seul le texte reconnu est ajoute au champ, et le
// patient le relit avant d'envoyer.
//
// Usage : <app-dictee [(texte)]="motif" [max]="1000" />
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, model, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { TranslatePipe } from '../../pipes/translate.pipe';
import { I18nService } from '../../services/i18n.service';
import { MoteurNatif } from './moteur-natif';

/** Memorise que le patient a lu l'avis (par navigateur, sans donnee personnelle). */
export const CLE_AVIS_DICTEE = 'bb-dictee-avis-vu';

// Le sous-ensemble de l'API qu'on utilise : elle n'est pas dans les types DOM.
export interface ResultatReconnaissance { isFinal: boolean; 0: { transcript: string }; }
export interface EvenementResultat { resultIndex: number; results: ArrayLike<ResultatReconnaissance>; }
export interface MoteurReconnaissance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: EvenementResultat) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type ConstructeurMoteur = new () => MoteurReconnaissance;

function constructeurDuNavigateur(): ConstructeurMoteur | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: ConstructeurMoteur; webkitSpeechRecognition?: ConstructeurMoteur };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Dans l'application native, le moteur du telephone ; sinon celui du navigateur. */
export function choisirMoteur(natif = Capacitor.isNativePlatform()): ConstructeurMoteur | null {
  return natif ? MoteurNatif : constructeurDuNavigateur();
}

function lireStockage(cle: string): string | null {
  try { return localStorage.getItem(cle); } catch { return null; }
}
function ecrireStockage(cle: string, valeur: string): void {
  try { localStorage.setItem(cle, valeur); } catch { /* navigation privee : l'avis sera redemande */ }
}

/** Ajoute une phrase dictee a la suite du texte, avec la bonne majuscule et l'espace. */
export function ajouterPhrase(texte: string, phrase: string, max: number | null): string {
  const p = phrase.trim();
  if (!p) return texte;
  const avant = texte.replace(/\s+$/, '');
  const debutDePhrase = avant === '' || /[.!?]$/.test(avant);
  const ajout = debutDePhrase ? p.charAt(0).toLocaleUpperCase() + p.slice(1) : p;
  const resultat = avant === '' ? ajout : `${avant} ${ajout}`;
  return max !== null ? resultat.slice(0, max) : resultat;
}

type Etat = 'repos' | 'avis' | 'ecoute';

@Component({
  selector: 'app-dictee',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dictee.component.html',
  styleUrl: './dictee.component.scss',
})
export class DicteeComponent implements OnDestroy {
  /** Le texte du champ, lu et complete par la dictee. */
  readonly texte = model<string>('');
  /** Longueur maximale du champ (son maxlength). */
  readonly max = input<number | null>(null);

  private readonly i18n = inject(I18nService);
  private readonly Moteur = choisirMoteur();
  private moteur: MoteurReconnaissance | null = null;

  protected readonly disponible = this.Moteur !== null;
  protected readonly etat = signal<Etat>('repos');
  protected readonly provisoire = signal('');
  protected readonly erreur = signal<string | null>(null);
  protected readonly ecoute = computed(() => this.etat() === 'ecoute');

  basculer(): void {
    if (this.etat() === 'ecoute') { this.arreter(); return; }
    this.erreur.set(null);
    if (lireStockage(CLE_AVIS_DICTEE) !== '1') { this.etat.set('avis'); return; }
    this.demarrer();
  }

  accepterAvis(): void {
    ecrireStockage(CLE_AVIS_DICTEE, '1');
    this.demarrer();
  }

  refuserAvis(): void {
    this.etat.set('repos');
  }

  private demarrer(): void {
    if (!this.Moteur) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.etat.set('repos');
      this.erreur.set(this.i18n.t('DICTEE.ERR_HORS_LIGNE'));
      return;
    }
    const moteur = new this.Moteur();
    moteur.lang = this.i18n.lang() === 'en' ? 'en-US' : 'fr-FR';
    moteur.continuous = true;
    moteur.interimResults = true;
    moteur.onresult = (e) => this.recevoir(e);
    moteur.onerror = (e) => this.erreur.set(this.messageErreur(e.error));
    moteur.onend = () => { this.moteur = null; this.provisoire.set(''); this.etat.set('repos'); };
    this.moteur = moteur;
    this.etat.set('ecoute');
    try {
      moteur.start();
    } catch {
      this.moteur = null;
      this.etat.set('repos');
      this.erreur.set(this.i18n.t('DICTEE.ERR_GENERIQUE'));
    }
  }

  private arreter(): void {
    this.moteur?.stop();
    this.etat.set('repos');
  }

  private recevoir(e: EvenementResultat): void {
    let provisoire = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) this.texte.set(ajouterPhrase(this.texte(), r[0].transcript, this.max()));
      else provisoire += r[0].transcript;
    }
    this.provisoire.set(provisoire.trim());
  }

  private messageErreur(code: string): string {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed': return this.i18n.t('DICTEE.ERR_MICRO_REFUSE');
      case 'no-speech': return this.i18n.t('DICTEE.ERR_SILENCE');
      case 'audio-capture': return this.i18n.t('DICTEE.ERR_PAS_DE_MICRO');
      case 'network': return this.i18n.t('DICTEE.ERR_HORS_LIGNE');
      default: return this.i18n.t('DICTEE.ERR_GENERIQUE');
    }
  }

  ngOnDestroy(): void {
    this.moteur?.abort();
  }
}
