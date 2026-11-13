#!/usr/bin/env bash
# Read-only security check of the VPS that serves placement.coccinelia.com and logger.coccinelia.com.
# It changes nothing: it only prints settings and test results, with OK / CHECK next to each finding.
#
# Run it on the VPS (as root, so it can read the Caddy and SSH settings):
#   ssh hostinger 'sudo bash -s' < deploy/security-check.sh > security-report.txt
# then send security-report.txt back. It contains no passwords or keys: .env files are listed (name, owner,
# permissions), never printed. Look through it before sharing if you prefer.
set -uo pipefail

PLACEMENT="${PLACEMENT:-placement.coccinelia.com}"
LOGGER="${LOGGER:-logger.coccinelia.com}"
ok() { echo "  OK     $*"; }
chk() { echo "  CHECK  $*"; }
h() { echo; echo "=== $* ==="; }

h "System"
. /etc/os-release 2>/dev/null && echo "  $PRETTY_NAME, kernel $(uname -r)"
echo "  Uptime: $(uptime -p 2>/dev/null)"
if command -v apt-get >/dev/null; then
  n=$(apt-get -s upgrade 2>/dev/null | grep -c '^Inst' || true); s=$(apt-get -s upgrade 2>/dev/null | grep '^Inst' | grep -ci security || true)
  [[ "$n" == 0 ]] && ok "No pending package updates" || chk "$n package updates pending ($s security)"
  dpkg -l unattended-upgrades 2>/dev/null | grep -q '^ii' && ok "unattended-upgrades installed" || chk "unattended-upgrades not installed (automatic security updates)"
fi
[[ -f /var/run/reboot-required ]] && chk "A reboot is pending (new kernel or libraries)"

h "Ports open to the internet (listening on all addresses)"
ss -ltnupH 2>/dev/null | awk '{print $1, $5, $7}' | grep -vE ' (127\.0\.0\.1|\[::1\]|::1):' | sed 's/^/  /'
echo "  Expected public ports: 22 (SSH), 80 and 443 (Caddy). Anything else (3000, 5678 n8n, a database...) should"
echo "  listen on 127.0.0.1 only, or be blocked by the firewall below."

h "Firewall"
if command -v ufw >/dev/null; then ufw status verbose 2>/dev/null | sed 's/^/  /'; else chk "ufw not installed"; fi
command -v nft >/dev/null && echo "  nftables rules: $(nft list ruleset 2>/dev/null | grep -c 'dport') port rules"
echo "  Note: Docker publishes ports straight through iptables, past ufw. Container ports must be bound to 127.0.0.1."

h "Docker containers and their published ports"
if command -v docker >/dev/null; then
  docker ps --format '  {{.Names}}  |  {{.Image}}  |  {{.Ports}}' 2>/dev/null
  docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE '0\.0\.0\.0:|:::' && chk "Some container ports listen on 0.0.0.0 (reachable without Caddy)" || ok "No container port published on 0.0.0.0"
else echo "  Docker not installed"; fi

h "SSH"
if command -v sshd >/dev/null; then
  cfg=$(sshd -T 2>/dev/null)
  for k in permitrootlogin passwordauthentication kbdinteractiveauthentication pubkeyauthentication maxauthtries x11forwarding; do echo "  $(echo "$cfg" | grep -i "^$k ")"; done
  echo "$cfg" | grep -qi '^passwordauthentication yes' && chk "SSH accepts passwords: keys only is safer" || ok "SSH passwords off"
  echo "$cfg" | grep -qiE '^permitrootlogin yes' && chk "Root can log in with a password" || ok "Root password login off"
fi
systemctl is-active --quiet fail2ban 2>/dev/null && ok "fail2ban running" || chk "fail2ban not running (blocks SSH brute force)"
echo "  Failed SSH logins in the last 24 h: $(journalctl -u ssh -u sshd --since '24 hours ago' 2>/dev/null | grep -c 'Failed password\|Invalid user')"

