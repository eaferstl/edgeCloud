// Device capability + liveness record published in each worker heartbeat.
//
// The record SCHEMA and the host-metadata collectors here are adapted from
// Chao Lam's (chaodoze) standalone device registry — `device_registry/index.js`
// — and the device schema ratified in eaferstl's "architectural consistency"
// pass (D-A: nested host record + status / maxConcurrent / currentLoad /
// availableCapacity). We carry his design onto our gossipsub presence channel
// instead of an OrbitDB documents DB, because edgeCloud deliberately keeps
// high-churn presence OUT of the CRDT oplog (see ARCHITECTURE.md), and we wire
// currentLoad/availableCapacity to ACTUAL job execution rather than leaving
// them as placeholders.

import os from 'node:os';
import fs from 'node:fs/promises';

// Disk space for the volume holding `p`. statfs gives block counts; bytes =
// blocks * block size. bavail = blocks free to non-root users. (Node 18.15+.)
export async function getStorage(p = '.') {
  try {
    const s = await fs.statfs(p);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return { totalBytes: null, freeBytes: null }; // not all platforms support statfs
  }
}

export function getRam() {
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() };
}

export function getCpu() {
  const cpus = os.cpus() || [];
  return {
    model: cpus[0]?.model?.trim() ?? 'unknown',
    cores: cpus.length,
    arch: os.arch(),
    platform: os.platform(),
    // "how busy is the host" — a coarse secondary signal. On Windows this is 0.
    load1m: os.loadavg()[0],
  };
}

/**
 * Build the full device record for a heartbeat.
 * @param {string} peerId
 * @param {{status:string,maxConcurrent:number,currentLoad:number,availableCapacity:number}} live
 *   live scheduling state, owned by the worker and mutated as jobs run.
 */
export async function buildDeviceRecord(peerId, live) {
  return {
    v: 1,
    peerId,
    hostname: os.hostname(),
    cpu: getCpu(), // { model, cores, arch, platform, load1m }
    ram: getRam(), // { totalBytes, freeBytes }
    storage: await getStorage('.'), // { totalBytes, freeBytes }
    status: live.status, // "available" | "draining" | "offline"
    maxConcurrent: live.maxConcurrent,
    currentLoad: live.currentLoad, // edgeCloud jobs running right now
    availableCapacity: live.availableCapacity,
    pricePerJobUsd: null, // reserved — cheapest-node scheduling, later (Chao's idea)
    ts: Date.now(), // heartbeat timestamp → liveness
  };
}

/** Loose structural validation for a received heartbeat record. */
export function validateDeviceRecord(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (typeof r.peerId !== 'string' || r.peerId.length === 0 || r.peerId.length > 128) {
    return 'malformed peerId';
  }
  if (!Number.isFinite(r.ts)) return 'malformed ts';
  return null;
}
