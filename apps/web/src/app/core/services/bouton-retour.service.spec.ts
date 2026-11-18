import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { BoutonRetourService } from './bouton-retour.service';

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  exitApp: vi.fn(),
  closeAll: vi.fn(),
  isNativePlatform: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: mocks.addListener,
    exitApp: mocks.exitApp,
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: mocks.isNativePlatform,
  },
}));

describe('BoutonRetourService', () => {
  let service: BoutonRetourService;
  let openDialogs: unknown[];

  beforeEach(() => {
    openDialogs = [];
    mocks.addListener.mockReset();
    mocks.exitApp.mockReset();
    mocks.closeAll.mockReset();
    mocks.isNativePlatform.mockReset();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: MatDialog,
          useValue: {
            get openDialogs() {
              return openDialogs;
            },
            closeAll: mocks.closeAll,
          },
        },
      ],
    });
    service = TestBed.inject(BoutonRetourService);
  });

  it('ferme une boîte de dialogue sans revenir en arrière ni quitter l’application', () => {
    openDialogs = [{}];
    const retourArriere = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    service.gerer(true);

    expect(mocks.closeAll).toHaveBeenCalledOnce();
    expect(retourArriere).not.toHaveBeenCalled();
    expect(mocks.exitApp).not.toHaveBeenCalled();
    retourArriere.mockRestore();
  });

  it('revient en arrière lorsque l’historique le permet', () => {
    const retourArriere = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    service.gerer(true);

    expect(retourArriere).toHaveBeenCalledOnce();
    expect(mocks.exitApp).not.toHaveBeenCalled();
    retourArriere.mockRestore();
  });

  it('quitte l’application lorsque l’historique ne permet pas de revenir en arrière', () => {
    service.gerer(false);

    expect(mocks.exitApp).toHaveBeenCalledOnce();
  });

  it('n’enregistre aucun écouteur hors de la plateforme native', () => {
    mocks.isNativePlatform.mockReturnValue(false);

    service.demarrer();

    expect(mocks.isNativePlatform).toHaveBeenCalledOnce();
    expect(App.addListener).not.toHaveBeenCalled();
  });

  it('sur le telephone, branche le bouton retour sur la meme logique', () => {
    mocks.isNativePlatform.mockReturnValue(true);

    service.demarrer();

    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    // L'evenement natif, sans historique : on quitte l'application.
    const ecouteur = mocks.addListener.mock.calls[0][1] as (e: { canGoBack: boolean }) => void;
    ecouteur({ canGoBack: false });
    expect(mocks.exitApp).toHaveBeenCalledOnce();
  });
});
