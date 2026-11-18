// features/admin/geographie/geographie.component.ts
// Le referentiel geographique (M1) : parcourir l'arbre des lieux du pays,
// en ajouter, confirmer les donnees de depart, tenir le voisinage, et
// rattraper les lieux saisis hors liste.
//
// Les niveaux et leurs noms viennent du pays installe (Parametres > Pays) :
// cet ecran ne suppose ni « prefecture » ni « commune ».
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { LieuGeoView, LieuHorsReferentielView, UtilisationLieuGeoView } from '@baobaoheath/shared-types';
import type { Observable } from 'rxjs';
import { GeographieService } from '../../../core/services/geographie.service';
import { TranslatePipe } from '../../../shared/pipes/translate.pipe';
import { I18nService } from '../../../shared/services/i18n.service';

interface EditionVoisins {
  lieu: LieuGeoView;
  candidats: LieuGeoView[];
  selection: Set<string>;
  filtre: string;
}

/** R7 : renommer ou supprimer un lieu, apres avoir vu ce qui porte son nom. */
interface Gestion {
  lieu: LieuGeoView;
  mode: 'renommer' | 'supprimer';
  nom: string;
  utilisation: UtilisationLieuGeoView | null;
}

@Component({
  selector: 'app-admin-geographie',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslatePipe,
    MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule,
  ],
  templateUrl: './geographie.component.html',
  styleUrl: './geographie.component.scss',
})
export class GeographieComponent implements OnInit {
  readonly geo = inject(GeographieService);
  private readonly i18n = inject(I18nService);

  readonly chargement = signal(true);
  readonly action = signal<string | null>(null);
  readonly erreur = signal('');
  readonly succes = signal('');

  /** Les lieux ouverts, du plus large au plus fin (fil d'Ariane). */
  readonly chemin = signal<LieuGeoView[]>([]);
  readonly lieux = signal<LieuGeoView[]>([]);
  readonly nouveauNom = signal('');
  readonly voisins = signal<EditionVoisins | null>(null);

  readonly hors = signal<LieuHorsReferentielView[]>([]);
  /** Les lieux du niveau d'elargissement, pour rattacher un lieu saisi hors liste. */
  private readonly zones = signal<LieuGeoView[]>([]);

  /** Le niveau des lieux affiches. */
  readonly niveauCourant = computed(() => this.geo.niveaux()[this.chemin().length] ?? null);
  /** Peut-on descendre d'un niveau depuis la liste affichee ? */
  readonly peutDescendre = computed(() => this.chemin().length < this.geo.niveaux().length - 1);
  readonly decoupage = computed(() => this.geo.niveaux().map((n) => this.geo.libelleNiveau(n, 'GEO.DEFAUT_LIEU')).join(' › '));
  readonly aValider = computed(() => this.lieux().filter((l) => l.aValider).length);

  /**
   * Un lieu saisi hors liste s'ajoute en un clic quand le niveau
   * d'elargissement est juste au-dessus du niveau de base (Prefecture >
   * Commune en Guinee) : sa zone saisie designe alors son parent.
   */
  readonly ajoutDirect = computed(() => {
    const c = this.geo.configuration();
    if (!c) return false;
    const codes = c.niveaux.map((n) => n.code);
    return codes.indexOf(c.niveauElargissement) === codes.indexOf(c.niveauBase) - 1;
  });

  readonly candidatsFiltres = computed(() => {
    const e = this.voisins();
    if (!e) return [];
    const f = e.filtre.trim().toLocaleLowerCase('fr');
    return e.candidats.filter((c) => !f || c.nom.toLocaleLowerCase('fr').includes(f) || (c.parent ?? '').toLocaleLowerCase('fr').includes(f));
  });

  constructor(iconRegistry: MatIconRegistry) {
    iconRegistry.registerFontClassAlias('pi', 'pi');
  }

  ngOnInit(): void {
    this.geo.chargerConfiguration(true).subscribe(() => {
      this.chargerLieux();
      this.chargerHors();
    });
  }

  actualiser(): void {
    this.voisins.set(null);
    this.geo.chargerConfiguration(true).subscribe(() => {
      this.chargerLieux();
      this.chargerHors();
    });
  }

  chargerLieux(): void {
    const niveau = this.niveauCourant();
    if (!niveau) { this.lieux.set([]); this.chargement.set(false); return; }
    const parent = this.chemin().at(-1);
    this.chargement.set(true);
    this.geo.lieux(parent ? { parent: parent.id } : { niveau: niveau.code }).subscribe({
      next: (r) => { this.lieux.set(r.data ?? []); this.chargement.set(false); },
      error: (e: unknown) => { this.chargement.set(false); this.erreur.set(this.messageDe(e, 'ADMIN.GEO.ERR_LOAD')); },
    });
  }

