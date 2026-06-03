# edgeCloud worker node.
#
# Build from the REPO ROOT (the context must include shared/):
#   docker build -t edgecloud-worker -f worker/Dockerfile .
#
# Debian sid base per project preference. Node is deliberately NOT installed
# from sid's repos (its nodejs tracks unpredictably) — the pinned Node 22
# binary is copied from the official image instead. wasmtime is a pinned
# static binary.

FROM debian:sid-slim

# Pinned Node 22 from the official image (binary + npm).
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      xz-utils \
      iptables \
      tini \
      util-linux \
 && rm -rf /var/lib/apt/lists/*

# wasmtime CLI, pinned. Bump against https://github.com/bytecodealliance/wasmtime/releases
ARG WASMTIME_VERSION=v45.0.0
RUN curl -fsSL "https://github.com/bytecodealliance/wasmtime/releases/download/${WASMTIME_VERSION}/wasmtime-${WASMTIME_VERSION}-x86_64-linux.tar.xz" \
      | tar -xJ -C /tmp \
 && mv /tmp/wasmtime-${WASMTIME_VERSION}-x86_64-linux/wasmtime /usr/local/bin/wasmtime \
 && rm -rf /tmp/wasmtime-* \
 && wasmtime --version

# Non-root user for the worker process (entrypoint drops privileges after
# installing the firewall rules).
RUN useradd --create-home --uid 10001 worker

WORKDIR /app

# Workspace install: copy manifests first for layer caching. server/ is a
# workspace too, so its manifest must exist for npm, but its deps are skipped.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY worker/package.json worker/package.json
RUN npm ci --omit=dev --workspace @edgecloud/shared --workspace @edgecloud/worker

COPY shared/src shared/src
COPY worker/src worker/src
COPY worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data && chown -R worker:worker /data /app

# /data holds the libp2p peerId, OrbitDB identity, and replicated blocks —
# mount a volume so the worker keeps its identity across restarts.
VOLUME /data
ENV EDGECLOUD_DATA=/data

ENTRYPOINT ["tini", "--", "/entrypoint.sh"]
CMD ["node", "worker/src/index.js"]
