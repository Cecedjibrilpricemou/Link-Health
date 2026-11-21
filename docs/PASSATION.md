# OmniCare — dossier de passation

> Écrit le **2026-11-19** pour qu'une personne, ou une IA, reprenne ce projet
> sans rien deviner. Chaque chiffre a été recompté dans le dépôt ce jour-là.
>
> **Si ce fichier et le code se contredisent, le code a raison** : corrigez ce
> fichier.
>
> `docs/REPRISE-PROJET.md` reste la référence de fond — architecture, parcours
> métier, feuille de route. Mais il date du **2026-10-02** et ses compteurs
> sont périmés : il annonce 568 tests API et 21 tests web, il y en a
> aujourd'hui 2707 et 606. Lisez-le pour le *pourquoi*, pas pour les chiffres.

---

## 1. Ce qu'est le projet

Une plateforme de santé numérique pour la **Guinée**. Elle relie sur un dossier
unique : patients, agents de santé communautaire, hôpitaux, laboratoires,
médecins, pharmacies, livreurs à moto, compagnies d'assurance et
administrations.

La promesse : **le patient ne se déplace qu'une fois**. Analyses, consultation,
ordonnance, pharmacie, paiement et livraison suivent depuis son dossier.

Le produit s'appelle **OmniCare** ; le dépôt et beaucoup de fichiers portent
encore les noms historiques *KÈNÈYA* et *BaoBaoHealth*. Ce sont les mêmes.

**Le dépôt GitHub est public.** Aucun secret, aucune donnée réelle de patient,
aucune information personnelle ne doit y entrer — ni dans le code, ni dans les
tests, ni dans les messages de commit.

---

## 2. L'état au 2026-11-19

| | |
|---|---|
| Monorepo | npm workspaces : `apps/api`, `apps/web`, `packages/shared-types`. **Un seul `package-lock.json`, à la racine.** |
| API | Node 24, Express, TypeScript, Prisma 7 / PostgreSQL 16 — 39 fichiers de routes, 67 services |
| Web | Angular 21 **standalone + signaux + zoneless**, Angular Material, i18n maison FR/EN — 96 composants dans `features/` |
| Modèle | **80 modèles Prisma, 47 enums, 81 migrations, 14 rôles** |
| Tests API | **2707 tests, 118 suites** (Jest 30) |
| Tests web | **606 tests, 75 fichiers** (Vitest 4) |
| Hébergement | VPS **Hostinger** piloté par **Dokploy**, tout en conteneurs Docker |

Branche de référence : **`main`**. Le travail se fait sur une branche par sujet,
poussée, puis fusionnée par pull request.

---

## 3. Comment travailler ici

### Démarrer

```bash
npm ci                     # à la racine, installe les trois workspaces
npm run dev                # API + web ensemble
```

### Les commandes qui comptent

```bash
# API — depuis apps/api
npx tsc --noEmit                                   # types
npx jest --silent                                  # 2707 tests
npx jest tests/<fichier>.test.ts                   # une suite

# Web — depuis apps/web
npx ng test --watch=false                          # 606 tests
npx ng test --include='**/features/x/*.spec.ts' --watch=false
npx ng build                                       # doit passer sans erreur

# Racine
node scripts/audit-gate.mjs                        # portillon de sécurité
```

**Les trois doivent passer avant tout commit** : types, tests, build.

### Le portillon d'audit

`scripts/audit-gate.mjs` fait échouer la CI sur tout avis **high** ou
**critical** de `npm audit`. Il n'y a aujourd'hui **aucune exception en cours**.
Si une faille sans correctif amont apparaît, on l'ajoute dans `EXCEPTIONS` avec
son identifiant GHSA, une date de réexamen et **un motif écrit qui explique
pourquoi elle ne nous expose pas** — pas seulement qu'elle gêne.

---

## 4. Les règles, sans exception

### Git

- **Jamais `git add -A`.** On ajoute les fichiers un par un, explicitement.
- Les messages de commit sont en **français**, à l'impératif, forme
  `type(portee): resume`. Ils décrivent le défaut corrigé et pourquoi.
- **Aucune mention d'une IA, d'un assistant ou d'un outil de génération** dans
  un message de commit, un push ou un texte de pull request. Pas de ligne
  `Co-Authored-By`, pas d'emoji, aucune information personnelle.
- Une branche par sujet, jamais de travail direct sur `main`.

### Fins de ligne et encodage

- `.ts`, `.html`, `.scss`, `.json` : **CRLF**, UTF-8 **sans BOM**.
- `schema.prisma` et `migrations/*.sql` : **LF**.
- Un fichier neuf écrit en LF casse les outils qui cherchent une ancre sur
  plusieurs lignes, et produit un diff entier au prochain checkout. Vérifiez.

### Internationalisation

- **Aucun texte en dur dans un gabarit.** Tout passe par le pipe `translate`.
- Toute clé ajoutée va dans **`apps/web/src/app/shared/i18n/fr.json` ET
  `en.json`**, au même endroit de l'arborescence.
- Les deux catalogues doivent rester du JSON valide et porter exactement les
  mêmes clés. Une clé absente s'affiche telle quelle à l'écran : l'utilisateur
  lit `PUBLIC.LIVREUR_REQUEST.SUBMIT` sur un bouton.
