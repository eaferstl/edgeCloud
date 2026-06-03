// device-registry.js
//
// A decentralized device registry built on OrbitDB (@orbitdb/core).
// Each device writes ONE document, keyed by its own ID, describing its
// hardware (storage, RAM, CPU) and a measured network latency. Because the
// underlying store is a CRDT, two devices registering at the same time both
// land in the registry — neither write is silently lost.
//
// DISCOVERY (this version assumes DNS is available):
// Peers find each other via a known coordinator/relay node addressed by a DNS
// name, not just mDNS. This lifts mDNS's single-LAN limitation — devices on
// separate networks (multiple sites, or a site reaching a relay over an
// uplink) can all converge on the same registry. The DNS name also stays
// valid if the coordinator's IP changes (DHCP, failover). mDNS is kept as a
// cheap complement so peers on the same LAN still find each other directly.
//
// ---------------------------------------------------------------------------
// SETUP
//   npm init -y
//   # add  "type": "module"  to package.json
//   npm i helia @orbitdb/core blockstore-level libp2p \
//         @chainsafe/libp2p-gossipsub @chainsafe/libp2p-noise \
//         @chainsafe/libp2p-yamux @libp2p/tcp @libp2p/mdns \
//         @libp2p/bootstrap @libp2p/identify
//
// RUN — coordinator (first node; creates the registry, prints its address):
//   node device-registry.js
//   -> copy the printed /orbitdb/... address into REGISTRY_ADDRESS below
//      (or pass it via the REGISTRY_ADDRESS env var) for all other nodes.
//
// RUN — any other device (joins the known registry over DNS):
//   REGISTRY_ADDRESS=/orbitdb/zdpu... node device-registry.js
//
// Requires Node 18.15+ (uses fs.promises.statfs for disk stats).
// ---------------------------------------------------------------------------

import os from 'node:os'
import net from 'node:net'
import fs from 'node:fs/promises'

import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { LevelBlockstore } from 'blockstore-level'
import { createOrbitDB } from '@orbitdb/core'

import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'

// --- DNS-based config --------------------------------------------------------
// One or more bootstrap peers, addressed by DNS. Two supported forms:
//
//  (a) /dnsaddr/<host>  — RECOMMENDED. libp2p resolves the TXT record at
//      _dnsaddr.<host> into one or more full multiaddrs (each including the
//      peer id). You can list several peers there for redundancy, and devices
//      never hardcode a peer id. Example TXT record value:
//        dnsaddr=/dns4/registry.relief.example/tcp/4001/p2p/12D3KooW...
//
//  (b) /dns4/<host>/tcp/<port>/p2p/<peerId> — explicit; no TXT record needed,
//      but you must know the coordinator's stable peer id.
//
const BOOTSTRAP_ADDRS = (process.env.BOOTSTRAP_ADDRS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
if (BOOTSTRAP_ADDRS.length === 0) {
  BOOTSTRAP_ADDRS.push('/dnsaddr/registry.relief.example') // <-- edit me
}

// The registry's OrbitDB address. The coordinator creates it on first run and
// prints it; put that value here (or in the env) so every other device opens
// the SAME database. With a persisted coordinator identity this stays stable
// across restarts.
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS || null

// Latency anchor — now a DNS hostname rather than a bare IP.
const ANCHOR_HOST = process.env.ANCHOR_HOST || 'registry.relief.example'
const ANCHOR_PORT = Number(process.env.ANCHOR_PORT) || 443

// --- libp2p config -----------------------------------------------------------
// bootstrap() seeds the peerstore with the DNS-addressed coordinator(s); libp2p
// resolves the /dnsaddr or /dns4 part automatically. gossipsub is what OrbitDB
// uses to sync the database. mdns is kept for same-LAN direct discovery.
const libp2pOptions = {
  addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] }, // 0 = OS picks a free port
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

// --- metadata collectors -----------------------------------------------------

// Disk space for the volume that holds `path`. statfs returns block counts;
// multiply by block size to get bytes. bavail = blocks free to non-root users.
async function getStorage (path = '.') {
  try {
    const s = await fs.statfs(path)
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
    // "how busy am I" — useful for routing work to the least-loaded device.
    // On Windows this is [0,0,0].
    load1m: os.loadavg()[0]
  }
}

