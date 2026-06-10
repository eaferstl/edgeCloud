// Shared constants for the edgeCloud network.
//
// DB addresses are NOT baked here: with IPFSAccessController({ write: ['*'] })
// the OrbitDB manifest (name + type + AC) is identical for every peer, so every
// peer that opens a DB by name with the same options computes the same
// /orbitdb/... address with zero coordination. See orbit.js.

// OrbitDB database names. Bump the -v1 suffix to hard-fork the network.
export const DB_REGISTRY = 'edgecloud-registry-v1'; // events: server-attested user pubkeys (NO raw emails, ever)
export const DB_JOBS = 'edgecloud-jobs-v1';         // events: signed job envelopes
export const DB_CLAIMS = 'edgecloud-claims-v1';     // events: worker claims (jobId, peerId, round)
export const DB_RESULTS = 'edgecloud-results-v1';   // documents indexBy jobId: result envelopes
export const DB_SERVERS = 'edgecloud-servers-v1';   // events: server-onboarding endorsements

// Gossipsub topics.
export const TOPIC_HEARTBEAT = 'edgecloud/heartbeat/v1'; // worker presence (UI only, not correctness)

// Genesis server public key (base64 Ed25519). This is the root of the
// server trust chain: the key first generated 2026-06-03 on the original
// rendezvous box (146.190.123.91), then migrated 2026-06-10 to the
// owner-operated node at seed.pandocloud.io. The KEY is unchanged across the
// move, so every existing registration stays valid. EDGECLOUD_GENESIS_KEY
// overrides it (used by local dev/test).
export const GENESIS_SERVER_KEY =
  process.env.EDGECLOUD_GENESIS_KEY || '7HHBxNv04kl9VhOynWxWuchSKgE4v5j/1H/k6r7oSHk=';

// Public multiaddrs of the genesis rendezvous server. Workers bootstrap here.
// Addressed by /dns4 (a domain, not a bare IP) so the host can move with only a
// DNS change — no code edit or worker rebuild. (Additional trusted servers are
// RECORDED in the edgecloud-servers DB and used for trust, but workers currently
// dial only RENDEZVOUS_MULTIADDR / these defaults — multiaddr-based discovery of
// those extra servers is not yet wired up.) RENDEZVOUS_MULTIADDR (comma-separated)
// overrides.
export const GENESIS_MULTIADDRS = (process.env.RENDEZVOUS_MULTIADDR
  ? process.env.RENDEZVOUS_MULTIADDR.split(',')
  : [
      '/dns4/seed.pandocloud.io/tcp/4002/ws/p2p/12D3KooWH1ntgWwvMLg6ft6dH49akyjDrNg35QqHdRFnPUK3wnX1',
      '/dns4/seed.pandocloud.io/tcp/4001/p2p/12D3KooWH1ntgWwvMLg6ft6dH49akyjDrNg35QqHdRFnPUK3wnX1',
    ]).filter(Boolean);

// Claim-protocol timing (ms).
export const CLAIM_SETTLE_MS = 3000;        // wait after claiming before computing the winner
export const RESULT_MARGIN_MS = 15000;      // extra wait for the winner's result before re-claiming
export const MAX_CLAIM_ROUNDS = 5;          // give up after this many takeover rounds

// Registry re-sync grace: how long a worker waits for the registry to catch up
// before rejecting a job from an unknown pubkey.
export const REGISTRY_GRACE_MS = 8000;
export const REGISTRY_GRACE_POLL_MS = 500;

// Job limits.
export const MAX_JOB_TIMEOUT_MS = 60000;    // hard cap regardless of manifest.timeoutMs
export const DEFAULT_JOB_TIMEOUT_MS = 10000;
export const MAX_ZIP_B64_BYTES = 4 * 1024 * 1024;  // 4 MiB of base64 payload
export const MAX_OUTPUT_BYTES = 256 * 1024;        // stdout/stderr capture cap

// Registration limits.
export const MAX_KEYS_PER_EMAIL = 4; // browser/user identity keys per attendee email
// Worker nodes per attendee email. Higher than the user-key cap (one person may
// legitimately run several machines), but still bounded for Sybil / work-
// stealing resistance: an attacker is limited to 25 worker identities per
// allowlisted email rather than the unbounded supply of free keypairs that the
// original anonymous-worker design allowed (THREAT_MODEL.md R-010).
export const MAX_WORKERS_PER_EMAIL = 25;

// Auth.
export const CHALLENGE_TTL_MS = 120000;     // signed-nonce challenges expire after 2 min
export const SESSION_TTL_MS = 30 * 60000;   // session tokens last 30 min

// Heartbeat presence.
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_EVICT_MS = 15000;

// Fixed mtime for deterministic zips. Must be >= 1980 (DOS time floor) and
// identical in browser and Node so the same inputs give byte-identical zips.
export const ZIP_FIXED_MTIME_MS = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z
