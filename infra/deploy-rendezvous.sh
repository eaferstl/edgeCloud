#!/usr/bin/env bash
#
# edgeCloud rendezvous server — one-shot provision + deploy.
#
# Runs on Debian, Ubuntu, and Fedora. Run ON a fresh box, as root or any
# sudo-capable user:
#
#   # plain HTTP on the bare IP (matches the demo deployment)
#   sudo ./deploy-rendezvous.sh --csv ./attendees.csv
#
#   # same, but front the website with a domain + HTTPS (Let's Encrypt via Caddy)
#   sudo ./deploy-rendezvous.sh --domain edge.example.com --email you@example.com --csv ./attendees.csv
#
# Idempotent: re-running upgrades code + config in place (it never rotates an
# already-generated EDGECLOUD_SHARED_SALT, so the registry survives re-runs).
#
# What it sets up: Node 22, swap, a firewall (ufw on Debian/Ubuntu, firewalld on
# Fedora), the `edgecloud` systemd service (libp2p relay + OrbitDB + HTTP
# bridge), the attendee allowlist, and—when a domain is given—Caddy terminating
# TLS in front of the Node app.
#
# NOTE ON HTTPS + libp2p: the domain/TLS fronts ONLY the website + JSON API.
# The libp2p listeners (tcp/4001, ws/4002) that WORKER nodes dial stay on the
# raw public IP; browsers never speak libp2p (the browser is an HTTP bridge that
# only does keygen/signing), so plain ws is fine for the demo. Upgrading workers
# to wss is a separate, optional step (see infra/DEPLOYMENT.md).

set -euo pipefail

# ---- defaults ------------------------------------------------------------
REPO_URL="https://github.com/eaferstl/edgeCloud.git"
REF="main"
DOMAIN=""
ACME_EMAIL=""
CSV=""
SALT=""
LABEL="$(hostname 2>/dev/null || uname -n)"
WORKER_EMAIL=""
APP_DIR="/opt/edgecloud"
ENV_FILE="/etc/edgecloud/env"
SERVICE_USER="ubuntu"   # the committed edgecloud.service runs as this user

usage() {
  sed -n '3,31p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ---- args ----------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)       DOMAIN="$2"; shift 2 ;;
    --email)        ACME_EMAIL="$2"; shift 2 ;;
    --csv)          CSV="$2"; shift 2 ;;
    --salt)         SALT="$2"; shift 2 ;;
    --label)        LABEL="$2"; shift 2 ;;
    --repo)         REPO_URL="$2"; shift 2 ;;
    --ref)          REF="$2"; shift 2 ;;
    --worker-email) WORKER_EMAIL="$2"; shift 2 ;;
    -h|--help)      usage 0 ;;
    *) echo "unknown option: $1" >&2; usage 1 ;;
  esac
done

if [ -n "$DOMAIN" ] && [ -z "$ACME_EMAIL" ]; then
  echo "error: --domain requires --email (ACME/Let's Encrypt contact)" >&2; exit 1
fi

# With a domain, Caddy owns :80/:443 and the Node app listens on :8080 (localhost
# only, never opened in the firewall). Without a domain, the app binds :80.
if [ -n "$DOMAIN" ]; then HTTP_PORT=8080; else HTTP_PORT=80; fi

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
log() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }

# Run a command as the unprivileged service user, whether we're root or a sudo
# user. Uses literal sudo/runuser (not $SUDO, which is empty as root) so the
# flags attach; -H sets HOME so git/npm find their config.
asuser() {
  if command -v sudo >/dev/null 2>&1; then sudo -u "$SERVICE_USER" -H "$@"
  else $SUDO runuser -u "$SERVICE_USER" -- "$@"; fi
}

# ---- distro abstraction --------------------------------------------------
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) FAMILY=debian ;;
  fedora|rhel|centos|rocky|almalinux) FAMILY=rhel ;;
  *) case " ${ID_LIKE:-} " in
       *debian*) FAMILY=debian ;;
       *rhel*|*fedora*) FAMILY=rhel ;;
       *) echo "unsupported distro: ${ID:-unknown} (need Debian/Ubuntu/Fedora)" >&2; exit 1 ;;
     esac ;;
esac

pkg_refresh() {
  case $FAMILY in
    debian) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -y ;;
    rhel)   $SUDO dnf -y makecache || true ;;
  esac
}
pkg_install() {
  case $FAMILY in
    debian) $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    rhel)   $SUDO dnf install -y "$@" ;;
  esac
}

install_node() {
  if command -v node >/dev/null 2>&1 && node -v | grep -q '^v22'; then return; fi
  case $FAMILY in
    debian) curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - ;;
    rhel)   curl -fsSL https://rpm.nodesource.com/setup_22.x | $SUDO bash - ;;
  esac
  pkg_install nodejs
}

# build toolchain for better-sqlite3 (C++ + python3)
buildtools_pkgs() {
  case $FAMILY in
    debian) echo build-essential python3 ;;
    rhel)   echo gcc-c++ make python3 ;;
  esac
}

