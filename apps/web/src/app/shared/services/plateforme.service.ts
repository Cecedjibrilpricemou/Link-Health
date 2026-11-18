// shared/services/plateforme.service.ts
// Identite de la plateforme (nom, logo, coordonnees) : chargee une fois au
// demarrage depuis GET /parametres/publics, exposee en signaux. C'est la
// seule source du nom affiche — nulle part ailleurs il n'est ecrit en dur.
// Le super-admin la modifie depuis Parametres > Identite ; appliquer() met
// l'interface a jour sans rechargement.
import { Injectable, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { catchError, firstValueFrom, of } from 'rxjs';
import type { IdentitePlateformeView } from '@baobaoheath/shared-types';
import { ApiService } from '../../core/services/api.service';
import { urlMedia } from '../utils/url-media';

/** Valeurs affichees tant que l'API n'a pas repondu (ou si elle est injoignable). */
export const IDENTITE_PAR_DEFAUT: IdentitePlateformeView = {
  nom: 'Plateforme',
  nomCourt: 'PLATEFORME',
  slogan: '',
  logoUrl: '',
  adresse: '',
  ville: '',
  pays: '',
  telephone: '',
  telephoneSupport: '',
  emailContact: '',
  emailSupport: '',
  emailExpediteur: '',
  siteWeb: '',
  facebook: '',
  whatsapp: '',
  copyright: '',
  devise: 'GNF',
};

@Injectable({ providedIn: 'root' })
export class PlateformeService {
  private api   = inject(ApiService);
  private title = inject(Title);
  private document = inject(DOCUMENT);

  private identiteSignal = signal<IdentitePlateformeView>(IDENTITE_PAR_DEFAUT);

  readonly identite = this.identiteSignal.asReadonly();
  readonly nom      = computed(() => this.identiteSignal().nom);
  readonly slogan   = computed(() => this.identiteSignal().slogan);
  /** Le logo a afficher : son chemin (/uploads/logos/...) resolu chez l'API. */
  readonly logoUrl  = computed(() => urlMedia(this.identiteSignal().logoUrl));
  readonly devise   = computed(() => this.identiteSignal().devise);
  readonly copyright = computed(() => this.identiteSignal().copyright);
  /** « Ville, Pays » ou l'adresse complete si elle est renseignee. */
  readonly adresseComplete = computed(() => {
    const i = this.identiteSignal();
    return [i.adresse, i.ville, i.pays].map((p) => p.trim()).filter(Boolean).join(', ');
  });
  readonly emailContact = computed(() => this.identiteSignal().emailContact);
  readonly telephone    = computed(() => this.identiteSignal().telephone);

  /** Appele au demarrage (app.config) ; ne bloque jamais l'application si l'API est absente. */
  async charger(): Promise<void> {
    const reponse = await firstValueFrom(
      this.api.get<{ success: boolean; data: IdentitePlateformeView }>('/parametres/publics')
        .pipe(catchError(() => of(null)))
    );
    if (reponse?.data) this.appliquer(reponse.data);
  }

  /**
   * Met a jour l'identite en memoire (apres une sauvegarde depuis les
   * parametres). Les derives sont recalcules ici comme cote API, car la
   * sauvegarde renvoie les valeurs brutes (copyright vide = mention generee).
   */
  appliquer(identite: IdentitePlateformeView): void {
    const nom = identite.nom.trim() || IDENTITE_PAR_DEFAUT.nom;
    this.identiteSignal.set({
      ...IDENTITE_PAR_DEFAUT,
      ...identite,
      nom,
      copyright: identite.copyright.trim() || `© ${new Date().getFullYear()} ${nom} — Tous droits réservés`,
    });
    this.title.setTitle(nom);
    this.appliquerIcones(urlMedia(identite.logoUrl));
  }

  /**
   * L'icone de l'onglet et celle de l'ecran d'accueil (« ajouter a l'ecran
   * d'accueil ») suivent le logo televerse. Sans logo, l'onglet reprend le
   * favicon.ico d'index.html et l'icone d'accueil disparait.
   */
  private appliquerIcones(logo: string): void {
    const head = this.document.head;
    let favicon = head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) {
      favicon = this.document.createElement('link');
      favicon.rel = 'icon';
      head.appendChild(favicon);
    }
    let accueil = head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');

    if (!logo) {
      favicon.setAttribute('href', FAVICON_PAR_DEFAUT);
      favicon.type = 'image/x-icon';
      accueil?.remove();
      return;
    }
    // Le logo est un PNG (l'API reencode tout logo televerse) : le type
    // « image/x-icon » d'index.html ne lui correspond plus.
    favicon.removeAttribute('type');
    favicon.setAttribute('href', logo);
    if (!accueil) {
      accueil = this.document.createElement('link');
      accueil.rel = 'apple-touch-icon';
      head.appendChild(accueil);
    }
    accueil.setAttribute('href', logo);
  }
}

/** Le favicon livre avec l'application, pose par index.html. */
const FAVICON_PAR_DEFAUT = 'favicon.ico';
