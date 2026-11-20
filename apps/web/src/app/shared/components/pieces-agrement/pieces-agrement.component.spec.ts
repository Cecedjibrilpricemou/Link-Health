// Ce que le bloc des pièces doit tenir.
//
// Deux comportements dangereux, et ce sont eux qui justifient ce fichier :
//   - **les fichiers d'un type ne doivent pas suivre un changement de type.**
//     Sans la remise à zéro, on joindrait le diplôme saisi pour une clinique
//     à un poste de santé, qui n'en demande aucun.
//   - **un refus doit vider le champ.** Un fichier trop gros laissé en place
//     partirait quand même, et le serveur le rejetterait après la montée —
//     sur un réseau guinéen, c'est du temps perdu pour rien.
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import type { TypePieceAgrement } from '@baobaoheath/shared-types';

import { PiecesAgrementComponent } from './pieces-agrement.component';

/** Un faux évènement de champ fichier, avec le `value` qu'on veut relire. */
function evenement(fichier: File | null) {
  const champ = { files: fichier ? [fichier] : [], value: 'C:\\\\faux\\\\chemin.pdf' };
  return { target: champ } as unknown as Event & { target: { value: string } };
}

function pdf(nom = 'agrement.pdf', octets = 2048): File {
  return new File([new Uint8Array(octets)], nom, { type: 'application/pdf' });
}

function monter(type: string, sousAutorite = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PiecesAgrementComponent],
    providers: [provideZonelessChangeDetection()],
  });
  const fixture = TestBed.createComponent(PiecesAgrementComponent);
  fixture.componentRef.setInput('type', type);
  fixture.componentRef.setInput('sousAutoriteDuParent', sousAutorite);
  fixture.detectChanges();
  return fixture;
}

describe('les pieces a joindre', () => {
  it.each(['PHARMACIE', 'CLINIQUE', 'LABORATOIRE'])(
    '%s demande les quatre pieces sanitaires',
    (type) => {
      const f = monter(type);
      expect([...f.componentInstance.requises()].sort()).toEqual([
        'AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
      ]);
    },
  );

  // ── La liste imposee par l'appelant ────────────────────────────────
  //
  // **Elle est comparee sur son contenu, pas sur son identite.** Les
  // appelants la rebatissent a chaque detection de changement ; s'en tenir a
  // l'identite rejouait sans fin l'effet qui remet les choix a zero, et le
  // fichier a peine choisi disparaissait. Mais comparer trop grossierement
  // ferait l'inverse : une liste vraiment nouvelle passerait inapercue.

  it('prend la liste imposee a la place de sa table locale', () => {
    const f = monter('PHARMACIE');
    f.componentRef.setInput('requisesImposees', ['AGREMENT_CREATION', 'DIPLOME_RESPONSABLE']);
    f.detectChanges();

    expect(f.componentInstance.requises()).toEqual(['AGREMENT_CREATION', 'DIPLOME_RESPONSABLE']);
  });

  // Meme longueur, pieces differentes : comparer les tailles ne suffit pas.
  it('suit une liste de meme longueur mais de contenu different', () => {
    const f = monter('PHARMACIE');
    f.componentRef.setInput('requisesImposees', ['AGREMENT_CREATION', 'DIPLOME_RESPONSABLE']);
    f.detectChanges();

    f.componentRef.setInput('requisesImposees', ['AGREMENT_ASSURANCE', 'INSCRIPTION_ORDRE']);
    f.detectChanges();

    expect(f.componentInstance.requises()).toEqual(['AGREMENT_ASSURANCE', 'INSCRIPTION_ORDRE']);
  });

  // Le meme contenu dans un tableau neuf ne doit rien rejouer : c'est ce que
  // fait un appelant qui construit sa liste dans une methode.
  it('ne perd pas un fichier quand la meme liste revient dans un tableau neuf', () => {
    const f = monter('PHARMACIE');
    f.componentRef.setInput('requisesImposees', ['AGREMENT_CREATION', 'DIPLOME_RESPONSABLE']);
    f.detectChanges();

    f.componentInstance.choisir('AGREMENT_CREATION', evenement(pdf()));
    f.detectChanges();
    expect(f.componentInstance.nomDe('AGREMENT_CREATION')).toBe('agrement.pdf');

    // Meme contenu, tableau neuf — exactement ce que produit un `.map()`.
    f.componentRef.setInput('requisesImposees', ['AGREMENT_CREATION', 'DIPLOME_RESPONSABLE']);
    f.detectChanges();

    expect(f.componentInstance.nomDe('AGREMENT_CREATION')).toBe('agrement.pdf');
  });

  // L'assureur relève de la Banque Centrale : ni diplôme ni ordre professionnel.
  // Mais l'extrait RCCM de la compagnie, et l'identité et la résidence de son
  // responsable.
  it('l assureur demande son agrement, son extrait RCCM, et l identite et la residence du responsable', () => {
    const f = monter('ASSURANCE');
    expect(f.componentInstance.requises()).toEqual([
      'AGREMENT_ASSURANCE', 'EXTRAIT_RCCM', 'PIECE_IDENTITE_RESPONSABLE', 'CERTIFICAT_RESIDENCE_RESPONSABLE',
    ]);
  });

  // **Un CHU n'a pas d'agrément privé à produire.** Le bloc ne doit pas même
  // s'afficher, sinon l'administrateur cherche un document qui n'existe pas.
  it.each(['POSTE', 'CENTRE', 'HOPITAL_PREF', 'HOPITAL_REG', 'CHU'])(
    'le public (%s) ne demande rien',
    (type) => {
      const f = monter(type);
      expect(f.componentInstance.requises()).toEqual([]);
      expect(f.componentInstance.exigeDesPieces()).toBe(false);
    },
  );

  // Une pharmacie hospitalière existe par l'autorisation de son hôpital.
  it('une pharmacie sous l autorite de son hopital ne demande rien', () => {
    const f = monter('PHARMACIE', true);
    expect(f.componentInstance.requises()).toEqual([]);
  });
});

