// device-registry.js
//
// A decentralized device registry built on OrbitDB (@orbitdb/core).
// Each device writes ONE document, keyed by its own peer id, describing its
// hardware (storage, RAM, CPU), a measured network latency, and its live
// scheduling state (status + capacity). Because the underlying store is a CRDT,
// two devices registering at the same time both land in the registry — neither
// write is silently lost.
//
// Aligned to docs/architecture.md (ratified 2026-06-03):
//   D-A device schema = nested host record + status/maxConcurrent/
//       currentLoad/availableCapacity.
//   D-B discovery     = DNS-addressed bootstrap coordinator/relay + mDNS, no DHT.
//   D-C convergence   = DETERMINISTIC, well-known OrbitDB address. Every node opens
//       the same name + type + access controller, so the /orbitdb/... address is
//       identical everywhere — no out-of-band address sharing.
//   D-D timing        = 5s heartbeat / 15s stale-offline threshold.
//   D-E identity      = libp2p Ed25519 keypair PERSISTED under EDGECLOUD_DATA_DIR;
//       stable PeerId across restarts.
//   D-F signing       = device documents are signed; readers verify before scoring
//       (§6 error contract). NOTE: the canonicalize+sign helpers below are a
//       provisional local copy of the shared auth contract — they MUST be replaced
//       by auth/ `sign`/`verify` + `canonicalJSON` once that module lands, keeping
//       the exact §6 canonicalization so signatures interoperate.
//   D-G config        = EDGECLOUD_-prefixed environment variables.
//   D-H runtime       = Node.js 20 LTS.
//
// ---------------------------------------------------------------------------
// SETUP
//   npm init -y      # ensure  "type": "module"  in package.json
//   npm i helia @orbitdb/core blockstore-level libp2p \
//         @chainsafe/libp2p-gossipsub @chainsafe/libp2p-noise \
//         @chainsafe/libp2p-yamux @libp2p/tcp @libp2p/mdns \
//         @libp2p/bootstrap @libp2p/identify
//
// RUN — any device (all nodes are equal; the registry address is deterministic):
//   EDGECLOUD_BOOTSTRAP=/dnsaddr/registry.example node device_registry/index.js
//
//   The first node to come up creates the registry; every other node opening the
//   same name + access controller derives the SAME address and converges. No
//   copy/paste of an /orbitdb/... address is needed. EDGECLOUD_REGISTRY can pin an
//   explicit address for testing.
//
// Requires Node 20 (uses fs.promises.statfs).
// ---------------------------------------------------------------------------

import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs/promises'

import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { LevelBlockstore } from 'blockstore-level'
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core'
import {
  generateKeyPair,
  privateKeyFromProtobuf,
  privateKeyToProtobuf
} from '@libp2p/crypto/keys'

import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'

// --- config (EDGECLOUD_-prefixed, D-G) --------------------------------------
// Bootstrap peers, addressed by DNS (D-B). Two supported forms:
//  (a) /dnsaddr/<host>  — RECOMMENDED. libp2p resolves the TXT record at
//      _dnsaddr.<host> into one or more full multiaddrs (each including a peer
//      id). List several there for redundancy; devices never hardcode a peer id.
//  (b) /dns4/<host>/tcp/<port>/p2p/<peerId> — explicit; needs the stable peer id.
const BOOTSTRAP_ADDRS = (process.env.EDGECLOUD_BOOTSTRAP || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (BOOTSTRAP_ADDRS.length === 0) {
  BOOTSTRAP_ADDRS.push('/dnsaddr/registry.example') // <-- edit me
}

// Deterministic registry: all nodes open this name with the same access
// controller, so the address is identical network-wide (D-C). EDGECLOUD_REGISTRY
// overrides with an explicit /orbitdb/... address (testing only).
const DB_NAME = 'device-registry'
const REGISTRY_OVERRIDE = process.env.EDGECLOUD_REGISTRY || null

// Persisted identity + datastore live under one data dir (D-E).
const DATA_DIR = process.env.EDGECLOUD_DATA_DIR || './.edgecloud'
const KEY_PATH = path.join(DATA_DIR, 'identity.key')
const BLOCKS_PATH = path.join(DATA_DIR, 'ipfs-blocks')

// Max simultaneous jobs this node will accept (seeds availableCapacity).
const MAX_CONCURRENT = Number(process.env.EDGECLOUD_MAX_CONCURRENT) || 4

// Latency anchor — a DNS hostname we TCP-probe for a coarse connectivity RTT.
const ANCHOR_HOST = process.env.EDGECLOUD_ANCHOR_HOST || 'registry.example'
const ANCHOR_PORT = Number(process.env.EDGECLOUD_ANCHOR_PORT) || 443

// Timing (D-D).
const HEARTBEAT_INTERVAL_MS = 5_000
const OFFLINE_THRESHOLD_MS = 15_000

// --- libp2p config -----------------------------------------------------------
// bootstrap() seeds the peerstore with the DNS-addressed coordinator(s); libp2p
// resolves the /dnsaddr or /dns4 part automatically. gossipsub is what OrbitDB
// uses to sync the database. mdns is kept for same-LAN direct discovery.
const libp2pOptions = {
  addresses: { listen: [process.env.EDGECLOUD_LISTEN || '/ip4/0.0.0.0/tcp/0'] },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  peerDiscovery: [
    bootstrap({ list: BOOTSTRAP_ADDRS }),
    mdns()
  ],
  services: {
    identify: identify(),
    pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
  }
}

// --- identity persistence (D-E) ----------------------------------------------
// Load the Ed25519 private key from disk so this node keeps the SAME PeerId
// across restarts; generate + persist it on first boot. The PeerId is derived
// from this key, and the same key signs device documents (D-F).
async function loadOrCreateIdentity (dataDir) {
  try {
    return privateKeyFromProtobuf(await fs.readFile(KEY_PATH))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    const privateKey = await generateKeyPair('Ed25519')
    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(KEY_PATH, privateKeyToProtobuf(privateKey), { mode: 0o600 })
    return privateKey
  }
}

// --- signing (D-F, PROVISIONAL — move to auth/ when it lands) -----------------
// canonicalJSON MUST match docs/architecture.md §6: JSON with keys sorted
// lexicographically (recursively) and no extra whitespace, excluding `signature`.
function sortKeys (value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, k) => {
      acc[k] = sortKeys(value[k])
      return acc
    }, {})
  }
  return value
}

