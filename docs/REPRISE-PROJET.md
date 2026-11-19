# KÈNÈYA — dossier de reprise

> Écrit pour qu'une personne **ou une IA** puisse reprendre ce projet sans rien deviner.
> Dernière mise à jour : **2026-10-02**. Chaque chiffre de ce fichier a été recompté dans le dépôt ce jour-là — compteurs de modèles, de tests, de cases de la feuille de route, état des branches. Aucun n'est recopié d'une version antérieure.
>
> Si vous constatez un écart entre ce fichier et le code, **le code a raison** — corrigez ce fichier.

> ### ⚠️ Chiffres périmés depuis le 2026-11-19
>
> Les compteurs ci-dessous datent du 2026-10-02 et ont été dépassés de
> plusieurs ordres : ce fichier annonce 568 tests API et 21 tests web, il y en
> a aujourd'hui **2675 et 588**. Les modèles, migrations, routes et services
> ont augmenté dans les mêmes proportions.
>
> **Pour l'état courant, les règles de travail et les pièges connus, lisez
> `docs/PASSATION.md`.** Ce fichier-ci reste la meilleure source sur
> l'architecture, les parcours métier et la feuille de route.

> ### ⚠️ À lire avant de cloner
>
> **`main` est la branche de référence.** L'ancienne branche `develop` y est entièrement fusionnée (mise à jour du 2026-10-30) : les six blocs de l'addendum, les lots de stock, le référentiel de catégories et les correctifs de sécurité sont tous sur `main`.
>
> ```bash
> git clone <url> && cd baobaoheath-platforme
> ```

---

## 1. En un coup d'œil

**KÈNÈYA** est une plateforme de santé numérique pour la Guinée. Elle relie patients, agents de santé communautaire (ASC), agents d'accueil hospitalier, laboratoires, médecins, pharmacies et administrations sur un dossier unique.

La promesse du cahier des charges tient en une phrase : **le patient ne se déplace qu'une fois**, à l'hôpital. Analyses, consultation, ordonnance, pharmacie, paiement et livraison suivent depuis son dossier.

| | |
|---|---|
| Monorepo | npm workspaces — `apps/api`, `apps/web`, `packages/shared-types`. **Un seul `package-lock.json`, à la racine.** |
| API | Node 24, Express, TypeScript, Prisma 7 / PostgreSQL 16 — **26 fichiers de routes, 35 services, 26 groupes d'endpoints** |
| Web | Angular 21 **standalone + signals + zoneless**, Angular Material 21, i18n maison FR/EN — **50 écrans dans 10 espaces** |
| Modèle | **49 modèles Prisma, 27 enums, 28 migrations, 12 rôles** |
| Branches | `develop` (travail) → CI verte → `main` (fast-forward). Voir l'encadré ci-dessus : `develop` est aujourd'hui fusionnée dans `main`. |
| Tests | **568 API** (Jest, 30 suites), **21 web** (Vitest), **5 parcours e2e** (Playwright, vraie base) |
| Avancement | Feuille de route : **42 cases faites, 5 partielles, 48 restantes sur 95**. Addendum : **les 8 blocs livrés**, avec des reliquats nommés bloc par bloc. |
| Référence contractuelle | *Cahier des charges Kènèya v2.0* du 13/09/2026 (`EF-01…EF-13`, `ENF-01…06`), **complété par l'addendum du 2026-09-28** |

> ⚠️ **Deux documents font autorité sur le périmètre, dans cet ordre** : `docs/ADDENDUM-CDC-2026-09-28.md` (le plus récent, il **rouvre** des blocs marqués livrés), puis `docs/FEUILLE_DE_ROUTE_KENEYA.md`.
>
> Le `README.md` à la racine a été repris le 2026-10-02 et pointe sur ce fichier. En cas de contradiction, **ce fichier-ci fait foi** : il est plus détaillé et tenu à jour avec le code.

---

## 2. Démarrer

### Prérequis

- **Node ≥ 24**, **npm ≥ 11** (imposés par `engines`)
- **Docker** pour PostgreSQL

### Installation

```bash
npm ci                      # à la racine : installe les trois workspaces
```

Il n'y a **qu'un seul `package-lock.json`, à la racine**. Un `npm audit` lancé depuis `apps/web` audite quand même tout le monorepo.

### Base de données

```bash
cd docker && docker compose up -d postgres     # conteneur baobao_db, port 5433
cd ../apps/api
npx prisma migrate deploy
npx prisma generate
npm run prisma:seed:demo                       # jeu « Pricemou », idempotent
```

> Le piège `prisma.config.js` **est résolu depuis le 2026-09-28**. Cet artefact de build était commité à côté du `.ts` ; Prisma 7 le préférait et **ne savait pas le lire**, ce qui faisait échouer `migrate`, `generate` et `diff` sans `--config` explicite. Il est supprimé et ignoré. Les commandes Prisma n'ont plus besoin de `--config`.

### Variables d'environnement

`apps/api/src/config/env.ts` **valide au chargement du module et appelle `process.exit(1)`** si une variable manque. Une variable oubliée ne donne donc pas une erreur au premier appel : le processus meurt au démarrage, et toute suite de tests important un service meurt avec lui.

Obligatoires :

| Variable | Format |
|---|---|
| `DATABASE_URL` | URL PostgreSQL |
| `JWT_SECRET` | ≥ 16 caractères |
| `JWT_REFRESH_SECRET` | ≥ 16 caractères |
| `DB_ENCRYPTION_KEY` | **64 caractères hexadécimaux** (32 octets) |

Optionnelles : `PORT` (3000), `NODE_ENV`, `ALLOWED_ORIGINS`, `GMAIL_USER` / `GMAIL_APP_PASSWORD`, `REDIS_URL`, `SENTRY_DSN`.

Délais du circuit laboratoire, tous surchargeables : `LABO_ESCALADE_MINUTES` (30), `LABO_RELANCE_LIBERATION_MINUTES` (720), `LABO_ESCALADE_LIBERATION_MINUTES` (2880).

### Lancer

```bash
npm run dev      # API (3000) + web (4200)
npm run api      # API seule
npm run web      # web seul
```

### Pièges de l'environnement — chacun a coûté du temps le 30/09 ou le 01/10

1. **Lancez l'API par le script du projet, pas à la main.** `npm run api` fait `tsx watch src/index.ts` et se recharge. En revanche `npx tsx src/index.ts` — ce qu'on écrit naturellement quand on veut rediriger le journal — **ne surveille rien** : modifier un service ne change alors rien tant qu'on n'a pas redémarré. Un sabotage de vérification est ainsi passé pour un succès le 30/09, alors que le code saboté n'avait jamais été chargé. *Si vous lancez l'API à la main, redémarrez-la après chaque modification.*

2. **La limitation de débit est en mémoire.** Une dizaine de connexions successives — ce que fait un script de vérification — déclenche un 429, et la page de connexion n'affiche alors aucun code OTP. Le symptôme ressemble à un bug d'authentification. *Redémarrer l'API remet le compteur à zéro* (`REDIS_URL` n'est pas configuré, voir la dette).

3. **Le journal de l'API est tamponné sous PowerShell.** `... | Out-File` n'écrit rien avant la fin du processus. N'attendez pas le démarrage en lisant `.api.log` : interrogez `http://localhost:3000/health`.

   ```bash
   until curl -sf http://localhost:3000/health >/dev/null; do sleep 2; done
   ```

4. **Playwright réutilise les serveurs déjà lancés** (`reuseExistingServer: !process.env.CI`). Si votre API de développement tourne sur le port 3000, les parcours e2e s'exécutent **contre votre base de développement** au lieu de la base e2e. *Libérez le port 3000 avant de lancer `npm run e2e`.*

5. **Les parcours e2e ont besoin de leur propre base.** Sans `E2E_DATABASE_URL`, la configuration pointe sur `postgresql://baobaoheath:baobaoheath@localhost:55433/baobaoheath_e2e`, qui n'existe pas en local : les migrations et la semence échouent, et l'échec se présente comme « les comptes e2e n'existent pas ».

   ```bash
   docker exec baobao_db psql -U baobao_user -d postgres -c "CREATE DATABASE keneya_e2e;"
   cd apps/web
   E2E_DATABASE_URL=postgresql://baobao_user:<mdp>@127.0.0.1:5433/keneya_e2e npx playwright test
   ```

6. **Pour éprouver une migration ou une semence, prenez une base jetable.** Ne le faites pas sur votre base de démonstration : les semences remettent des quantités à leur valeur de référence.

   ```bash
   docker exec baobao_db psql -U baobao_user -d postgres -c "CREATE DATABASE keneya_essai;"
   cd apps/api
   DATABASE_URL=postgresql://baobao_user:<mdp>@127.0.0.1:5433/keneya_essai npx prisma migrate deploy
   DATABASE_URL=... npx tsx prisma/seed.ts && DATABASE_URL=... npx tsx prisma/seed-demo.ts
   ```

   Les deux semences sont **idempotentes** et vérifient en terminant que la quantité de chaque stock égale la somme de ses lots. Elles échouent en nommant les écarts.