- Insérez par **manipulation textuelle** avec des ancres, jamais par
  `JSON.parse` + `JSON.stringify` : reformater le catalogue entier produit un
  diff de 4000 lignes où la vraie modification devient invisible.

### Tests

- API : **Jest**. Web : **Vitest** — `vi.fn()`, jamais `jasmine.createSpy()`.
- Les composants se montent avec `provideZonelessChangeDetection()`, et
  `provideRouter([])` dès qu'un gabarit contient un `routerLink`.
- **Un test ne se modifie pas pour le faire passer.** S'il casse, c'est le code
  nouveau qui est en cause — sauf si la règle métier a changé, et alors on
  corrige le test en disant pourquoi dans le commit.
- Les commentaires de test expliquent **quel défaut réel** ils empêchent de
  revenir, pas ce que fait la ligne suivante.

### Ce qu'on ne touche pas sans accord explicite

- `apps/api/prisma/schema.prisma` et les migrations existantes.
- `withFieldEncryption`, `DB_ENCRYPTION_KEY`, `reset-demo-passwords.ts`.
- `features/patient/dossier/`.
- `npm audit fix --force` et Prisma 8 : interdits.
- Les mots de passe ne s'affichent jamais, nulle part.

---

## 5. Les pièges qui ont déjà coûté cher

### Angular : le `computed` figé

Un `computed()` qui lit une **propriété ordinaire** (non-signal) n'a aucune
dépendance réactive : il est évalué une fois, puis figé pour toujours. Dans ce
cas, écrivez une **méthode**.

> Vécu : `exigeUnDossier` était un `computed` lisant `newStructure.type`.
> Choisir « Clinique » ne faisait pas apparaître le dossier réglementaire,
> l'écran laissait partir la création, et le serveur la refusait sur des champs
> qu'il n'avait jamais montrés.

### Angular : l'identité des entrées

Angular compare les entrées de composant **par identité**, et n'accepte pas de
comparateur sur une entrée. Un parent qui construit un tableau avec `.map()`
dans une méthode produit une valeur neuve à chaque détection de changement :
tout ce qui lit cette entrée se rejoue en boucle.

> Vécu : la correction du `computed` figé ci-dessus a introduit ce défaut. Un
> fichier joint était effacé à l'instant où on le choisissait, et la détection
> de changement bouclait (NG0103). La parade : interposer un
> `computed(() => this.entree(), { equal: comparaisonDeContenu })` — `computed`,
> lui, accepte une égalité.

### Prisma : l'index trigramme

`medicaments_recherche_trgm` existe en base mais **n'est pas déclaré dans
`schema.prisma`**. Prisma ne le connaît donc pas, et **chaque migration générée
veut le supprimer**. Retirez ce `DROP INDEX` à la main avant d'appliquer une
migration, sinon la recherche de médicaments tombe en production.

**Même règle pour `commandes_origine_par_ordonnance`** (migration
`20261120180000_commande_prise_partielle`) : un index unique **partiel**
(`WHERE "idCommandeOrigine" IS NULL`), écrit en SQL brut parce que Prisma ne
sait pas les déclarer. Il garantit **une seule commande d'origine par
ordonnance** depuis que les reliquats y ont droit à plusieurs commandes. Si une
migration générée propose de le supprimer, retirez la ligne : sans lui, deux
lancements simultanés feraient deux commandes complètes pour la même
ordonnance.

### Prisma : ne pas lancer `prisma format`

Il réaligne **tout** `schema.prisma` : une modification de trois lignes devient
un diff de plusieurs dizaines, qui entre en conflit avec chaque branche ouverte.
Ajoutez les champs à la main, alignés sur leurs voisins, puis
`npx prisma validate`. Pour générer la migration, `prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script` contre une
base jetable où toutes les migrations sont appliquées, puis retirez le
`DROP INDEX` de l'index trigramme (ci-dessus).

### Commandes : le stock vérifié, et la prise partielle

Quand une commande arrive, chaque ligne est confrontée au stock de la
pharmacie (`disponibilite-stock.service.ts`) : **seuls les lots non périmés
comptent**, une ligne est disponible, insuffisante ou absente, et un
**équivalent** (même DCI, même dosage, comparés sans casse ni espaces) est
**signalé, jamais substitué**. Le bilan éclaire, il ne décide pas.

La pharmacie peut **prendre tout**, **proposer une partie** ou **refuser**. Une
proposition réserve la commande (`ATTENTE_ACCORD_PATIENT`) ; le patient choisit
sous **deux heures** (`DELAI_REPONSE_PARTIELLE_MINUTES`) :

| Choix | Suite |
|---|---|
| Accepter et relancer | la commande ne sert plus que les lignes proposées (`lignesOrdonnance`) ; le manquant devient un **reliquat**, seconde commande sur la même ordonnance (`idCommandeOrigine`), appelée sans la pharmacie d'origine |
| Accepter seul | même chose, sans reliquat |
| Refuser, ou pas de réponse | retour au quartier ; la pharmacie qui a proposé n'est plus sollicitée, et le délai final repart du retour |

`lignesOrdonnance` vide veut dire « toutes les lignes » : c'est le cas de
toute commande antérieure. Le chiffrage, la vue et le stock ne lisent que les
lignes servies. Les notifications ne nomment aucun produit (P9).