function canonicalJSON (obj) {
  return JSON.stringify(sortKeys(obj))
}

// Sign the record's canonical form (without any `signature` field) with this
// node's persisted key. Readers verify with verify(payload, signature, _id).
async function signRecord (privateKey, record) {
  const { signature: _drop, ...unsigned } = record
  const bytes = new TextEncoder().encode(canonicalJSON(unsigned))
  const sig = await privateKey.sign(bytes)
  return { ...unsigned, signature: Buffer.from(sig).toString('base64') }
}

// --- live scheduling state ---------------------------------------------------
// Capacity/status are owned by THIS node at runtime. The Job Execution module
// mutates `live` on job accept/complete/fail (contract #4); the heartbeat only
// publishes it. Keeping a single in-memory owner avoids the heartbeat clobbering
// Execution's writes (single-writer-per-_id, architecture §15 A-3).
const live = {
  status: 'available',          // "available" | "draining" | "offline"
  currentLoad: 0,               // edgeCloud jobs running now
  availableCapacity: MAX_CONCURRENT
}

// --- metadata collectors -----------------------------------------------------

// Disk space for the volume that holds `path`. statfs returns block counts;
// multiply by block size to get bytes. bavail = blocks free to non-root users.
async function getStorage (p = '.') {
  try {
    const s = await fs.statfs(p)
    return {
      totalBytes: s.blocks * s.bsize,
      freeBytes: s.bavail * s.bsize
    }
  } catch {
    return { totalBytes: null, freeBytes: null } // not all platforms support statfs
  }
}

function getRam () {
  return {
    totalBytes: os.totalmem(),
    freeBytes: os.freemem()
  }
}

function getCpu () {
  const cpus = os.cpus() || []
  return {
    model: cpus[0]?.model?.trim() ?? 'unknown',
    cores: cpus.length,
    arch: os.arch(),
    platform: os.platform(),
    // "how busy is the host" — secondary signal; the scheduler's load term uses
    // currentLoad/availableCapacity. On Windows this is [0,0,0].
    load1m: os.loadavg()[0]
  }
}

// Measure round-trip latency as the time to open a TCP connection to an anchor
// host:port (resolved via DNS), averaged over a few samples. In a real mesh
// you'd also use libp2p's ping protocol against actual peers — latency there is
// PER-PEER, not one global number. This anchor RTT is a coarse "how well am I
// connected" snapshot, good enough for registration.
async function measureLatencyMs (host, port, samples = 3, timeoutMs = 1000) {
  const times = []
  for (let i = 0; i < samples; i++) {
    const t = await oneTcpRtt(host, port, timeoutMs)
    if (t !== null) times.push(t)
  }
  if (times.length === 0) return null // unreachable
  return Math.round(times.reduce((a, b) => a + b, 0) / times.length)
}

function oneTcpRtt (host, port, timeoutMs) {
  return new Promise((resolve) => {
    const start = performance.now()
    const sock = net.connect({ host, port }) // host may be a DNS name
    const done = (val) => { sock.destroy(); resolve(val) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(performance.now() - start))
    sock.once('timeout', () => done(null))
    sock.once('error', () => done(null))
  })
}

