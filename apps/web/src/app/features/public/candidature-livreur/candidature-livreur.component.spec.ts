// La candidature publique d'un motard.
//
// **C'est le seul formulaire que remplit quelqu'un qui n'a pas de compte et
// qui n'en aura peut-etre jamais.** S'il echoue, personne ne le saura : le
// candidat ferme la page et va ailleurs. D'ou ce que ce fichier tient :
//   - l'adresse suit le decoupage reel du pays. A Conakry on choisit sa
//     commune dans une liste ; ailleurs on saisit son quartier, et la
//     sous-preference ne se demande que si le candidat dit ne pas habiter la
//     ville meme. Le referentiel ne connait pas de niveau « sous-prefecture » :
//     c'est le niveau « commune » qui la porte, filtre par la prefecture ;
//   - hors de Conakry le referentiel est souvent vide : la saisie reste libre
//     plutot que de bloquer un candidat sur une liste qui n'existe pas ;
//   - les pieces sont refusees **avant** l'envoi. Sur un reseau guineen,
//     decouvrir apres dix minutes de televersement qu'une photo etait trop
//     grosse se paie en temps perdu ;
//   - le bouton dit pourquoi il ne part pas. Un bouton gris et muet fait
//     chercher, puis abandonner.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { CandidatureLivreurComponent } from './candidature-livreur.component';
import { GeographieService } from '../../../core/services/geographie.service';
import { CandidatureLivreurService, TYPES_PIECES_LIVREUR } from '../../../core/services/candidature-livreur.service';
import fr from '../../../shared/i18n/fr.json';
import en from '../../../shared/i18n/en.json';

/** Les communes que le referentiel connait, par lieu englobant. */
const COMMUNES: Record<string, string[]> = {
  conakry: ['Kaloum', 'Dixinn', 'Ratoma', 'Matam', 'Matoto'],
  // Kindia n'a aucune commune enregistree : le cas le plus frequent hors
  // Conakry, et celui ou la saisie doit rester libre.
  kindia: [],
};

class GeoStub {
  readonly demandes: string[] = [];
  configuration = () => ({ indicatifTelephone: '+224', longueurNumero: 9 });
  chargerConfiguration = () => of(null);
  libelle = (role: string) => (role === 'base' ? 'Commune' : 'Préfecture');
  nomsSuggeres = (role: string, dans?: string) => {
    this.demandes.push(`${role}:${dans ?? ''}`);
    if (role === 'elargissement') return of(['Conakry', 'Kindia', 'Mamou']);
    return of(COMMUNES[(dans ?? '').toLowerCase()] ?? []);
  };
}

function monter() {
  TestBed.resetTestingModule();
  const geo = new GeoStub();
  TestBed.configureTestingModule({
    imports: [CandidatureLivreurComponent],
    providers: [
      provideZonelessChangeDetection(),
      // L'enveloppe publique porte des liens de navigation : sans routeur,
      // le composant ne se monte pas.
      provideRouter([]),
      { provide: GeographieService, useValue: geo },
      { provide: CandidatureLivreurService, useValue: { deposer: () => of({ success: true, data: null }) } },
    ],
  });
  const fixture = TestBed.createComponent(CandidatureLivreurComponent);
  fixture.detectChanges();
  const rendre = () => { fixture.detectChanges(); return fixture.nativeElement as HTMLElement; };
  return { c: fixture.componentInstance, fixture, rendre, geo };
}

function fichier(nom: string, octets: number, type: string): File {
  return new File([new Uint8Array(octets)], nom, { type });
}

/** Ce que fait le navigateur quand on choisit un fichier. */
function evenementFichier(f: File): Event {
  return { target: { files: [f], value: 'x' } } as unknown as Event;
}

/** Une date de naissance qui donne exactement cet age aujourd'hui. */
function naissancePourAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