### Connexion : l'email est obligatoire pour les professionnels

Seuls **PATIENT** et **LIVREUR** peuvent se connecter avec leur téléphone. Tous
les autres rôles doivent utiliser leur **email professionnel**, et reçoivent
ensuite un **code à usage unique par email**. Sans expéditeur configuré
(`BREVO_API_KEY`, `EMAIL_EXPEDITEUR`), ils ne peuvent pas se connecter du tout.

### Windows : Vitest et la casse de la lettre du lecteur

Lancé depuis `c:\Pricemou\...` (c minuscule), `ng test` peut échouer sur
**toutes** les suites avec « Vitest failed to find the runner » — y compris
celles que personne n'a touchées. Le même lancement depuis `C:\Pricemou\...`
passe. Vitest charge alors deux fois son propre module. Avant de chercher une
erreur dans le code, relancez depuis un chemin en `C:` majuscule
(`Set-Location C:\Pricemou\...` sous PowerShell). Vider le cache Angular n'y
change rien.

### Windows : Git Bash cache les `\r`

`sed`, `od` et `cat -A` lancés depuis Git Bash peuvent montrer un fichier en LF
alors qu'il est en CRLF — les catalogues `fr.json` et `en.json` le sont. Un
script qui cherche `"\n    \"CLE\""` ne trouve alors rien. Pour une
manipulation textuelle, lisez le fichier en Python avec `newline=''`,
normalisez en `\n`, et rétablissez le CRLF à l'écriture. `git ls-files --eol`
dit la vérité.

### Le message « Identifiants invalides » ne dit pas lequel

Il couvre deux cas : compte introuvable **et** mot de passe refusé. Pour les
distinguer, lisez `evenements_connexion` : quand le compte est introuvable,
`idUtilisateur` est nul ; quand c'est le mot de passe, il est renseigné.

---

## 6. Les règles métier structurantes

### Le dossier réglementaire

**Toute structure fournit ses pièces à la création**, sans exception et sans
pièce facultative. La création est refusée tant que le dossier est incomplet.
Ce qui est exigé dépend du type (`PIECES_REQUISES` dans
`apps/api/src/services/piece-agrement.service.ts`) :

| Type | Pièces |
|---|---|
| Pharmacie, clinique, laboratoire | agrément de création, agrément d'exploitation, diplôme du responsable, inscription à l'ordre |
| Hôpitaux publics (préfectoral, régional, CHU) | acte de création, diplôme, inscription à l'ordre |
| Poste et centre de santé | acte de création, diplôme |
| Assurance | agrément de la Banque Centrale, extrait RCCM, carte d'identité ou passeport du responsable, certificat de résidence du responsable (depuis le 2026-11-20) |

Les structures publiques n'ont **ni RCCM ni agrément d'exploitation** : le
serveur efface ces champs s'ils arrivent, et la même pièce porte un libellé
différent selon le type — « agrément de création » pour une officine, « acte de
création » pour un CHU.

Les pièces vivent dans `stockage-prive/`, **jamais** dans `uploads/` qui est
servi sans authentification. Chaque lecture passe par une route gardée et est
journalisée.

### Le rôle du responsable suit le métier de sa structure

Écrit **à un seul endroit** : `roleDuResponsable()` dans
`apps/api/src/utils/officine.util.ts`. Les trois portes de création le lisent.

| Structure | Rôle | En plus |
|---|---|---|
| Pharmacie | `PHARMACIEN` | profil d'officine `TITULAIRE`, `estResponsable: true` |
| Assurance | `ASSUREUR` | — |
| Tout le reste | `ADMIN_STRUCTURE` | — |

**Le rôle seul ne suffit pas pour une officine** : l'adjoint, le préparateur et
le caissier portent le même rôle que le titulaire. C'est le profil qui les
distingue, et le serveur reconnaît le titulaire à **ses deux marques** —
`estResponsable` ou `roleOfficine === 'TITULAIRE'` — parce que le menu du
navigateur filtre sur la seconde et que diverger exposerait à un écran vide.

### Le partenariat

`estPartenaire` décide quelles officines reçoivent les appels de commande du
quartier. Il est posé **à la création**, et se retire depuis le menu de la ligne
dans l'écran admin des structures (administration nationale seulement).
`partenaireDepuis` retient la date et s'efface au retrait.

### Les demandes d'agrément

Une structure privée peut candidater **sans compte** depuis
`/demande-agrement`. **Une compagnie d'assurance aussi, depuis le 2026-11-20** :
la tuile « Inscrire mon assurance » de l'accueil ouvre le même formulaire déjà
réglé (`?type=ASSURANCE`). Elle y propose le code de ses cartes (unique, vérifié
dès le dépôt contre les compagnies existantes et les demandes en cours) et son
mode d'échange ; sa seule référence d'agrément est celle de la BCRG, sans arrêté
d'exploitation. Ses quatre pièces sont celles de la création directe.