setup_firewall() {  # $@ = tcp ports to allow
  case $FAMILY in
    debian)
      pkg_install ufw
      $SUDO ufw --force default deny incoming
      $SUDO ufw --force default allow outgoing
      for p in "$@"; do $SUDO ufw allow "${p}/tcp"; done
      $SUDO ufw --force enable ;;
    rhel)
      pkg_install firewalld
      $SUDO systemctl enable --now firewalld
      for p in "$@"; do $SUDO firewall-cmd --permanent --add-port="${p}/tcp" >/dev/null; done
      $SUDO firewall-cmd --reload >/dev/null ;;
  esac
}

install_caddy() {
  command -v caddy >/dev/null 2>&1 && return
  case $FAMILY in
    debian)
      pkg_install debian-keyring debian-archive-keyring apt-transport-https gnupg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | $SUDO gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      pkg_refresh; pkg_install caddy ;;
    rhel)
      # Fedora ships caddy in its repos; COPR is the upstream-blessed fallback.
      $SUDO dnf install -y 'dnf-command(copr)' || true
      $SUDO dnf copr enable -y @caddy/caddy || true
      pkg_install caddy ;;
  esac
}

install_docker() {  # only for the optional local worker
  command -v docker >/dev/null 2>&1 && return
  case $FAMILY in
    debian) pkg_install docker.io ;;
    rhel)   pkg_install moby-engine ;;
  esac
  $SUDO systemctl enable --now docker
}

log "Detected distro: ${PRETTY_NAME:-$ID} (family: $FAMILY)"

# ---- 1. packages ---------------------------------------------------------
log "Installing packages (Node 22, git, build tools)…"
pkg_refresh
install_node
# shellcheck disable=SC2046
pkg_install git rsync ca-certificates curl openssl $(buildtools_pkgs)

# ---- 2. service user + swap ---------------------------------------------
id "$SERVICE_USER" >/dev/null 2>&1 || $SUDO useradd -m -s /bin/bash "$SERVICE_USER"

if [ ! -f /swapfile ] && ! swapon --show 2>/dev/null | grep -q .; then
  log "Creating 2G swap (small boxes need headroom for Node + a worker)…"
  $SUDO fallocate -l 2G /swapfile && $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile && $SUDO swapon /swapfile
  echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

# ---- 3. code -------------------------------------------------------------
log "Fetching code ($REPO_URL @ $REF) into $APP_DIR…"
$SUDO install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  asuser git -C "$APP_DIR" fetch --depth 1 origin "$REF"
  asuser git -C "$APP_DIR" reset --hard FETCH_HEAD
else
  asuser git clone --branch "$REF" --depth 1 "$REPO_URL" "$APP_DIR"
fi
asuser bash -c "cd '$APP_DIR' && npm ci --omit=dev"

# ---- 4. server env (never prints or rotates the salt) -------------------
log "Writing $ENV_FILE…"
$SUDO mkdir -p /etc/edgecloud
if [ -z "$SALT" ]; then
  if [ -f "$ENV_FILE" ]; then
    SALT="$($SUDO grep -E '^EDGECLOUD_SHARED_SALT=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  fi
  [ -n "$SALT" ] || SALT="$(openssl rand -hex 24)"
fi
PUBLIC_IP="$(curl -fsS https://api.ipify.org 2>/dev/null || ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
$SUDO tee "$ENV_FILE" >/dev/null <<EOF
EDGECLOUD_DATA=/var/lib/edgecloud
EDGECLOUD_SHARED_SALT=$SALT
HTTP_PORT=$HTTP_PORT
LIBP2P_TCP_PORT=4001
LIBP2P_WS_PORT=4002
EDGECLOUD_SERVER_LABEL=$LABEL
EOF
$SUDO chmod 640 "$ENV_FILE"; $SUDO chgrp "$SERVICE_USER" "$ENV_FILE"

# ---- 5. firewall ---------------------------------------------------------
log "Configuring firewall…"
if [ -n "$DOMAIN" ]; then
  setup_firewall 22 80 443 4001 4002   # 80 = ACME challenge + HTTP->HTTPS redirect
else
  setup_firewall 22 80 4001 4002       # 80 = website + API
fi

# ---- 6. systemd service --------------------------------------------------
log "Installing + starting the edgecloud service…"
$SUDO cp "$APP_DIR/infra/edgecloud.service" /etc/systemd/system/edgecloud.service
$SUDO systemctl daemon-reload
$SUDO systemctl enable edgecloud
$SUDO systemctl restart edgecloud

# ---- 7. attendee allowlist ----------------------------------------------
if [ -n "$CSV" ]; then
  log "Importing attendee allowlist…"
  $SUDO install -o "$SERVICE_USER" -m 600 "$CSV" "/home/$SERVICE_USER/attendees.csv"
  asuser env $($SUDO cat "$ENV_FILE" | xargs) \
    npm run import-allowlist --prefix "$APP_DIR/server" -- "/home/$SERVICE_USER/attendees.csv"
fi

