// Opens the five edgeCloud OrbitDB databases.
//
// Every DB uses IPFSAccessController({ write: ['*'] }): the manifest
// (name + type + access controller) is then identical for every peer, so each
// peer independently computes the SAME /orbitdb/... address from the name
// alone — no address exchange or coordination step. Authorization happens at
// the application layer (Ed25519 envelopes/attestations/endorsements), not at
// the OrbitDB layer.
//
// edgecloud-results uses the documents store with the default _id index;
// result docs set _id = jobId so duplicate executions collapse to one logical
// record.

import { IPFSAccessController } from '@orbitdb/core';
import { DB_REGISTRY, DB_JOBS, DB_CLAIMS, DB_RESULTS, DB_SERVERS } from './constants.js';

export async function openNetworkDatabases(orbitdb) {
  const open = (name, type) =>
    orbitdb.open(name, { type, AccessController: IPFSAccessController({ write: ['*'] }) });

  const [registry, jobs, claims, results, servers] = await Promise.all([
    open(DB_REGISTRY, 'events'),
    open(DB_JOBS, 'events'),
    open(DB_CLAIMS, 'events'),
    open(DB_RESULTS, 'documents'),
    open(DB_SERVERS, 'events'),
  ]);
  const dbs = { registry, jobs, claims, results, servers };
  // OrbitDB emits an 'error' event on sync failures (e.g. a peer sends a block
  // we can't decode). Unhandled, that 'error' event would crash the process.
  // A bad block from one peer must never take a node down — log and continue.
  for (const [name, db] of Object.entries(dbs)) {
    db.events.on('error', (err) => {
      console.warn(`[orbitdb] ${name} sync error (ignored): ${err?.message || err}`);
    });
  }
  return dbs;
}

/** All values of an events DB (oldest..newest). */
export async function allEventValues(eventsDb) {
  const out = [];
  for await (const entry of eventsDb.iterator()) {
    out.push(entry.value);
  }
  return out.reverse(); // iterator yields newest-first
}

/** Get a result doc by jobId from the documents DB (or null). */
export async function getResultDoc(resultsDb, jobId) {
  const doc = await resultsDb.get(jobId);
  if (!doc) return null;
  // documents.get returns { hash, key, value } in OrbitDB 2-4
  return doc.value ?? doc;
}
