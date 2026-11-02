#!/usr/bin/env bash
# Serve the Hydrascout placement app from a Linux VPS (Debian/Ubuntu) with nginx + HTTPS,
# and pull updates from GitHub main every 5 minutes.
#
# Usage (as root, on the VPS):
#   curl -fsSL https://raw.githubusercontent.com/flavaflav03/hydrascout-placement/main/deploy/setup-vps.sh -o setup-vps.sh
#   bash setup-vps.sh placement.example.com you@example.com
#
# Before running: point the domain's DNS A record (and AAAA if you use IPv6) at the VPS.
# Safe to run again: it updates the existing install instead of duplicating it.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO="${REPO:-https://github.com/flavaflav03/hydrascout-placement.git}"
BRANCH="${BRANCH:-main}"
WEBROOT="/var/www/hydrascout-placement"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: bash $0 <domain> <email for Let's Encrypt>" >&2; exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "Run as root (or with sudo)." >&2; exit 1; fi
if ! command -v apt-get >/dev/null; then echo "This script expects Debian/Ubuntu (apt-get)." >&2; exit 1; fi

# Refuse to fight another web server (Apache, Caddy, Traefik, a Docker container...) for port 80/443.
if command -v ss >/dev/null; then
  OTHER=$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v nginx || true)
  if [[ -n "$OTHER" ]]; then
    echo "Something other than nginx already listens on port 80/443:" >&2
    echo "$OTHER" >&2
    echo "Stopping here so nothing breaks. Send this output back and we'll adapt the setup." >&2
    exit 2
  fi
fi

echo "==> Installing nginx, git, certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git certbot python3-certbot-nginx >/dev/null

echo "==> Fetching the app into $WEBROOT"
if [[ -d "$WEBROOT/.git" ]]; then
  git -C "$WEBROOT" fetch -q origin "$BRANCH"
  git -C "$WEBROOT" reset -q --hard "origin/$BRANCH"
else
  rm -rf "$WEBROOT"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$WEBROOT"
fi

echo "==> Writing nginx site for $DOMAIN"
cat > /etc/nginx/sites-available/hydrascout-placement <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $WEBROOT;
    index index.html;

    location ~ /\.(git|github) { deny all; return 404; }
    location /deploy/ { deny all; return 404; }

    location / { try_files \$uri \$uri/ =404; }

    # index.html always revalidated so updates show up; css/js are versioned with ?v=N
    location = /index.html { add_header Cache-Control "no-cache"; }
    location ~* \.(css|js)$ { add_header Cache-Control "public, max-age=3600"; }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;
}
NGINX
ln -sf /etc/nginx/sites-available/hydrascout-placement /etc/nginx/sites-enabled/hydrascout-placement
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx

echo "==> Getting the HTTPS certificate"
certbot --nginx -n --agree-tos -m "$EMAIL" -d "$DOMAIN" --redirect --keep-until-expiring

echo "==> Auto-update from GitHub $BRANCH every 5 minutes"
cat > /usr/local/bin/hydrascout-update <<UPD
#!/bin/sh
git -C $WEBROOT fetch -q origin $BRANCH && git -C $WEBROOT reset -q --hard origin/$BRANCH
UPD
chmod +x /usr/local/bin/hydrascout-update
cat > /etc/systemd/system/hydrascout-update.service <<UNIT
[Unit]
Description=Pull the Hydrascout placement app from GitHub
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hydrascout-update
UNIT
cat > /etc/systemd/system/hydrascout-update.timer <<UNIT
[Unit]
Description=Pull the Hydrascout placement app every 5 minutes
[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now hydrascout-update.timer >/dev/null

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null
fi

echo
echo "Done: https://$DOMAIN"
echo "Updates from GitHub $BRANCH arrive within 5 minutes. Force one now with: hydrascout-update"
