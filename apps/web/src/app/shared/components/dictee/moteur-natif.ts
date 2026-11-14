// La dictee dans l'application Android : la reconnaissance vocale du
// telephone, via @capacitor-community/speech-recognition.
//
// La WebView n'offre pas la Web Speech API ; ce moteur imite son interface
// (MoteurReconnaissance) pour que le composant de dictee ne voie aucune
// difference : resultats provisoires pendant qu'on parle, phrase finale a la
// fin de l'ecoute, memes codes d'erreur.
import type { PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

import type { EvenementResultat, MoteurReconnaissance } from './dictee.component';

export class MoteurNatif implements MoteurReconnaissance {
  lang = 'fr-FR';
  continuous = true;
  interimResults = true;
  onresult: ((e: EvenementResultat) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  /** Le dernier texte entendu : Android le complete a chaque resultat provisoire. */
  private dernier = '';
  private ecouteurs: PluginListenerHandle[] = [];
  private termine = false;

  start(): void {
    void this.lancer();
  }

  stop(): void {
    // Sans attendre l'evenement `listeningState` : selon les telephones, il
    // n'arrive pas toujours apres un arret demande, et la derniere phrase
    // serait perdue. `terminer` ne s'execute qu'une fois.
    void SpeechRecognition.stop().catch(() => undefined).finally(() => void this.terminer());
  }

  abort(): void {
    this.dernier = '';
    void SpeechRecognition.stop().catch(() => undefined);
    void this.terminer();
  }

  private async lancer(): Promise<void> {
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) { this.echouer('audio-capture'); return; }
      const permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== 'granted') { this.echouer('not-allowed'); return; }

      this.ecouteurs.push(await SpeechRecognition.addListener('partialResults', ({ matches }) => {
        const texte = (matches?.[0] ?? '').trim();
        if (!texte) return;
        this.dernier = texte;
        this.emettre(texte, false);
      }));
      this.ecouteurs.push(await SpeechRecognition.addListener('listeningState', ({ status }) => {
        if (status === 'stopped') void this.terminer();
      }));

      await SpeechRecognition.start({ language: this.lang, maxResults: 1, partialResults: true, popup: false });
    } catch {
      this.echouer('erreur-native');
    }
  }

  /** La phrase en cours devient definitive, puis l'ecoute se termine, une seule fois. */
  private async terminer(): Promise<void> {
    if (this.termine) return;
    this.termine = true;
    if (this.dernier) this.emettre(this.dernier, true);
    this.dernier = '';
    const ecouteurs = this.ecouteurs;
    this.ecouteurs = [];
    await Promise.all(ecouteurs.map((e) => e.remove().catch(() => undefined)));
    this.onend?.();
  }

  private echouer(code: string): void {
    this.onerror?.({ error: code });
    void this.terminer();
  }

  private emettre(texte: string, final: boolean): void {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: texte } }] });
  }
}
