# Registre RH — AIFG

Application de gestion RH pour AIFG et ses sociétés de sous-traitance :
pointage mensuel par chantier, congés, contrats, visites médicales,
notifications e-mail et WhatsApp, export paie Excel.

## Contenu

```
aifg-rh/
├── serveur/        API Node.js/Express + PostgreSQL (toute la sécurité est ici)
│   ├── sql/schema.sql       Schéma de la base
│   ├── src/routes/          Points d'entrée de l'API
│   ├── src/lib/             Base, authentification, audit, messagerie, règles métier
│   ├── tests/api.test.js    52 tests d'intégration
│   └── .env.example         Configuration à copier en .env
├── client/         Interface React (build à copier dans serveur/public)
├── deploiement/    installer.sh, nginx.conf, systemd, sauvegarde.sh
└── LISEZ-MOI.md
```

## Déploiement rapide avec Docker (Linux, gratuit)

Sur n'importe quelle machine Linux avec Docker :

```bash
cp .env.docker.exemple .env
# Générez les secrets : openssl rand -hex 32
nano .env                 # remplacez TOUTES les valeurs
docker compose up -d
```

L'application est disponible sur `http://ADRESSE:3001`. Les données et les pièces jointes
sont conservées dans des volumes Docker, donc préservées aux redémarrages et mises à jour.

Sauvegarde :
```bash
docker compose exec base pg_dump -U aifg aifg_rh | gzip > sauvegarde_$(date +%F).sql.gz
docker run --rm -v aifg-rh_fichiers:/f -v $(pwd):/s alpine tar czf /s/fichiers_$(date +%F).tar.gz -C /f .
```

## Installation en production — Windows Server 2025 (recommandé)

Dans une console **PowerShell ouverte en administrateur**, depuis le dossier `deploiement\` :

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force

# 1. Verification prealable (ne modifie RIEN) - obligatoire si IIS heberge deja un site
.\Verifier-Coexistence.ps1 -Domaine "rh.sarlaifg.dz"

# 2. Installation
.\Installer.ps1 -Domaine "rh.sarlaifg.dz" -Email "informatique@aifg.dz"
```

**Serveur IIS deja utilise ?** L'installation cree un site separe identifie par son
sous-domaine : vos sites existants ne sont ni arretes ni modifies. La configuration IIS
est sauvegardee automatiquement avant toute operation
(`appcmd restore backup <nom>` pour revenir en arriere).