7. **Les semences ne sont pas type-vérifiées.** `apps/api/tsconfig.json` déclare `include: src/**/*` ; `prisma/seed*.ts` en est exclu. Une erreur y reste invisible jusqu'à l'exécution — d'où le point précédent.

### Se connecter

Les comptes et mots de passe **ne sont pas dans le dépôt** (volontairement). Voir `f:\perso\BaoBaoHealth\COMPTES-KENEYA.md`, hors versionnement, vérifié contre les empreintes en base.

Le jeu **« Pricemou »** (7 comptes, un par métier, mot de passe commun) se recrée sans rien casser :

```bash
cd apps/api && npm run prisma:seed:demo
```

Trois choses à savoir, chacune a déjà fait perdre du temps :

1. **Les professionnels passent par un OTP.** Gmail n'étant pas configuré, l'API renvoie le code dans la réponse de connexion et la page l'affiche.
2. **Les patients se connectent avec leur numéro de téléphone, sans OTP** — et certains n'ont aucune adresse e-mail.
3. **Si l'API ne tourne pas**, la page de connexion affichait autrefois « identifiants incorrects ». Corrigé le 2026-09-26 : elle dit maintenant « serveur injoignable ». Si vous lisez ce message, démarrez l'API — le mot de passe n'est pas en cause.

---

## 3. Architecture

```
apps/api/src/
  config/      prisma, env (valide + exit), swagger, générés Prisma, extension de chiffrement
  routes/      25 fichiers — déclarent les chemins, les rôles et les validateurs
  controllers/ traduisent HTTP ↔ service, ne contiennent aucune règle
  services/    32 fichiers — toutes les règles métier vivent ici
  validators/  schémas Zod (api.schemas.ts)
  middlewares/ authenticate, requireRole, validateBody, audit
  realtime/    Socket.IO
  utils/       app-error, jwt, password, cache, chiffrement

apps/web/src/app/
  core/        services HTTP, gardes, intercepteurs, modèles clients
  shared/      composants transverses, i18n (fr.json / en.json), pipes, layouts
  styles/      feuilles globales — _shell, _hopital, _auth, _utilities, theme Material
  features/    admin · admin-structure · asc · auth · hopital · laboratoire
               landing · medecin · patient · pharmacien

packages/shared-types/src/index.ts   LE CONTRAT (voir ci-dessous)
```

### Le contrat partagé — le point le plus important

`packages/shared-types` contient **les types d'API partagés entre le web et l'API**. Les contrôleurs annotent leurs réponses avec ces types.

Conséquence : **changer le modèle casse la compilation de l'API là où la forme ne correspond plus**, et le build Angular là où un écran lit un champ disparu. C'est voulu. Ce filet a rattrapé plusieurs régressions silencieuses.

Après toute modification :

```bash
cd packages/shared-types && npm run build     # sinon les autres voient l'ancien type
```

**Corollaire à respecter** : quand un champ est *calculé* (`expiree`, `renouvellementsRestants`, `contientProduitReglemente`), rendez-le **obligatoire** dans le type de la fonction qui le consomme. S'il est optionnel, les appelants passeront l'enregistrement Prisma brut — où le champ n'existe pas — et la règle sera **inerte sans que rien ne le signale**. C'est arrivé.

### Où vivent les styles

Tous les composants n'ont **pas** de `styleUrl`. Plusieurs écrans — dont `patient/parcours` — tirent entièrement leurs styles des feuilles globales de `src/styles/`. Créer un `.scss` à côté d'un tel composant produit un **fichier orphelin** : la compilation reste verte et la page rend sans aucune mise en forme. Vérifiez le décorateur avant d'écrire du style.

Corollaire sur le thème sombre : dans un SCSS **de composant**, utiliser `:host-context([data-theme='dark'])` ; dans une feuille **globale**, `[data-theme='dark']` — l'attribut est porté par `<html>`, et `:host-context` n'y a pas de sens.

### Carte des endpoints

Les **28** groupes montés dans `apps/api/src/index.ts`, dans l'ordre du fichier. C'est la table d'entrée la plus rapide pour savoir où chercher.

> Recompté le 2026-10-03 en comptant les `app.use('/api/v1/…')` du fichier, pas de mémoire : 28. Le 26e est `assurance` (02/10), le 27e `referentiels` et le 28e `journal` (03/10).

| Préfixe `/api/v1/…` | Pour qui | Fichier de routes |
|---|---|---|
| `auth` | tous | `auth.routes.ts` |
| `patients` | patient, soignants | `patient.routes.ts` |
| `consultations` | ASC, médecin | `consultation.routes.ts` |
| `ordonnances` | prescripteurs, patient | `ordonnance.routes.ts` |
| `commandes` | patient, pharmacies | `commande.routes.ts` |
| `medicaments` | prescripteurs | `medicament.routes.ts` — **ne rend que des médicaments** |
| `asc` | agent de santé communautaire | `asc.routes.ts` |
| `medecin` | médecin | `medecin.routes.ts` |
| `paiements` | patient | `paiement.routes.ts` |
| `vaccinations` | patient, ASC | `vaccination.routes.ts` |
| `notifications` | tous | `notification.routes.ts` |
| `analytics` | administrations | `analytics.routes.ts` |
| `admin-structure` | admin d'établissement | `admin-structure.routes.ts` |
| `pharmacien` | pharmacien | `pharmacien.routes.ts` — **catalogue complet, articles compris** |
| `sync` | ASC hors connexion | `sync.routes.ts` |
| `fhir` | interopérabilité | `fhir.routes.ts` |
| `triage` | ASC | `triage.routes.ts` |
| `privacy` | patient | `privacy.routes.ts` |
| `ussd` | passerelle USSD | `ussd.routes.ts` |
| `stats` | administrations | `stats.routes.ts` |
| `uploads` | tous | `upload.routes.ts` |
| `parametres` | admin national | `parametres.routes.ts` |
| `hopital` | agent d'accueil | `hopital.routes.ts` |
| `laboratoire` | laborantin | `laboratoire.routes.ts` |
| `resultats` | prescripteurs | `resultats.routes.ts` |
| `assurance` | comptoir **et** administration nationale | `assurance.routes.ts` — les deux publics sont séparés par les gardes de rôle |
| `referentiels` | administration nationale seule | `referentiel.routes.ts` — import CSV ; un référentiel vaut pour toute la plateforme |
| `journal` | administration nationale seule | `journal.routes.ts` — recherche et export du journal d'audit ; **ces routes sont elles-mêmes journalisées** |

Swagger est servi sur **`/api/docs`** et décrit dans `apps/api/src/config/swagger.ts`. **Il est incomplet** — voir la dette.

> Ce document annonçait `/api-docs` jusqu'au 03/10 ; cette adresse rend un 404. Vérifié par un appel réel.

> **Pour vérifier qu'une route figure dans Swagger, demandez d'abord `/api/docs/`.** Le fichier `/api/docs/swagger-ui-init.js` — celui qui porte le document — revient **vide** tant que la page HTML n'a pas été chargée une fois : `swaggerUi.serve` lit un cache que seul `setup()` remplit, et `setup()` ne tourne que sur la route HTML. Un navigateur charge toujours la page d'abord, donc aucun utilisateur n'est concerné ; mais un `curl` direct sur le script rend 200 avec 0 octet et laisse croire que le document est cassé. Payé deux fois le 03/10.

### Les écrans, par espace

48 composants dans 10 espaces (`apps/web/src/app/features/`).

| Espace | Écrans | Ce qu'on y fait |
|---|---|---|
| `auth` | 4 | connexion, OTP, mot de passe oublié, inscription |
| `landing` | 3 | page publique, annuaire des structures, contact |
| `patient` | 8 | parcours, ordonnances, QR, résultats, **demande de rendez-vous à distance** |
| `asc` | 4 | consultations, fiche de consultation, stocks, planning |
| `hopital` | 7 | accueil, épisodes, **pointage des présences**, **demandes de RDV**, triage |
| `laboratoire` | 3 | file, fiche de demande, scan du QR patient |
| `medecin` | 9 | consultations, dossier, **orientations**, **agenda**, **résultats à libérer**, **demandes** |
| `pharmacien` | 6 | ordonnances, stocks, approvisionnement, péremptions, **caisse** (avec le tiers payant), **tableau de bord** |
| `admin-structure` | 2 | agents, statistiques de l'établissement |
| `admin` | 4 | paramètres de plateforme, référentiels, analytique, utilisateurs |

En **gras** : ce qui a été ajouté entre le 28/09 et le 02/10. Aucun écran n'existe pour le rôle `LIVREUR` ni pour l'assurance.

---

## 4. Modèle de données

