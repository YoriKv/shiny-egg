// Unit test: SPC700 upload-stream codec round-trip identity.
// Run: node snes-framework/scripts/audio/upload-stream.test.ts
//
// Pins:
//  - parse→serialize is byte-identical for every extracted song-module bin
//    (assets/yi/SPC700/DATA_*.bin) and consumes each file exactly.
//  - Every song module targets the instrument table ($3D00) in its first
//    block and ends with entry $0400 — the format invariants the composer
//    and the future blob-write path rely on.
//  - (Build-gated) All 20 ROM-resident modules parse at the DATA_SPC_ptr
//    locations with the exact retail byte lengths, and re-serialize
//    byte-identical to the ROM — the byte-identity gate for any future
//    module-writing code, and a standing validation of the catalog readers.
//
// Assets-gated + build-gated: skips cleanly when extract output or the V1.0
// build is absent.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseUploadStream, serializeUploadStream } from './upload-stream.ts';
import { readAudioCatalog, SPC_BLOCKS } from './catalog.ts';
import { FRAMEWORK_ROOT, loadDevCart } from '../engine/dev-cart.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// --- Part A: extracted song-module bins -----------------------------------
const spcAssetsDir = path.join(FRAMEWORK_ROOT, 'assets', 'yi', 'SPC700');
const binNames = fs.existsSync(spcAssetsDir)
  ? fs.readdirSync(spcAssetsDir).filter((f) => /^DATA_4[EF][0-9A-F]{4}\.bin$/.test(f)).sort()
  : [];

if (binNames.length === 0) {
  console.log('(skip) no extracted SPC700 song bins — run extract first');
} else {
  console.log(`=== round-trip: ${binNames.length} extracted song modules ===`);
  assert(binNames.length === 12, `expected 12 song-module bins, found ${binNames.length}`);
  for (const name of binNames) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(spcAssetsDir, name)));
    const { stream, byteLength } = parseUploadStream(bytes);
    assert(byteLength === bytes.length, `${name}: parse consumed ${byteLength} of ${bytes.length} bytes`);
    assert(stream.entry === 0x0400, `${name}: entry 0x${stream.entry.toString(16)} != 0x0400`);
    assert(stream.blocks[0]?.dest === 0x3d00, `${name}: first block dest 0x${stream.blocks[0]?.dest.toString(16)} != 0x3D00 (instrument table)`);
    assert(bytesEqual(serializeUploadStream(stream), bytes), `${name}: serialize(parse()) not byte-identical`);
  }
}

// --- Part B: all 20 ROM-resident modules (build-gated) --------------------
try {
  const { rom, symbols } = loadDevCart();
  const catalog = readAudioCatalog(rom, symbols);
  console.log('\n=== round-trip: 20 ROM-resident modules (built V1.0) ===');
  for (const block of SPC_BLOCKS) {
    const pc = catalog.blockPc.get(block.blockId)!;
    const { stream, byteLength } = parseUploadStream(rom, pc);
    assert(byteLength === block.retailBytes,
      `${block.module} (block 0x${block.blockId.toString(16)}): byteLength ${byteLength} != retail ${block.retailBytes}`);
    assert(stream.entry === 0x0400, `${block.module}: entry != 0x0400`);
    const reser = serializeUploadStream(stream);
    assert(bytesEqual(reser, rom.subarray(pc, pc + byteLength)), `${block.module}: re-serialize differs from ROM bytes`);
  }
} catch (e) {
  console.log(`\n(skip) ROM-resident module checks: ${(e as Error).message.split('\n')[0]}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll upload-stream checks passed.');
