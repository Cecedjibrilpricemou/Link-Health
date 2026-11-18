# Les secrets de la plateforme

> À quoi sert chaque secret, ce qu'on risque à le perdre, où il vit, et comment le restaurer. Ce document ne contient aucune valeur : il dit seulement où elles se trouvent et quoi en faire.

---

## 1. Le principe en une phrase

Aucun secret dans le dépôt — qui est public ; en développement dans `apps/api/.env`, ignoré par git ; en production dans les variables d'environnement de Dokploy ; et **une copie hors du serveur de la seule clé qui ne se régénère pas**.

---

## 2. Les secrets, et ce qu'on risque

| Variable | À quoi elle sert | Si elle est perdue | Si elle est volée |
|---|---|---|---|
| **`DB_ENCRYPTION_KEY`** | Chiffre les données sensibles des patients dans la base | **Données illisibles définitivement.** Aucune récupération | Les données chiffrées deviennent lisibles pour qui a aussi la base |
| `DATABASE_URL` | Adresse et mot de passe de PostgreSQL | Se reconstruit depuis les réglages du serveur | Accès complet à la base |
| `JWT_SECRET` | Signe les jetons d'accès | On en génère un autre : tout le monde se reconnecte | Un attaquant fabrique des jetons valides pour n'importe quel rôle |
| `JWT_REFRESH_SECRET` | Signe les jetons de rafraîchissement | Idem : on en génère un autre | Idem, avec des sessions longues |
| `BREVO_API_KEY` | Envoi des courriels (codes de connexion) | On en régénère une chez Brevo en trente secondes | Envoi de courriels au nom de la plateforme |
| `CHAPCHAP_API_KEY`, `CHAPCHAP_HMAC_KEY` | Paiements | Se régénèrent chez le prestataire | Encaissements et faux rappels de paiement |

**Une seule ligne de ce tableau est irréversible.** Toutes les autres se remplacent en quelques minutes ; celle-là, jamais.

---

## 3. `DB_ENCRYPTION_KEY` : le cas à part

Cette clé chiffre, dans la base, des champs déclarés un par un (`apps/api/src/config/prisma-encryption.extension.ts`) :

| Donnée | Champs |
|---|---|
| Patient | groupe sanguin, contact d'urgence (nom, téléphone), point de repère, position GPS, lieu de naissance, nom de la mère, allergies, maladies chroniques |
| Consultation | motif principal, résumé, notes de l'agent de santé, notes du médecin, symptômes |
| Ordonnance | posologie, instructions |
| Personne assurée | lieu de naissance, nationalité, adresse |

Sans la clé, ces colonnes restent dans la base mais ne veulent plus rien dire. Le reste du dossier (noms, rendez-vous, commandes) survit : c'est **l'information médicale** qui disparaît.

La clé fait 64 caractères hexadécimaux, soit 32 octets. L'API refuse de démarrer si elle n'a pas exactement cette forme.

---

## 4. Sauvegarder la clé dans un gestionnaire de mots de passe

À faire **une fois**, avant toute migration ou réinstallation. Une seule commande, depuis la racine du dépôt :

```powershell
& .\scripts\sauvegarder-cle.ps1
```

Le script guide tout : il lit la clé, la met dans le presse-papiers, attend pendant qu'on crée l'entrée dans le gestionnaire, puis vérifie la copie et vide le presse-papiers. **La clé n'est jamais affichée** : seules des empreintes de douze caractères le sont, qui permettent de comparer sans rien révéler.

L'entrée à créer : **« KENEYA — DB_ENCRYPTION_KEY (production) »**, avec en note *« Chiffre les données médicales des patients. Perdue, ces données sont illisibles définitivement. Ne jamais la changer sur une base qui contient déjà des données. »*

Deux règles pendant l'opération :

- **Ne rien copier d'autre.** Chaque copie écrase le presse-papiers, y compris celle d'une commande prise dans une page web. C'est pour cela que tout tient en une seule exécution plutôt qu'en une suite d'étapes à copier une par une.
- **La clé va dans le gestionnaire, nulle part ailleurs.** Ni dans ce document, ni dans un fichier du dépôt, ni dans un bloc-notes : le dépôt est public, et un fichier local finit tôt ou tard par être commité.

Pour un fichier ailleurs que `apps/api/.env` :

```powershell
& .\scripts\sauvegarder-cle.ps1 -FichierEnv D:\chemin\vers\.env
```

Le script répond **CORRECT** si la copie est fidèle, ou **ÉCHEC** en disant ce qui cloche — mauvaise longueur, ou un caractère changé.

**Si la production et le développement utilisent des clés différentes, sauvegarder les deux**, en nommant clairement chaque entrée.

---

## 5. Poser les variables dans Dokploy

Dokploy range les variables à trois niveaux : projet, environnement, service. Celles de la plateforme vont au niveau du **service** de l'API.

