# Signer et notariser Solar Scanner sur Mac

Sur un Mac récent, un .dmg non signé est bloqué par Gatekeeper (« l'application n'est pas conforme », « impossible de l'ouvrir », parfois « l'app est endommagée »). C'est normal : Apple veut une signature **Developer ID** puis une **notarisation** (un contrôle de leur côté).

Ce guide explique comment préparer ça, une bonne fois pour toutes. Ensuite, GitHub fabrique tout seul un .dmg que tes utilisateurs pourront ouvrir sans message d'alerte.

**Important :** tes certificats, mots de passe et ton Team ID ne vont **jamais** dans le code, ni dans un message, ni dans un commit. Ils restent dans les secrets GitHub.

---

## 1. Contourner le blocage, en attendant (sur ton Mac)

Le .dmg actuel (v1.5.0) n'est pas encore signé. Pour l'ouvrir maintenant :

1. Fais un **clic droit** sur `Solar Scanner` (dans le .dmg ou dans Applications), puis **Ouvrir**, et encore **Ouvrir**.
2. Ou va dans **Réglages Système** → **Confidentialité et sécurité**. Descends en bas et clique sur **Ouvrir quand même**.
3. Si macOS dit que l'app est « endommagée », ouvre le **Terminal** et tape :

```bash
xattr -cr "/Applications/Solar Scanner.app"
```

Puis réessaie le clic droit → **Ouvrir**.

---

## 2. Ce dont tu as besoin