**Chaque action de l'administration porte un motif, envoyé par courriel au
responsable** — mise en vérification, validation, refus, pour tous les types —
et s'inscrit dans l'historique du dossier (`evenements_demande_agrement`) avec
son auteur et **le sort du courriel** (`emailEnvoye`, posé après l'envoi,
jamais avant). La mise en vérification se répète : chaque fois, un nouveau
motif. La validation d'une assurance crée dans la même transaction la
structure, la compagnie (au code éventuellement corrigé par l'agent) et le
compte `ASSUREUR` ; le courriel de validation porte le motif, les identifiants
et le code retenu. Le mot de passe ne sort jamais dans la réponse : si le
courriel échoue, l'écran et l'historique le disent, et c'est à l'administration
de prévenir le responsable.

### La pharmacie d'un hôpital

**L'administrateur d'un hôpital ne crée plus sa pharmacie : il la demande**
(depuis le 2026-11-21). Avant, il ouvrait seul une officine et le compte de son
titulaire, sans que l'administration de la plateforme l'ait jamais vue passer.

- Seuls les hôpitaux (préfectoral, régional, CHU) et les cliniques peuvent la
  demander (`estStructureHospitaliere`), depuis leur page Pharmacies :
  `POST /admin-structure/pharmacies/demandes`. La création directe,
  `POST /admin-structure/pharmacies`, est réservée au super admin.
- La demande est une `DemandeAgrement` ordinaire, avec deux colonnes en plus :
  `idStructureParente` (l'hôpital) et `idDeposePar` (l'administrateur). Elle
  arrive dans l'écran d'examen avec les autres, marquée « Pharmacie de … ».
- **Aucune pièce n'est exigée** : la pharmacie opère sous l'autorisation de son
  hôpital (`piecesExigees`, qui renvoie à `SOUS_AUTORISATION_DU_PARENT`). Le
  dossier se montre donc complet sans pièce.
- **Aucun mot de passe n'est reçu ni gardé** au dépôt. L'adresse du titulaire
  est obligatoire : ses identifiants y partent à la validation.
- **Les courriels vont à l'administrateur qui a déposé la demande**, pas au
  pharmacien, qui n'a rien déposé : accusé de réception, puis chaque étape avec
  son motif (`envoyerSuiviPharmacieHospitaliere`). À la validation, le
  titulaire reçoit ses identifiants, et l'administrateur la décision sans eux.
  Un administrateur sans adresse suit sa demande à l'écran, où s'affichent
  l'état et le dernier motif (`GET /admin-structure/pharmacies/demandes`).
- La validation crée la pharmacie **fille de l'hôpital**, partenaire, et son
  titulaire (`PHARMACIEN`, profil `TITULAIRE`). Elle est refusée si l'hôpital
  a été désactivé entre-temps.
- Deux demandes ouvertes pour le même nom dans le même hôpital, à la casse
  près, sont refusées.

### La candidature des livreurs

**Tout livreur a un dossier, quelle que soit la porte.** Six pièces — carte
d'identité recto et verso, permis, carte grise, assurance, certificat de
résidence —, photo (JPEG, PNG) ou PDF, 5 Mo maximum, **vérifiées dans leurs
octets** (`typeMimeReel`), jamais sur l'en-tête du navigateur. Majeur, sexe `M`
ou `F`, quartier obligatoire (le profil livreur ne sait pas s'en passer).

- **Dépôt public** : `/devenir-livreur` → `POST /livreurs/candidatures`, sans
  compte, limité à dix par heure. Refuse un téléphone déjà porté par un compte
  ou dont un dossier est en cours. **Aucun compte n'est créé au dépôt.**
- **Examen** : `/admin/candidatures-livreurs`, ouvert aux mêmes rôles que
  `/admin/livreurs` (`SUPER_ADMIN`, `ADMIN_NATIONAL`, `ADMIN_REGIONAL`).
  Prise en charge, validation (crée le compte `LIVREUR` et son profil), refus
  avec motif d'au moins dix caractères. Une décision ne se reprend pas, et la
  mise à jour porte le statut dans son filtre : deux agents ne décident pas
  le même dossier.
- **Création par l'administration** : `POST /comptes/livreurs` exige les
  mêmes six pièces et enregistre un dossier **déjà validé**
  (`deposeParAdministration`). Les deux portes n'exigent pas moins l'une que
  l'autre.
- **Mot de passe temporaire** : par courriel si le livreur a un email, et il
  n'est alors **pas** rendu à l'agent. Sans email, ou si l'envoi échoue, il
  est rendu **une fois** et affiché sur la page — pas dans la fenêtre du
  dossier — jusqu'à ce que l'agent dise l'avoir noté. Les SMS ne partent pas
  encore : sans ce repli, un motard sans email n'apprendrait jamais son mot
  de passe. Un livreur se connecte par téléphone, sans code par email, qu'il
  ait une adresse ou non.

Le code est dans `apps/api/src/services/candidature-livreur.service.ts` et,
côté web, `core/services/candidature-livreur.service.ts`, qui porte aussi le
contrôle des fichiers partagé par les deux écrans. Les pièces vivent dans
`stockage-prive/livreurs/`.

### L'accès du médecin à l'historique du patient

**La visite se soigne sans rien demander ; l'historique suit l'accord du
patient.** Le médecin d'un rendez-vous voit l'épisode, le rendez-vous, la
consultation du jour et les analyses de cette visite. Au-delà, il lui faut
l'accord du patient, donné à ce médecin pour cet épisode : consultations
passées (toutes structures), fiche médicale, résultats suivis, vaccinations,
export FHIR.

| Moment | Ce qui se passe |
|---|---|
| Rendez-vous fixé (`fixerRendezVous`, `accepterDemande`) | une demande `DEMANDEE` est créée, avec une notification et un courriel au patient s'il a une adresse. Elle n'est pas refaite pour un même épisode. Si elle échoue, le rendez-vous est quand même pris. |
| Le patient répond (`/patient/acces-dossier`) | accepter, refuser, ou retirer plus tard (effet immédiat). Il peut accorder après un refus ou un retrait. |
| Durée | jusqu'à la clôture de l'épisode, **plus trente jours** (`JOURS_APRES_CLOTURE`) |
| Sans réponse | le médecin relance, **une fois par jour au plus** |
| Urgence | le bris de glace, inchangé : déclaré, notifié, relu |

Le courriel **ne permet pas d'accepter** : son lien ouvre l'application, où le
patient se connecte. Un courriel transféré ne doit pas suffire à ouvrir un
dossier. Ni le courriel ni la notification ne nomment la structure.

La règle est écrite une seule fois, dans `acces-dossier.service.ts`
(`peutLireHistorique`, `filtrePatientsLisibles`), puis posée sur les lectures
existantes : fiche patient, recherche par QR, liste des patients, résultats
suivis, export FHIR. **Elle ne vise que le rôle `MEDECIN`** : l'ASC et
l'administration gardent leurs règles. La lecture d'une consultation par son
identifiant reste ouverte à la structure ; c'est un choix, pas un oubli.

### Les couleurs de l'interface, par structure

**Une structure, une palette**, choisie par son responsable (administrateur,
titulaire d'officine, assureur) depuis « Apparence ». Tout son personnel la
voit dès son chargement suivant ; le responsable la voit changer sous ses yeux.
Les patients, l'administration nationale et les pages publiques gardent le
vert d'origine.

- **Une liste fermée** (`PALETTES_STRUCTURE`, shared-types) : Émeraude,
  Océan, Indigo, Sarcelle, Améthyste, Ardoise. Pas de rouge ni d'orange :
  ce sont les couleurs du danger et de l'avertissement. Le serveur refuse tout
  autre nom.
- **Construites, pas choisies à l'œil** : chaque palette reprend les
  luminosités de l'émeraude (en OKLCH) et change seulement la teinte.
  `core/theme/palettes-structure.spec.ts` remesure les contrastes (WCAG AA, en
  clair et en sombre, Material compris) : une couleur retouchée à la main qui
  rendrait un texte difficile à lire ne passe pas.
- **Rien n'est recompilé** : la palette pose `data-palette` et une feuille
  de style sur `<html>`, qui redéfinit les jetons `--bb-*` et `--mat-sys-*`.
  Émeraude ne pose rien : c'est la feuille de style elle-même.
- **Les couleurs sémantiques ne bougent jamais** (`--bb-success`, `danger`,
  `warning`, `info`). Pour une teinte de marque (étiquette, survol, liseré),
  utilisez `--bb-accent-bg` / `--bb-accent-border`, **pas** `--bb-success-bg` :
  ils ont la même valeur en émeraude, mais seul le premier suit la palette.
  De même, n'écrivez plus de vert en dur : `var(--bb-primary)`,
  `var(--bb-bright)`, ou `color-mix(in srgb, var(--bb-bright) 14%, transparent)`
  pour une transparence.

### Les images des pages publiques

Le super-admin les remplace depuis **Paramètres > Images**, emplacement par
emplacement : la photo de la page d'accueil, celle des écrans de connexion,
et une par étape de « Comment ça marche » (neuf en tout,
`EMPLACEMENTS_VISUELS`). Il change l'image, pas la page : le cadrage reste
celui du CSS (`object-fit: cover`).

- **Rien n'est gardé tel que reçu.** L'API refuse une image trop petite pour
  son emplacement (elle serait floue) ou trop allongée, la redresse, la
  réduit, la convertit en WebP et en fait une version pour petits écrans
  (`visuels.service.ts`). L'original et ses métadonnées (lieu de prise de vue)
  ne sont jamais écrits. Pas de SVG : ce sont des photos.
- **Une adresse d'image ne se saisit pas** : seul le téléversement en
  enregistre une, avec un chemin qu'il fabrique. Le PUT des paramètres ne
  laisse pas passer la section `visuels`.
- **L'image remplacée reste servie dix minutes** (`DELAI_CONSERVATION_MS`),
  puis part au changement suivant : `/parametres/publics` reste une minute
  dans les navigateurs, et une suppression immédiate afficherait une image
  cassée à qui vient de charger la page.
- **Les images d'origine** sont déclarées dans
  `shared/utils/visuels-publics.ts`, qui sert aussi de repli tant que l'API
  n'a pas répondu. Une étape sans photo garde son icône.
- Les fichiers vivent dans `uploads/visuels/`, donc dans le volume
  `api_uploads` : ils survivent aux redéploiements, mais ne sont pas dans la
  sauvegarde de la base (section 7).

### L'interface unique de l'administrateur de structure

Comme le titulaire d'une officine, l'administrateur d'un hôpital, d'une
clinique ou d'un centre de santé a **une seule interface** pour tout son
établissement. Son menu est fait de rubriques, selon ce que la structure
fait (`admin-structure-nav.ts`) :

| Rubrique | Structures | Écrans |
|---|---|---|
| Pilotage | toutes | tableau de bord |
| Accueil | poste, centre, hôpitaux, CHU, clinique | activité, admissions, rendez-vous à orienter, présences, épisodes |
| Laboratoire | centre, hôpitaux, CHU, clinique, laboratoire | activité, plateau technique, demandes d'analyse |
| Équipe | toutes | agents |
| Établissement | selon le type | pharmacies et assurances (hospitalières), laboratoires conseillés, identités, dossier réglementaire, apparence |

**Les écrans sont ceux du métier**, montés sous `/admin-structure/accueil` et
`/admin-structure/laboratoire`. Leurs liens partent d'une racine injectée
(`core/navigation/racines.ts` : `RACINE_ACCUEIL`, `RACINE_LABO`) au lieu d'un
chemin écrit en dur. Sans elle, un clic ferait basculer l'administrateur dans
l'interface de l'accueil. **Tout nouveau lien de ces écrans doit partir de
`racine`.**

L'écran ne lui propose aucun acte de soin : ni prescription, ni clôture, ni
saisie, validation ou impression de résultats. L'API les lui refuse de toute
façon (branche `fix/admin-sans-contenu-medical-v2`).

### La structure à la place de la plateforme

**Le nom de la plateforme n'apparaît que chez son administration** (super
admin, administrations nationale et régionale), et sur les pages publiques.
Partout ailleurs, l'interface porte la structure :

- **le personnel** : le nom et le logo de son établissement en tête de la
  barre latérale, et dans l'onglet du navigateur ;
- **le patient** : sa structure par défaut (`idStructurePreferee`, celle où
  partent ses demandes de rendez-vous), pour la lui rappeler. Il garde les
  couleurs d'origine : une palette est celle d'une équipe ;
- **sans structure** (patient qui n'en a pas, livreur) : « Mon espace
  santé », « Espace livreur ».

`/auth/me` porte `structure` (`apparence.service.ts`, `espaceDeLUtilisateur`)
; la barre latérale l'affiche avec `<app-brand portee="espace">`. Sans logo,
un **monogramme** : les initiales (`CHU` pour « CHU Donka », `CP` pour
« Clinique Pasteur »), aux couleurs de la palette. **Un logo qui ne se charge
pas** (fichier perdu, réseau coupé) laisse place au monogramme, jamais à une
image cassée ; il est de nouveau essayé quand le logo change.

**Le logo** se téléverse depuis Apparence, par le responsable. Il est stocké
dans `StructureSante.photoUrl` (champ jusque-là inutilisé), réduit à 512 px
en PNG, dans `uploads/structures/`.

**Les documents imprimés** (ordonnance, compte rendu, bon d'examen, reçu)
portent en tête la structure qui les émet : nom, logo, téléphone, adresse
(`document-emetteur.service.ts`). Une ligne discrète en pied de page dit où les
vérifier : le site de la plateforme, sinon son nom.

### L'administrateur de structure et le secret médical

**L'administrateur dirige tout, sauf le soin.** Il voit les admissions, les
rendez-vous, les épisodes, le plateau et la file du laboratoire, l'avancement
des analyses. Il ne lit ni les consultations, ni la fiche médicale, ni les
résultats, ni les commentaires du laboratoire ou du médecin, et ne fait aucun
acte de soin (prescrire, ouvrir une consultation, clore une prise en charge,
saisir un résultat). S'il est aussi médecin, il a un compte médecin à part.

- **Le filtre est posé une fois, sur le routeur** :
  `sansValeursDAnalysePour(...)` (`middlewares/secret-medical.middleware.ts`)
  retire les valeurs et les commentaires cliniques de **toute** réponse JSON
  de l'accueil (`/hopital`, pour l'accueil et l'administration) et du
  laboratoire (`/laboratoire`, pour l'administration). Une nouvelle route de
  ces routeurs en hérite sans rien faire.
- **Les routes de soin ne laissent plus passer `ADMIN_STRUCTURE`** :
  actes médicaux de l'hôpital, saisie et compte rendu du laboratoire, espace
  médecin, consultations, fiche patient, résultats, export FHIR,
  synchronisation hors ligne, rappels de vaccination nominatifs.
- **L'alerte « résultat critique en attente » est un contenu médical** : sans
  valeur, elle dit pourtant l'état du patient. Le même filtre ramène
  `alerteCritiqueEnAttente` à faux pour l'accueil et l'administration.
- Ce qui lui reste ouvert : son administration, les chiffres (statistiques,
  couverture vaccinale), la relecture des accès d'urgence de son personnel.

### Le personnel : des métiers, pas des rôles

L'administrateur crée **un métier** : médecin généraliste, médecin spécialiste
(avec sa spécialité), chirurgien-dentiste, agent d'accueil, technicien de
laboratoire, agents de santé communautaire. Le métier se traduit en rôle
technique côté serveur ; un dentiste ou un pédiatre ont les écrans du médecin.

- **Les spécialités sont une liste fermée** de vingt-deux codes
  (`SPECIALITES_MEDICALES`, dans `shared-types`), traduits. Les spécialités
  saisies à la main avant la liste sont reconnues (`normaliserSpecialite`,
  `utils/specialite.util.ts`) ; un texte inconnu reste tel quel.
- **Seuls les métiers du type de structure sont proposés, et l'API refuse le
  reste** (`rolesCreablesPour`) : pas d'agent communautaire à l'hôpital, des
  techniciens seuls au laboratoire, plus aucun compte pharmacien créé par
  l'administrateur.
- Changer le numéro d'ordre retire sa vérification au registre, qui ne valait
  que pour l'ancien numéro.
- Un compte désactivé reste dans la liste et se réactive.
- Réinitialiser un mot de passe : temporaire, envoyé par courriel et montré une
  seule fois ; toutes les sessions de l'agent sont fermées.
- **Infirmier et sage-femme ne sont pas encore des rôles** : c'est la phase
  suivante (section 9).

### Les services de l'hôpital

Un centre, un hôpital ou une clinique déclare ses services (urgences,
maternité, pédiatrie…) depuis « Services », dans la rubrique Équipe
(`ServiceHospitalier`, `services-hospitaliers.service.ts`).

- Un nom déjà pris **à la casse près** est refusé : « PÉDIATRIE » et
  « Pédiatrie » sont le même service. L'index unique de la base, lui, distingue
  la casse : c'est le service qui fait le contrôle.
- Un service se ferme et se rouvre, il ne se supprime pas. Fermé, il n'est plus
  proposé à l'accueil.
- Chaque médecin est rattaché à **un** service, depuis « Mes agents »
  (`MedecinProfile.idService`, remis à nul si le service disparaît).
- **À l'accueil**, l'admission et l'orientation proposent les services ouverts ;
  choisir un service ne laisse que ses médecins. Un service sans médecin
  rattaché propose tous les médecins, et l'écran le dit. Sans service déclaré,
  la saisie libre d'avant reste.

### La géographie

Le référentiel est **générique**, pour servir un autre pays sans toucher au
code. Deux rôles seulement : le niveau de **base** (commune en Guinée) et celui
d'**élargissement** (préfecture). Les libellés viennent de
`geo.libelle('base' | 'elargissement')` — **n'écrivez jamais « Commune » ou
« Préfecture » en dur**.

En Guinée une **sous-préfecture est une commune rurale** : c'est le niveau
`base` qui la porte, filtré par la préfecture. N'inventez pas de niveau
« sous-préfecture ». Et hors de Conakry, le référentiel est souvent vide :
laissez la saisie libre plutôt que de bloquer.

---

## 7. Le déploiement

VPS Hostinger, Dokploy, Docker. Fichier :
`docker/docker-compose.prod.yml`, secrets dans `docker/.env.prod` **hors du
dépôt** (voir `docker/.env.prod.example` pour la liste).

Quatre volumes portent tout ce qui doit survivre à un redéploiement :

| Volume | Contenu |
|---|---|
| `postgres_data` | la base |
| `api_stockage_prive` | les PDF du dossier réglementaire, et les pièces des livreurs (`livreurs/`) |
| `api_uploads` | avatars, logos, photos — servis publiquement |
| `redis_data` | sessions, codes à usage unique, cache |

**La base ne contient pas les fichiers** : elle ne garde que leur nom, leur
type, leur taille et leur rattachement. Une base restaurée sans les volumes
donne des dossiers qui pointent vers le vide.

### Ce qui reste à faire côté sauvegarde

`scripts/backup-db.sh` existe (dump chiffré AES-256, rétention 14 jours) mais :

1. il ne sauvegarde **que la base**, pas `stockage-prive/` — ni les PDF
   d'agrément ni les cartes d'identité et permis des livreurs, que personne
   ne peut redéposer après validation ;
2. ses valeurs par défaut datent de l'ancienne configuration (`baobao_user`,
   port 5433) et ne correspondent plus à la production ;
3. rien ne prouve qu'un cron l'appelle sur le serveur.

---

## 8. Ce qui a été livré récemment

Du plus récent au plus ancien, tout est sur `main` sauf mention contraire.

- **La pharmacie d'un hôpital se demande** (branche
  `feat/pharmacie-hopital-agrement`, section 6) : l'hôpital dépose, le super
  admin met en analyse, valide ou refuse avec un motif envoyé à
  l'administrateur ; la validation crée la pharmacie et son titulaire.
- **Les services de l'hôpital** (branche `feat/services-hopital`, section 6) :
  déclarés par l'administrateur, médecins rattachés, orientation par service à
  l'accueil.
- **L'alerte critique cachée à l'accueil et à l'administration** (branche
  `fix/alerte-critique-sans-soin`, section 6).
- **Jamais une image cassée à la place d'un logo** (branche
  `fix/logo-structure-repli`, section 6).
- **Le personnel par métiers et spécialités** (branche
  `feat/personnel-metiers`, section 6) : métiers proposés selon la structure,
  spécialités en liste fermée, réactivation et réinitialisation d'un compte.
- **L'administrateur de structure sans contenu médical** (branche
  `fix/admin-sans-contenu-medical-v2`, section 6) : actes et lectures de soin
  fermés, valeurs d'analyse retirées de toute réponse de l'accueil et du
  laboratoire.