Le script installe et configure Node.js 22, PostgreSQL 16, le service Windows (NSSM),
IIS en proxy inverse, le certificat HTTPS (win-acme / Let's Encrypt), le pare-feu et la
sauvegarde quotidienne planifiée, puis affiche les mots de passe initiaux du RH et de la
Direction — à noter puis changer à la première connexion.

Serveur interne sans nom de domaine public : ajoutez `-SansHttps` (à n'utiliser que sur un
réseau isolé). Autres options : `-Racine "D:\AIFG-RH"`, `-Port 3001`.

### Pièces jointes

Les photos, contrats signés et certificats sont stockés dans `serveur/fichiers/`,
**hors du dossier web** : aucun accès direct par URL n'est possible, tout passe par une
route authentifiée avec contrôle de périmètre.

- Formats acceptés : JPEG, PNG, PDF, DOCX, XLSX — 10 Mo maximum.
- Le type réel est vérifié par la **signature binaire** du fichier : un script renommé
  en `.jpg` est refusé.
- Chaque fichier reçoit une **empreinte SHA-256** : elle prouve qu'un document archivé
  n'a pas été modifié depuis son dépôt.
- **Ce dossier doit être sauvegardé** : `Sauvegarde.ps1` l'archive automatiquement chaque
  nuit, en plus de la base. Une sauvegarde de la base seule ne suffit pas.

## Exploitation au quotidien (Windows)

```powershell
.\Exploitation.ps1 -Action etat          # état du service, de l'API et des sauvegardes
.\Exploitation.ps1 -Action journaux      # suivi des journaux en direct
.\Exploitation.ps1 -Action redemarrer
.\Exploitation.ps1 -Action sauvegarder   # sauvegarde immédiate
.\Exploitation.ps1 -Action reinitialiser-mdp -Email "y.bouzid@aifg.dz"
.\Exploitation.ps1 -Action mettre-a-jour # procédure de mise à jour guidée
```

## Installation en production — Ubuntu (alternative)

```bash
./deploiement/installer.sh rh.votre-domaine.dz votre.email@aifg.dz
```

## Développement

```bash
# 1. Base
sudo -u postgres psql -c "CREATE USER aifg WITH PASSWORD 'motdepasse';"
sudo -u postgres psql -c "CREATE DATABASE aifg_rh OWNER aifg;"

# 2. Serveur
cd serveur && cp .env.example .env   # renseigner DATABASE_URL et JWT_SECRET
npm install && npm run migrate && npm start          # http://localhost:3001

# 3. Client
cd ../client && pnpm install && pnpm dev             # http://localhost:5173
```

Pour produire le client de production : `pnpm build` puis copier `dist/` dans `serveur/public/`.

## Tests

```bash
cd serveur && npm test     # 52 tests d'intégration (nécessite PostgreSQL)
cd client  && npx vitest run   # 19 tests de logique métier
```

## Messagerie automatique

Sans configuration, les messages sont enregistrés avec un lien à ouvrir (wa.me / mailto).
Pour l'envoi automatique, renseignez dans `.env` :

- **E-mail** : `SMTP_HOTE`, `SMTP_PORT`, `SMTP_UTILISATEUR`, `SMTP_MDP`, `SMTP_EXPEDITEUR`.
  Configurez SPF, DKIM et DMARC sur le domaine pour éviter le classement en spam.
- **WhatsApp** : `WHATSAPP_TOKEN` et `WHATSAPP_TELEPHONE_ID` (Meta WhatsApp Business Cloud API).
  Les messages sortants hors fenêtre de 24 h nécessitent des **modèles approuvés** par Meta :
  faites approuver un modèle par type de message (congé approuvé, rappel de visite, etc.).

## Points d'exploitation à connaître

**Sortie d'effectif, pas suppression.** Un employé qui quitte l'entreprise est *sorti de
l'effectif* : il disparaît des listes et des futures feuilles, mais son historique de
pointage et de congés est conservé — ce sont les pièces justificatives de la paie
(conservation légale). Une suppression définitive n'est possible que s'il n'a aucun
historique. Un employé sorti peut être réintégré.

**Garde-fou de démarrage.** En production, le service refuse de démarrer si le fichier
`.env` est absent, si `JWT_SECRET` est laissé à sa valeur par défaut ou trop court, si
`DATABASE_URL` contient un mot de passe de démonstration, ou si `ORIGINE_FRONTEND` manque.
Consultez `logs\erreurs.log` : le message indique précisément quoi corriger.

**Fuseau horaire.** Le service et la base sont réglés sur `Africa/Algiers`. Sans cela, les
dates de pointage suivraient l'heure UTC du serveur.

## Rôles

| Rôle | Droits |
|---|---|
| **RH** | Tout : référentiel, comptes, employés, validation finale, archivage, exports, audit |
| **Direction** | Consultation de tout (aucune modification), organigramme, notifications d'archivage |
| **Chef de service** | Son service : valide les pointages et les congés, les transmet au RH |
| **Chef de chantier / Superviseur** | Son chantier : prépare et soumet le pointage au chef de service |

## Pièces jointes

Les photos, contrats signés et certificats sont stockés dans `serveur/fichiers/`,
**hors du dossier web** : aucun accès direct par URL n'est possible, tout passe par une
route authentifiée avec contrôle de périmètre.

- Formats acceptés : JPEG, PNG, PDF, DOCX, XLSX — 10 Mo maximum.
- Le type réel est vérifié par la **signature binaire** du fichier : un script renommé
  en `.jpg` est refusé.
- Chaque fichier reçoit une **empreinte SHA-256** : elle prouve qu'un document archivé
  n'a pas été modifié depuis son dépôt.
- **Ce dossier doit être sauvegardé** : `Sauvegarde.ps1` l'archive automatiquement chaque
  nuit, en plus de la base. Une sauvegarde de la base seule ne suffit pas.

## Exploitation

- Journal d'audit : consultable dans l'application (RH/Direction), table `journal_audit`.
- Sauvegardes : quotidiennes à 2 h dans `/var/sauvegardes/aifg-rh`, rétention 30 jours.
  **Testez une restauration au moins une fois par trimestre.**
- Mises à jour : `apt update && apt upgrade` régulièrement, puis `systemctl restart aifg-rh`.
