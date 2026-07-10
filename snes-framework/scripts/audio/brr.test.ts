// Unit test: BRR decoder + WAV writer.
// Run: node snes-framework/scripts/audio/brr.test.ts
//
// Pins:
//  - Synthetic blocks: filter-0 shift math, per-filter predictor math on a
//    known two-block stream, end/loop flag handling (trailing blocks after
//    the end flag are dropped; loop flag surfaces).
//  - WAV container fields for a known PCM payload.
//  - (Assets-gated) every extracted .brr under assets/yi/SPC700/Samples
//    decodes to an end-flag-terminated, non-silent stream — the "sample
//    export won't produce garbage" gate. (Byte length is NOT pinned to a
//    block multiple: each bank's LAST sample is sliced to the data-block
//    end, so it carries padding past its end block by construction.)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeBrr } from './brr.ts';
import { wavFromPcm16 } from './wav.ts';
import { FRAMEWORK_ROOT } from '../engine/dev-cart.ts';

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}
function eq<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ✗ ${msg}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failures++;
  }
}

console.log('=== synthetic blocks ===');
{
  // Filter 0, shift 12: nibble n decodes to (n<<12)>>1 = n*2048.
  const block = new Uint8Array(9);
  block[0] = (12 << 4) | 0x01; // shift 12, filter 0, end, no loop
  block[1] = 0x10; // nibbles 1, 0
  block[2] = 0xf8; // nibbles -1, -8
  const d = decodeBrr(block);
  eq(d.blocks, 1, 'one block');
  eq(d.loops, false, 'no loop flag');
  eq([...d.pcm.slice(0, 4)], [2048, 0, -2048, -16384], 'filter-0 shift-12 values');
  assert(d.pcm.length === 16, '16 samples per block');
}
{
  // Filter 1 continuation: s = (nib<<shift)>>1 + p1 - (p1>>4).
  const bytes = new Uint8Array(18);
  bytes[0] = (12 << 4) | 0; // block 1: shift 12, filter 0
  bytes[1] = 0x10; // p1 ends up ... start samples 2048, 0
  bytes[9] = (0 << 4) | (1 << 2) | 0x03; // block 2: shift 0, filter 1, end+loop
  // all-zero nibbles → each sample = p1 - (p1>>4) (decay chain)
  const d = decodeBrr(bytes);
  eq(d.blocks, 2, 'two blocks');
  eq(d.loops, true, 'loop flag from end block');
  // Block 1 samples 2..15 are zero (nibbles 0, filter 0) → p1 = 0 entering
  // block 2, so the decay chain stays 0.
  eq([...d.pcm.slice(16, 19)], [0, 0, 0], 'filter-1 zero chain');
}
{
  // Filter-1 predictor math with a nonzero tail: craft block 1 ending with a
  // nonzero sample, then a filter-1 block of zero nibbles decays it.
  const bytes = new Uint8Array(18);
  bytes[0] = 12 << 4;
  bytes[8] = 0x01; // last nibble of block 1 = 1 → sample 15 = 2048
  bytes[9] = (0 << 4) | (1 << 2) | 0x01;
  const d = decodeBrr(bytes);
  eq(d.pcm[15], 2048, 'block-1 tail sample');
  eq(d.pcm[16], 2048 - (2048 >> 4), 'filter-1 decay step 1');
  const s1 = 2048 - (2048 >> 4);
  eq(d.pcm[17], s1 - (s1 >> 4), 'filter-1 decay step 2');
}
{
  // Trailing bytes after the end block are dropped.
  const bytes = new Uint8Array(27);
  bytes[0] = (12 << 4) | 0x01; // end at block 1
  const d = decodeBrr(bytes);
  eq(d.blocks, 1, 'stops at end flag');
  eq(d.pcm.length, 16, 'trailing blocks dropped');
}

console.log('\n=== wav container ===');
{
  const wav = wavFromPcm16(new Int16Array([0, 1000, -1000]), 32000);
  const dv = new DataView(wav.buffer);
  eq(wav.length, 44 + 6, 'container size');
  eq(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF', 'RIFF magic');
  eq(dv.getUint32(24, true), 32000, 'sample rate');
  eq(dv.getUint16(22, true), 1, 'mono');
  eq(dv.getInt16(46, true), 1000, 'payload sample');
}

// --- assets-gated: decode every extracted sample -----------------------------
const samplesRoot = path.join(FRAMEWORK_ROOT, 'assets', 'yi', 'SPC700', 'Samples');
if (!fs.existsSync(samplesRoot)) {
  console.log('\n(skip) extracted samples not present — run extract first');
} else {
  console.log('\n=== decode all extracted samples ===');
  let count = 0;
  for (const bank of fs.readdirSync(samplesRoot).sort()) {
    const bankDir = path.join(samplesRoot, bank);
    for (const file of fs.readdirSync(bankDir).filter((f) => f.endsWith('.brr')).sort()) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(bankDir, file)));
      const d = decodeBrr(bytes);
      assert(d.terminated, `${bank}/${file}: no end flag inside the stream`);
      let energy = 0;
      for (let i = 0; i < d.pcm.length; i++) energy += Math.abs(d.pcm[i]);
      assert(energy > 0, `${bank}/${file}: decoded to silence`);
      count++;
    }
  }
  console.log(`  ${count} samples decoded`);
  assert(count > 50, `expected 60+ samples, saw ${count}`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll BRR checks passed.');