**43 modèles, 24 enums, 26 migrations** (recompté le 2026-10-02).

- **`Utilisateur`** — 12 rôles : `PATIENT`, `ASC`, `ASC_SUPERVISOR`, `MEDECIN`, `PHARMACIEN`, `AGENT_ACCUEIL`, `TECHNICIEN_LABO`, `LIVREUR`, `ADMIN_STRUCTURE`, `ADMIN_REGIONAL`, `ADMIN_NATIONAL`, `SUPER_ADMIN`. Le rôle `BIOLOGISTE` a été supprimé le 2026-09-30 : c'est le laborantin qui valide.
- **`PatientProfile`** — dossier, QR code, géographie (`prefecture`, `commune`, `quartier`), allergies et maladies chroniques en **texte libre** (d'où la comparaison tolérante aux accents, §5).
- **`EpisodeSoins` → `DemandeAnalyse` → `Echantillon` → `ResultatAnalyse`** — le parcours hôpital → laboratoire.
- **`Consultation` → `Ordonnance` → `LigneOrdonnance`** — voir ci-dessous.
- **`Commande` + `ReponsePharmacie`** — l'appel aux pharmacies du quartier et l'attribution au premier déclarant (P6, socle livré le 2026-09-26).
- **`ParametresSysteme`** — une seule ligne, `valeurs` en JSON, défauts dans `parametres.service.ts`. **Ajouter un paramètre ne demande aucune migration.**
- **`Compteur`** — numérotation lisible et atomique (`EP-2026-000123`, `DA-`, `EC-`, `OR-`, `AP-`), via `numero.service.ts`.
- **`Medicament`** — le catalogue, qui contient aussi des **articles non médicamenteux** depuis le 2026-10-01 (`categorie: CategorieProduit`). Le nom du modèle est désormais trop étroit ; le renommer en `Produit` est un chantier mécanique mais large, non fait.
- **`Stock` → `LotStock` ← `Approvisionnement`** — depuis le 2026-09-30, la quantité d'un stock est **la somme de ses lots**, et la date de péremption appartient au lot. Rien dans le schéma ne l'impose : les deux semences le vérifient en terminant, et `consommerLots` sort au plus proche de la date.
- **`RendezVous` + `DemandeRendezVous`** — le créneau fixé par le médecin, et la demande que le patient fait depuis chez lui.

### Ce que le modèle ne sait pas encore

Vérifié le 2026-10-02. **Deux manques sur quatre ont été comblés** depuis le 28/09 ; la géographie, le partenariat des pharmacies et le rôle `LIVREUR` existent.

| Manque | Bloque | Détail |
|---|---|---|
| ~~**`LotStock`**~~ | ~~bloc 6~~ | **Comblé le 2026-09-30.** `LotStock` et `Approvisionnement` existent, `Stock.datePeremption` a disparu, et la consommation se fait au plus proche de la péremption. La migration `20260930160000_lots_de_stock_et_approvisionnement` a reversé les 7 stocks existants en 7 lots, 2 362 unités conservées. |
| ~~**Vente au comptoir**~~ | ~~bloc 7~~ | **Comblé le 2026-10-02.** `VenteComptoir` + `LigneVente`, avec client **facultatif**, remise plafonnée par paramètre, vendeur, établissement, et les lots consommés gardés sur chaque ligne. `Facture` est restée la note d'une consultation : l'élargir aurait rendu ambiguë chaque requête existante. Trois contraintes SQL tiennent les invariants d'argent. |
| ~~**Catégorie de produit fermée**~~ | ~~bloc 8~~ | **Comblé le 2026-10-01.** `CategorieProduit` est une énumération de huit valeurs ; l'ancien texte libre est devenu `classeTherapeutique`, qui est un autre axe. Le catalogue accepte des articles sans DCI ni dosage, et une contrainte SQL (`medicaments_medicament_complet`) garantit qu'un `MEDICAMENT` porte toujours DCI, forme et dosage. Deux catalogues distincts : le comptoir voit tout, la prescription ne voit que des médicaments. |
| ~~**Modèle d'assurance**~~ | ~~bloc 8~~ | **Comblé le 2026-10-02.** `Assureur`, `ContratAssurance`, `RegleCouverture`, `ControleEligibilite`, et `TypeStructure.ASSURANCE`. Cinq contraintes SQL tiennent les invariants d'argent et de traçabilité — dont « un refus d'éligibilité porte toujours son motif », sans quoi il ne serait pas opposable. |

### L'ordonnance est un *document*, pas un médicament

Avant P3, « ordonnance » désignait un médicament prescrit : trois médicaments prescrits le même jour formaient trois objets sans lien. Il n'y avait donc rien à numéroter, rien à signer d'un geste, rien que la pharmacie puisse contrôler.

Aujourd'hui :

- **`Ordonnance`** porte le document — `numero` (`OR-AAAA-NNNNNN`), `codeVerification`, `valideJusquau`, signature, `renouvellementsAutorises` / `renouvellementsUtilises` ;
- **`LigneOrdonnance`** porte chaque médicament, et **la délivrance se fait à ce niveau** (une officine peut n'avoir qu'une partie du traitement) ;
- le statut du document **se déduit de ses lignes** (`recalculerStatut`), il ne se saisit jamais.

### Un résultat d'analyse n'est visible qu'après libération

Depuis le 2026-09-28, `DemandeAnalyse.diffuseePatientLe` **n'est jamais posé par le temps qui passe** : seul un médecin qui libère les résultats le renseigne, avec `idLiberePar` et `commentaireMedecin` (l'explication en langage clair).

Avant, un résultat sans particularité partait au patient dès la validation du laboratoire, et un résultat critique finissait par partir seul au bout de 24 h. Le cas courant n'était relu par personne ; le cas grave s'échappait avec le temps. Voir §7.

---

## 5. Règles de travail du projet

Elles ne sont pas décoratives — le code les applique.

1. **API d'abord, front ensuite, dans le même bloc.** Chaque bloc API est mergé (`develop` → CI verte → `main`), puis immédiatement branché au front avec ses écrans alignés sur le design de la landing.
2. **Aucune décision non tranchée en dur dans le code.** Les décisions `D1`–`D10` du CDC sont des **paramètres administrables** (`ParametresSysteme`) ou des référentiels importables. Exemple : `prescription.signatureObligatoire` est à `false` parce que la décision D2 n'est pas arbitrée — l'imposer bloquerait la délivrance là où il n'y a pas de médecin.
3. **SMS et paiement restent simulés**, derrière `notification.service` et `payment-provider.service`. Seul l'adaptateur changera.
4. **Chaque livraison référence ses exigences** (`EF-04-05`) dans le message de commit **et dans Swagger**.
5. **Ne jamais inventer de donnée clinique.** Le référentiel `interactions_medicaments` est volontairement **vide** : de fausses règles d'interaction dans une plateforme de santé seraient pires que pas de règles.
6. **Rien de trompeur sur la vitrine.** Les chiffres de la landing viennent de `GET /stats/public` avec repli `—`. Une fonctionnalité non construite qui figure au parcours porte une pastille « Bientôt ».
7. **Rien de médical ne parvient au patient sans qu'un soignant l'ait décidé.** Ni la validation du laboratoire, ni l'expiration d'un délai ne rendent un résultat visible. Le garde-fou qui relance le médecin escalade vers l'administrateur de la structure, **jamais vers le patient** — sinon il rétablirait par la fenêtre la diffusion automatique qu'on a supprimée.

### Comparaison de libellés saisis à la main

Les allergies et maladies chroniques sont du texte libre. `prescription-securite.service.ts` compare sur une forme normalisée (sans accents ni casse) **avec un seuil de 4 caractères** : sans ce seuil, « fer » se rapprocherait de « fermeture ». Une alerte de trop est du bruit, et le bruit apprend au prescripteur à ne plus lire les alertes.

---

## 6. Vérifier son travail

```bash
# API
cd apps/api && npx tsc --noEmit && npm test && npm run build

# Web
cd apps/web && npx tsc --noEmit && npm test
npm run build -- --configuration=production     # seul le build vérifie les templates

# Parcours e2e — Playwright demarre l'API et le web lui-meme, applique les
# migrations et la semence e2e. Deux conditions, voir §2 :
#   - le port 3000 doit etre LIBRE (sinon il reutilise votre API de dev) ;
#   - E2E_DATABASE_URL doit pointer sur une base qui existe.
docker exec baobao_db psql -U baobao_user -d postgres -c "CREATE DATABASE keneya_e2e;"
cd apps/web
E2E_DATABASE_URL=postgresql://baobao_user:<mdp>@127.0.0.1:5433/keneya_e2e npm run e2e
```

**Les quatre niveaux ne voient pas la même chose, et c'est voulu** :