// Assemble the full record this device will publish (schema: architecture §7.1).
async function buildDeviceRecord (deviceId) {
  const storage = await getStorage('.')
  const latencyMs = await measureLatencyMs(ANCHOR_HOST, ANCHOR_PORT)
  return {
    _id: deviceId,                          // documents DB is keyed by _id (== peerId)
    hostname: os.hostname(),
    storage,                                // { totalBytes, freeBytes }
    ram: getRam(),                          // { totalBytes, freeBytes }
    cpu: getCpu(),                          // { model, cores, arch, platform, load1m }
    latencyMs,                              // number | null
    status: live.status,                    // live, Execution-owned
    maxConcurrent: MAX_CONCURRENT,
    currentLoad: live.currentLoad,          // live, Execution-owned
    availableCapacity: live.availableCapacity, // live, Execution-owned
    pricePerJobUsd: null,                   // reserved (cheapest-node, later)
    lastSeen: Date.now()                    // heartbeat timestamp -> liveness
  }
}

// --- pretty printing ---------------------------------------------------------
const gb = (b) => (b == null ? 'n/a' : (b / 1e9).toFixed(1) + ' GB')

async function printRoster (db, staleMs = OFFLINE_THRESHOLD_MS) {
  // db.all() returns [{ key, value, hash }] for a documents store.
  const records = await db.all()
  const now = Date.now()
  console.log(`\n--- device registry (${records.length} devices) ---`)
  for (const { value: d } of records) {
    const age = now - (d.lastSeen ?? 0)
    const state = age > staleMs ? 'STALE' : (d.status ?? 'live')
    console.log(
      `[${state}] ${d._id.slice(0, 12)}…  ${d.hostname}  ` +
      `RAM ${gb(d.ram?.freeBytes)}/${gb(d.ram?.totalBytes)}  ` +
      `disk ${gb(d.storage?.freeBytes)} free  ` +
      `${d.cpu?.cores}c ${d.cpu?.arch}  ` +
      `cap ${d.availableCapacity ?? '?'}/${d.maxConcurrent ?? '?'}  ` +
      `lat ${d.latencyMs ?? 'n/a'}ms`
    )
  }
  console.log('-------------------------------------------\n')
}

// --- main --------------------------------------------------------------------
async function main () {
  const privateKey = await loadOrCreateIdentity(DATA_DIR)

  const blockstore = new LevelBlockstore(BLOCKS_PATH)
  const libp2p = await createLibp2p({ ...libp2pOptions, privateKey })
  const ipfs = await createHelia({ libp2p, blockstore })
  const orbitdb = await createOrbitDB({ ipfs })

  // The libp2p peerId is a stable device identity (persisted key, D-E).
  const deviceId = libp2p.peerId.toString()
  console.log('this device id:', deviceId)
  console.log('bootstrap (DNS):', BOOTSTRAP_ADDRS.join(', '))

  // Log discovery/connection events so you can see DNS bootstrap working.
  libp2p.addEventListener('peer:discovery', (e) =>
    console.log('[discovery]', e.detail.id.toString().slice(0, 12) + '…'))

  // Deterministic registry (D-C): same name + type + access controller on every
  // node => same /orbitdb/... address => automatic convergence. write: ['*']
  // makes the access-controller manifest identical network-wide (signing, D-F,
  // is the real integrity layer — anyone may append, readers verify).
  const db = REGISTRY_OVERRIDE
    ? await orbitdb.open(REGISTRY_OVERRIDE)
    : await orbitdb.open(DB_NAME, {
      type: 'documents',
      AccessController: IPFSAccessController({ write: ['*'] })
    })

  console.log('registry address:', db.address)

  // React when ANY peer adds/updates a device (including ourselves).
  db.events.on('update', async (entry) => {
    const op = entry?.payload?.op
    const key = entry?.payload?.key
    console.log(`[sync] ${op} ${String(key).slice(0, 12)}…`)
    await printRoster(db)
  })

  // Register now, then heartbeat: refreshes dynamic host fields (free RAM,
  // latency) and bumps lastSeen for liveness, while preserving live capacity/
  // status owned by Execution. A re-put of the same _id REPLACES that device's
  // document — the mutable "current state" for that key. The record is signed
  // (D-F) so readers can verify it came from this peer before scoring.
  async function registerOrRefresh () {
    const record = await buildDeviceRecord(deviceId)
    await db.put(await signRecord(privateKey, record))
  }

  await registerOrRefresh()
  await printRoster(db)
  const heartbeat = setInterval(registerOrRefresh, HEARTBEAT_INTERVAL_MS)

  const shutdown = async () => {
    clearInterval(heartbeat)
    await db.close()
    await orbitdb.stop()
    await ipfs.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log('\nrunning — Ctrl+C to stop.')
  console.log('other devices join automatically with the same EDGECLOUD_BOOTSTRAP;')
  console.log('the registry address is deterministic, so nothing needs copying.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
