// Builds the example WASM modules from the .wat sources in wasm-src/ using
// the wabt npm package (wat2wasm compiled to WebAssembly — no native
// toolchain needed). Outputs are committed to src/modules/ so neither servers
// nor workers need a WASM build toolchain at runtime.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initWabt from 'wabt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'wasm-src');
const outDir = path.join(__dirname, '..', 'src', 'modules');
fs.mkdirSync(outDir, { recursive: true });

const wabt = await initWabt();
for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.wat'))) {
  const watPath = path.join(srcDir, file);
  const mod = wabt.parseWat(watPath, fs.readFileSync(watPath, 'utf8'));
  const { buffer } = mod.toBinary({});
  const out = path.join(outDir, file.replace(/\.wat$/, '.wasm'));
  fs.writeFileSync(out, Buffer.from(buffer));
  console.log(`built ${file} -> ${path.relative(process.cwd(), out)} (${buffer.length} bytes)`);
}