// Measure round-trip latency as the time to open a TCP connection to an anchor
// host:port (resolved via DNS), averaged over a few samples. In a real mesh
// you'd also use libp2p's ping protocol against actual peers — latency there is
// PER-PEER, not one global number. This anchor RTT is a coarse "how well am I
// connected to the coordinator" snapshot, good enough for registration.
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

// Assemble the full record this device will publish.
async function buildDeviceRecord (deviceId) {
  const storage = await getStorage('.')
  const latencyMs = await measureLatencyMs(ANCHOR_HOST, ANCHOR_PORT)
  return {
    _id: deviceId,            // <-- the documents DB is keyed by _id
    hostname: os.hostname(),
    storage,                  // { totalBytes, freeBytes }
    ram: getRam(),            // { totalBytes, freeBytes }
    cpu: getCpu(),            // { model, cores, arch, platform, load1m }
    latencyMs,                // number | null
    lastSeen: Date.now()      // heartbeat timestamp -> liveness
  }
}

// --- pretty printing ---------------------------------------------------------
const gb = (b) => (b == null ? 'n/a' : (b / 1e9).toFixed(1) + ' GB')

async function printRoster (db, staleMs = 30_000) {
  // db.all() returns [{ key, value, hash }] for a documents store.
  const records = await db.all()
  const now = Date.now()
  console.log(`\n--- device registry (${records.length} devices) ---`)
  for (const { value: d } of records) {
    const age = now - (d.lastSeen ?? 0)
    const state = age > staleMs ? 'STALE' : 'live'
    console.log(
      `[${state}] ${d._id.slice(0, 12)}…  ${d.hostname}  ` +
      `RAM ${gb(d.ram?.freeBytes)}/${gb(d.ram?.totalBytes)}  ` +
      `disk ${gb(d.storage?.freeBytes)} free  ` +
      `${d.cpu?.cores}c ${d.cpu?.arch}  ` +
      `lat ${d.latencyMs ?? 'n/a'}ms`
    )
  }
  console.log('-------------------------------------------\n')
}

// --- main --------------------------------------------------------------------
async function main () {
  // Precedence: explicit CLI arg > REGISTRY_ADDRESS config > create new.
  const joinAddress = process.argv[2] || REGISTRY_ADDRESS

  const blockstore = new LevelBlockstore('./ipfs-blocks')
  const libp2p = await createLibp2p(libp2pOptions)
  const ipfs = await createHelia({ libp2p, blockstore })
  const orbitdb = await createOrbitDB({ ipfs })

  // The libp2p peerId is a natural, stable device identity (one per keypair).
  // To keep the SAME id across restarts — REQUIRED for the coordinator, so its
  // /dns4/.../p2p/<peerId> address and the registry address stay stable —
  // persist the peer private key (libp2p keychain/datastore). Regenerated here.
  const deviceId = libp2p.peerId.toString()
  console.log('this device id:', deviceId)
  console.log('bootstrap (DNS):', BOOTSTRAP_ADDRS.join(', '))

  // Log discovery/connection events so you can see DNS bootstrap working.
  libp2p.addEventListener('peer:discovery', (e) =>
    console.log('[discovery]', e.detail.id.toString().slice(0, 12) + '…'))

  // Coordinator path: open by name and CREATE the registry (then share the
  // printed address). Everyone else: open by the known address so all peers
  // read/write the same database.
  const db = joinAddress
    ? await orbitdb.open(joinAddress)
    : await orbitdb.open('device-registry', { type: 'documents' })

  if (!joinAddress) {
    console.log('\n*** CREATED registry. Put this in REGISTRY_ADDRESS for all',
      'other devices: ***')
  }
  console.log('registry address:', db.address)

  // React when ANY peer adds/updates a device (including ourselves).
  db.events.on('update', async (entry) => {
    const op = entry?.payload?.op
    const key = entry?.payload?.key
    console.log(`[sync] ${op} ${String(key).slice(0, 12)}…`)
    await printRoster(db)
  })

  // Register now, then heartbeat: refreshes dynamic fields (free RAM, latency)
  // and bumps lastSeen for liveness. A re-put of the same _id REPLACES that
  // device's document — the mutable "current state" for that key.
  async function registerOrRefresh () {
    await db.put(await buildDeviceRecord(deviceId))
  }

  await registerOrRefresh()
  await printRoster(db)
  const heartbeat = setInterval(registerOrRefresh, 15_000)

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
  console.log('other devices join with:')
  console.log(`  REGISTRY_ADDRESS=${db.address} node device-registry.js\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
