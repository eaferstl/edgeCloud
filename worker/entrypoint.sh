#!/bin/sh
# edgeCloud worker entrypoint (runs as root, confined by docker-compose.yml:
# cap_drop ALL + a 5-cap allow-list, no-new-privileges, read-only rootfs).
#
# Responsibilities, in order:
#   1. Take ownership of /data (root, mode 700). Under cap_drop ALL root has no
#      CAP_DAC_OVERRIDE, so it can only touch files it actually owns — hence the
#      explicit chown (uses CAP_CHOWN). This also guards against a freshly
#      initialized volume having unexpected ownership.
#   2. Install the egress firewall (needs CAP_NET_ADMIN):
#        - block submitted code's whole uid (sandbox, 10002) from ALL network,
#        - block everyone from private/LAN/metadata ranges (defense in depth).
#   3. exec the worker supervisor as root. It drops each individual job to the
#      unprivileged `sandbox` uid (see worker/src/executor/*).
#
# RULE ORDER MATTERS: loopback / established / DNS accepts precede the rejects;
# the per-uid sandbox block is inserted first so nothing can pre-empt it.
set -e

SANDBOX_UID="${EDGECLOUD_SANDBOX_UID:-10002}"

# 1. Own /data so the (DAC_OVERRIDE-less) root worker can read/write it, and so
#    the sandbox uid cannot (mode 700).
chown -R 0:0 /data 2>/dev/null || true
chmod 700 /data 2>/dev/null || true

if [ "${EDGECLOUD_SKIP_FIREWALL:-0}" = "1" ]; then
  echo "[firewall] EDGECLOUD_SKIP_FIREWALL=1 — egress restrictions DISABLED (local testing only)"
else
  # --- submitted code gets NO network at all -------------------------------
  # Every job runs as uid $SANDBOX_UID; drop all of its outbound traffic. The
  # worker (root) keeps full connectivity for libp2p. Pure-compute jobs need no
  # network, so this is the strongest containment with zero legitimate breakage.
  iptables -I OUTPUT 1 -m owner --uid-owner "$SANDBOX_UID" -j REJECT --reject-with icmp-net-prohibited
  echo "[firewall] all egress blocked for sandbox uid $SANDBOX_UID"

  # --- defense in depth: nobody reaches private/LAN/metadata ranges ---------
  # Loopback inside the container's own netns is fine (and required).
  iptables -A OUTPUT -o lo -j ACCEPT
  # Return traffic for connections the worker itself opened (the libp2p session).
  iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  # Docker's embedded DNS at 127.0.0.11 (covered by lo, explicit for safety).
  iptables -A OUTPUT -p udp --dport 53 -d 127.0.0.11 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -d 127.0.0.11 -j ACCEPT
  # Allow DNS to the container's actual resolvers even on a private IP (home
  # routers, podman/pasta). Narrow DNS-only exception; residual risk: DNS-based
  # exfiltration to a LAN resolver — but the sandbox uid is already fully
  # blocked above, so only the (trusted) worker can use this.
  for ns in $(awk '/^nameserver/ {print $2}' /etc/resolv.conf); do
    case "$ns" in
      *:*) ;; # IPv6 resolvers unreachable anyway (v6 egress dropped)
      *)
        iptables -A OUTPUT -p udp --dport 53 -d "$ns" -j ACCEPT
        iptables -A OUTPUT -p tcp --dport 53 -d "$ns" -j ACCEPT
        ;;
    esac
  done

  # Optional extra accepts for local testing (comma-separated CIDRs), applied
  # before the private-range blocks (e.g. a rendezvous on a LAN IP).
  if [ -n "${EDGECLOUD_FIREWALL_ALLOW:-}" ]; then
    for cidr in $(echo "$EDGECLOUD_FIREWALL_ALLOW" | tr ',' ' '); do
      echo "[firewall] extra allow: $cidr"
      iptables -A OUTPUT -d "$cidr" -j ACCEPT
    done
  fi

  # Block NEW connections to private/special ranges: RFC1918, link-local (incl.
  # cloud metadata 169.254.169.254), CGNAT, loopback net, benchmarks, multicast.
  for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 \
             100.64.0.0/10 127.0.0.0/8 0.0.0.0/8 192.0.0.0/24 \
             198.18.0.0/15 224.0.0.0/4 240.0.0.0/4; do
    iptables -A OUTPUT -d "$net" -j REJECT --reject-with icmp-net-unreachable
  done

  # No IPv6 egress at all.
  if command -v ip6tables >/dev/null 2>&1; then
    ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
    ip6tables -P OUTPUT DROP 2>/dev/null || true
  fi
  echo "[firewall] private-IP egress blocking active"
fi

# 3. Run the worker supervisor as root (it sandboxes each job itself).
exec "$@"