| Niveau | Attrape | N'attrape pas |
|---|---|---|
| `tsc --noEmit` | les écarts au contrat partagé | les templates Angular, les semences (`prisma/` est hors `include`) |
| `npm test` | les règles métier, sur des mocks Prisma | ce qui dépend d'une vraie base, et tout l'affichage |
| `ng build --configuration production` | les templates, les pipes non importés | qu'une page rende effectivement quelque chose |
| `npm run e2e` | le produit de bout en bout, vraie base | ce qui n'est pas dans les cinq parcours |

C'est **le job e2e de la CI** qui a trouvé que les semences ne créaient aucun lot, donc qu'une base fraîche ne pouvait rien délivrer. Ni les 400 tests, ni le typage, ni la base locale ne l'avaient vu — la base locale marchait grâce à une reprise de données que personne ne rejouera.

**`tsc --noEmit` ne vérifie pas les templates Angular.** Seul `ng build` le fait.

### Un build vert ne prouve pas qu'une page rend quelque chose

C'est la leçon la plus chère du projet, payée **six fois** :

1. `*ngTemplateOutlet` sans importer `NgTemplateOutlet` → page vide, build vert.
2. `computed()` sur une propriété `ngModel` ordinaire → valeur figée. L'application est **zoneless** : `[(ngModel)]` qui écrit dans un champ ordinaire — ou qui mute un objet rangé dans un signal — ne notifie personne. Le 30/09, un formulaire de facture affichait un total faux (60 000 au lieu de 160 000) et son bouton d'enregistrement restait mort.
3. Un `.scss` créé à côté d'un composant **sans `styleUrl`** → bloc affiché sans aucune mise en forme, build vert.
4. Une classe CSS citée dans un gabarit mais **jamais définie** → aucun style, aucune erreur.
5. Un **service web mal typé** : `getMedicaments()` annonçait `PharmacieStock[]` quand l'API rend des médicaments à plat. Tout appelant lisant `m.medicament` recevait `undefined`, et la liste déroulante restait vide, sans erreur.
6. Un **champ retiré du modèle mais laissé dans le contrat**, en optionnel : `Stock.datePeremption` a disparu le 30/09, les deux écrans de stock ont cessé d'afficher les dates pendant un jour, et le compilateur s'est tu parce que le champ était `?`.

Les points 5 et 6 ont la même racine : **un type qui mentait**. Quand un champ est calculé ou retiré, rendez le contrat strict — c'est le compilateur qui doit refuser, pas l'écran qui doit se vider.

**Toute question d'affichage se vérifie dans un vrai navigateur**, dans les deux thèmes. Playwright pilote le Chrome installé (`channel: 'chrome'`) ; un script jetable qui se connecte, navigue, lit `getComputedStyle` et prend une capture coûte quelques minutes et attrape ce que la compilation ne voit pas.

### CI

`.github/workflows/ci.yml` — cinq jobs sur chaque poussée : *API Build & Test*, *API Security Audit*, *Web Build*, *Web Security Audit*, *E2E Parcours*. Le job *Deploy* est **ignoré** (aucun secret ni environnement `production` configuré).

L'audit passe par **`scripts/audit-gate.mjs`**, pas par `npm audit` brut : même exigence (tout avis *high*/*critical* fait échouer la CI) mais avec des **exceptions nommées par identifiant GHSA, justifiées et datées**.

> `gh run list --commit <sha>` est **peu fiable sur ce dépôt** : il renvoie parfois un run périmé, parfois rien. Interrogez par branche et filtrez sur `headSha` :
> `gh run list --branch develop --limit 5 --json databaseId,headSha,status,conclusion`

### Les permissions se testent

`requireRole` porte ses rôles (`GardeDeRole.roles`), ce qui permet de parcourir la pile d'un routeur Express et d'affirmer qui peut atteindre quoi — voir `tests/routes-permissions.test.ts`. Avant, retirer un `requireRole` d'une route ne cassait aucun test et l'API s'ouvrait en silence.

**Fermer une route ne suffit pas toujours.** La même donnée arrive souvent par plusieurs chemins : les résultats d'analyse sont exposés par `/demandes-analyse/:id` **et** par la fiche d'épisode. Retirer le droit d'un côté le laissait revenir par l'autre. Cherchez toujours le second chemin.

### Prouver, pas supposer

La convention du projet est de **saboter ses propres tests** avant de les croire : retirer la garde, vérifier que le test tombe pour la bonne raison, restaurer. Une suite verte ne prouve rien tant qu'on ne l'a pas vue échouer.

Signe qui ne trompe pas : quand un changement de règle fait échouer des tests existants, **lisez leurs noms**. Le 2026-09-28, quatre tests sont tombés — ils s'appelaient « diffuse aussitôt au patient » et « diffuse au patient passé le délai ». Ils faisaient exactement leur travail.

#### Les quatre façons dont un sabotage mentit, et comment les éviter

Sur treize sabotages menés entre le 30/09 et le 02/10, **quatre ont révélé un défaut du contrôle, pas du code**. Chacun est une erreur reproductible :

1. **Un marqueur partagé par le succès et l'échec.** Un contrôle comptait l'icône `pi-calendar-times` pour vérifier qu'une date s'affichait — mais les **deux branches** du `@if` rendent cette icône. Le compte valait 9 dans tous les cas. Même erreur qu'un contrôle antérieur qui cherchait `/Arriv/`, motif que portait aussi le bouton « Pointer l'arrivée ». *Demandez-vous toujours : si la règle tombait, cette assertion changerait-elle de valeur ?*

2. **Des données laissées par les passages précédents.** Un contrôle cherchait des numéros de lot dans toute la page ; l'historique des exécutions antérieures suffisait à le satisfaire, donc un sabotage qui n'enregistrait qu'un lot sur deux passait. *Étiquetez chaque exécution et ne faites porter les assertions que sur son étiquette.*

3. **Un sabotage qui ne compile pas.** Deux fois, le code saboté a été rejeté par le compilateur : le serveur de développement a continué à servir l'ancien paquet, et le contrôle est passé. *Attendez une reconstruction réellement postérieure à l'édition* — comptez les « bundle generation complete » dans `.web.log` — *et vérifiez que le sabotage compile.*

4. **Un sabotage sur une cible que le code ne touche pas.** La protection des stocks approvisionnés a été « vérifiée » sur un produit `e2e` que `seed-demo` ne gère jamais. *Vérifiez que le chemin saboté est bien celui que le test emprunte.*

Et un corollaire sur les mesures : `cmd | tail` renvoie le code de sortie de `tail`. Mesurez le code de la commande, pas celui du tube.

---

## 7. Où nous en sommes

### Les blocs du cahier des charges

« Livré » veut dire **API et front, vérifiés dans un navigateur**. Tout ce qui suit est sur `main`.