  chargerHors(): void {
    this.geo.horsReferentiel().subscribe({
      next: (r) => this.hors.set(r.data ?? []),
      error: () => this.hors.set([]),
    });
    const zone = this.geo.codeNiveau('elargissement');
    if (zone) this.geo.lieux({ niveau: zone }).subscribe({ next: (r) => this.zones.set(r.data ?? []) });
  }

  ouvrir(lieu: LieuGeoView): void {
    if (!this.peutDescendre()) return;
    this.chemin.update((c) => [...c, lieu]);
    this.apresNavigation();
  }

  remonterA(index: number): void {
    this.chemin.update((c) => c.slice(0, index));
    this.apresNavigation();
  }

  private apresNavigation(): void {
    this.voisins.set(null);
    this.gestion.set(null);
    this.nouveauNom.set('');
    this.chargerLieux();
  }

  ajouter(): void {
    const nom = this.nouveauNom().trim();
    const niveau = this.niveauCourant();
    if (!nom || !niveau || this.action()) return;
    this.lancer('ajout', this.geo.creerLieu({ niveau: niveau.code, nom, idParent: this.chemin().at(-1)?.id }), () => {
      this.nouveauNom.set('');
      this.annoncer(this.i18n.t('ADMIN.GEO.SUCCESS_ADD', { nom }));
      this.chargerLieux();
      this.chargerHors();
    });
  }

  confirmer(lieu: LieuGeoView): void {
    this.lancer(lieu.id, this.geo.modifierLieu(lieu.id, { aValider: false }), () => {
      this.lieux.update((ls) => ls.map((l) => (l.id === lieu.id ? { ...l, aValider: false } : l)));
    });
  }

  confirmerTout(): void {
    const a = this.lieux().filter((l) => l.aValider);
    if (a.length === 0 || this.action()) return;
    this.action.set('tout');
    let restants = a.length;
    for (const l of a) {
      this.geo.modifierLieu(l.id, { aValider: false }).subscribe({
        next: () => { this.lieux.update((ls) => ls.map((x) => (x.id === l.id ? { ...x, aValider: false } : x))); },
        error: (e: unknown) => this.erreur.set(this.messageDe(e, 'ADMIN.GEO.ERR_SAVE')),
        complete: () => { if (--restants === 0) this.action.set(null); },
      });
    }
  }

  editerVoisins(lieu: LieuGeoView): void {
    this.gestion.set(null);
    this.geo.lieux({ niveau: lieu.niveau }).subscribe({
      next: (r) => {
        // Les lieux du meme parent d'abord : ce sont presque toujours eux.
        const candidats = (r.data ?? []).filter((c) => c.id !== lieu.id).sort((a, b) =>
          Number(b.idParent === lieu.idParent) - Number(a.idParent === lieu.idParent) || a.nom.localeCompare(b.nom, 'fr'));
        this.voisins.set({ lieu, candidats, selection: new Set(lieu.voisins.map((v) => v.id)), filtre: '' });
      },
      error: (e: unknown) => this.erreur.set(this.messageDe(e, 'ADMIN.GEO.ERR_LOAD')),
    });
  }

  basculerVoisin(id: string): void {
    this.voisins.update((e) => {
      if (!e) return e;
      const selection = new Set(e.selection);
      if (selection.has(id)) selection.delete(id); else selection.add(id);
      return { ...e, selection };
    });
  }

  filtrerVoisins(filtre: string): void {
    this.voisins.update((e) => (e ? { ...e, filtre } : e));
  }

  enregistrerVoisins(): void {
    const e = this.voisins();
    if (!e) return;
    this.lancer('voisins', this.geo.modifierLieu(e.lieu.id, { voisins: [...e.selection] }), () => {
      this.voisins.set(null);
      this.annoncer(this.i18n.t('ADMIN.GEO.SUCCESS_NEIGHBOURS', { nom: e.lieu.nom }));
      this.chargerLieux();
    });
  }

  // ── R7 : renommer, supprimer ──────────────────────────────────────
  //
  // Le nom d'un lieu est recopie dans les adresses. Le panneau montre d'abord
  // ce qui le porte : renommer le propage, supprimer n'est permis qu'a un
  // lieu que plus rien n'utilise.
  readonly gestion = signal<Gestion | null>(null);