Les variables ordinaires de Dokploy sont stockées dans sa base, sur le serveur : **leur protection est celle du serveur lui-même**. Il n'existe pas de « variables chiffrées » natives — ce que Dokploy chiffre, ce sont les renvois vers un coffre externe (Vault, Infisical, Doppler…), qu'on pourra brancher plus tard sans rien changer au code.

Obligatoires, l'API refuse de démarrer sans elles :

| Variable | Valeur en production |
|---|---|
| `DATABASE_URL` | Adresse du PostgreSQL de production |
| `JWT_SECRET` | 64 caractères au hasard, **différent** du suivant |
| `JWT_REFRESH_SECRET` | 64 caractères au hasard |
| `DB_ENCRYPTION_KEY` | **La clé sauvegardée**, jamais une nouvelle sur une base existante |

À poser aussi :

| Variable | Valeur en production |
|---|---|
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | L'adresse publique du site, en `https://` |
| `FRONTEND_URL` | L'adresse publique du site, en `https://` |
| `BREVO_API_KEY` | La clé du compte Brevo |
| `EMAIL_EXPEDITEUR` | Une adresse validée chez Brevo, sur un domaine authentifié |
| `EMAIL_REPONSE` | Une adresse qui reçoit vraiment le courrier |
| `EMAIL_OTP_DEV_FALLBACK` | **Absente, ou `false`** |
| `REDIS_URL` | L'adresse du Redis, si présent |

Pour engendrer un secret au hasard :

```powershell
# 64 caracteres hexadecimaux (pour JWT_SECRET et JWT_REFRESH_SECRET)
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

> `EMAIL_OTP_DEV_FALLBACK` affiche le code de connexion à l'écran. Il est déjà verrouillé en production par le code (`utils/otp-developpement.ts` exige aussi `NODE_ENV !== 'production'`), mais le poser à `false` évite toute ambiguïté.

---

## 6. Restaurer après réinstallation du serveur

1. Réinstaller Dokploy, recréer le projet et le service.
2. **Restaurer la base de données** depuis sa sauvegarde.
3. Reposer les variables du chapitre 5. `DB_ENCRYPTION_KEY` doit être **exactement celle d'avant** : la reprendre dans le gestionnaire de mots de passe, pas en engendrer une nouvelle.
4. Déployer, puis vérifier par un cas réel : ouvrir un dossier patient qui a un groupe sanguin ou des allergies. S'ils s'affichent, la clé est la bonne. S'ils sont vides ou illisibles, **arrêter immédiatement** et ne rien réécrire dans la base : la clé est fausse, et la bonne existe peut-être encore ailleurs.

---

## 7. Ce qui se change, ce qui ne se change pas

| Secret | Changement |
|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Quand on veut. Effet : tout le monde doit se reconnecter |
| `BREVO_API_KEY`, clés de paiement | Quand on veut, en les régénérant chez le prestataire |
| Mot de passe PostgreSQL | Quand on veut, en mettant `DATABASE_URL` à jour |
| **`DB_ENCRYPTION_KEY`** | **Jamais sur une base qui contient des données**, sauf à déchiffrer puis rechiffrer l'ensemble dans une opération prévue pour (voir `prisma/backfill-encryption.ts`) |

---

## 8. Ce qu'il ne faut jamais faire

- Écrire un secret dans le dépôt, un ticket, une capture d'écran ou une conversation — **le dépôt est public**.
- Envoyer `DB_ENCRYPTION_KEY` par messagerie.
- Engendrer une nouvelle `DB_ENCRYPTION_KEY` « pour faire propre » sur une base qui contient des données.
- Garder l'unique copie de la clé sur le serveur qu'elle protège : une réinstallation emporte les deux.
- Réutiliser `JWT_SECRET` comme `JWT_REFRESH_SECRET` : le schéma de configuration le refuse, parce qu'avec un secret commun un jeton de rafraîchissement passait pour un jeton d'accès.

---

## 9. Le filet du dépôt

`.gitignore` écarte déjà les fichiers qui portent un nom à secrets : `/COMPTES*.md`, `/MOTS-DE-PASSE*.md`, `/*identifiants*.md`, `secrets.md`. C'est un filet, pas une garantie : il ne protège que les noms prévus, et il a déjà retenu ce document quand il s'appelait `SECRETS.md`.

Avant de committer un fichier qui parle de configuration, vérifier qu'aucune valeur réelle ne s'y trouve :

```powershell
# Signale toute valeur du .env presente dans un fichier
$cible = "docs\GESTION-DES-SECRETS.md"
$t = [IO.File]::ReadAllText($cible)
foreach ($l in Get-Content apps\api\.env) {
  $m = [regex]::Match($l.Trim(), '^([A-Z][A-Z0-9_]*)=(.+)$')
  if ($m.Success -and $m.Groups[2].Value.Trim().Length -ge 12 -and $t.Contains($m.Groups[2].Value.Trim())) {
    Write-Host "FUITE : $($m.Groups[1].Value)" -ForegroundColor Red
  }
}
```