| Bloc | Objet | État |
|---|---|---|
| **P0** | Identité de la plateforme administrable (nom, logo, coordonnées) | ✅ complet |
| **P1** | Épisode de soins, demande d'analyse, espace Accueil, « Mon parcours » patient | ✅ complet, **repris** par l'addendum (RDV, périmètre de l'accueil) |
| **P2** | Laboratoire — file, prélèvement, résultats, validation, valeurs critiques, courbes | ✅ quasi complet (1 case : synchronisation hors connexion du laboratoire), **repris** (biologiste, libération) |
| **P3** | Ordonnance infalsifiable, sécurité de prescription, renouvellement, produits réglementés | ✅ quasi complet (1 case) |
| **P6** | Pharmacie et officine | ⏳ **4 cases sur 13** — socle de commande (API seule), lots de stock, approvisionnement par facture, alerte de péremption |
| **P13** | Extension | ⏳ 1 case sur 5 — la prise de RDV à distance a été remontée ici |
| P4, P5, P7 – P12 | identité/consentement, fil d'avancement, paiement, livraison, notifications, assurance, administration, interopérabilité | ❌ non commencés |

### Les huit blocs de l'addendum — les huit livrés

`docs/ADDENDUM-CDC-2026-09-28.md` contient neuf points du chef de projet. Trois contredisaient du code déjà écrit ; ils ont été repris.

| # | Bloc | Livré le | Ce qu'il a changé |
|---|---|---|---|
| 1 | Résultats libérés par le médecin | 2026-09-28 | Un résultat ne part plus au patient à la validation. Le médecin le libère, avec un commentaire. Relance à 12 h, escalade à 48 h, **aucune diffusion automatique**. |
| 2 | Le médecin prescrit, l'accueil se recentre | 2026-09-29 | L'écran de prescription d'analyses passe au médecin ; l'accueil perd le droit, et **les valeurs de résultats lui sont masquées jusque dans la vue d'épisode** — fermer les routes ne suffisait pas. |
| 3 | RDV fixés par le médecin, agenda, pointage | 2026-09-30 | L'accueil oriente **sans proposer d'heure** ; le médecin fixe le créneau et voit son agenda ; l'assistante pointe l'arrivée. `StatutRendezVous` devient une énumération. |
| 4 | Suppression du rôle biologiste | 2026-09-30 | Le laborantin valide. Migration des comptes faite **avant** la recréation de l'énumération, sinon la conversion échoue. Les comptes rendus gardent le nom de leur valideur. |
| 5 | Prise de rendez-vous à distance | 2026-09-30 | Le patient demande depuis chez lui ; l'accueil ou le médecin accepte, ce qui crée l'épisode et le rendez-vous en une transaction. |
| 6 | Pharmacie : lots, approvisionnement, péremptions | 2026-09-30 | `Stock.datePeremption` disparaît au profit de `LotStock`. Saisie de facture, une ligne par lot avec sa propre date. Sortie **au plus proche de la péremption**, lot périmé bloqué. |
| 7 | Pharmacie : vente au comptoir et tableau de bord | 2026-10-02 | `VenteComptoir` + `LigneVente`. Client **facultatif**, remise plafonnée par paramètre, ordonnance exigée pour un produit réglementé (EF-05-12) et annoncée **avant** l'encaissement. Annulation d'une erreur de saisie qui remet exactement les lots sortis. **Reste le volet assurance**, qui dépend du bloc 8. |
| 8 | Assurance | 2026-10-02, API + caisse | Éligibilité opposable et tracée, règles d'exclusion par catégorie, reste à charge ligne par ligne, tiers payant sur la vente au comptoir. **Restent** : le front, la vue de l'assureur sur ses pharmacies conventionnées, les bénéficiaires d'un contrat, les taux par acte et par analyse (supposent P11), et les échanges automatiques avec les assureurs. |

### Décisions prises, à ne pas rediscuter

- **Seul le médecin crée le rendez-vous.** L'accueil oriente sans proposer d'heure.
- **Le laborantin valide**, `BIOLOGISTE` est supprimé du modèle et du contrat.
- **L'« assistante » est l'`AGENT_ACCUEIL` existant**, à qui on a ajouté le pointage. Pas de nouveau rôle.
- **L'accueil ne fait plus rien de médical** : ni prescription, ni ordonnance, ni lecture de résultats. Il garde : chercher ou créer le patient, ouvrir l'épisode, pointer la présence, rediriger. Le médecin ferme l'épisode.
- **La prise de rendez-vous à distance est faite** ; la **téléconsultation réelle** reste en lot V4, suspendue à la décision D2.
- **Le catalogue accepte des articles non médicamenteux**, par catégorie fermée (décision du 2026-10-01, voir ci-dessous).

### Le catalogue, depuis le 2026-10-01

Le point le plus structurant livré après l'addendum, parce qu'il conditionnait les deux blocs restants.

- `CategorieProduit` est une **énumération de huit valeurs** (`MEDICAMENT`, `LAIT_INFANTILE`, `COMPLEMENT_ALIMENTAIRE`, `COSMETIQUE`, `HYGIENE`, `PARAPHARMACIE`, `DISPOSITIF_MEDICAL`, `AUTRE`). L'ancien texte libre est devenu `classeTherapeutique` — c'est un autre axe, et il reste libre.
- `dci`, `forme` et `dosage` sont **facultatifs** : un lait infantile n'en a pas. L'invariant est une **contrainte SQL**, `medicaments_medicament_complet` : un `MEDICAMENT` porte toujours les trois. Ce n'est pas du zèle — le contrôle d'allergie et la recherche d'interaction comparent sur la DCI, et une ligne de médicament sans DCI les traverserait en silence.
- `libelle` est le nom affiché, **toujours renseigné**. Treize écrans recomposaient `nomCommercial ?? dci`, ce qui ne veut rien dire pour un article.
- **Deux catalogues** : `GET /pharmacien/medicaments` rend tout (une officine vend aussi du lait) ; `GET /medicaments` ne rend que des médicaments. `analyserPrescription` refuse de toute façon un article non médicamenteux, mais autant ne pas le proposer.

---

## 8. Ce qui reste

Deux listes qui **se recouvrent largement**. Le chef de projet n'a pas ajouté huit chantiers aux cinquante-huit restants : il en a déplacé, supprimé et précisé.

### A. Décompte de la feuille de route

Recompté dans `docs/FEUILLE_DE_ROUTE_KENEYA.md` le 2026-10-02, en lisant les cases à cocher. `[~]` note un bloc livré en partie.

| Bloc | Fait | Partiel | Reste | Ce qui manque |
|---|---|---|---|---|
| P0 Identité plateforme | 5 | — | **0** | ✅ fini |
| P1 Épisode de soins | 11 | — | **0** | ✅ fini |
| P2 Laboratoire | 11 | — | 1 | synchronisation hors connexion du laboratoire (EF-04-11) |
| P3 Ordonnance | 5 | — | 1 | — |
| P4 Identité, consentement, accès | 0 | — | 7 | **rien n'est commencé** |
| P5 Fil d'avancement | 0 | — | 3 | rien |
| P6 Pharmacie et officine | 5 | 1 | 7 | lots, approvisionnement, péremptions, **vente au comptoir et tableau de bord** livrés ; restent les écrans de commande, l'import Excel et l'OCR de facture |
| P7 Paiement | 0 | — | 5 | rien |
| P8 Livraison, carte, annuaire | 0 | — | 9 | rien |
| P9 Notifications neutres | 1 | — | 1 | **neutralité des messages sortants** livrée le 02/10 ; restent les préférences de canaux et le rejeu |
| P10 Assurance | 3 | 4 | 2 | assureur, contrat, règles par catégorie, éligibilité tracée, tiers payant à la caisse (02/10) ; restent la vue assureur, l'administration à l'écran et les échanges automatiques |
| P11 Admin, audit, référentiels | 6 | 1 | — | **référentiels**, **journal d'audit**, **suspension de compte**, **détection d'anomalies** et **demandes RGPD** (03–04/10). Reste EF-12-02, les conventions des partenaires |
| P12 Interopérabilité | 0 | — | 3 | rien |
| P13 Extension | 1 | — | 4 | téléconsultation réelle (suspendue à D2) |
| **Total** | **42** | **5** | **48** | sur 95 |

**Deux blocs sont réellement finis : P0 et P1.** P2 et P3 n'ont plus qu'une case chacun, et P11 n'a plus que les conventions des partenaires.

> Ce tableau était faux jusqu'au 03/10 au soir : il annonçait encore P6, P9 et P10 au point où ils étaient le 01/10, et un total de 36 au lieu de 42. Les comptes sont désormais repris de `FEUILLE_DE_ROUTE_KENEYA.md`, qui fait foi. Un pack de reprise qui ment sur l'état du projet est pire qu'un pack absent.

### B. Les blocs d'addendum — tous livrés

Les neuf points du chef de projet sont traités. Les blocs 7 (vente au comptoir) et 8 (assurance et
tiers payant) ont été livrés le 2026-10-02 ; ils figuraient encore ici comme « restants » jusqu'au
03/10 au soir, alors que la section « Les huit blocs de l'addendum » les donnait livrés juste
au-dessus. Deux sections du même document se contredisaient.

Ce qui reste de ces deux blocs n'est plus du modèle mais de l'écran et de l'échange :

| # | Bloc | Ce qui reste |
|---|---|---|
| 7 | Vente au comptoir | L'import Excel des factures fournisseur, l'OCR, et les écrans de commande côté pharmacie. |
| 8 | Assurance et tiers payant | La vue de l'assureur sur ses pharmacies conventionnées, l'écran d'administration des assureurs, les bénéficiaires d'un contrat, les taux par acte et par analyse (supposent un référentiel d'actes — l'import existe depuis le 03/10), et les échanges automatiques avec les assureurs. |

### C. Ce que l'addendum ne couvre pas et qu'il ne faut pas perdre

Ces blocs n'ont pas été évoqués par le chef de projet, mais ils conditionnent une mise en service :

- **P4** (7 cases) — identito-vigilance, doublons, consentement versionné, bris de glace, journal des accès patient. Le plus lourd non commencé, et le plus sensible réglementairement. **EF-02-08 en dépend** : le journal d'audit trace les scans de QR mais `idRessource` reste vide (voir la dette), donc « qui a consulté mon dossier ? » n'a pas de réponse indexée.
- **P11** — EF-12-01, 03, 04, 05, 06 et 09 sont livrés, API, Swagger et écrans compris. Reste **EF-12-02**, les conventions des partenaires : ni modèle ni écran. Le référentiel d'interactions reste **vide en base** : il manque une source médicale validée, pas l'outil.
  - **Deux chantiers ouverts par EF-12-09**, qui ne sont pas du code : la **durée légale de conservation d'un dossier de soins en Guinée**, qui détermine ce qu'on peut répondre à une demande d'effacement ; et le sort des **15 comptes à moitié purgés** du 2026-08-04 — terminer l'anonymisation, ou rétablir ?
  - **L'anonymisation elle-même reste à construire.** Aujourd'hui une demande d'effacement se traite à la main, et la réponse écrite dit ce qui a été fait.
  - Sur les anomalies, à savoir avant de s'y fier : **les seuils ne sont pas calibrés** sur du trafic réel, et devront probablement varier selon le rôle. Ils sont affichés à l'écran pour cette raison.
- ~~**P9**~~ — la neutralité des messages sortants est **livrée le 2026-10-02**, et ce n'était pas une case vide : le code envoyait du contenu médical en SMS clair. Reste une case : préférences de canaux et de langue, rejeu des non délivrées.

### D. Questions ouvertes

Trois des cinq questions de l'addendum sont tranchées (A, B, C, D ; voir le tableau en fin d'addendum). Reste :

