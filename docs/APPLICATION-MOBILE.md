# Application mobile Lead Health

> Ce document explique ce qui a été fait pour l'application Android, pourquoi ce choix, et comment tout lancer : la base de données, l'API, le site et l'application.

---

## 1. Le principe en une phrase

L'application Android **n'est pas une seconde application** : c'est le site Angular existant, présenté dans une fenêtre plein écran sur le téléphone, grâce à **Capacitor**.

```
┌──────────────── Téléphone Android ────────────────┐
│  Application « Lead Health » (gn.leadhealth.app)   │
│  ┌──────────────────────────────────────────────┐  │
│  │  WebView (navigateur intégré)                │  │
│  │  → affiche le site Angular (apps/web)        │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────┬───────────────────────────┘
                         │  HTTP
          ┌──────────────┴──────────────┐
          │  Site Angular  (port 4200)  │
          │  API Express   (port 3000)  │
          │  PostgreSQL + Redis (Docker)│
          └─────────────────────────────┘
```

---

## 2. Pourquoi réutiliser les écrans existants au lieu d'en recréer

Trois façons de faire une application mobile étaient possibles :

| | Le site seul, installable (PWA) | **Capacitor : le site emballé dans une application** (choisi) | Réécrire une application native (Flutter, React Native, Kotlin) |
|---|---|---|---|
| Travail | Presque rien | **Quelques jours** | Plusieurs mois |
| Code à maintenir | Un seul | **Un seul** | Deux : le site et l'application |
| Présent sur le Play Store | Non | **Oui** | Oui |
| Icône, écran de démarrage, nom | Limités | **Oui** | Oui |
| Accès au téléphone (caméra, micro, notifications, fichiers) | Partiel, selon le navigateur | **Oui, par des plugins** | Oui, complet |
| Fluidité | Celle du navigateur | Celle du navigateur | La meilleure |

### Les avantages du choix

- **Un seul code.** Une correction faite sur un écran (ordonnances, caisse, rendez-vous…) profite au site **et** à l'application. Pas de double travail, pas de différences entre les deux.
- **Tout ce qui existe est déjà là** : plus de 2 000 tests API et ~250 tests web, les 10 espaces métier, les traductions, le mode sombre, la sécurité (cookies, CSRF, rôles). Une réécriture aurait tout dû refaire et retester.
- **Rapide** : la base de l'application a été posée en quelques jours, pas en mois.
- **Les écrans étaient déjà pensés pour le téléphone** (mise en page adaptative, faible débit), parce que beaucoup d'utilisateurs en Guinée passent par un smartphone.
- **Ouvert pour plus tard** : Capacitor permet d'ajouter, écran par écran, des fonctions du téléphone (dictée native, caméra pour scanner un QR, notifications) sans tout réécrire.

### Les inconvénients, à connaître

