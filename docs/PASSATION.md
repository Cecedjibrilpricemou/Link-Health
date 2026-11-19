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
| Assurance | agrément de la Banque Centrale |

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
`/demande-agrement`. L'administration examine, valide ou refuse avec motif. Une
assurance ne passe **pas** par là : elle relève de la Banque Centrale.

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
- **Volumes Docker en production** — chaque redéploiement effaçait jusque-là
  tous les fichiers téléversés.

---

## 9. Ce qui reste ouvert

Par ordre de risque décroissant.

1. **L'index trigramme non déclaré** (section 5) — une migration distraite fait
   tomber la recherche de médicaments en production.
2. **Les sauvegardes** (section 7) — ni les PDF d'agrément ni les pièces des
   livreurs ne sont sauvegardés nulle part.
3. **Les comptes déjà créés** gardent leur ancien rôle : un responsable
   d'assurance existant reste `ADMIN_STRUCTURE` tant qu'on ne le bascule pas.
   De même, les livreurs créés avant le 2026-11-20 n'ont **aucun dossier** :
   rien ne dit sur quelles pièces ils ont été admis.
4. **La fenêtre d'examen passe sous le menu latéral** sur ordinateur : sa
   partie gauche est coupée. Le défaut vient de la feuille de style de
   l'examen des agréments, que l'examen des livreurs réutilise : les deux
   écrans l'ont. À corriger une fois, dans
   `demandes-agrement.component.scss`.
5. **Écran patient « Mon adresse »** : un bogue a été signalé par un testeur,
   l'analyse est faite mais le message d'erreur exact manque pour conclure. Les
   trois causes possibles sont identifiées dans
   `features/patient/profil/adresse/`.
6. Ménage : branches fusionnées à supprimer, référentiel LOINC, voisinages de
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