- **E — Vente au comptoir sans ordonnance : autorisée pour tous les produits ?** Un produit réglementé ne se vend pas sans ordonnance (EF-05-12), et c'est acquis. La question porte sur le reste : un antibiotique non classé, par exemple. Elle bloque le bloc 7.
- **Deux propositions de `PARCOURS-COMMANDE-LIVRAISON.md`** attendent validation : la double voie de preuve de remise, et le circuit de substitution pharmacien → médecin.
- **Non décidé et signalé** : une photo de QR code ouvre la même porte au comptoir de pharmacie et au guichet du laboratoire. J'ai recommandé de demander la date de naissance après le scan, aux deux endroits simultanément. Sans réponse à ce jour.

### E. Le chemin critique n'est pas le code

L'agrément de l'hébergeur santé (ENF-05) et la reprise de données commandent la date de mise en service — ils ne s'accélèrent pas en écrivant plus vite, et sont à lancer **immédiatement, en parallèle**. Six décisions externes (D1/D2/D4/D5/D6/D7/D8) conditionnent des blocs entiers ; toutes sont déjà des paramètres, les trancher ne demandera aucun développement.

---

## 9. Dette et pièges connus

### Dette (vérifiée le 2026-10-02)

| Point | Constat |
|---|---|
| ~~`apps/api/prisma.config.js`~~ | ✅ **Résolu le 2026-09-28** — supprimé et ignoré. |
| ~~Section de paramètres non enregistrable~~ | ✅ **Résolu le 2026-10-02.** `updateParametresSystemeSchema` est `.strict()` et **n'avait aucune section `prescription`** : l'onglet « Ordonnances » de l'écran d'administration s'affichait, son bouton répondait, et rien ne s'enregistrait. Trouvé en ajoutant la section « Comptoir ». Un test vérifie désormais que **chaque** section du contrat passe le schéma. |
| Swagger | **10 routes pharmacien documentées sur 19** (recompté le 02/10, après le bloc 7). Manquent `scan`, `renouveler`, les stocks, le catalogue, les agents et `stocks/reapprovisionner`, alors que le CDC exige la documentation. |
| CI | ✅ **Les actions sont en `@v5` et Node 24** (vérifié le 02/10 ; la dette de dépréciation est levée). Reste : `ubuntu-latest` bascule vers **Ubuntu 26 le 19/10/2026**, et le runner l'annonce à chaque exécution. |
| `REDIS_URL` | Non configuré : limitation de débit **en mémoire**, donc inopérante à plusieurs instances. |
| Gmail | Non configuré : OTP en repli développement. Inacceptable en production. |
| ~~`README.md`~~ | ✅ **Repris le 2026-10-02** — il annonçait « BaoBaoHealth », PrimeNG et neuf rôles. Il pointe désormais sur ce dossier et sur l'addendum. |
| Espace ASC non démontrable | La semence de démonstration ne crée **aucun compte ASC**, et le mot de passe des comptes ASC existants n'est pas connu (voir `COMPTES-KENEYA.md`). L'espace agent de santé communautaire ne peut donc pas être montré, ni vérifié au navigateur. |
| Semences hors typage | `apps/api/tsconfig.json` déclare `include: src/**/*` : **`prisma/seed*.ts` n'est pas type-vérifié**. Une erreur y reste invisible jusqu'à l'exécution. |
| Sync hors connexion | Ne couvre que l'ASC. Le laboratoire (EF-04-11) l'attend — c'est la dernière case de P2. |
| Modèle `Medicament` mal nommé | Le catalogue contient des cosmétiques et du lait depuis le 01/10. Le renommer `Produit` est mécanique mais touche presque tous les services ; non fait, et les relations `Stock.medicament` et `LigneVente.medicament` désignent donc parfois un savon. |
| Exceptions d'audit | Quatre avis `high`/`critical` sont couverts par des exceptions datées dans `scripts/audit-gate.mjs` : `deepmerge-ts`, `mysql2` (×2) et `piscina`. **Réexamen : 01/11/2026 pour piscina, 01/12/2026 pour les trois autres.** Chacune dit pourquoi elle ne nous expose pas. |
| `overrides` npm inopérants | npm 11 **ne déplace pas** une dépendance épinglée en version exacte par un parent, ni à plat ni en forme imbriquée. Retirer l'entrée du verrou pour forcer une résolution fait **perdre des paquets** à l'arbre. Constaté sur `prisma` en septembre et reconfirmé sur `@angular/build`/`piscina` le 02/10. |
| Images de la landing | Banques d'images génériques, **noms de fichiers trompeurs**, une avec signalétique en espagnol. Manquent : laboratoire, livraison. |
| Marque | Le bandeau latéral **et la réponse de `/health`** affichent encore « Santé Pour Tous » alors que les SMS partent sous « KENEYA ». |
| Rôle `LIVREUR` | Existe dans le modèle, **sans aucune route ni écran** : un tel compte atterrirait sur `/unauthorized`. |
| Journal d'audit | Les scans de QR sont tracés depuis le 2026-09-29 (**vérifié en base** : une ligne par scan, avec le rôle et la personne). Mais `idRessource` reste vide — le middleware ne lit que `req.params.id`, or le paramètre s'appelle `qrCode`. Le patient concerné n'est que dans `metadonnees.params`, donc non indexé. Répondre à « qui a consulté mon dossier ? » est possible mais coûteux. **EF-02-08 n'est pas couvert**, il reste en P4. |

### Pièges rencontrés — à ne pas repayer

**Base de données**

- **Un champ retiré du modèle reste souvent dans le contrat, et l'écran cesse d'afficher sans rien dire.** `Stock.datePeremption` a disparu le 2026-09-30, mais `StockAscView` et `StockPharmacieView` l'annonçaient encore — optionnel, donc le compilateur se taisait. Les deux écrans de stock ont arrêté d'afficher les dates de péremption pendant un jour sans qu'aucune erreur n'apparaisse. Corrigé le 2026-10-01 : le contrat porte `peremptionLaPlusProche`, calculée depuis les lots, et relire l'ancien champ ne compile plus.
- **La quantité d'un stock est la somme de ses lots, et rien ne l'impose.** Depuis le 2026-09-30 la sortie passe par `consommerLots` : une quantité sans lot est indélivrable, alors que l'écran affiche du stock. Les deux semences l'avaient oublié, et la CI e2e l'a trouvé — pas les tests, pas le type-checking, pas la base locale, dont les lots venaient de la migration. Chaque semence vérifie maintenant l'invariant en terminant.
- Corollaire : **une base locale qui marche ne prouve rien sur une base neuve.** Ce qui marchait ici venait d'une reprise de données que personne ne rejouera.

**Angular**