h "Caddy"
command -v caddy >/dev/null && echo "  $(caddy version 2>/dev/null)"
docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -i caddy | sed 's/^/  container: /'
for f in /etc/caddy/Caddyfile $(find / -xdev -name Caddyfile -not -path '*/proc/*' 2>/dev/null | head -5); do
  [[ -f "$f" ]] || continue; echo "  --- $f (lines mentioning secrets are hidden)"
  grep -viE 'password|secret|token|key|basicauth|hash' "$f" | sed 's/^/  | /'
done | awk '!seen[$0]++'

h "Secret files (.env): owner and permissions only, never the content"
find / -xdev \( -name '.env' -o -name '*.env' -o -name 'users.json' \) -not -path '/proc/*' -not -path '*/node_modules/*' 2>/dev/null | head -20 | while read -r f; do
  p=$(stat -c '%a %U:%G' "$f"); echo "  $p  $f"
  [[ "${p%% *}" =~ [1-7]$ ]] && chk "$f can be read by every user on the server (chmod 600)"
done

h "Placement app folder"
for d in /var/www/hydrascout-placement /srv/hydrascout-placement; do [[ -d "$d/.git" ]] && echo "  $d at $(git -C "$d" log -1 --format='%h %cd' 2>/dev/null)"; done
systemctl list-timers 2>/dev/null | grep -i hydrascout | sed 's/^/  timer: /'

h "HTTP checks from the server itself (same as a visitor)"
for host in "$PLACEMENT" "$LOGGER"; do
  echo "  --- https://$host/"
  hdr=$(curl -sS -o /dev/null -D - --max-time 15 "https://$host/" 2>&1)
  echo "$hdr" | grep -iE '^(HTTP|server|strict-transport|content-security|x-frame|x-content-type|referrer-policy|permissions-policy|access-control|set-cookie|location)' | sed 's/^/  | /'
  for want in strict-transport-security x-content-type-options referrer-policy; do echo "$hdr" | grep -qi "^$want" && ok "$want" || chk "$want header missing"; done
  echo "$hdr" | grep -qiE '^(x-frame-options|content-security-policy:.*frame-ancestors)' && ok "framing blocked" || chk "pages can be framed (clickjacking): add X-Frame-Options DENY"
  echo "$hdr" | grep -qi '^server: ' && chk "Server header shows the software (hide with header -Server)"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://$host/"); [[ "$code" =~ ^30[178]$ ]] && ok "http:// redirects to https ($code)" || chk "http:// answered $code"
  for p in /.git/config /.git/HEAD /.env /deploy/setup-vps.sh /backend/.env /data/users.json /docker-compose.yml; do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$host$p")
    [[ "$c" == 200 ]] && chk "$p is served (HTTP 200)" || ok "$p not served ($c)"
  done
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -H 'Origin: https://evil.example' -D /tmp/.cors.$$ "https://$host/api/devices")
  grep -qi '^access-control-allow-origin' /tmp/.cors.$$ && chk "/api/devices sends CORS headers to a foreign origin: $(grep -i '^access-control' /tmp/.cors.$$ | tr -d '\r' | tr '\n' ' ')" || ok "/api/devices: no CORS for foreign origins (answered $c without login)"
  rm -f /tmp/.cors.$$
done
echo "  --- Spoofed X-Forwarded-For (should not change the IP the logger sees; check its log for 'Failed login ... from 203.0.113.9')"
curl -s -o /dev/null --max-time 10 -H 'X-Forwarded-For: 203.0.113.9' -d 'username=security-check&password=not-a-real-password' "https://$LOGGER/login"
sleep 1; (docker ps --format '{{.Names}}' 2>/dev/null | grep -iE 'logger|app' | head -1 | xargs -r -I{} docker logs --since 1m {} 2>&1; journalctl --since '1 minute ago' 2>/dev/null) | grep -i 'security-check' | tail -2 | sed 's/^/  log: /'
echo "  If the log shows 203.0.113.9, anyone can dodge the 10-attempt login lock by changing that header (see SECURITY.md)."

h "TLS certificates"
for host in "$PLACEMENT" "$LOGGER"; do
  end=$(echo | openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  echo "  $host expires: ${end:-could not read}"
  echo | openssl s_client -tls1_1 -servername "$host" -connect "$host:443" >/dev/null 2>&1 && chk "$host still accepts TLS 1.1" || ok "$host refuses TLS 1.1"
done
echo; echo "Done. Nothing was changed."
