// app.ts — BaoBaoHealth v2
// Injecte ThemeService au démarrage pour appliquer le thème stocké
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService } from './shared/services/theme.service';
import { SocketService } from './core/services/socket.service';
import { BoutonRetourService } from './core/services/bouton-retour.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: '<router-outlet />',
  styles: []
})
export class AppComponent {
  // Injection suffit : ThemeService et SocketService appliquent leurs effets
  // via effect() dans leur propre constructeur.
  readonly theme = inject(ThemeService);
  readonly socket = inject(SocketService);
  readonly boutonRetour = inject(BoutonRetourService);

  constructor() {
    this.boutonRetour.demarrer();
  }
}
