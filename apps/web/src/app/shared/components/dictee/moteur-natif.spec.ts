import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const callbacks = new Map<string, (data: { matches?: string[]; status?: string }) => void>();
  const remove = vi.fn(() => Promise.resolve());
  const speechRecognition = {
    available: vi.fn(),
    requestPermissions: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    addListener: vi.fn((eventName: string, callback: (data: { matches?: string[]; status?: string }) => void) => {
      callbacks.set(eventName, callback);
      return Promise.resolve({ remove });
    }),
  };
  return { callbacks, remove, speechRecognition };
});

vi.mock('@capacitor-community/speech-recognition', () => ({
  SpeechRecognition: mocks.speechRecognition,
}));

import { MoteurNatif } from './moteur-natif';

const attendre = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('moteur natif de dictee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callbacks.clear();
    mocks.speechRecognition.available.mockResolvedValue({ available: true });
    mocks.speechRecognition.requestPermissions.mockResolvedValue({ speechRecognition: 'granted' });
    mocks.speechRecognition.start.mockResolvedValue({});
    mocks.speechRecognition.stop.mockResolvedValue(undefined);
  });

  it('signale une permission refusee et termine', async () => {
    mocks.speechRecognition.requestPermissions.mockResolvedValue({ speechRecognition: 'denied' });
    const moteur = new MoteurNatif();
    const onerror = vi.fn();
    const onend = vi.fn();
    moteur.onerror = onerror;
    moteur.onend = onend;

    moteur.start();
    await attendre();

    expect(onerror).toHaveBeenCalledWith({ error: 'not-allowed' });
    expect(onend).toHaveBeenCalledTimes(1);
    expect(mocks.speechRecognition.start).not.toHaveBeenCalled();
  });

  it('signale le plugin indisponible et termine', async () => {
    mocks.speechRecognition.available.mockResolvedValue({ available: false });
    const moteur = new MoteurNatif();
    const onerror = vi.fn();
    const onend = vi.fn();
    moteur.onerror = onerror;
    moteur.onend = onend;

    moteur.start();
    await attendre();

    expect(onerror).toHaveBeenCalledWith({ error: 'audio-capture' });
    expect(onend).toHaveBeenCalledTimes(1);
  });

  it('demarre avec les options et la langue choisies', async () => {
    const moteur = new MoteurNatif();
    moteur.lang = 'en-US';

    moteur.start();
    await attendre();

    expect(mocks.speechRecognition.start).toHaveBeenCalledWith({
      language: 'en-US',
      maxResults: 1,
      partialResults: true,
      popup: false,
    });
  });

  it('transmet les resultats provisoires', async () => {
    const moteur = new MoteurNatif();
    const onresult = vi.fn();
    moteur.onresult = onresult;

    moteur.start();
    await attendre();
    mocks.callbacks.get('partialResults')?.({ matches: ['bonjour docteur'] });

    expect(onresult).toHaveBeenCalledWith({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: 'bonjour docteur' } }],
    });
  });

  it('finalise le dernier texte et retire les ecouteurs une seule fois', async () => {
    const moteur = new MoteurNatif();
    const onresult = vi.fn();
    const onend = vi.fn();
    moteur.onresult = onresult;
    moteur.onend = onend;

    moteur.start();
    await attendre();
    mocks.callbacks.get('partialResults')?.({ matches: ['bonjour docteur'] });
    mocks.callbacks.get('listeningState')?.({ status: 'stopped' });
    mocks.callbacks.get('listeningState')?.({ status: 'stopped' });
    await attendre();

    expect(onresult).toHaveBeenLastCalledWith({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'bonjour docteur' } }],
    });
    expect(onend).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it('termine apres abort sans emettre de resultat final', async () => {
    const moteur = new MoteurNatif();
    const onresult = vi.fn();
    const onend = vi.fn();
    moteur.onresult = onresult;
    moteur.onend = onend;

    moteur.start();
    await attendre();
    mocks.callbacks.get('partialResults')?.({ matches: ['bonjour docteur'] });
    moteur.abort();
    await attendre();

    expect(onresult).toHaveBeenCalledTimes(1);
    expect(onresult).toHaveBeenCalledWith({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: 'bonjour docteur' } }],
    });
    expect(onend).toHaveBeenCalledTimes(1);
  });

  it('garde la derniere phrase quand on arrete, meme sans evenement du telephone', async () => {
    const moteur = new MoteurNatif();
    const onresult = vi.fn();
    const onend = vi.fn();
    moteur.onresult = onresult;
    moteur.onend = onend;

    moteur.start();
    await attendre();
    mocks.callbacks.get('partialResults')?.({ matches: ['mal au ventre'] });
    moteur.stop();
    await attendre();
    // Le telephone n'a encore rien signale : la phrase est deja definitive.
    expect(onresult).toHaveBeenLastCalledWith({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'mal au ventre' } }],
    });
    expect(onend).toHaveBeenCalledTimes(1);
    // Puis l'evenement arrive quand meme : rien ne doit etre emis deux fois.
    mocks.callbacks.get('listeningState')?.({ status: 'stopped' });
    await attendre();

    expect(mocks.speechRecognition.stop).toHaveBeenCalledTimes(1);
    expect(onresult).toHaveBeenLastCalledWith({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: 'mal au ventre' } }],
    });
    expect(onresult).toHaveBeenCalledTimes(2);
    expect(onend).toHaveBeenCalledTimes(1);
  });
});