describe('l adresse du candidat', () => {
  it('propose les communes quand le candidat est a Conakry', () => {
    const { c, rendre } = monter();

    c.changerPrefecture('Conakry');
    rendre();

    expect(c.estConakry()).toBe(true);
    expect(c.communes()).toEqual(['Kaloum', 'Dixinn', 'Ratoma', 'Matam', 'Matoto']);
    expect(rendre().querySelector('#candidature-commune')).toBeTruthy();
  });

  // Hors de Conakry, on ne demande pas d'emblee une commune : la plupart des
  // candidats habitent la ville meme, et la question n'aurait pas de sens.
  it('ne demande pas de commune pour une autre prefecture', () => {
    const { c, rendre } = monter();

    c.changerPrefecture('Kindia');
    rendre();

    expect(c.estConakry()).toBe(false);
    expect(rendre().querySelector('#candidature-commune')).toBeNull();
    expect(rendre().querySelector('#candidature-sous-prefecture')).toBeNull();
  });

  it('demande la sous-prefecture quand le candidat dit ne pas habiter la ville', () => {
    const { c, rendre } = monter();
    c.changerPrefecture('Mamou');
    rendre();

    c.basculerHorsVille(true);
    rendre();

    expect(rendre().querySelector('#candidature-sous-prefecture')).toBeTruthy();
  });

  // Le referentiel est interroge sur le niveau « base », filtre par la
  // prefecture choisie : il n'existe pas de niveau « sous-prefecture ».
  it('interroge le referentiel sur la prefecture choisie, et non sur un niveau invente', () => {
    const { c, geo } = monter();
    c.changerPrefecture('Mamou');
    geo.demandes.length = 0;

    c.basculerHorsVille(true);

    expect(geo.demandes).toEqual(['base:Mamou']);
  });

  // Sans commune enregistree, une liste vide enfermerait le candidat : la
  // saisie libre prend le relais.
  it('laisse saisir librement quand le referentiel ne connait aucune commune', () => {
    const { c, rendre } = monter();
    c.changerPrefecture('Kindia');
    c.basculerHorsVille(true);

    const champ = rendre().querySelector('#candidature-sous-prefecture');
    expect(c.communes()).toEqual([]);
    expect(champ?.tagName).toBe('INPUT');
  });

  it('oublie la commune choisie quand la prefecture change', () => {
    const { c } = monter();
    c.changerPrefecture('Conakry');
    c.modifierChamp('commune', 'Ratoma');

    c.changerPrefecture('Kindia');

    expect(c.formulaire().commune).toBe('');
    expect(c.formulaire().horsVille).toBe(false);
  });
});

describe('l age du candidat', () => {
  it('refuse un mineur, et le dit', () => {
    const { c, rendre } = monter();

    c.modifierChamp('dateNaissance', naissancePourAge(17));

    expect(c.estMineur()).toBe(true);
    expect(rendre().textContent).toContain('18 ans');
  });

  it('accepte dix-huit ans revolus', () => {
    const { c } = monter();

    c.modifierChamp('dateNaissance', naissancePourAge(18));

    expect(c.age()).toBe(18);
    expect(c.estMineur()).toBe(false);
  });
});

describe('les pieces du dossier', () => {
  it('refuse un fichier de plus de 5 Mo sans le retenir', () => {
    const { c } = monter();

    c.choisirPiece('CNI_RECTO', evenementFichier(fichier('cni.jpg', 6 * 1024 * 1024, 'image/jpeg')));

    expect(c.nomDe('CNI_RECTO')).toBeNull();
    expect(c.refusDe('CNI_RECTO')).not.toBeNull();
  });

  // Un motard photographie ses papiers : exiger un PDF serait un obstacle.
  it.each(['image/jpeg', 'image/png', 'application/pdf'])('accepte un %s', (type) => {
    const { c } = monter();
    const extension = type === 'application/pdf' ? 'pdf' : type.split('/')[1];

    c.choisirPiece('CNI_RECTO', evenementFichier(fichier(`cni.${extension}`, 2048, type)));

    expect(c.nomDe('CNI_RECTO')).toBe(`cni.${extension}`);
    expect(c.refusDe('CNI_RECTO')).toBeNull();
  });

  it('refuse un format que le serveur ne saura pas lire', () => {
    const { c } = monter();

    c.choisirPiece('CARTE_GRISE', evenementFichier(fichier('carte.docx', 2048, 'application/msword')));

    expect(c.nomDe('CARTE_GRISE')).toBeNull();
    expect(c.refusDe('CARTE_GRISE')).not.toBeNull();
  });

  it('refuse un fichier vide, qui ressemble a un televersement rate', () => {
    const { c } = monter();

    c.choisirPiece('ASSURANCE', evenementFichier(fichier('vide.pdf', 0, 'application/pdf')));

    expect(c.nomDe('ASSURANCE')).toBeNull();
  });

  it('compte ce qui manque tant que les six pieces ne sont pas la', () => {
    const { c } = monter();
    expect(c.piecesManquantes().length).toBe(6);

    for (const type of TYPES_PIECES_LIVREUR) {
      c.choisirPiece(type, evenementFichier(fichier(`${type}.jpg`, 2048, 'image/jpeg')));
    }

    expect(c.piecesManquantes()).toEqual([]);
    expect(c.piecesJointes()).toBe(6);
  });
});

