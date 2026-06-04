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
import { readFileSync } from 'node:fs';

// PRIVACY: we advertise only what is available to THIS container (its cgroup
// limits), NOT the host's total RAM / core count / disk — that would needlessly
// leak the operator's machine specs to the whole network. Outside a limited
// cgroup (local dev) we fall back to host values.

// Cores available to this container (cgroup v2 CPU quota = quota/period).
function availableCores() {
  try {
    const [quota, period] = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max') {
      const cores = Number(quota) / Number(period);
      if (cores > 0) return Math.round(cores * 100) / 100;
    }
  } catch {
    /* not a limited cgroup v2 — fall through */
  }
  return (os.cpus() || []).length; // local-dev fallback
}

// Memory available to this container (cgroup v2 limit + current usage), not host total.
function containerMemory() {
  try {
    const max = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (max !== 'max') {
      const totalBytes = Number(max);
      let used = 0;
      try {
        used = Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
      } catch {
        /* current usage unavailable */
      }
      if (totalBytes > 0) return { totalBytes, freeBytes: Math.max(0, totalBytes - used) };
    }
  } catch {
    /* not a limited cgroup v2 — fall through */
  }
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() }; // local-dev fallback
}

// Disk free in the job scratch area (statfs on the scratch/tmp path), so we
// report usable scratch space, not the host's total disk size.
export async function getStorage(p = os.tmpdir()) {
  try {
    const s = await fs.statfs(p);
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return { totalBytes: null, freeBytes: null }; // not all platforms support statfs
  }
}

export function getRam() {
  return containerMemory();
}

export function getCpu() {
  return {
    cores: availableCores(), // cores available to THIS container, not the host
    arch: os.arch(),
    platform: os.platform(),
    // "how busy is this container" — coarse secondary signal. On Windows this is 0.
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
    cpu: getCpu(), // { cores, arch, platform, load1m } — container-scoped, no host model
    ram: getRam(), // { totalBytes, freeBytes } — container cgroup limit, not host total
    storage: await getStorage(), // scratch (tmpfs) free space, not host disk size
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
