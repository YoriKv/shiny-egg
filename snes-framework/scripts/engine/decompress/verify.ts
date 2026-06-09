// Verifier: runs our lz2/lz16 decoders side-by-side with lc200/decomp.exe
// (Lunar Compress reference) and byte-compares the outputs across a sweep of
// source pointer-table entries from a YI cart.
//
// Run from the repo root:
//   npx tsx snes-framework/scripts/engine/decompress/verify.ts \
//     "/mnt/d/Dev/SNES/Super Mario World 2 - Yoshi's Island (USA) (Rev 1).sfc"
//
// Pass `--ids=0,1,5,10` to test only specific IDs, or `--limit=N` to cap
// the sweep size (default 32 per format).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { lz2 } from './lz2.ts';
import { lz16 } from './lz16.ts';
import { snesToPC } from '../symbol-map.ts';

// These match load-graphics.ts's decimal constants — re-deriving asm-first is
// Phase 2 work. PC offsets into the LoROM cart, 24-bit (3-byte) SNES pointer
// per entry, indexed by graphic-ID byte.
const COMPRESSED_TABLE_LZ2 = 227678; // 0x3795E — DATA_lz2_compressed_gfx_ptrs
const COMPRESSED_TABLE_LZ16 = 228473; // 0x37C79 — DATA_lz16_compressed_gfx_ptrs
const DECOMP_EXE = '/mnt/d/Dev/SNES/lc200/decomp.exe';
const DECOMP_DIR = '/mnt/d/Dev/SNES/lc200';

function readU24LE(buf: Uint8Array, pc: number): number {
  return buf[pc] | (buf[pc + 1] << 8) | (buf[pc + 2] << 16);
}

function wslToWin(p: string): string {
  if (p.startsWith('/mnt/')) {
    const letter = p[5].toUpperCase();
    return `${letter}:\\${p.slice(7).replace(/\//g, '\\')}`;
  }
  return p;
}

function runDecompExe(
  cartPath: string,
  srcPC: number,
  format: number,
  format2: number
): Uint8Array | null {
  const stagedOut = path.join(DECOMP_DIR, '__verify_out.bin');
  if (fs.existsSync(stagedOut)) fs.unlinkSync(stagedOut);

  // decomp.exe needs Windows paths; cwd into the lc200 dir so the DLL loads.
  const res = spawnSync(
    DECOMP_EXE,
    [
      wslToWin(cartPath),
      wslToWin(stagedOut),
      srcPC.toString(16).toUpperCase(),
      // +1000 to FORMAT skips the "press enter" wait per readme.txt.
      (format + 1000).toString(),
      format2.toString(),
    ],
    { encoding: 'utf8', cwd: DECOMP_DIR }
  );

  if (res.status !== 0) {
    process.stderr.write(`  decomp.exe exit=${res.status}\n${res.stdout}\n${res.stderr}\n`);
    return null;
  }
  if (!fs.existsSync(stagedOut)) return null;
  const bytes = fs.readFileSync(stagedOut);
  fs.unlinkSync(stagedOut);
  return new Uint8Array(bytes);
}

interface CaseResult {
  id: number;
  srcPC: number;
  ourSize: number;
  refSize: number;
  match: boolean;
  err?: string;
  firstDiff?: number;
}