- **La structure à la place de la plateforme** (branche
  `feat/espace-structure-v3`, section 6) : nom, logo ou monogramme dans les
  interfaces des structures et des patients, documents imprimés à l'en-tête
  de la structure émettrice.
- **L'interface unique de l'administrateur de structure** (branche
  `feat/admin-interface-complete`, section 6) : accueil, laboratoire, équipe et
  établissement dans un seul menu, sans acte de soin.
- **Images des pages publiques modifiables par le super-admin** (branche
  `feat/visuels-publics`, section 6) : neuf emplacements, images vérifiées,
  réduites et converties en WebP, description pour les lecteurs d'écran.
- **Couleurs de l'interface par structure** (branche `feat/theme-structure`,
  section 6) : six palettes vérifiées pour la lisibilité, choisies par le
  responsable, appliquées sans rechargement.
- **L'historique du patient sur son accord** (branche
  `feat/acces-dossier-accord`, section 6) : demande envoyée avec le
  rendez-vous, page « Accès à mon dossier » côté patient, panneau
  « Historique » dans le dossier de la visite côté médecin.
- **Candidatures des livreurs de bout en bout** (branche
  `feat/candidature-livreur-serveur`) : tables, dépôt public, écran d'examen,
  dossier exigé à la création par l'administration (section 6). Vérifié contre
  une vraie base PostgreSQL et dans un navigateur, en plus des tests.
