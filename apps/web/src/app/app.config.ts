// app.config.ts — BaoBaoHealth v2
import { ApplicationConfig, provideZonelessChangeDetection, APP_INITIALIZER, LOCALE_ID, inject, isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

// Dates et nombres des pipes Angular en francais (« samedi 20 septembre 2026 »,
// « 12 500 »). Sans cela, DatePipe rend en anglais americain.
registerLocaleData(localeFr);
import { provideRouter, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideToastr } from 'ngx-toastr';
import { catchError, of, switchMap } from 'rxjs';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';
import { PlateformeService } from './shared/services/plateforme.service';

// Nom, logo et coordonnees de la plateforme : lus avant le premier rendu pour
// que la marque n'apparaisse jamais avec sa valeur de repli.
function initializePlateforme() {
  const plateforme = inject(PlateformeService);
  return () => plateforme.charger();
}

function initializeAuth() {
  const auth = inject(AuthService);
  // Attempt a silent token refresh on app boot. The HttpOnly cookie is sent
  // automatically; if it's missing or expired we just leave the user unauthenticated.
  return () => auth.refreshToken().pipe(
    switchMap(() => auth.fetchCurrentUser()),
    catchError(() => of(null))
  );
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    { provide: LOCALE_ID, useValue: 'fr' },
    // Site public : un lien « /#how » defile jusqu'a la section depuis
    // n'importe quelle page, et chaque nouvelle page s'ouvre en haut. Les
    // espaces connectes defilent dans leur propre zone : non concernes.
    provideRouter(routes, withViewTransitions(), withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' })),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: APP_INITIALIZER, useFactory: initializePlateforme, multi: true },
    { provide: APP_INITIALIZER, useFactory: initializeAuth, multi: true },
    provideAnimationsAsync(),
    // Hors ligne (§4.3) : la coquille de l'application est mise en cache pour
    // se charger sans reseau. Les reponses de l'API ne le sont jamais (voir
    // ngsw-config.json). Enregistre une fois l'application stable, ou au bout
    // de 30 s, pour ne pas ralentir le premier affichage en faible debit.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideToastr({
      positionClass: 'toast-top-right',
      preventDuplicates: true,
      timeOut: 4000
    })
  ]
};