function verifyOne(
  rom: Uint8Array,
  cartPath: string,
  table: number,
  id: number,
  ourDecoder: 'lz2' | 'lz16',
  decompFormat: number,
  format2: number
): CaseResult | null {
  const ptrAddr = table + id * 3;
  const srcSnes = readU24LE(rom, ptrAddr);
  const srcPC = snesToPC(srcSnes);
  if (srcSnes === 0 || srcPC <= 0 || srcPC >= rom.length) return null;

  const ref = runDecompExe(cartPath, srcPC, decompFormat, format2);
  if (!ref) {
    return { id, srcPC, ourSize: 0, refSize: 0, match: false, err: 'decomp.exe failed' };
  }

  const ourBuf = new Uint8Array(0x10000);
  let ourSize = 0;
  try {
    const r = ourDecoder === 'lz2'
      ? lz2(rom, srcPC, ourBuf, 0)
      : lz16(rom, srcPC, ourBuf, 0, format2);
    ourSize = r.destEnd;
  } catch (e) {
    return { id, srcPC, ourSize: 0, refSize: ref.length, match: false, err: String(e) };
  }

  const our = ourBuf.subarray(0, ourSize);
  // Compare the overlap; many LZ formats produce trailing zeros so we compare
  // up to min(len) then require the longer side's tail to be all zero.
  const cmpLen = Math.min(our.length, ref.length);
  for (let i = 0; i < cmpLen; i++) {
    if (our[i] !== ref[i]) {
      return {
        id,
        srcPC,
        ourSize,
        refSize: ref.length,
        match: false,
        firstDiff: i,
        err: `byte mismatch at offset ${i}: ours=0x${our[i].toString(16).padStart(2, '0')} ref=0x${ref[i].toString(16).padStart(2, '0')}`,
      };
    }
  }
  if (our.length !== ref.length) {
    // Tail mismatch — check if it's all zero (often benign).
    const longer = our.length > ref.length ? our : ref;
    let allZero = true;
    for (let i = cmpLen; i < longer.length; i++) {
      if (longer[i] !== 0) { allZero = false; break; }
    }
    if (!allZero) {
      return {
        id, srcPC, ourSize, refSize: ref.length, match: false,
        err: `size differs (ours=${ourSize}, ref=${ref.length}); tail non-zero`,
      };
    }
  }
  return { id, srcPC, ourSize, refSize: ref.length, match: true };
}

function parseArgs(argv: string[]): { cart: string; ids?: number[]; limit: number } {
  let cart = '/mnt/d/Dev/SNES/YI_USA1.sfc'; // V1.0 reference (= built V1.0)
  let ids: number[] | undefined;
  let limit = 32;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--ids=')) ids = a.slice(6).split(',').map(s => parseInt(s, 10));
    else if (a.startsWith('--limit=')) limit = parseInt(a.slice(8), 10);
    else if (!a.startsWith('--')) cart = a;
  }
  return { cart, ids, limit };
}

function main() {
  const { cart, ids, limit } = parseArgs(process.argv);
  if (!fs.existsSync(cart)) {
    console.error(`Cart not found: ${cart}`);
    process.exit(1);
  }
  if (!fs.existsSync(DECOMP_EXE)) {
    console.error(`decomp.exe not found at ${DECOMP_EXE}`);
    process.exit(1);
  }
  const rom = new Uint8Array(fs.readFileSync(cart));
  console.log(`Cart: ${cart} (${rom.length.toLocaleString()} bytes)`);
  console.log(`Ground truth: ${DECOMP_EXE}\n`);

  const idList = ids ?? Array.from({ length: limit }, (_, i) => i);

  // Note: YI's `.lz2` blobs are LC_LZ2 (FORMAT=1) per byte-for-byte ground
  // truth. The SuperFX backref builds the offset big-endian via
  // `WITH R1 / GETB → R0 := first; GETB → R0' := second; SWAP / OR R1`
  // ⇒ `(first << 8) | second` = LZ2. Our `lz2()` function implements that.
  for (const [label, table, ourFn, decompFormat, format2] of [
    ['lz2',  COMPRESSED_TABLE_LZ2,  'lz2',  1, 0],
    ['lz16', COMPRESSED_TABLE_LZ16, 'lz16', 15, 4],
  ] as const) {
    console.log(`=== ${label} (decomp.exe FORMAT=${decompFormat}, Format2=${format2}) ===`);
    let pass = 0, fail = 0, skipped = 0;
    for (const id of idList) {
      const r = verifyOne(rom, cart, table, id, ourFn, decompFormat, format2);
      if (r === null) { skipped++; continue; }
      const sym = r.match ? '✓' : '✗';
      const idStr = '0x' + id.toString(16).padStart(2, '0');
      const pcStr = '0x' + r.srcPC.toString(16).padStart(6, '0');
      const sizeStr = `ours=${r.ourSize.toString().padStart(5)} ref=${r.refSize.toString().padStart(5)}`;
      const msg = r.err ? `  ${r.err}` : '';
      console.log(`  ${sym} id=${idStr} pc=${pcStr} ${sizeStr}${msg}`);
      if (r.match) pass++; else fail++;
    }
    console.log(`  → ${pass} pass, ${fail} fail, ${skipped} empty\n`);
  }
}

main();
