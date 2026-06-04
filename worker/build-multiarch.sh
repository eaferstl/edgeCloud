#!/usr/bin/env bash
#
# Build (and optionally publish) a multi-arch edgeCloud worker image so
# collaborators can `docker pull` a prebuilt image instead of building locally.
#
# WHEN TO USE THIS: local `docker compose up --build` already builds the worker
# NATIVELY on both Intel/x86 (amd64) and Apple Silicon (arm64) — the Dockerfile
# maps BuildKit's TARGETARCH to the right wasmtime binary. This script is ONLY
# for convenience/distribution: build once, push a single multi-arch tag, and
# every collaborator pulls instead of waiting on a local build.
#
# Usage:
#   # Build both arches locally (no push). Just confirms the cross-build works:
#   ./worker/build-multiarch.sh
#
#   # Build and publish a multi-arch image (requires a prior `docker login`):
#   IMAGE=ghcr.io/eaferstl/edgecloud-worker:latest PUSH=1 ./worker/build-multiarch.sh
#
# Env vars:
#   IMAGE     image ref to build/push (default: ghcr.io/eaferstl/edgecloud-worker:latest)
#   PLATFORMS comma-separated platform list (default: linux/amd64,linux/arm64)
#   PUSH      set to 1 to push to the registry; otherwise build-only
#   BUILDER   buildx builder name to create/use (default: edgecloud)
#
# Prerequisites:
#   - Docker with buildx (bundled with Docker Desktop / recent Docker Engine).
#   - QEMU binfmt for cross-arch emulation when your host is single-arch
#     (Docker Desktop ships this; on plain Linux run once:
#       docker run --privileged --rm tonistiigi/binfmt --install all).
#   - For PUSH=1: `docker login <registry>` with push rights to IMAGE.
#
set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/eaferstl/edgecloud-worker:latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-edgecloud}"
PUSH="${PUSH:-0}"

# Build from the REPO ROOT — the Dockerfile needs shared/, server/, worker/ in
# context (same as `docker build -f worker/Dockerfile .`). Resolve it relative
# to this script so the command works from any working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Ensure a buildx builder exists and is bootstrapped (needed for multi-platform).
if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
  echo "==> creating buildx builder '${BUILDER}'"
  docker buildx create --name "${BUILDER}" --use
fi
echo "==> bootstrapping buildx builder '${BUILDER}'"
docker buildx inspect "${BUILDER}" --bootstrap >/dev/null

OUTPUT_ARGS=()
if [ "${PUSH}" = "1" ]; then
  echo "==> building ${IMAGE} for ${PLATFORMS} and PUSHING to the registry"
  echo "    (requires a prior 'docker login' to that registry)"
  OUTPUT_ARGS=(--push)
else
  echo "==> building ${IMAGE} for ${PLATFORMS} (build-only; NOT pushing)"
  echo "    a multi-arch manifest can't be loaded into the local docker image"
  echo "    store, so this only verifies the cross-build + warms the cache."
  echo "    To publish: IMAGE=${IMAGE} PUSH=1 ./worker/build-multiarch.sh"
  echo "    (after 'docker login' to the registry)."
  OUTPUT_ARGS=(--output type=cacheonly)
fi

docker buildx build \
  --builder "${BUILDER}" \
  --platform "${PLATFORMS}" \
  -t "${IMAGE}" \
  -f "${REPO_ROOT}/worker/Dockerfile" \
  "${OUTPUT_ARGS[@]}" \
  "${REPO_ROOT}"

echo "==> done."
if [ "${PUSH}" = "1" ]; then
  echo "    Published ${IMAGE} (${PLATFORMS}). Collaborators can now:"
  echo "      docker pull ${IMAGE}"
fi
