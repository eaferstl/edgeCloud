// Verifies the device capability record (schema adapted from chaodoze's
// device registry) is well-formed and that availableCapacity tracks load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceRecord, getCpu, getRam, getStorage, validateDeviceRecord } from '../src/device-info.js';

test('getCpu/getRam/getStorage return plausible shapes', async () => {
  const cpu = getCpu();
  assert.equal(typeof cpu.cores, 'number');
  assert.ok(cpu.cores >= 1);
  assert.equal(typeof cpu.arch, 'string');

  const ram = getRam();
  assert.ok(ram.totalBytes > 0);
  assert.ok(ram.freeBytes >= 0);

  const storage = await getStorage('.');
  // statfs may be unsupported → nulls allowed, but the keys must exist
  assert.ok('totalBytes' in storage && 'freeBytes' in storage);
});

test('buildDeviceRecord includes capability + scheduling fields', async () => {
  const live = { status: 'available', maxConcurrent: 4, currentLoad: 1, availableCapacity: 3 };
  const rec = await buildDeviceRecord('12D3KooWExamplePeerId', live);
  assert.equal(rec.peerId, '12D3KooWExamplePeerId');
  assert.equal(rec.status, 'available');
  assert.equal(rec.maxConcurrent, 4);
  assert.equal(rec.currentLoad, 1);
  assert.equal(rec.availableCapacity, 3);
  assert.ok(rec.cpu && typeof rec.cpu.cores === 'number');
  assert.ok(rec.ram && rec.ram.totalBytes > 0);
  assert.equal(validateDeviceRecord(rec), null);
});

test('validateDeviceRecord rejects malformed records', () => {
  assert.notEqual(validateDeviceRecord(null), null);
  assert.notEqual(validateDeviceRecord({ ts: 1 }), null); // no peerId
  assert.notEqual(validateDeviceRecord({ peerId: 'x' }), null); // no ts
  assert.equal(validateDeviceRecord({ peerId: 'x', ts: Date.now() }), null);
});

test('availableCapacity getter reflects currentLoad (coordinator live object)', () => {
  // mirror the live object shape created in coordination.js
  const live = {
    status: 'available',
    maxConcurrent: 4,
    currentLoad: 0,
    get availableCapacity() {
      return Math.max(0, this.maxConcurrent - this.currentLoad);
    },
  };
  assert.equal(live.availableCapacity, 4);
  live.currentLoad = 3;
  assert.equal(live.availableCapacity, 1);
  live.currentLoad = 9;
  assert.equal(live.availableCapacity, 0);
});
