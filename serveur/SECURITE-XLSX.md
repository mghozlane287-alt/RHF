# Note de sécurité — bibliothèque Excel (SheetJS)

## Situation

La version de `xlsx` publiée sur npm n'est plus maintenue et porte deux alertes :

- **Pollution de prototype** (GHSA-4r6h-8v6p-xvw6)
- **Déni de service par expression régulière / ReDoS** (GHSA-5pgg-2g8v-p4x9)

npm indique « No fix available » car SheetJS a quitté npm pour son propre dépôt.

## Ce qui est déjà fait dans l'application

1. **Pollution de prototype neutralisée dans le code** : l'import lit le classeur en
   tableaux (`header: 1`) et reconstruit les objets avec `Object.create(null)`, en
   rejetant les colonnes `__proto__`, `constructor` et `prototype`. Un test automatisé
   vérifie qu'un fichier piégé ne modifie pas `Object.prototype`.
2. **Surface d'attaque réduite** : l'import est réservé au compte RH authentifié,
   limité à 1 fichier de 2 Mo et 2000 lignes, avec vérification de la signature binaire
   du fichier. Un fichier hostile ne peut donc pas être déposé par un utilisateur anonyme.
3. **Transaction atomique** : en cas d'erreur pendant l'import, aucune ligne n'est écrite.

Le risque résiduel (ReDoS) supposerait qu'un administrateur RH importe volontairement
un fichier malveillant : l'impact se limiterait à une lenteur temporaire du serveur.

## Mise à jour recommandée (quand vous aurez accès à Internet sur le serveur)

Installez la version officielle maintenue, qui corrige les deux alertes :

```powershell
cd C:\AIFG-RH\serveur
npm remove xlsx
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm audit --omit=dev          # doit afficher 0 vulnérabilité
Restart-Service AIFG-RH
```

Aucune modification de code n'est nécessaire : l'API de la bibliothèque est identique.
Vérifiez ensuite qu'un import et un export Excel fonctionnent toujours.

## Contrôle périodique

Ajoutez à votre routine trimestrielle :

```powershell
cd C:\AIFG-RH\serveur ; npm audit --omit=dev
```
