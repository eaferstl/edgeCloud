# VPS provisioning runbook — edgeCloud rendezvous server

> **Canonical genesis is now `seed.pandocloud.io` (`64.23.224.76`), migrated
> 2026-06-10 — see `docs/04_decisions_risks_cuts.md` D-013.** This runbook's
> `146.190.123.91` references are the original box (kept ~1 month as overlap
> fallback, then decommissioned); substitute your own host. The scripted path in
> `DEPLOYMENT.md` (`deploy-rendezvous.sh`) is the current way to stand one up.

Target: Ubuntu 24.04 VPS (1 GB RAM) at `146.190.123.91`. All steps are
idempotent; rerunning is safe. Steps 1–5 run as **root**, the rest as
**ubuntu**.

## 1. ubuntu user (sudo, SSH key; root login stays as fallback)

```bash
id ubuntu || adduser --disabled-password --gecos '' ubuntu
usermod -aG sudo,docker ubuntu 2>/dev/null || usermod -aG sudo ubuntu
printf 'ubuntu ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/90-ubuntu
mkdir -p /home/ubuntu/.ssh
cp /root/.ssh/authorized_keys /home/ubuntu/.ssh/authorized_keys
chown -R ubuntu:ubuntu /home/ubuntu/.ssh && chmod 700 /home/ubuntu/.ssh && chmod 600 /home/ubuntu/.ssh/authorized_keys
```

Default to `ssh ubuntu@146.190.123.91` from now on (the repo's `~/.ssh/config`
`Host edgeCloud` entry already does this).

## 2. Swap (1 GB box + Node server + Docker worker need headroom)

```bash
test -f /swapfile || (fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab)
```

## 3. Packages: Node 22 (NodeSource), Docker, ufw

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get update && apt-get install -y nodejs docker.io rsync ufw build-essential
usermod -aG docker ubuntu
```

## 4. Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # webform + API
ufw allow 4001/tcp  # libp2p TCP
ufw allow 4002/tcp  # libp2p WebSockets
ufw --force enable
```

## 5. Server env

```bash
mkdir -p /etc/edgecloud
cat > /etc/edgecloud/env <<EOF
EDGECLOUD_DATA=/var/lib/edgecloud
EDGECLOUD_SHARED_SALT=$(openssl rand -hex 24)
HTTP_PORT=80
LIBP2P_TCP_PORT=4001
LIBP2P_WS_PORT=4002
EDGECLOUD_SERVER_LABEL=genesis-146.190.123.91
EOF
chmod 640 /etc/edgecloud/env && chgrp ubuntu /etc/edgecloud/env
```

`EDGECLOUD_SHARED_SALT` + the attendee CSV are the artifacts a NEW server
operator must receive out-of-band (plus an endorsement, see below). The salt
pseudonymizes emails in OrbitDB; never publish it.

`EDGECLOUD_PUBLIC_MULTIADDRS` is appended after first boot (needs the peerId):

```bash
echo "EDGECLOUD_PUBLIC_MULTIADDRS=/ip4/146.190.123.91/tcp/4002/ws/p2p/<PEER_ID>,/ip4/146.190.123.91/tcp/4001/p2p/<PEER_ID>" >> /etc/edgecloud/env
```

## 6. Deploy code (from the dev machine)

```bash
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude server-data --exclude worker-data \
  ./ ubuntu@146.190.123.91:/opt/edgecloud/
ssh ubuntu@146.190.123.91 'cd /opt/edgecloud && npm ci --omit=dev'
```

(`/opt/edgecloud` must exist and be owned by ubuntu: `install -d -o ubuntu -g ubuntu /opt/edgecloud` as root, once.)

## 7. systemd service

```bash
sudo cp /opt/edgecloud/infra/edgecloud.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edgecloud
journalctl -u edgecloud -n 30   # note the peerId and server pubkey
```

## 8. Import the attendee CSV (scp it to the server first; it is NOT in git)

```bash
sudo -u ubuntu env $(sudo cat /etc/edgecloud/env | xargs) \
  npm run import-allowlist --prefix /opt/edgecloud/server -- /home/ubuntu/attendees.csv
```

## 9. Genesis key capture (once, after first boot)

First boot prints `server pubkey: <base64>` and `libp2p peerId: <id>`.
1. Put the pubkey into `shared/src/constants.js` `GENESIS_SERVER_KEY` fallback.
2. Put `/ip4/146.190.123.91/tcp/4002/ws/p2p/<peerId>` (and the tcp/4001 one)
   into `GENESIS_MULTIADDRS`.
3. Append `EDGECLOUD_PUBLIC_MULTIADDRS=...` to `/etc/edgecloud/env` (step 5).
4. Redeploy (step 6) + `sudo systemctl restart edgecloud`; rebuild/publish the
   worker image so workers carry the right defaults.

## 10. Worker container on the same VPS (or anywhere)

The worker talks to the server ONLY via libp2p on the public multiaddr — no
localhost shortcut, no shared volume; moving it to another machine later is
just running the same container elsewhere.

```bash
cd /opt/edgecloud
sudo docker build -t edgecloud-worker -f worker/Dockerfile .
sudo docker run -d --name edgecloud-worker --restart unless-stopped \
  --cap-add NET_ADMIN \
  --memory 400m \
  -v edgecloud_worker_data:/data \
  edgecloud-worker
sudo docker logs -f edgecloud-worker   # expect: connected to rendezvous …
```

(Defaults baked into shared/constants.js point at the genesis server; override
with `-e RENDEZVOUS_MULTIADDR=... -e EDGECLOUD_HTTP_FALLBACK=...` if needed.)

## Onboarding ANOTHER central server

On the new box: run this same runbook (same CSV, same `EDGECLOUD_SHARED_SALT`).
First boot prints its `server pubkey` — it is untrusted until endorsed.
On any EXISTING trusted server:

```bash
cd /opt/edgecloud/server
HTTP_PORT=80 npm run endorse-server -- "<newServerPubkeyB64>" "/ip4/<newIp>/tcp/4002/ws/p2p/<newPeerId>" "<label>"
```

The endorsement replicates via OrbitDB; workers start trusting the new
server's registrations automatically. No config changes, no restarts.
