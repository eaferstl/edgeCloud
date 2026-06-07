# Deployment guide — edgeCloud rendezvous server

How to stand up (or redeploy) a rendezvous server: the libp2p relay + OrbitDB
peer + HTTP bridge that serves the webform and replicates the job/registry/claim/
result DBs. Workers are separate Docker containers (see
[`provision.md`](provision.md) §10 and `worker/Dockerfile`).

There are two paths:

- **Script** — [`deploy-rendezvous.sh`](deploy-rendezvous.sh): one command stands
  up a fresh box, with or without HTTPS. Use this for a new server.
- **Manual / redeploy** — the steps below. Use this to push an update to an
  already-running server (what we do day to day) or to understand what the script
  does.

The canonical from-scratch runbook with per-step rationale is
[`provision.md`](provision.md); this guide is the operational summary plus the
domain + HTTPS instructions.

---

## A. New server (scripted)

On a fresh **Debian, Ubuntu, or Fedora** box, as root or a sudo user. The script
detects the distro and uses the right tooling (apt + ufw on Debian/Ubuntu, dnf +
firewalld on Fedora; NodeSource for Node 22 on both; Caddy via the cloudsmith apt
repo or the `@caddy/caddy` COPR). Verified end-to-end on Ubuntu 24.04, Debian 12,
and Fedora 41 (the last under SELinux Enforcing). The repo is public, so the
script clones it itself; you only bring the attendee CSV (and, to join an existing
network, that network's shared salt).

```bash
git clone https://github.com/eaferstl/edgeCloud.git
cd edgeCloud/infra

# plain HTTP on the bare IP (this is how the demo box runs):
sudo ./deploy-rendezvous.sh --csv /path/to/attendees.csv

# OR with a domain + automatic HTTPS (Let's Encrypt via Caddy):
sudo ./deploy-rendezvous.sh \
  --domain edge.example.com --email you@example.com \
  --csv /path/to/attendees.csv
```

Useful flags: `--salt <hex>` (REQUIRED to join an existing network — reuse that
network's `EDGECLOUD_SHARED_SALT`), `--ref <branch|tag|sha>`, `--label <name>`,
`--worker-email <attendee@…>` (also run a worker container here), `--repo <url>`.
Run `./deploy-rendezvous.sh --help` for all of them.

The script is **idempotent** — re-run it to upgrade code/config in place; it
reuses the existing salt and never wipes the registry.

What it does, in order: installs Node 22 + Docker + ufw (+ Caddy if `--domain`);
makes 2G swap; clones the repo to `/opt/edgecloud` and `npm ci`; writes
`/etc/edgecloud/env`; opens the firewall; installs and starts the `edgecloud`
systemd service; imports the CSV; captures the libp2p peerId and self-advertises
its multiaddrs; configures Caddy; prints the URL, peerId, and server pubkey.

---

## B. Manual deploy / redeploy (already-provisioned server)

This is the day-to-day update flow for the running demo box (`146.190.123.91`,
SSH alias `edgeCloud`). `/opt/edgecloud` is an **rsync target, not a git
checkout**, so push the working tree up:

```bash
# from the repo root on your dev machine
rsync -az \
  --exclude node_modules --exclude .git --exclude server-data --exclude worker-data \
  --exclude .omx --exclude 'attendees*.csv' \
  ./ ubuntu@edgeCloud:/opt/edgecloud/
```

Notes from doing this in practice:

- **Static-only change** (e.g. `server/src/public/*`): no restart needed — the
  Node server reads files from disk per request. Just rsync and hard-refresh.
- **Server code change**: `ssh ubuntu@edgeCloud 'sudo systemctl restart edgecloud'`.
  Brief reconnect blip while OrbitDB reopens; workers reconnect automatically.
- **Dependency change** (package-lock changed): add
  `ssh ubuntu@edgeCloud 'cd /opt/edgecloud && npm ci --omit=dev'` before the
  restart. Skip it otherwise.
- **Omit `--delete`** unless you've confirmed nothing server-only lives under
  `/opt/edgecloud`; the data dir is `/var/lib/edgecloud` (systemd `StateDirectory`,
  not under the app dir), so a no-delete rsync is the safe default.
- **Never** rsync `attendees*.csv` or `.git`, and never commit
  `EDGECLOUD_SHARED_SALT` or attendee data.

Add attendees later (additive, `INSERT OR IGNORE`, safe to re-run):

```bash
scp attendees.csv ubuntu@edgeCloud:/home/ubuntu/attendees.csv
ssh ubuntu@edgeCloud 'env $(sudo cat /etc/edgecloud/env | xargs) \
  npm run import-allowlist --prefix /opt/edgecloud/server -- /home/ubuntu/attendees.csv'
```

Health check after any deploy:

```bash
curl -s -o /dev/null -w "GET /        -> %{http_code}\n" http://edgeCloud-or-domain/
curl -s -o /dev/null -w "GET /api/ping -> %{http_code}\n" http://edgeCloud-or-domain/api/ping   # expect 204
curl -s http://edgeCloud-or-domain/api/status | grep -o '"workersOnline":[0-9]*'
```

---

## C. Domain + HTTPS (Let's Encrypt)

The `--domain`/`--email` flags do all of this automatically; here's what they set
up, and how to add HTTPS to a server that's already running on plain HTTP.

### Architecture

- TLS fronts **only the website + JSON API**. We use **Caddy** as a reverse proxy:
  it listens on `:80`/`:443`, obtains and auto-renews a Let's Encrypt cert, and
  proxies to the Node app on `127.0.0.1:8080`.
- The Node app therefore binds `:8080` (set `HTTP_PORT=8080` in
  `/etc/edgecloud/env`) instead of `:80`. Port `8080` is **not** opened in the
  firewall — only Caddy reaches it.
- The **libp2p listeners (tcp/4001, ws/4002) stay on the raw public IP.** Workers
  dial those, not the browser. Browsers only do keygen/signing over HTTPS and POST
  to the API — so plain `ws` for workers is fine. (The app uses tweetnacl in the
  browser regardless of HTTP vs HTTPS, so nothing about the crypto path changes.)

### Steps to add HTTPS to an existing plain-HTTP server

1. Point a DNS **A record** for your domain at the server's public IP. Confirm:
   `dig +short edge.example.com` returns that IP.

2. Move the app off `:80` so Caddy can take it:

   ```bash
   sudo sed -i 's/^HTTP_PORT=.*/HTTP_PORT=8080/' /etc/edgecloud/env
   sudo systemctl restart edgecloud
   ```

3. Open `:443` (leave `:80` open — Caddy needs it for the ACME challenge + the
   HTTP→HTTPS redirect):

   ```bash
   sudo ufw allow 443/tcp
   ```

4. Install Caddy and configure the proxy:

   ```bash
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
     | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
     | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
   sudo apt-get update && sudo apt-get install -y caddy

   sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
   {
       email you@example.com
   }
   edge.example.com {
       encode gzip
       reverse_proxy 127.0.0.1:8080
   }
   EOF
   sudo systemctl restart caddy
   ```

   Caddy fetches the cert on first request and renews it automatically. Verify:
   `curl -sI https://edge.example.com/ | head -1`.

   <details><summary>nginx + certbot alternative</summary>

   ```bash
   sudo apt-get install -y nginx certbot python3-certbot-nginx
   sudo tee /etc/nginx/sites-available/edgecloud >/dev/null <<'EOF'
   server {
       listen 80;
       server_name edge.example.com;
       location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
   }
   EOF
   sudo ln -sf /etc/nginx/sites-available/edgecloud /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d edge.example.com -m you@example.com --agree-tos -n --redirect
   # certbot installs a systemd timer that auto-renews.
   ```
   </details>

### After going HTTPS — content follow-ups

These reference the old IP/scheme and should be updated to the domain (see also
`FOLLOWUPS.md`):

- `server/src/public/index.html`: `og:url`, `og:image`, `twitter:image`
  (currently `http://146.190.123.91/…`) → `https://edge.example.com/…`.
- The `<meta name="theme-color">` is a separate pending tweak in `FOLLOWUPS.md`.
- If you later want workers on `wss`: advertise a `/dns4/edge.example.com/tcp/443/
  wss/p2p/<peerId>` multiaddr and have Caddy proxy a WS path to `:4002` — out of
  scope for the demo, noted here as the upgrade path.

---

## Reference

- **Service:** `edgecloud.service` (User=ubuntu, binds `:80` via
  `CAP_NET_BIND_SERVICE`, data in `/var/lib/edgecloud`). Logs:
  `journalctl -u edgecloud -f`.
- **Env:** `/etc/edgecloud/env` — `EDGECLOUD_SHARED_SALT` (secret),
  `HTTP_PORT`, `LIBP2P_TCP_PORT`/`LIBP2P_WS_PORT`,
  `EDGECLOUD_PUBLIC_MULTIADDRS`, `EDGECLOUD_SERVER_LABEL`.
- **Ports:** `22` SSH · `80` web/ACME · `443` HTTPS (domain mode) ·
  `4001` libp2p TCP · `4002` libp2p WS. App-internal `8080` stays firewalled.
- **Multi-server onboarding** (endorsement chain): `provision.md` "Onboarding
  ANOTHER central server".
