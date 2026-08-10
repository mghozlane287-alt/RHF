#!/bin/bash
# Sauvegarde quotidienne de la base (cron : 0 2 * * * /opt/aifg-rh/deploiement/sauvegarde.sh)
set -euo pipefail
DOSSIER=/var/sauvegardes/aifg-rh
RETENTION=30
mkdir -p "$DOSSIER"
FICHIER="$DOSSIER/aifg_rh_$(date +%Y%m%d_%H%M).sql.gz"
pg_dump -U aifg -h localhost aifg_rh | gzip > "$FICHIER"
chmod 600 "$FICHIER"
find "$DOSSIER" -name 'aifg_rh_*.sql.gz' -mtime +$RETENTION -delete
echo "Sauvegarde : $FICHIER"
# Restauration :
#   gunzip -c FICHIER.sql.gz | psql -U aifg -h localhost aifg_rh