- **Rôle du responsable selon le métier** — l'espace assureur était
  inatteignable : le rôle `ASSUREUR` existait, les routes le réclamaient, la
  redirection le prévoyait, mais aucun compte ne le portait jamais. Même trou
  pour les officines créées par la porte administrative.
- **Écran public de candidature des motards**.
- **Partenariat des officines** — `estPartenaire` n'avait aucune porte : aucune
  pharmacie réelle ne recevait de commande.
- **Correction du fichier joint effacé** dans l'écran admin des structures.
- **Raison du blocage affichée** à côté du bouton de création désactivé.
- **Périmètre du titulaire d'officine** sur le dossier réglementaire.
- **Dossier réglementaire obligatoire pour toutes les structures**.
- **Demandes d'agrément** de bout en bout : dépôt public, examen, validation ou
  refus motivé.
- **Commandes : stock vérifié à l'arrivée, prise partielle** avec accord du
  patient sous deux heures, et reliquat relancé aux autres pharmacies.
- **Demandes d'assurance en ligne**, motif obligatoire et envoyé à chaque action,
  historique des actions avec le sort de chaque courriel.
- **La fenêtre d'examen ne passe plus sous le menu latéral** (agréments et
  candidatures livreurs, qui partagent sa feuille de style).
- **Volumes Docker en production** — chaque redéploiement effaçait jusque-là
  tous les fichiers téléversés.