describe('le compte des pieces jointes', () => {
  it('n est complet que lorsque les quatre sont la', () => {
    const f = monter('CLINIQUE');
    const recus: boolean[] = [];
    f.componentInstance.complet.subscribe((v) => recus.push(v));

    const types: TypePieceAgrement[] = [
      'AGREMENT_CREATION', 'AGREMENT_EXPLOITATION', 'DIPLOME_RESPONSABLE', 'INSCRIPTION_ORDRE',
    ];
    for (const t of types) f.componentInstance.choisir(t, evenement(pdf()));

    expect(recus).toEqual([false, false, false, true]);
    expect(f.componentInstance.manquantes()).toEqual([]);
  });

  it('redevient incomplet quand on retire une piece', () => {
    const f = monter('ASSURANCE');
    for (const t of f.componentInstance.requises()) f.componentInstance.choisir(t, evenement(pdf()));
    expect(f.componentInstance.manquantes()).toEqual([]);

    f.componentInstance.retirer('AGREMENT_ASSURANCE');
    expect(f.componentInstance.manquantes()).toEqual(['AGREMENT_ASSURANCE']);
  });

  it('remonte au parent les fichiers retenus', () => {
    const f = monter('ASSURANCE');
    let dernier: Partial<Record<TypePieceAgrement, File>> = {};
    f.componentInstance.pieces.subscribe((p) => { dernier = p; });

    const fichier = pdf('bcrg.pdf');
    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(fichier));

    expect(dernier['AGREMENT_ASSURANCE']).toBe(fichier);
  });
});

