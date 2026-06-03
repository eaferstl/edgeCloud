// Copies browser builds of the vendored libs from node_modules into
// public/vendor/. Run after `npm install`; the outputs are committed so a
// production deploy doesn't need devDependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.join(__dirname, '..', 'src', 'public', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

const copies = [
  // [resolve-from-package, destination]
  ['tweetnacl/nacl-fast.min.js', 'nacl.min.js'],
  ['js-sha256/build/sha256.min.js', 'sha256.min.js'],
];

for (const [from, to] of copies) {
  const src = require.resolve(from);
  fs.copyFileSync(src, path.join(vendorDir, to));
  console.log(`vendored ${from} -> public/vendor/${to}`);
}

// fflate's exports map hides its UMD build from require.resolve; derive the
// package root from the main entry instead.
const fflateRoot = path.resolve(path.dirname(require.resolve('fflate')), '..');
fs.copyFileSync(path.join(fflateRoot, 'umd', 'index.js'), path.join(vendorDir, 'fflate.min.js'));
console.log('vendored fflate/umd/index.js -> public/vendor/fflate.min.js');
