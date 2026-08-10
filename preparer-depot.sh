#!/bin/bash
# ============================================================
# Prépare et envoie le projet sur GitHub avec la bonne structure.
# Usage :  ./preparer-depot.sh https://github.com/VOTRE-COMPTE/RHF.git
# ============================================================
set -e
DEPOT="${1:?Usage: ./preparer-depot.sh https://github.com/compte/depot.git}"

echo "--- Vérification de la structure locale ---"
for d in client serveur deploiement; do
  [ -d "$d" ] || { echo "ERREUR : dossier $d/ introuvable. Placez-vous dans le dossier aifg-rh."; exit 1; }
done
[ -f Dockerfile ] && [ -f render.yaml ] || { echo "ERREUR : Dockerfile ou render.yaml manquant."; exit 1; }
echo "  OK : client/, serveur/, deploiement/ présents"

# Ne jamais envoyer de secrets ni de fichiers volumineux
cat > .gitignore <<'IGN'
node_modules/
dist/
.parcel-cache/
serveur/public/
serveur/fichiers/
serveur/logs/
.env
*.env
!.env.docker.exemple
*.tar.gz
*.log
IGN

echo "--- Contrôle : aucun fichier .env réel ne doit partir ---"
if find . -name ".env" -not -path "*/node_modules/*" | grep -q .; then
  echo "  ATTENTION : un fichier .env existe. Il est exclu par .gitignore, mais vérifiez-le."
fi

git init -q 2>/dev/null || true
git add -A
git -c user.email="rh@aifg.dz" -c user.name="AIFG" commit -q -m "Registre RH AIFG" || echo "  (rien de nouveau à valider)"
git branch -M main
git remote remove origin 2>/dev/null || true
git remote add origin "$DEPOT"

echo "--- Envoi vers $DEPOT ---"
git push -u origin main --force

echo ""
echo "Terminé. Vérifiez sur GitHub que vous voyez bien les dossiers client/ et serveur/."