describe('les refus avant l envoi', () => {
  // 5 Mo, comme le serveur. Le contrôle existe pour ne pas faire monter
  // 20 Mo avant de se faire refuser.
  it('refuse un fichier de plus de 5 Mo et ne le retient pas', () => {
    const f = monter('ASSURANCE');
    const trop = pdf('enorme.pdf', 5 * 1024 * 1024 + 1);

    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(trop));

    expect(f.componentInstance.refusDe('AGREMENT_ASSURANCE')).toBe('AGREMENT.PIECE.TROP_GROS');
    expect(f.componentInstance.nomDe('AGREMENT_ASSURANCE')).toBeNull();
    expect(f.componentInstance.manquantes()).toContain('AGREMENT_ASSURANCE');
  });

  it('accepte un fichier juste sous la limite', () => {
    const f = monter('ASSURANCE');
    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(pdf('juste.pdf', 5 * 1024 * 1024)));
    expect(f.componentInstance.refusDe('AGREMENT_ASSURANCE')).toBeNull();
  });

  it('refuse un fichier qui n est pas un PDF', () => {
    const f = monter('ASSURANCE');
    const image = new File([new Uint8Array(1024)], 'agrement.png', { type: 'image/png' });

    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(image));

    expect(f.componentInstance.refusDe('AGREMENT_ASSURANCE')).toBe('AGREMENT.PIECE.PAS_UN_PDF');
    expect(f.componentInstance.nomDe('AGREMENT_ASSURANCE')).toBeNull();
  });

  // Certains navigateurs ne renseignent pas `type` : l'extension sert alors de
  // dernier indice. Le serveur, lui, lit les octets de tête.
  it('accepte un .pdf dont le navigateur ne donne pas le type', () => {
    const f = monter('ASSURANCE');
    const sansType = new File([new Uint8Array(1024)], 'agrement.pdf', { type: '' });

    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(sansType));

    expect(f.componentInstance.refusDe('AGREMENT_ASSURANCE')).toBeNull();
    expect(f.componentInstance.nomDe('AGREMENT_ASSURANCE')).toBe('agrement.pdf');
  });

  it('un nouveau choix valide efface le refus precedent', () => {
    const f = monter('ASSURANCE');
    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(pdf('x.pdf', 6 * 1024 * 1024)));
    expect(f.componentInstance.refusDe('AGREMENT_ASSURANCE')).not.toBeNull();

    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(pdf()));
    expect(f.componentInstance.refusDe('AGREMENT_ASSURANCE')).toBeNull();
  });
});

// **Le cas qui compte.**
describe('le changement de type', () => {
  it('oublie les fichiers choisis pour le type precedent', () => {
    const f = monter('CLINIQUE');
    f.componentInstance.choisir('DIPLOME_RESPONSABLE', evenement(pdf('diplome.pdf')));
    expect(f.componentInstance.nomDe('DIPLOME_RESPONSABLE')).toBe('diplome.pdf');

    // L'administrateur se corrige : ce n'était pas une clinique.
    f.componentRef.setInput('type', 'CHU');
    f.detectChanges();

    expect(f.componentInstance.nomDe('DIPLOME_RESPONSABLE')).toBeNull();
    expect(f.componentInstance.requises()).toEqual([]);
  });

  it('declare complet un type public, pour ne pas bloquer l envoi', () => {
    const f = monter('CLINIQUE');
    const recus: boolean[] = [];
    f.componentInstance.complet.subscribe((v) => recus.push(v));

    f.componentRef.setInput('type', 'POSTE');
    f.detectChanges();

    expect(recus[recus.length - 1]).toBe(true);
  });

  it('oublie aussi un refus affiche', () => {
    const f = monter('CLINIQUE');
    f.componentInstance.choisir('AGREMENT_CREATION', evenement(pdf('x.pdf', 6 * 1024 * 1024)));
    expect(f.componentInstance.refusDe('AGREMENT_CREATION')).not.toBeNull();

    f.componentRef.setInput('type', 'LABORATOIRE');
    f.detectChanges();

    expect(f.componentInstance.refusDe('AGREMENT_CREATION')).toBeNull();
  });
});

describe('l affichage de la taille', () => {
  it('compte en Ko sous le mega-octet', () => {
    const f = monter('ASSURANCE');
    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(pdf('p.pdf', 204800)));
    expect(f.componentInstance.tailleDe('AGREMENT_ASSURANCE')).toBe('200 Ko');
  });

  it('compte en Mo au-dela', () => {
    const f = monter('ASSURANCE');
    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(pdf('p.pdf', 2 * 1024 * 1024)));
    expect(f.componentInstance.tailleDe('AGREMENT_ASSURANCE')).toBe('2.0 Mo');
  });

  // Un fichier minuscule ne doit pas s'afficher « 0 Ko », qui ressemble a un
  // televersement rate.
  it('n affiche jamais zero', () => {
    const f = monter('ASSURANCE');
    f.componentInstance.choisir('AGREMENT_ASSURANCE', evenement(pdf('p.pdf', 12)));
    expect(f.componentInstance.tailleDe('AGREMENT_ASSURANCE')).toBe('1 Ko');
  });
});