- Un compte **Apple Developer** payant (tu l'as déjà).
- Accès au dépôt GitHub `Dontbyshai/SolarScan` (c'est le tien).
- Ton Mac, pour créer le certificat.

Tu vas créer **5 secrets**. Voici leurs noms exacts, à recopier tels quels :

| Nom du secret GitHub | Qu'est-ce que c'est |
| --- | --- |
| `CSC_LINK` | Ton certificat `.p12`, converti en base64 (voir plus bas) |
| `CSC_KEY_PASSWORD` | Le mot de passe que **toi** tu choisis en exportant le `.p12` |
| `APPLE_ID` | L'adresse e-mail de ton compte Apple Developer |
| `APPLE_APP_SPECIFIC_PASSWORD` | Un mot de passe **spécial**, créé sur appleid.apple.com (pas le mot de passe de ton compte Apple) |
| `APPLE_TEAM_ID` | L'identifiant de ton équipe Apple, 10 caractères (lettres et chiffres) |

Il y a **deux mots de passe différents**. Ne les inverse pas.

---

## 3. Créer le certificat « Developer ID Application »

Attention : ce n'est **pas** « Apple Development », ni « Developer ID Installer ». Il faut **Developer ID Application**. C'est celui qui sert à distribuer une app en dehors du Mac App Store.

### Option A — depuis le site Apple (méthode classique)

**3.1 Demander un fichier CSR sur ton Mac**

1. Ouvre l'app **Trousseaux d'accès** (Keychain Access).
2. Menu **Trousseaux d'accès** → **Assistant de certificat** → **Demander un certificat à une autorité de certificat…**
3. Indique ton nom et l'e-mail de ton compte Apple.
4. Choisis **Enregistré sur le disque**, puis Enregistrer. Tu obtiens un fichier `.certSigningRequest`.

**3.2 Faire le certificat sur le site Developer**

1. Va sur [la liste des certificats Apple](https://developer.apple.com/account/resources/certificates/list) (connecte-toi).
2. Clique sur le bouton **+**.
3. Choisis **Developer ID Application**, puis Continue.
4. Envoie le fichier `.certSigningRequest` créé juste avant.
5. Télécharge le certificat (fichier `.cer`).
6. Double-clique sur ce fichier : il s'installe dans Trousseaux d'accès.

### Option B — depuis Xcode (souvent plus simple)

1. Ouvre **Xcode**.
2. Menu **Xcode** → **Settings** (Réglages) → onglet **Accounts**.
3. Ajoute ton Apple ID si ce n'est pas déjà fait, sélectionne ton équipe.
4. Clique sur **Manage Certificates…** → le bouton **+** → **Developer ID Application**.

---

## 4. Exporter le certificat en `.p12`, puis en base64

1. Ouvre **Trousseaux d'accès**.
2. Cherche une entrée qui commence par **Developer ID Application:** (avec ton nom et souvent le Team ID entre parenthèses).
3. Clic droit → **Exporter…**
4. Choisis le format **Fichier d'échange d'informations personnelles (.p12)**.
5. Donne un mot de passe à ce fichier (choisis-en un solide, et garde-le : c'est `CSC_KEY_PASSWORD`).
6. Enregistre le fichier, par exemple sur le Bureau, sous le nom `cert.p12`.

Ensuite, toujours sur ton Mac, ouvre le **Terminal** et tape (adapte le chemin si le fichier n'est pas sur le Bureau) :

```bash
base64 -i ~/Desktop/cert.p12 | pbcopy
```

Cette commande ne montre rien à l'écran : elle copie le certificat déjà encodé dans le presse-papiers. C'est la valeur de `CSC_LINK`. Colle-la directement dans le secret GitHub (étape 7), sans la mettre dans un fichier du dépôt, ni dans un chat.

Quand les secrets sont en place, tu peux supprimer le `.p12` du Bureau (ou le ranger dans un endroit privé, hors du projet).

---

## 5. Créer un mot de passe d'application (app-specific password)

Ce n'est **pas** le mot de passe de ton compte Apple, et ce n'est **pas** le mot de passe du `.p12`.

1. Va sur [appleid.apple.com](https://appleid.apple.com) et connecte-toi.
2. Ouvre **Connexion et sécurité** (Sign-In and Security).
3. Clique sur **Mots de passe pour application** (App-Specific Passwords).
4. Crée-en un, par exemple nommé `SolarScan notarisation`.
5. Apple t'affiche un mot de passe du type `xxxx-xxxx-xxxx-xxxx`. Il n'est montré **qu'une fois** : copie-le, c'est la valeur de `APPLE_APP_SPECIFIC_PASSWORD`.

---

## 6. Trouver ton Team ID

1. Va sur [developer.apple.com/account](https://developer.apple.com/account) et connecte-toi.
2. Dans les informations d'adhésion (Membership details), tu verras **Team ID**.
3. C'est une suite de **10 caractères** (lettres majuscules et chiffres). Recopie-la exactement : c'est `APPLE_TEAM_ID`.

---

## 7. Ajouter les 5 secrets sur GitHub

1. Ouvre le dépôt : [github.com/Dontbyshai/SolarScan](https://github.com/Dontbyshai/SolarScan).
2. Clique sur **Settings** (Paramètres).
3. Dans le menu de gauche : **Secrets and variables** → **Actions**.
4. Clique sur **New repository secret**.
5. Crée les 5 secrets, un par un, avec **exactement** ces noms :

- `CSC_LINK` — colle le contenu copié à l'étape 4 (`base64 … | pbcopy`)
- `CSC_KEY_PASSWORD` — le mot de passe choisi à l'export du `.p12`
- `APPLE_ID` — l'e-mail de ton compte Apple
- `APPLE_APP_SPECIFIC_PASSWORD` — le mot de passe créé à l'étape 5
- `APPLE_TEAM_ID` — les 10 caractères de l'étape 6

Ne les mets nulle part ailleurs (pas dans `package.json`, pas dans le workflow, pas dans un ticket).

---

## 8. Lancer la fabrication du .dmg signé

Le workflow s'appelle **Signature et notarisation macOS**. Il se lance :

- **à la main**, une fois cette mise à jour fusionnée dans `main` : onglet **Actions** du dépôt → **Signature et notarisation macOS** → **Run workflow** (branche `main`) → **Run workflow** ;
- **tout seul**, quand tu pousses une étiquette (tag) du type `v1.6.0`.

La construction prend souvent 10 à 20 minutes : Apple doit inspecter l'app (notarisation).

À la fin :

- tu peux télécharger les .dmg dans l'onglet **Actions**, dans les **artefacts** (`SolarScanner-Mac-signe`). Il y en a deux : un pour les Mac Apple Silicon (`arm64`) et un pour les Mac Intel (`x64`) ;
- **si le lancement vient d'un tag** : les .dmg sont aussi attachés à la Release GitHub de ce tag (la release est créée automatiquement si elle n'existe pas encore). Un lancement manuel n'attache rien à une release : tu peux d'abord tester le fichier.

Le workflow habituel (celui qui tourne à chaque push sur `main`) continue de faire des builds de contrôle **non signés**. C'est volontaire : on ne demande pas à Apple de notariser l'app à chaque petite modification.

Tant que ce workflow n'a pas été fusionné dans `main`, le bouton **Run workflow** peut ne pas apparaître : GitHub n'affiche ce bouton que pour les workflows déjà présents sur la branche par défaut.

---

## 9. En cas de souci

- **« Secret manquant »** dans les logs Actions : un des 5 noms est absent ou mal orthographié. Recopie les noms du tableau de l'étape 2.
- **Erreur de signature / certificat** : vérifie que tu as bien exporté un **Developer ID Application** (pas « Apple Development »), et que `CSC_KEY_PASSWORD` est le mot de passe du `.p12`.
- **Erreur de notarisation (notarytool)** : vérifie `APPLE_ID`, le mot de passe d'application, et le Team ID. Le mot de passe d'application n'est montré qu'une fois : si tu l'as perdu, crées-en un nouveau et mets à jour le secret.
- **L'app s'ouvre puis se ferme, ou le moteur Python ne démarre pas** : ouvre une issue ou demande de l'aide, avec le message d'erreur (sans y coller de secret).

Les builds sur ton Mac, sans ces secrets, restent possibles : `cd solar-scanner/electron && npm run build:mac` produit un .dmg **non signé**, comme avant.
