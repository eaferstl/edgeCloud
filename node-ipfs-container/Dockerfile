# syntax=docker/dockerfile:1

# Single-image appliance: Node.js app + Kubo (go-ipfs) under supervisord.
# Base is Debian sid (unstable). See HANDOFF.md for the rationale and the
# decoupled docker-compose alternative.

FROM debian:sid-slim

# Runtime + tooling. supervisor manages the two long-running processes;
# tini is PID 1 for correct signal handling and zombie reaping.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      nodejs \
      npm \
      ca-certificates \
      supervisor \
      tini && \
    rm -rf /var/lib/apt/lists/*

# Kubo ships as a static Go binary; copy it from the official image and pin
# the version. VERIFY/UPDATE this tag against https://github.com/ipfs/kubo/releases
COPY --from=ipfs/kubo:v0.40.0 /usr/local/bin/ipfs /usr/local/bin/ipfs

# IPFS repo location. Mounted as a volume in compose / at run time so the
# repo, keys, and PeerID survive image rebuilds.
ENV IPFS_PATH=/data/ipfs
RUN mkdir -p /data/ipfs && \
    ipfs init --profile=server

WORKDIR /app

# Install deps first for layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

COPY supervisord.conf /etc/supervisor/conf.d/app.conf

# 3000 app | 4001 swarm/p2p | 5001 API (KEEP INTERNAL) | 8080 gateway
EXPOSE 3000 4001 5001 8080

ENTRYPOINT ["tini", "--"]
CMD ["supervisord", "-c", "/etc/supervisor/supervisord.conf"]
