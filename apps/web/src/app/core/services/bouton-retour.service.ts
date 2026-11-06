import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

@Injectable({ providedIn: 'root' })
export class BoutonRetourService {
  constructor(private readonly dialog: MatDialog) {}

  demarrer(): void {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    void App.addListener('backButton', ({ canGoBack }) => {
      this.gerer(canGoBack);
    });
  }

  gerer(canGoBack: boolean): void {
    if (this.dialog.openDialogs.length > 0) {
      this.dialog.closeAll();
      return;
    }

    if (canGoBack) {
      window.history.back();
      return;
    }

    void App.exitApp();
  }
}
