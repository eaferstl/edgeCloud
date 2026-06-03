// device-registry.js
//
// A decentralized device registry built on OrbitDB (@orbitdb/core).
// Each device writes ONE document, keyed by its own ID, describing its
// hardware (storage, RAM, CPU) and a measured network latency. Because the
// underlying store is a CRDT, two devices registering at the same time both
// land in the registry — neither write is silently lost.
//
// Discovery is over mDNS so peers on the same LAN/mesh find each other with
// no bootstrap server. That matches a local-area (e.g. disaster-relief)
// deployment where there may be no reliable internet.
//
// ---------------------------------------------------------------------------
// SETUP
//   npm init -y
//   # tell node this is ESM:  add  "type": "module"  to package.json
//   npm i helia @orbitdb/core blockstore-level libp2p \
//         @chainsafe/libp2p-gossipsub @chainsafe/libp2p-noise \
//         @chainsafe/libp2p-yamux @libp2p/tcp @libp2p/mdns @libp2p/identify
//
// RUN (first peer — creates the registry and prints its address):
//   node device-registry.js
//
// RUN (other peers — join the SAME registry by passing that address):
//   node device-registry.js /orbitdb/zdpu...      <- address printed by peer 1
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
import { identify } from '@libp2p/identify'

// --- libp2p config -----------------------------------------------------------
// TCP transport + Noise encryption + yamux muxing is the standard Node stack.
// gossipsub is what OrbitDB uses to sync the database between peers.
// mdns auto-discovers other peers on the local network — no bootstrap needed.
const libp2pOptions = {
  addresses: { listen: ['/ip4/0.0.0.0/tcp/0'] }, // 0 = OS picks a free port
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  peerDiscovery: [mdns()],
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
    // load average is a useful "how busy am I" signal for scheduling work to
    // the least-loaded device. On Windows this is [0,0,0].
    load1m: os.loadavg()[0]
  }
}

// Measure round-trip latency as the time to open a TCP connection to an anchor
// host:port, averaged over a few samples. In a real mesh you'd instead use
// libp2p's ping protocol against actual peers — latency there is PER-PEER, not
// a single global number. This anchor-based number is a coarse "how well am I
// connected to the coordination point" snapshot, good enough for registration.
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
    const sock = net.connect({ host, port })
    const done = (val) => { sock.destroy(); resolve(val) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(performance.now() - start))
    sock.once('timeout', () => done(null))
    sock.once('error', () => done(null))
  })
}

// Assemble the full record this device will publish.
async function buildDeviceRecord (deviceId) {
  const [storage] = await Promise.all([getStorage('.')])
  const latencyMs = await measureLatencyMs(
    process.env.ANCHOR_HOST || '1.1.1.1', // swap for your local gateway/relay
    Number(process.env.ANCHOR_PORT) || 443
  )
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
  const existingAddress = process.argv[2] // optional: an /orbitdb/... address

  const blockstore = new LevelBlockstore('./ipfs-blocks')
  const libp2p = await createLibp2p(libp2pOptions)
  const ipfs = await createHelia({ libp2p, blockstore })
  const orbitdb = await createOrbitDB({ ipfs })

  // The libp2p peerId is a natural, stable device identity (one per keypair).
  // To keep the SAME id across restarts, persist the peer private key — see
  // libp2p's keychain / datastore docs. Here it's regenerated each run.
  const deviceId = libp2p.peerId.toString()
  console.log('this device id:', deviceId)

  // Open (or join) the shared registry as a "documents" database.
  // Peer 1 opens by name and creates it; other peers open by the address
  // peer 1 printed, so everyone reads/writes the same database.
  const db = await orbitdb.open(existingAddress || 'device-registry', {
    type: 'documents'
  })
  console.log('registry address (share this with other peers):', db.address)

  // React when ANY peer adds/updates a device (including ourselves). The
  // 'update' event fires after the local log integrates a new entry, whether
  // it originated here or arrived via replication from a peer.
  db.events.on('update', async (entry) => {
    const op = entry?.payload?.op
    const key = entry?.payload?.key
    console.log(`[sync] ${op} ${String(key).slice(0, 12)}…`)
    await printRoster(db)
  })

  // Register now, then heartbeat: re-publishing the record on an interval both
  // refreshes the dynamic fields (free RAM, latency) and updates lastSeen so
  // other peers can tell we're still alive. A re-put of the same _id REPLACES
  // the previous document for that key — that's the mutable "current state".
  async function registerOrRefresh () {
    const record = await buildDeviceRecord(deviceId)
    await db.put(record)
  }

  await registerOrRefresh()
  await printRoster(db)
  const heartbeat = setInterval(registerOrRefresh, 15_000)

  // Clean shutdown.
  const shutdown = async () => {
    clearInterval(heartbeat)
    await db.close()
    await orbitdb.stop()
    await ipfs.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log('\nrunning — Ctrl+C to stop. Start another peer with:')
  console.log(`  node device-registry.js ${db.address}\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})