  readonly peutRenommer = computed(() => {
    const g = this.gestion();
    const nom = g?.nom.trim() ?? '';
    return !!g && g.mode === 'renommer' && !!nom && nom !== g.lieu.nom && !this.action();
  });

  /** Inutilise : ni enfant, ni adresse, ni appel en cours. Tant que le compte n'est pas la, non. */
  readonly inutilise = computed(() => {
    const u = this.gestion()?.utilisation;
    return !!u && u.enfants + u.structures + u.patients + u.motards + u.appelsEnCours === 0;
  });

  readonly peutSupprimer = computed(() => this.gestion()?.mode === 'supprimer' && this.inutilise() && !this.action());

  ouvrirGestion(lieu: LieuGeoView, mode: 'renommer' | 'supprimer'): void {
    this.voisins.set(null);
    this.erreur.set('');
    this.gestion.set({ lieu, mode, nom: lieu.nom, utilisation: null });
    this.geo.utilisationLieu(lieu.id).subscribe({
      next: (r) => this.gestion.update((g) => (g && g.lieu.id === lieu.id ? { ...g, utilisation: r.data ?? null } : g)),
      error: (e: unknown) => this.erreur.set(this.messageDe(e, 'ADMIN.GEO.ERR_LOAD')),
    });
  }

  saisirNom(nom: string): void {
    this.gestion.update((g) => (g ? { ...g, nom } : g));
  }

  fermerGestion(): void {
    this.gestion.set(null);
  }

  confirmerRenommage(): void {
    const g = this.gestion();
    if (!g || !this.peutRenommer()) return;
    const nom = g.nom.trim();
    this.lancer('renommer', this.geo.renommerLieu(g.lieu.id, nom), (data) => {
      this.gestion.set(null);
      const r = data?.renommes;
      this.annoncer(this.i18n.t('ADMIN.GEO.SUCCESS_RENAME', {
        avant: g.lieu.nom, nom,
        structures: r?.structures ?? 0, patients: r?.patients ?? 0, motards: r?.motards ?? 0, appels: r?.appelsEnCours ?? 0,
      }));
      this.chargerLieux();
      this.chargerHors();
    });
  }

  confirmerSuppression(): void {
    const g = this.gestion();
    if (!g || !this.peutSupprimer()) return;
    this.lancer('supprimer', this.geo.supprimerLieu(g.lieu.id), () => {
      this.gestion.set(null);
      this.annoncer(this.i18n.t('ADMIN.GEO.SUCCESS_DELETE', { nom: g.lieu.nom }));
      this.chargerLieux();
    });
  }

  chargerJeu(): void {
    this.lancer('jeu', this.geo.chargerJeuDeDepart(), (data) => {
      this.annoncer(this.i18n.t('ADMIN.GEO.SUCCESS_STARTER', { crees: data?.crees ?? 0, presents: data?.dejaPresents ?? 0 }));
      this.chemin.set([]);
      this.chargerLieux();
      this.chargerHors();
    });
  }

  /** La zone saisie avec un lieu hors liste, si elle est au referentiel. */
  zoneDe(h: LieuHorsReferentielView): LieuGeoView | undefined {
    const z = h.zone.trim().toLocaleLowerCase('fr');
    return this.zones().find((l) => l.nom.toLocaleLowerCase('fr') === z);
  }

  ajouterHors(h: LieuHorsReferentielView): void {
    const parent = this.zoneDe(h);
    const base = this.geo.codeNiveau('base');
    if (!parent || !base) return;
    this.lancer(`hors-${h.zone}-${h.lieu}`, this.geo.creerLieu({ niveau: base, nom: h.lieu, idParent: parent.id }), () => {
      this.annoncer(this.i18n.t('ADMIN.GEO.SUCCESS_ADD', { nom: h.lieu }));
      this.chargerHors();
      this.chargerLieux();
    });
  }

  private lancer<T>(cle: string, flux: Observable<{ data?: T }>, apres: (data: T | undefined) => void): void {
    if (this.action()) return;
    this.action.set(cle);
    this.erreur.set('');
    flux.subscribe({
      next: (r) => { this.action.set(null); apres(r.data); },
      error: (e: unknown) => { this.action.set(null); this.erreur.set(this.messageDe(e, 'ADMIN.GEO.ERR_SAVE')); },
    });
  }

  private annoncer(message: string): void {
    this.succes.set(message);
    setTimeout(() => this.succes.set(''), 4000);
  }

  private messageDe(erreur: unknown, cle: string): string {
    const e = erreur as { error?: { error?: string; message?: string } };
    return e?.error?.error ?? e?.error?.message ?? this.i18n.t(cle);
  }
}
