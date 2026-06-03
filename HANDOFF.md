# Node.js + IPFS (Kubo) Container — Handoff

A handoff document for Claude Code. Goal: a Debian sid container image that runs
a Node.js application alongside a Kubo (go-ipfs) node, with room to add more
long-running processes later. This repo contains a working single-image build
plus a decoupled `docker-compose` alternative, and documents the tradeoffs so
the right topology can be chosen deliberately.

## What's in here

| File | Purpose |
|------|---------|
| `Dockerfile` | Primary build. Single-image appliance: Node + Kubo under `supervisord`, `tini` as PID 1. |
| `supervisord.conf` | Process definitions for the two daemons; logs to stdout/stderr. |
| `Dockerfile.multistage` | Node-only multi-stage build for apps with a compile/bundle step; non-root runtime. Used by the compose `app` service. |
| `docker-compose.yml` | Decoupled topology: `app` and `ipfs` as independent services. |
| `.dockerignore` | Keeps build context lean; explicitly excludes local IPFS repo/keys and `.env`. |

## Quick start

Single-image appliance:

```bash
docker build -t node-ipfs:dev .
docker run --rm -p 3000:3000 -p 4001:4001 -p 8080:8080 \
  -v ipfs_data:/data/ipfs node-ipfs:dev
```

Decoupled (recommended for anything non-trivial):

```bash
docker compose up --build
```

Note that the `CMD`/`EXPOSE`/entrypoint assume the app's entry is `index.js`
listening on `3000`, and (for the multistage build) `npm run build` emitting to
`dist/`. Adjust to match the actual app.

## Design decisions and rationale

**Base image — Debian sid.** Chosen per the existing preference. Caveat worth
keeping front of mind: sid is *unstable*, and its `nodejs`/`npm` packages track
unpredictably (can be ahead of or behind a given LTS). If a specific Node major
is required, do not rely on the sid package — either install from NodeSource or
copy the `node` binary from an official `node:<ver>-bookworm` image. The current
build takes whatever sid ships; pin deliberately if reproducibility matters.

**Kubo install — copy the static binary from `ipfs/kubo`, version-pinned.** Kubo
is a single static Go binary, so `COPY --from=ipfs/kubo:vX.Y.Z` is cleaner and
more reproducible than downloading a tarball at build time. The tag is pinned
(currently `v0.40.0`) — **verify and bump against the upstream releases page**;
the pin in this repo is illustrative and should be confirmed before any real
deploy.

**Multiple processes — supervisord + tini, not `&`.** A container has one PID 1.
Backgrounding `ipfs daemon &` inside a shell entrypoint leaves signals and
zombie reaping broken and gives no restart semantics. `tini` is PID 1 (signals,
reaping); `supervisord` owns the two daemons and restarts them on crash. This is
the single-image path.

**The real fork in the road — single image vs. compose.** The single-image
appliance is appropriate when this ships and scales as one indivisible unit.
But IPFS and the app have genuinely independent lifecycles: they crash, scale,
and get upgraded independently, and bundling them couples all of that. The
moment "potentially other things" become real services, the textbook answer is
separate containers under compose (or whatever orchestrator), which
`docker-compose.yml` sets up. Decide based on whether these processes should
share a fate. This is the main open architectural question (see below).

## Security notes (important)

- **The IPFS API on `5001` is root-equivalent and unauthenticated.** Anything
  that can reach it can read/write the repo, swap config, and read keys. It must
  never be published to the host or the internet. In the single-image build it
  stays on `127.0.0.1` inside the container; in compose it's reachable only on
  the internal network as `http://ipfs:5001` and is deliberately not in `ports`.
  Keep it that way.
- **Gateway (`8080`)** is only exposed if you actually intend to serve content
  publicly. Otherwise drop it.
- **Swarm (`4001`, TCP+UDP/QUIC)** is the p2p port and is safe (and necessary)
  to expose for connectivity.
- **The `server` profile** (set via `ipfs init --profile=server` / `IPFS_PROFILE`)
  disables local-network peer discovery — correct for a VPS/datacenter, wrong if
  LAN peers are wanted. Flip it if the deployment target is a local network.
- **Persistence/keys.** `/data/ipfs` holds the repo, config, and the node's
  private key / PeerID. It must be a volume so identity is stable across
  rebuilds, and the repo must never be baked into an image or committed (hence
  the `.dockerignore` entries).
- **Non-root.** The multistage runtime drops to a non-root `app` user. The
  single-image build currently runs as root because supervisord + the `/data`
  init are simpler that way; tightening this (dedicated `ipfs` user, drop caps)
  is a reasonable hardening task.

## Alternative: s6-overlay instead of supervisord

s6-overlay is the more common choice for multi-process containers now — lighter
PID 1, faster/cleaner shutdown, and real dependency ordering between services.
If we move off supervisord, the shape is:

```dockerfile
# In the Dockerfile, after installing runtime deps:
ARG S6_OVERLAY_VERSION=3.2.0.2
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-x86_64.tar.xz /tmp/
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-overlay-x86_64.tar.xz
ENTRYPOINT ["/init"]
```

Each service is a longrun under `/etc/s6-overlay/s6-rc.d/`. For `ipfs`:

```
/etc/s6-overlay/s6-rc.d/ipfs/type            -> contents: "longrun"
/etc/s6-overlay/s6-rc.d/ipfs/run             -> #!/command/execlineb -P
                                                 export IPFS_PATH /data/ipfs
                                                 ipfs daemon --migrate=true
/etc/s6-overlay/s6-rc.d/user/contents.d/ipfs -> (empty file, enables the service)
```

…and an equivalent `node` service. Dependency ordering (e.g. app waits on a
readiness check for the API) is expressed via `dependencies.d/`. Left as
supervisord for now because it's fewer moving parts to read; swapping is
low-risk if preferred.

## Open questions / suggested next tasks

1. **Topology decision.** Confirm single-image appliance vs. compose/decoupled,
   given what the "other things" will be. Everything else depends on this.
2. **Pin Node deliberately.** Decide the target Node major and pin it (NodeSource
   or copy from `node:<ver>`), rather than inheriting sid's package.
3. **Verify the Kubo version pin** against upstream and bump.
4. **Wire the app to IPFS.** Decide the client path (HTTP API via
   `kubo-rpc-client`, or embedding) and the API URL injection (`IPFS_API_URL`
   is already plumbed in compose).
5. **Healthchecks.** Add a `HEALTHCHECK` (app `/health`; IPFS `ipfs id` or an
   API ping) and, in compose, gate `depends_on` on readiness.
6. **Harden the single-image build** if it's the chosen path: dedicated `ipfs`
   user, dropped capabilities, read-only rootfs where feasible.
7. **Decide on s6-overlay vs. supervisord** (see above) if shutdown latency or
   inter-service ordering matters.
8. **Pin the base** to a sid snapshot or digest if reproducible builds are
   required (sid moves daily).
