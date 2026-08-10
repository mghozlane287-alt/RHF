#!/bin/bash
# Installation sur un serveur Ubuntu 22.04/24.04 LTS neuf. À exécuter en root.
set -euo pipefail
DOMAINE="${1:?Usage: ./installer.sh rh.votre-domaine.dz email@aifg.dz}"
EMAIL="${2:?Usage: ./installer.sh rh.votre-domaine.dz email@aifg.dz}"

echo "== 1. Paquets =="
apt-get update
apt-get install -y curl nginx postgresql ufw fail2ban certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

echo "== 2. Utilisateur système et base =="
id aifg &>/dev/null || useradd -r -m -d /opt/aifg-rh -s /usr/sbin/nologin aifg
MDP_BASE=$(openssl rand -base64 24 | tr -d '/+=')
sudo -u postgres psql -c "CREATE USER aifg WITH PASSWORD '$MDP_BASE';" || true
sudo -u postgres psql -c "CREATE DATABASE aifg_rh OWNER aifg;" || true

echo "== 3. Application =="
mkdir -p /opt/aifg-rh
cp -r ./serveur /opt/aifg-rh/
cp -r ./deploiement /opt/aifg-rh/
mkdir -p /opt/aifg-rh/serveur/logs
cd /opt/aifg-rh/serveur
npm ci --omit=dev

SECRET=$(openssl rand -hex 48)
MDP_RH=$(openssl rand -base64 12)
MDP_DIR=$(openssl rand -base64 12)
cat > .env <<CONF
PORT=3001
DATABASE_URL=postgresql://aifg:$MDP_BASE@localhost:5432/aifg_rh
JWT_SECRET=$SECRET
JWT_DUREE=8h
ORIGINE_FRONTEND=https://$DOMAINE
EMAIL_RH=rh@aifg.dz
MDP_INITIAL_RH=$MDP_RH
MDP_INITIAL_DIRECTION=$MDP_DIR
SMTP_HOTE=
SMTP_PORT=587
SMTP_SECURISE=false
SMTP_UTILISATEUR=
SMTP_MDP=
SMTP_EXPEDITEUR=rh@aifg.dz
WHATSAPP_TOKEN=
WHATSAPP_TELEPHONE_ID=
CONF
chmod 600 .env
chown -R aifg:aifg /opt/aifg-rh

echo "== 4. Base de données (migration) =="
sudo -u aifg bash -c "cd /opt/aifg-rh/serveur && set -a && . ./.env && set +a && node src/lib/migrate.js"

echo "== 5. Service systemd =="
cp deploiement/aifg-rh.service /etc/systemd/system/ 2>/dev/null || cp /opt/aifg-rh/deploiement/aifg-rh.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now aifg-rh

echo "== 6. Nginx + HTTPS =="
sed "s/rh.aifg.dz/$DOMAINE/g" /opt/aifg-rh/deploiement/nginx.conf > /etc/nginx/sites-available/aifg-rh
ln -sf /etc/nginx/sites-available/aifg-rh /etc/nginx/sites-enabled/aifg-rh
rm -f /etc/nginx/sites-enabled/default
certbot --nginx -d "$DOMAINE" --non-interactive --agree-tos -m "$EMAIL" --redirect
nginx -t && systemctl reload nginx

echo "== 7. Pare-feu et sauvegardes =="
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
systemctl enable --now fail2ban
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/aifg-rh/deploiement/sauvegarde.sh >> /var/log/sauvegarde-aifg.log 2>&1") | crontab -

echo ""
echo "========================================================"
echo " INSTALLATION TERMINÉE — https://$DOMAINE"
echo ""
echo " Identifiants initiaux (à changer à la 1re connexion) :"
echo "   RH        : rh@aifg.dz        / $MDP_RH"
echo "   Direction : direction@aifg.dz / $MDP_DIR"
echo ""
echo " NOTEZ-LES puis supprimez-les de votre écran."
echo "========================================================"