---

## 9. Ce qui reste ouvert

Par ordre de risque décroissant.

1. **Les deux index en SQL brut** (section 5) — l'index trigramme et
   `commandes_origine_par_ordonnance`. Une migration distraite fait tomber la
   recherche de médicaments, ou laisse doubler une commande.
2. **Les sauvegardes** (section 7) — ni les PDF d'agrément ni les pièces des
   livreurs ne sont sauvegardés nulle part.
3. **Les comptes déjà créés** gardent leur ancien rôle : un responsable
   d'assurance existant reste `ADMIN_STRUCTURE` tant qu'on ne le bascule pas.
   De même, les livreurs créés avant le 2026-11-20 n'ont **aucun dossier** :
   rien ne dit sur quelles pièces ils ont été admis.
4. **Écran patient « Mon adresse »** : un bogue a été signalé par un testeur,
   l'analyse est faite mais le message d'erreur exact manque pour conclure. Les
   trois causes possibles sont identifiées dans
   `features/patient/profil/adresse/`.
5. **Infirmier et sage-femme** ne sont pas encore des rôles : ils ne peuvent
   être créés comme personnel. C'est la phase prévue après les étapes 1 à 4.
6. **Les pharmacies hospitalières créées avant le 2026-11-21** l'ont été sans
   demande : aucune trace d'examen par l'administration.
7. Ménage : branches fusionnées à supprimer, référentiel LOINC, voisinages de
   Conakry, identité de la plateforme en production.

---

## 10. La méthode de travail attendue

Ce projet soigne les bords plus que les cas heureux. Ce qui est demandé :

- **Comprendre avant d'écrire.** Lire le code existant, chercher si la règle est
  déjà écrite quelque part, ne pas la redécider.
- **Un test par défaut réel.** Pas de test qui récite le code : un test qui
  empêche un bogue précis de revenir, avec le commentaire qui dit lequel.
- **Vérifier que les tests tiennent vraiment** : casser volontairement la règle
  dans le code, s'assurer qu'un test tombe, puis remettre en état. Un test qui
  ne tombe jamais ne protège rien.
- **Dire ce qui ne va pas**, y compris quand ça sort du périmètre demandé : les
  trois derniers défauts sérieux ont été trouvés en vérifiant autre chose.
- **Expliquer le pourquoi dans les commentaires**, pas le quoi. Le code dit déjà
  ce qu'il fait.
