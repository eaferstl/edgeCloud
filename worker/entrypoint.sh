#!/bin/sh
# edgeCloud worker entrypoint.
#
# 1. Installs egress firewall rules so code submitted to this worker cannot
#    reach private networks (the host LAN, cloud metadata services, etc.).
#    Requires NET_ADMIN (docker compose sets cap_add: [NET_ADMIN]).
# 2. Drops privileges and starts the worker as the non-root `worker` user.
#
# RULE ORDER MATTERS: loopback, established-connections, and container-DNS
# accepts must precede the private-range rejects.
set -e

if [ "${EDGECLOUD_SKIP_FIREWALL:-0}" = "1" ]; then
  echo "[firewall] EDGECLOUD_SKIP_FIREWALL=1 — egress restrictions DISABLED (local testing only)"
else
  # Loopback inside the container's own netns is fine (and required).
  iptables -A OUTPUT -o lo -j ACCEPT
  # Return traffic for connections the worker itself opened (e.g. the libp2p
  # session to the rendezvous) must keep flowing.
  iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  # Docker's embedded DNS lives at 127.0.0.11 (covered by lo above, but be
  # explicit in case of custom network configs).
  iptables -A OUTPUT -p udp --dport 53 -d 127.0.0.11 -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -d 127.0.0.11 -j ACCEPT
  # Allow port 53 to the container's actual resolvers even when they sit on a
  # private network (home routers, podman/pasta). This is a deliberately
  # narrow exception — DNS only, to designated resolvers; documented residual
  # risk: DNS-based exfiltration to a LAN resolver.
  for ns in $(awk '/^nameserver/ {print $2}' /etc/resolv.conf); do
    case "$ns" in
      *:*) ;; # IPv6 resolvers are unreachable anyway (v6 egress dropped)
      *)
        iptables -A OUTPUT -p udp --dport 53 -d "$ns" -j ACCEPT
        iptables -A OUTPUT -p tcp --dport 53 -d "$ns" -j ACCEPT
        ;;
    esac
  done

  # Optional extra accepts for local testing (comma-separated CIDRs), applied
  # BEFORE the private-range blocks, e.g. a rendezvous on a LAN IP.
  if [ -n "${EDGECLOUD_FIREWALL_ALLOW:-}" ]; then
    for cidr in $(echo "$EDGECLOUD_FIREWALL_ALLOW" | tr ',' ' '); do
      echo "[firewall] extra allow: $cidr"
      iptables -A OUTPUT -d "$cidr" -j ACCEPT
    done
  fi

  # Block NEW connections to private/special ranges: RFC1918, link-local
  # (incl. cloud metadata 169.254.169.254), CGNAT, loopback net, benchmarks,
  # multicast, reserved.
  for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 \
             100.64.0.0/10 127.0.0.0/8 0.0.0.0/8 192.0.0.0/24 \
             198.18.0.0/15 224.0.0.0/4 240.0.0.0/4; do
    iptables -A OUTPUT -d "$net" -j REJECT --reject-with icmp-net-unreachable
  done

  # No IPv6 egress at all (simpler than enumerating ULA/link-local; the
  # rendezvous is dialed over IPv4).
  if command -v ip6tables >/dev/null 2>&1; then
    ip6tables -A OUTPUT -o lo -j ACCEPT 2>/dev/null || true
    ip6tables -P OUTPUT DROP 2>/dev/null || true
  fi
  echo "[firewall] private-IP egress blocking active"
fi

# Make sure the data volume is writable by the worker user, then drop root.
chown -R worker:worker /data 2>/dev/null || true
exec setpriv --reuid worker --regid worker --init-groups env HOME=/home/worker "$@"