# ---- 8. capture peerId, self-advertise multiaddrs, restart --------------
log "Waiting for first boot (libp2p peerId)…"
PEER_ID=""
for _ in $(seq 1 30); do
  # `|| true` so an empty grep on an early poll doesn't trip `set -e`/pipefail.
  PEER_ID="$($SUDO journalctl -u edgecloud --no-pager 2>/dev/null | grep -oE 'libp2p peerId: [^ ]+' | tail -1 | awk '{print $3}' || true)"
  [ -n "$PEER_ID" ] && break
  sleep 2
done
MULTIADDRS=""
if [ -n "$PEER_ID" ]; then
  MULTIADDRS="/ip4/$PUBLIC_IP/tcp/4002/ws/p2p/$PEER_ID,/ip4/$PUBLIC_IP/tcp/4001/p2p/$PEER_ID"
  $SUDO sed -i '/^EDGECLOUD_PUBLIC_MULTIADDRS=/d' "$ENV_FILE"
  echo "EDGECLOUD_PUBLIC_MULTIADDRS=$MULTIADDRS" | $SUDO tee -a "$ENV_FILE" >/dev/null
  $SUDO systemctl restart edgecloud
else
  log "WARNING: could not read the peerId from the logs; EDGECLOUD_PUBLIC_MULTIADDRS not set."
fi

# ---- 9. HTTPS via Caddy --------------------------------------------------
if [ -n "$DOMAIN" ]; then
  log "Installing Caddy + configuring https://$DOMAIN → 127.0.0.1:$HTTP_PORT…"
  install_caddy
  $SUDO tee /etc/caddy/Caddyfile >/dev/null <<EOF
{
    email $ACME_EMAIL
}
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:$HTTP_PORT
}
# Plain-HTTP bare-IP vhost for WORKER nodes. The hardened worker egress firewall
# blocks in-container DNS on some hosts (e.g. Docker Desktop), so workers dial us
# by raw IP and need a no-DNS HTTP endpoint for registration + the registry-grace
# check. "http://" => serve HTTP only, no TLS, no auto-redirect. Browsers use the
# HTTPS domain above; the worker default (shared/src/constants.js, worker config)
# points at this IP.
http://$PUBLIC_IP {
    encode gzip
    reverse_proxy 127.0.0.1:$HTTP_PORT
}
EOF
  $SUDO systemctl enable caddy
  $SUDO systemctl restart caddy
fi

# ---- 10. optional local worker ------------------------------------------
if [ -n "$WORKER_EMAIL" ]; then
  log "Building + starting a local worker container (email: $WORKER_EMAIL)…"
  install_docker
  $SUDO usermod -aG docker "$SERVICE_USER" 2>/dev/null || true
  $SUDO docker build -t edgecloud-worker -f "$APP_DIR/worker/Dockerfile" "$APP_DIR"
  $SUDO docker rm -f edgecloud-worker 2>/dev/null || true
  $SUDO docker run -d --name edgecloud-worker --restart unless-stopped \
    --cap-add NET_ADMIN --memory 400m \
    -v edgecloud_worker_data:/data \
    -e EDGECLOUD_EMAIL="$WORKER_EMAIL" \
    edgecloud-worker
fi

# ---- 11. health + summary -----------------------------------------------
sleep 5
log "Health checks"
curl -fsS -o /dev/null -w "  app  /api/ping  -> %{http_code}\n" "http://127.0.0.1:$HTTP_PORT/api/ping" \
  || echo "  app not answering yet (check: journalctl -u edgecloud -n 50)"
if [ -n "$DOMAIN" ]; then
  curl -fsS -o /dev/null -w "  https://$DOMAIN/ -> %{http_code}\n" "https://$DOMAIN/" \
    || echo "  https not ready yet — DNS for $DOMAIN must point at $PUBLIC_IP; Caddy retries automatically"
else
  curl -fsS -o /dev/null -w "  http://$PUBLIC_IP/ -> %{http_code}\n" "http://$PUBLIC_IP/" || true
fi

PUBKEY="$($SUDO journalctl -u edgecloud --no-pager 2>/dev/null | grep -oE 'server pubkey: [^ ]+' | tail -1 | awk '{print $3}' || true)"
cat <<EOF

==> Done.
    URL:          $([ -n "$DOMAIN" ] && echo "https://$DOMAIN" || echo "http://$PUBLIC_IP")
    peerId:       ${PEER_ID:-<not captured — see journalctl>}
    server pubkey:${PUBKEY:+ $PUBKEY}
    multiaddrs:   ${MULTIADDRS:-<none>}
    env file:     $ENV_FILE  (contains EDGECLOUD_SHARED_SALT — keep secret, never commit)

    To JOIN AN EXISTING network, this server must reuse that network's
    EDGECLOUD_SHARED_SALT (pass --salt) and be endorsed once, from any already-trusted
    server, with:
      cd /opt/edgecloud/server
      npm run endorse-server -- "$PUBKEY" "$MULTIADDRS" "$LABEL"
EOF
