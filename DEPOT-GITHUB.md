# Envoyer le projet sur GitHub — avec la bonne structure

## Le problème rencontré

La construction a échoué avec :

```
#5 transferring context: 2B done
"/client": not found
```

Le contexte de construction est **vide** : les dossiers `client/` et `serveur/` ne sont pas
dans le dépôt. C'est ce qui arrive quand on dépose les fichiers par **glisser-déposer sur
le site de GitHub** : l'interface web n'envoie pas les dossiers, seulement les fichiers.

## Structure attendue à la racine du dépôt

```
RHF/
├── client/          ← interface (React)
├── serveur/         ← API (Node.js)
├── deploiement/
├── render.yaml
├── Dockerfile
└── LISEZ-MOI.md
```

Ouvrez votre dépôt sur GitHub : si vous ne voyez pas les dossiers `client` et `serveur`,
c'est confirmé.

## La solution : envoyer avec git

Décompressez l'archive, placez-vous dans le dossier `aifg-rh`, puis :

```bash
./preparer-depot.sh https://github.com/mghozlane287-alt/RHF.git
```

Le script vérifie la structure, crée un `.gitignore` (pour ne jamais envoyer de secrets ni
de fichiers volumineux), valide et envoie. Il vous demandera vos identifiants GitHub :
utilisez un **jeton d'accès personnel** comme mot de passe
(GitHub → Settings → Developer settings → Personal access tokens → Generate new token,
avec la permission `repo`).

### Sous Windows

Installez [Git pour Windows](https://git-scm.com/download/win), puis dans Git Bash :

```bash
cd chemin/vers/aifg-rh
bash preparer-depot.sh https://github.com/mghozlane287-alt/RHF.git
```

### En manuel, si vous préférez

```bash
cd aifg-rh
git init
git add -A
git commit -m "Registre RH AIFG"
git branch -M main
git remote add origin https://github.com/mghozlane287-alt/RHF.git
git push -u origin main --force
```

## Changement important : plus besoin de Docker sur Render

J'ai remplacé le `render.yaml` : il utilise désormais **Node directement**, sans construire
d'image Docker. C'est plus rapide, et il y a beaucoup moins de choses qui peuvent échouer.

Render exécutera :
1. vérification que `client/` et `serveur/` existent — **avec un message d'erreur clair** si
   ce n'est pas le cas, au lieu du message Docker incompréhensible ;
2. compilation de l'interface ;
3. copie de l'interface dans le serveur ;
4. installation des dépendances de production ;
5. démarrage.

**J'ai reproduit cette séquence exacte de mon côté** : interface compilée (848 Ko),
130 paquets installés, serveur démarré, page d'accueil et routes en 200, base accessible.

Le `Dockerfile` reste dans le projet pour l'option Docker sur votre propre serveur — il
porte maintenant un commentaire expliquant cette erreur précise.

## Après l'envoi

Sur Render : **Manual Deploy → Clear build cache & deploy**. Le cache contient l'échec
précédent ; sans cela vous pourriez revoir la même erreur.

Render vous demandera `MDP_INITIAL_RH` et `MDP_INITIAL_DIRECTION` : ce sont les mots de
passe de première connexion, à changer dès votre arrivée dans l'application.

## Deuxième erreur rencontrée : conflit entre gestionnaires de paquets

```
pnpm install --frozen-lockfile ... échec
npm error Cannot read properties of null (reading 'matches')
```

**Cause** : un fichier `pnpm-workspace.yaml`, résidu de mon environnement de développement,
déclarait un espace de travail vide — ce qui faisait échouer `pnpm install`. Le repli
`|| npm install` s'exécutait alors **par-dessus une installation pnpm à moitié faite**, et
npm plantait sur cet arbre de dépendances incohérent.

**Corrigé** : les résidus pnpm ont été supprimés, un `package-lock.json` est fourni pour le
client et pour le serveur, et l'installation n'utilise plus qu'**un seul gestionnaire de
paquets** — npm — sans enchaînement de repli.

Chaîne validée de bout en bout depuis un dépôt propre :
`npm ci` (254 paquets) → `vite build` (828 Ko) → copie → `npm ci --omit=dev` (130 paquets)
→ démarrage → base accessible, page d'accueil en 200, connexion RH et Direction
fonctionnelles avec les mots de passe initiaux.

## Si Render utilise encore Docker

Votre service a été créé en mode Docker. Le nouveau `render.yaml` utilise Node directement.
Pour en bénéficier :

1. sur Render, **supprimez le service web** existant (la base peut rester) ;
2. **New → Blueprint**, resélectionnez le dépôt ;
3. Render lit le nouveau `render.yaml` et crée un service Node.

Si vous préférez garder Docker, le `Dockerfile` corrigé fonctionne aussi — dans ce cas,
faites simplement **Clear build cache & deploy**.

## Une vérification avant d'envoyer

Votre dépôt est-il **privé** ? Même avec des données fictives, un dépôt public expose votre
organisation interne (noms des chantiers, structure des services). Sur GitHub :
Settings → Danger Zone → Change repository visibility.