describe('pourquoi le bouton ne part pas', () => {
  /** Remplit tout ce qui est exige, dossier compris. */
  function remplirTout(c: CandidatureLivreurComponent) {
    c.modifierChamp('prenom', 'Mamadou');
    c.modifierChamp('nom', 'Barry');
    c.modifierChamp('dateNaissance', naissancePourAge(28));
    c.modifierChamp('sexe', 'M');
    c.modifierChamp('telephone', '620000001');
    c.changerPrefecture('Conakry');
    c.modifierChamp('commune', 'Ratoma');
    for (const type of TYPES_PIECES_LIVREUR) {
      c.choisirPiece(type, evenementFichier(fichier(`${type}.jpg`, 2048, 'image/jpeg')));
    }
  }

  // Tant que la route serveur n'existe pas, l'ecran se montre et se remplit,
  // mais ne promet pas un envoi qui echouerait.
  it('annonce que le depot en ligne n est pas encore ouvert', () => {
    const { c, rendre } = monter();
    remplirTout(c);

    expect(c.peutEnvoyer()).toBe(false);
    expect(c.raisonBlocage()).toBe(
      (fr as Record<string, any>)['PUBLIC']['LIVREUR_REQUEST']['NOT_ACTIVE_YET'],
    );
    expect(rendre().querySelector<HTMLButtonElement>('button[type=submit]')?.disabled).toBe(true);
  });

  it('ne tente rien quand le depot est ferme', () => {
    const { c } = monter();
    remplirTout(c);

    c.envoyer();

    expect(c.envoi()).toBe(false);
    expect(c.confirmation()).toBeNull();
  });
});

describe('les textes de l ecran', () => {
  /** Les cles appelees par le composant et par son gabarit. */
  const CLES = [
    'TAG', 'TITLE_A', 'TITLE_B', 'LEAD',
    'IDENTITY', 'FIRST_NAME', 'LAST_NAME', 'BIRTH_DATE', 'AGE', 'MINOR', 'PHONE', 'EMAIL',
    'ADDRESS_SECTION', 'NOT_IN_TOWN', 'FREE_TEXT', 'QUARTIER',
    'PIECES_TITLE', 'PIECES_NOTE',
    'PIECE_BAD_FORMAT', 'PIECE_TOO_LARGE', 'PIECE_EMPTY',
    'NOT_ACTIVE_YET', 'MISSING_IDENTITY', 'MISSING_BIRTH_DATE', 'MISSING_GENDER',
    'MISSING_PHONE', 'MISSING_ADDRESS', 'MISSING_PIECES',
    'SUBMIT', 'SENDING', 'SEND_ERROR',
    'CONFIRM_TITLE', 'CONFIRM_TEXT', 'CONFIRM_NEXT',
  ];

  // Une cle absente s'affiche telle quelle a l'ecran : le candidat lit
  // « PUBLIC.LIVREUR_REQUEST.SUBMIT » sur le bouton.
  it.each([['fr', fr], ['en', en]] as const)('%s porte toutes les cles de l ecran', (_langue, catalogue) => {
    const bloc = (catalogue as Record<string, any>)['PUBLIC']['LIVREUR_REQUEST'];
    for (const cle of CLES) {
      expect(bloc[cle]).toBeTruthy();
    }
  });

  it.each([['fr', fr], ['en', en]] as const)('%s nomme et explique les six pieces', (_langue, catalogue) => {
    const bloc = (catalogue as Record<string, any>)['PUBLIC']['LIVREUR_REQUEST'];
    for (const type of TYPES_PIECES_LIVREUR) {
      expect(bloc[`PIECE_${type}`]).toBeTruthy();
      expect(bloc[`PIECE_${type}_AIDE`]).toBeTruthy();
    }
  });

  it('porte le lien de la page d accueil dans les deux langues', () => {
    expect((fr as Record<string, any>)['PUBLIC']['LINK_LIVREUR_REQUEST']).toBeTruthy();
    expect((en as Record<string, any>)['PUBLIC']['LINK_LIVREUR_REQUEST']).toBeTruthy();
  });

  // Les deux comptes du message doivent y figurer, sinon le candidat lit
  // « Joignez les pieces du dossier ( sur  jointes) ».
  it.each([['fr', fr], ['en', en]] as const)('%s garde les deux comptes des pieces', (_langue, catalogue) => {
    const texte = (catalogue as Record<string, any>)['PUBLIC']['LIVREUR_REQUEST']['MISSING_PIECES'] as string;
    expect(texte).toContain('{{jointes}}');
    expect(texte).toContain('{{total}}');
  });
});