- `computed()` **ne suit que des signaux**. Sur une propriété ordinaire liée par `ngModel`, la valeur est figée au premier calcul, sans aucune erreur. Utiliser un `signal()` posé explicitement.
- `*ngTemplateOutlet` sans importer `NgTemplateOutlet` est **ignoré en silence** : build vert, page vide. Même famille : `routerLink` sans `RouterLink`.
- Un `.scss` créé à côté d'un composant **qui n'a pas de `styleUrl`** est un fichier mort. Vérifier le décorateur avant d'écrire du style.
- Thème sombre : `:host-context([data-theme='dark'])` dans un SCSS de composant ; `[data-theme='dark']` dans une feuille globale. L'un ne marche pas à la place de l'autre.
- **Les jetons `--bb-danger`, `--bb-info` et `--bb-warning` ne sont pas redéfinis en sombre** — seuls leurs `-bg` et `-border` le sont. Un `--bb-info` (#1E40AF) sur `--bb-info-bg` sombre (#0A0F2D) est illisible. Rattraper localement avec une teinte claire (#60A5FA, #F87171, #FBBF24), comme le fait le tableau de bord médecin.
- `--bb-surface-1` **vaut** `--bb-surface-card` en sombre : un bandeau qui compte dessus pour se détacher devient invisible.
- Les styles Material se chargent **après** la feuille globale et gagnent à spécificité égale : doubler la classe (`&__x#{&}__x`) quand il faut l'emporter.

**Migrations**

- **Lisez le SQL avant d'appliquer une migration qui change un type.** Pour passer `RendezVous.statut` de `String` à un `enum`, `prisma migrate diff` proposait `DROP COLUMN` puis `ADD COLUMN` : les statuts auraient été effacés et les rendez-vous annulés seraient repassés à « planifié ». Il faut l'écrire à la main avec `USING`, et vérifier les valeurs avant/après.
- Un BOM UTF-8 en tête d'un `.prisma` le rend invalide (« This line is invalid »). `Set-Content -Encoding utf8` de PowerShell en ajoute un ; préférez Python ou l'outil d'écriture.

**Prisma**

- `ALTER TYPE … ADD VALUE` et l'usage de la valeur ajoutée **ne peuvent pas cohabiter dans la même transaction**. Deux fichiers de migration.
- Un champ `Json` revient en `JsonValue` : la conversion vers le type du contrat se fait **une fois**, dans un mappeur partagé.
- Dans un générique, `{...obj, champ: X}` **conserve le type d'origine** de `champ` par intersection. Il faut `Omit<T, 'champ'> & { champ: X }`.
- Une colonne nullable arrive en `null`, jamais `undefined`.
- **Prisma 7 a changé les drapeaux de `migrate diff`** : `--to-schema-datamodel` → `--to-schema`, `--from-url` → `--from-config-datasource`, et `--shadow-database-url` n'existe plus. Pour prouver qu'une migration reproduit le schéma : créer une base jetable, `migrate deploy` dessus, puis `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` avec `DATABASE_URL` pointant sur elle. Attendu : « No difference detected », sortie 0.
- **Ne jamais ajouter d'`overrides` npm sans vérifier ce qu'il advient des paquets.** Une tentative a fait *disparaître* `deepmerge-ts` : `npm audit` est devenu vert parce que le code n'existait plus, pas parce qu'il était corrigé.

**Écriture atomique**

Le projet utilise partout le même motif pour une prise de décision concurrente — attribution d'une commande, libération de résultats : un `updateMany` dont le `where` porte la condition, et qui renvoie `count`. Deux appelants simultanés donnent un gagnant et un perdant, jamais deux gagnants.

**Outils (Windows)**

- Playwright utilise le **Chrome installé** en local (`channel: 'chrome'`), pas son Chromium.
- PowerShell re-tokenise les chaînes contenant `"` passées à un exe natif : utiliser `git commit -F fichier`. Les expressions `jq` avec `\(...)` y sont aussi cassées.
- Le démarrage des workers Vitest échoue parfois de façon **transitoire**. Relancer avant de diagnostiquer.
- `npx ng test` (pas `npx vitest run` directement) : l'invocation directe contourne le builder Angular et perd les globales, donnant un `describe is not defined` trompeur.

**Méthode**

- **Un `try/catch` qui n'écrit qu'un avertissement avale aussi vos garde-fous.** `envoyerSmsSimule` enveloppait l'envoi pour qu'une panne d'opérateur ne fasse pas échouer un parcours de soin ; un contrôle placé à l'intérieur se serait transformé en simple `logger.warn`. Le contrôle est donc **hors** du try, et le `try` ne couvre que l'envoi.
- **Un `replace(motif, 1)` prend la première occurrence, pas celle que vous visez.** Un sabotage a ainsi retiré un garde-fou d'une fonction voisine portant la même ligne, et le test est resté vert — à raison. Quand un motif existe en plusieurs exemplaires, ciblez la fonction, pas le fichier.
- **Un test qui affirme une capacité que le code n'a pas est pire que pas de test.** Le filtre de vocabulaire ne peut pas détecter un nom de produit ni un nom d'établissement : ils viennent de la base. Le test le dit explicitement au lieu de prétendre le contraire, et la défense est déplacée dans le constructeur, qui ne reçoit pas ces valeurs.
- **Un schéma Zod `.strict()` rejette tout champ qu'il ne connaît pas, même si le contrat et le service le portent.** Le symptôme est un 400 « Unrecognized key », et **les tests unitaires ne le voient pas** : ils appellent le service, pas Zod. Payé deux fois le 2026-10-02 — `prescription` dans les paramètres, puis `avecAssurance` sur la vente. Un test par schéma vérifie désormais que chaque champ optionnel du DTO passe.
- **Une vérification qui ne peut pas échouer ne vérifie rien.** Un contrôle du pointage cherchait `/Arriv/` dans la page — or le bouton s'appelle « Pointer l'arrivée », donc il passait quoi qu'il arrive. Comptez des éléments précis, et assurez-vous d'avoir vu le contrôle échouer.
- **Un écran qui envoie moins que ce que l'API exige échoue en silence.** L'écran de demande de rendez-vous n'envoyait que le motif ; l'API réclamait aussi un établissement, faute de structure préférée au dossier. Le build était vert, la page s'affichait, et le bouton ne faisait rien d'autre qu'un 400. Vérifiez un formulaire **contre l'API**, pas seulement à l'écran.
- **Les scripts de vérification déclenchent la limitation de débit** (429 après quelques connexions). Elle est en mémoire faute de `REDIS_URL` : redémarrer l'API la remet à zéro.
- **Ne jamais déduire le contenu d'un fichier de son nom.** `hero-patient.jpeg` est une plaquette d'ibuprofène vide ; `hero-hospital.jpeg` un portrait de médecin.
- Un mot de passe se vérifie **contre l'empreinte stockée**, pas contre le script de seed censé l'avoir posé. Mieux : en tentant réellement la connexion sur l'API.
- Une migration de données se prouve **en l'exécutant sur une base jetable**.
- Un script de seed périmé peut annoncer « 0 compte mis à jour » et sortir en code 0. Lire la sortie, pas seulement le code de retour.
- **Un numéro de ligne rendu à un humain doit être celui qu'il voit, pas un index de tableau.** Le rapport d'import des référentiels numérotait les lignes par leur position dans le tableau *après* avoir écarté les lignes vides. Une seule ligne blanche, et l'opérateur était renvoyé à la ligne précédant la fautive : il corrigeait une ligne saine et laissait la mauvaise. Les 40 tests unitaires ne le voyaient pas — ils travaillaient sur des CSV sans trou. Trouvé le 03/10 en interrogeant l'API réelle avec un fichier tel qu'Excel l'exporte. Corollaire : un champ entre guillemets qui occupe trois lignes décale de trois ce qui suit, donc le découpage doit compter les sauts de ligne **même à l'intérieur des guillemets**.
- **Un test qui ne peut pas échouer ne vérifie rien — et un titre de section ne le rend pas vrai.** Une épreuve intitulée « le rappel au moment de répondre à un effacement » testait en fait une rectification, la seule demande ouverte à ce moment-là : le rappel n'était jamais affiché, et tout passait. Vérifiez que le cas que vous nommez est bien celui que vous exercez.
- **Les données d'essai finissent à l'écran.** Les demandes RGPD déposées par mes scripts s'affichaient sans accents sur les écrans de démonstration — « duree legale de conservation ». Un texte français approximatif se lit comme une sortie de machine. Écrivez les jeux d'essai comme s'ils allaient être montrés, parce qu'ils le seront.
- **Playwright refuse de cliquer un élément recouvert, même quand le navigateur achemine le clic.** Le `mat-label` flottant recouvre le déclencheur d'un `mat-select` : le test échoue alors que l'interface fonctionne — vérifié, un clic réel ouvre bien la liste, et le clavier aussi. Cliquez le `<mat-label>`, comme le ferait quelqu'un qui vise le champ.
- **Une phrase générée doit s'accorder avec le code qu'elle accompagne.** Le journal affichait « Dossier consulté » à côté d'un 403 : l'accès avait été refusé, rien n'avait été consulté, et la phrase contredisait la colonne voisine. C'est exactement ce qu'une enquête ne doit pas lire. Vu à l'écran, pas en relisant le code.
- **Un filtre large ne fait pas un détecteur.** `statutHttp >= 400` convient à une recherche, pas à une détection : la base portait 58 erreurs 400, toutes issues de scripts de vérification. Pour détecter un abus d'accès, seuls 401 et 403 comptent.
- **Un sabotage ne prouve rien si le jeu d'essai ne discrimine pas les deux règles.** Trier les anomalies par gravité ou par dépassement donnait le même ordre sur mes données : le sabotage du tri passait inaperçu. Il a fallu construire un cas où les deux règles se contredisent.
- **Un enfant de `mat-card` s'étire sur toute la largeur.** La carte est en `display: flex; flex-direction: column`, donc `align-items: stretch` s'applique : un bouton seul sur sa ligne prend 1031 px au lieu de 131. `width: auto` n'y change rien — c'est `align-self: flex-start` qu'il faut. Corrigé deux fois le 03/10, la première tentative visant la mauvaise propriété ; seule la capture l'a montré.
- **Un écran qui liste une énumération complète révèle les traductions manquantes.** `AGENT_ACCUEIL`, `TECHNICIEN_LABO` et `LIVREUR` n'avaient aucun libellé, ni en français ni en anglais : partout où ces rôles s'affichaient, l'utilisateur lisait `ROLE.AGENT_ACCUEIL`. Personne ne l'avait vu parce qu'aucun écran ne les listait tous.
- **Un `colorScheme` passé au navigateur ne bascule pas le thème de cette application.** Elle le pose elle-même en `data-theme` sur `<html>` (`theme.service.ts`) ; `prefers-color-scheme` n'est pas suivi. Deux campagnes de captures « clair et sombre » du 03/10 étaient donc deux campagnes en clair, et cela ne s'est vu qu'en **comparant les images**, pas en relisant le script. Une vérification de thème doit cliquer l'interrupteur et lire `document.documentElement.dataset.theme` avant de conclure.
- **Un écran qui réemploie les mots d'un autre public dit des choses fausses.** Le journal d'administration affichait « votre dossier a été consulté » à propos du dossier d'un tiers, parce qu'il réutilisait les libellés écrits pour le patient. Le même événement se raconte autrement selon qui lit : gardez une seule table de correspondance, mais deux rédactions.
- **Dans un contrôle `mat-checkbox` ou `mat-slide-toggle`, cliquez le `<label>`.** L'`<input>` est masqué visuellement, et un `click({ force: true })` dessus ne déclenche pas `(ngModelChange)` : le test passe à côté du filtre tout en paraissant l'avoir actionné. Payé deux fois le 03/10.
- **Le script `/api/docs/swagger-ui-init.js` est vide tant que `/api/docs/` n'a pas été chargé.** Voir la note de la carte des endpoints.
- **`'\b'` dans un script Python produit un caractère retour arrière**, pas la séquence `\b` attendue par une expression régulière — alors que `'\s'` reste littéral, n'étant pas une séquence d'échappement valide. Un motif de test cherchait ainsi des caractères de contrôle et ne mordait sur rien. Écrivez ces fichiers avec l'outil d'édition, ou construisez la séquence avec `chr(92) + 'b'`.
- **`req.path` ment dans un routeur monté.** Express le tronque du préfixe de montage : pour `/api/v1/patients/abc`, un middleware applicatif voit `/abc`. Le service d'audit y cherchait le segment `v1` et retombait sur le premier segment restant — d'où 288 lignes de ressource « me » et des identifiants de patient pris pour des noms de ressource. `req.originalUrl` n'est jamais modifié ; il porte la chaîne de requête, qu'il faut retirer.
- **Un test peut passer en encodant une hypothèse fausse.** Mes 28 premiers tests du résolveur d'audit fabriquaient une requête avec le chemin complet dans `req.path` — ce que le middleware ne voit jamais. Ils étaient verts et le code ne pouvait pas fonctionner en service. C'est l'API réelle qui l'a montré. Quand un test fabrique une entrée, vérifiez que vous la fabriquez comme le cadre la présente, pas comme vous l'imaginez.
- **Mesurez avant de basculer une lecture d'une source à une autre.** Passer le journal des accès d'une requête JSON à une colonne indexée semblait un gain pur : la colonne trouvait 30 lignes de plus. Elle en manquait 33. Un journal qui perd des lignes est pire qu'un journal lent. La comparaison ligne à ligne, avant bascule, a imposé une seconde migration de reprise.
- **Une API qui rend du texte rédigé casse l'i18n en silence.** Les libellés du journal partaient en français figé ; l'application est bilingue. Ils rendent maintenant des clés, et un test vérifie que chacune existe dans `fr.json` **et** `en.json` — une clé absente s'affiche telle quelle, en majuscules.
- **Un garde-fou protégé en double ne peut pas être verrouillé par un test.** Le BOM d'Excel tombait à la fois avec le `trim()` du texte entier et celui des en-têtes ; aucun sabotage d'un seul des deux ne faisait échouer le test du BOM. La redondance n'était pas un tort, mais elle rendait le test incapable de prouver quoi que ce soit. Quand une protection est doublée, sachez-le, et dites-le dans le commentaire plutôt que d'affirmer qu'un test la tient.

---

## 10. Par où commencer

0. **`docs/PARCOURS-TEST-ADMINISTRATION.md`** — pour dérouler soi-même ce qui a été livré en P11 et au début de P4 : journal des accès, demandes RGPD, audit, anomalies, suspension de compte, vérification d'identité. Chaque étape dit ce qu'on doit voir **et pourquoi**.
1. **`docs/ADDENDUM-CDC-2026-09-28.md`** — à lire en premier : il rouvre des blocs que la feuille de route affiche comme livrés.
2. `docs/FEUILLE_DE_ROUTE_KENEYA.md` — le plan vivant ; les blocs rouverts portent 🔁.
3. `docs/PARCOURS-COMMANDE-LIVRAISON.md` — **indispensable avant P6, P7 ou P8** ; inutile avant.
4. `docs/PARCOURS-DEMO.md` — dérouler le produit à la main en vingt minutes.
5. `packages/shared-types/src/index.ts` — le contrat ; on y comprend le domaine plus vite que dans le schéma.
6. `apps/api/prisma/schema.prisma` — le modèle, largement commenté sur les choix non évidents.
7. `apps/api/src/services/ordonnance.service.ts` et `laboratoire.service.ts` — représentatifs du style attendu : règles explicites, commentaires qui disent *pourquoi*, pas *quoi*.
8. `apps/web/e2e/parcours.spec.ts` — les cinq parcours décrivent le produit mieux qu'une spécification.

### Le premier chantier recommandé

Si vous reprenez le projet et cherchez par où entrer, **le bloc 7 est le bon point de départ** — mais il commence par une décision de modèle, pas par du code.

1. Lisez le point 1 de `docs/ADDENDUM-CDC-2026-09-28.md` (gestion complète d'une pharmacie).
2. Regardez `Facture` dans `schema.prisma`. Le verrou n'est pas le lien à la consultation — `idConsultation` est `String?`. Ce sont **trois autres choses** : la facture n'a **aucune ligne** (juste un `montantGnf`, donc on ne sait pas ce qui a été vendu), elle exige un **`idPatient`** (un client de passage sans dossier ne peut pas être facturé), et elle ne porte ni vendeur, ni remise, ni établissement. Le seul code qui en crée une est `creerPaiementConsultation` dans `paiement.service.ts`, qui part d'une consultation.
3. Tranchez la question **E** des questions ouvertes (vente sans ordonnance), qui détermine les règles de la caisse.
4. Modélisez la vente au comptoir : lignes, remise, mode de paiement (`ModePaiement` existe déjà avec `ESPECES`, `ORANGE_MONEY`, `MTN_MOMO`), vendeur, avec ou sans ordonnance. `CategorieProduit` permet déjà d'appliquer EF-05-12.
5. La sortie de stock passe par `consommerLots` (`approvisionnement.service.ts`) : réutilisez-la, ne la réécrivez pas — elle sort au plus proche de la péremption et refuse un lot périmé.
6. API d'abord, front ensuite, **dans le même bloc**. C'est la règle du projet.

Le bloc 8 (assurance) suit, et suppose le 7 pour les ventes au comptoir.

### Si vous êtes une IA qui reprend ce dépôt

- **Vérifiez `git branch --show-current`.** Le travail est sur `develop` ; `main` est en retard de six jours.
- **Ne faites pas confiance à une suite verte.** La convention est le sabotage, et la section 6 liste les quatre façons dont un sabotage mentit ici.
- **Lisez le SQL avant d'appliquer une migration** qui change un type ou retire une colonne. Prisma a proposé du SQL destructeur **cinq fois sur cinq** : `DROP COLUMN` avant la reprise des données, `ADD COLUMN NOT NULL` sans valeur sur une table peuplée, recréation d'énumération avant la migration des lignes.
- **Reconstruisez `packages/shared-types` après l'avoir modifié**, sinon l'API et le front voient l'ancien type.
- **Redémarrez l'API après toute modification** : `tsx` tourne sans `--watch`.
- **Un build vert ne prouve pas qu'une page rend quelque chose.** Quatre défauts d'affichage sont passés par une compilation verte : un pipe non importé, un `computed()` sur un champ `ngModel` ordinaire (l'application est *zoneless*), un `.scss` orphelin, une classe CSS jamais définie.
- **Dites ce qui reste ouvert** plutôt que de le passer sous silence. Ce fichier contient plusieurs limites assumées ; c'est voulu.

### Ce qu'on attend d'une contribution

- Le **pourquoi** en commentaire quand le choix n'est pas évident ; jamais la paraphrase du code.
- Des **tests qui mordent**, vérifiés par sabotage.
- Un **message de commit qui explique la décision**, pas la liste des fichiers touchés.
- Ce qui est **vérifié à l'écran** quand c'est une question d'affichage — un build vert ne prouve pas qu'une page rend quelque chose.
- Ce qui **reste ouvert**, dit explicitement plutôt que passé sous silence.