- **Fluidité un peu moindre qu'une application native** : animations et défilement passent par le navigateur intégré. Pour des formulaires, des listes et des tableaux, la différence est faible.
- **L'aspect est celui du site**, pas celui des applications Android « natives ». C'est un choix de cohérence.
- **Fonctions du téléphone par plugins** : chaque fonction (micro, caméra, notifications…) demande un plugin et un peu de code.
- **En développement, le téléphone doit joindre le PC** (par le câble USB, l'émulateur ou le wifi), puisque l'application charge le site qui tourne sur le PC.
- **La version de production reste à décider** (voir la section 7).

---

## 3. Ce qui a été fait, étape par étape

| Étape | Contenu |
|---|---|
| Base de l'application (PR #48) | Capacitor 8, projet Android dans `apps/web/android`, identifiant **`gn.leadhealth.app`**, nom **Lead Health**, script `apps/web/scripts/mobile.mjs` |
| Mise au point de l'outillage | Gradle 8.14.3 avec **JDK 21** (Gradle refuse les JDK trop récents), build-tools Android fixés à 36.0.0, délai de téléchargement allongé pour les connexions lentes |
| Accès au PC depuis le téléphone | Adresse de l'émulateur ajoutée à `ALLOWED_ORIGINS` de l'API ; site lancé avec `npm run start:lan` (sinon il n'écoute qu'en IPv6 et le téléphone est refusé) |
| Logo (PR #49) | Logo « croix et feuille » : icône aux 5 tailles Android (carrée, ronde, adaptative), écran de démarrage vert |
| Logo sur le site (PR #50) | L'icône de l'onglet suit le logo téléversé dans Paramètres → Identité |
| Adresses des images (PR `fix/url-televersements`) | Logos et photos enregistrés par leur **chemin** (`/uploads/…`) et non plus avec `localhost` : ils s'affichent aussi sur le téléphone et en production |
| Téléphone branché en USB | Commande **`npm run mobile:usb`** : le téléphone joint le PC par le câble, sans dépendre du wifi |

Essais réels : émulateur Pixel 10 Pro (Android 17) et Samsung Galaxy A07 (Android 16).

---

## 4. Ce qu'il faut installer une fois

| Outil | Pourquoi |
|---|---|
| Node.js 24 | API et site |
| Docker Desktop | PostgreSQL et Redis |
| Android Studio | SDK Android, émulateur, compilation |
| JDK 21 (dans Android Studio : *Gradle JDK* → **ms-21**) | Gradle 8.14 ne fonctionne pas avec un JDK plus récent |

Puis, à la racine du dépôt :

```powershell
npm ci
```

Dans `apps/api/.env` (fichier local, jamais commité), en développement :

```
ALLOWED_ORIGINS=http://localhost:4200,http://10.0.2.2:4200
EMAIL_OTP_DEV_FALLBACK=true
```

- `10.0.2.2` est l'adresse par laquelle l'émulateur voit le PC.
- `EMAIL_OTP_DEV_FALLBACK=true` affiche le code de connexion à l'écran quand l'e-mail n'est pas configuré. Sans lui, la connexion d'un professionnel échoue (« serveur injoignable »).

---

## 5. Lancer le projet au quotidien

Ouvrir **3 terminaux** dans VS Code (bouton **+** du panneau Terminal).

### Terminal 1 — base de données et API

```powershell
cd C:\Pricemou\baobaoheath-platforme\docker
docker compose up -d postgres redis
cd ..\apps\api
npx prisma migrate deploy        # seulement après un git pull qui apporte une migration
npm run dev                      # API sur http://localhost:3000
```

### Terminal 2 — le site

```powershell
cd C:\Pricemou\baobaoheath-platforme\apps\web
npm run start:lan                # site sur http://localhost:4200, joignable par le téléphone
```

`npm start` suffit pour travailler **seulement sur le PC**. Pour le téléphone ou l'émulateur, il faut **`npm run start:lan`**. À n'utiliser que sur un réseau de confiance (maison, bureau), jamais sur un wifi public.

> Raccourci : `npm run dev` à la racine du dépôt lance l'API et le site ensemble (`npm run dev:lan` pour le réseau).

### Terminal 3 — l'application mobile (une des trois façons)

| Appareil | Commande (dans `apps\web`) | Remarque |
|---|---|---|
| **Téléphone branché en USB** (conseillé) | `npm run mobile:usb` | Débogage USB activé sur le téléphone. Ne dépend pas du wifi |
| Émulateur Android Studio | `npm run mobile:emulateur` | Démarrer l'émulateur dans le Device Manager |
| Téléphone sur le wifi | `npm run mobile:telephone -- 192.168.x.x` | IP du PC (affichée par `start:lan`), à ajouter à `ALLOWED_ORIGINS` |

Puis, dans **Android Studio** : ouvrir `apps\web\android`, choisir l'appareil en haut, cliquer sur **▶**.

**Inutile de recompiler l'application quand on modifie le code du site** : elle charge le site du PC, donc il suffit de la fermer et de la rouvrir. On ne relance `mobile:*` et ▶ qu'après un changement de la partie Android (icône, nom, plugins) ou un changement d'appareil.

### Activer le débogage USB sur le téléphone (une seule fois)

1. **Paramètres → À propos du téléphone → Informations sur le logiciel** : toucher 7 fois **Numéro de version**.
2. **Paramètres → Options de développement** : activer **Débogage USB**.
3. Brancher le câble et accepter « Autoriser le débogage USB » sur le téléphone.

---

## 6. Problèmes déjà rencontrés et leur solution

| Ce qu'on voit | Cause | Solution |
|---|---|---|
| Android Studio : « does not contain a Gradle build » | Le dossier `android` est incomplet | Être sur une branche à jour (`git pull`), puis **File → Sync Project with Gradle Files** |
| « Plugin … relies on org.gradle.api.problems… » | Android Studio utilise une autre version de Gradle | Paramètres (**Ctrl+Alt+S**) → Build Tools → Gradle : **Distribution = Wrapper**, **Gradle JDK = ms-21** |
| « No emulator installed » alors que l'émulateur tourne | Bandeau en retard | L'ignorer ; vérifier le point vert à côté de l'appareil |
| Application : « Webpage not available », `ERR_CONNECTION_REFUSED` ou `ERR_EMPTY_RESPONSE` | Le site tourne avec `npm start` | Le relancer avec **`npm run start:lan`** |
| Site : « serveur injoignable » à la connexion | Code OTP impossible à envoyer (e-mail non configuré) | `EMAIL_OTP_DEV_FALLBACK=true` dans `apps/api/.env`, puis redémarrer l'API |
| La connexion est refusée depuis l'émulateur | Adresse absente de `ALLOWED_ORIGINS` | Ajouter `http://10.0.2.2:4200`, redémarrer l'API |
| Logo ou photo invisible sur le téléphone | Ancienne adresse enregistrée avec `localhost` | `npx prisma migrate deploy` (migration `chemins_televersements`) |

---

## 7. Ce qui reste à décider : la version de production

Aujourd'hui l'application charge le site **du PC de développement**. Pour la distribuer, deux options :

| | **A. L'application charge le site en ligne** | **B. L'application embarque le site** |
|---|---|---|
| Principe | Comme aujourd'hui, mais avec l'adresse du serveur de production | Les fichiers du site sont copiés dans l'APK |
| Mise à jour | Immédiate : on met à jour le serveur, toutes les applications suivent | Il faut publier une nouvelle version sur le Play Store |
| Sans réseau | Rien ne s'affiche sans connexion (sauf ce que le service worker a gardé) | Les écrans s'ouvrent, mais les données demandent quand même le réseau |
| Connexion (cookies) | Fonctionne telle quelle | À adapter : l'API n'est plus sur la même origine que l'application |
| Travail | Faible | Plus important |

**A** est le plus simple et garde un seul site à jour. **B** demande de revoir l'authentification. Cette décision revient à l'équipe, une fois l'adresse du serveur de production connue.

---

## 8. Fichiers utiles

| Fichier | Rôle |
|---|---|
| `apps/web/capacitor.config.ts` | Identifiant, nom, écran de démarrage, mode développement |
| `apps/web/scripts/mobile.mjs` | Les commandes `mobile:usb`, `mobile:emulateur`, `mobile:telephone` |
| `apps/web/android/` | Le projet Android (à ouvrir dans Android Studio) |
| `apps/web/android/app/src/main/res/` | Icônes et écrans de démarrage |
| `apps/web/src/app/shared/utils/url-media.ts` | Où le site va chercher les logos et photos selon l'appareil |
