// Encoder confidence gate (dev tool, cart + lc200 gated).
//
// Proves the LZ2/LZ16 *encoders* produce streams the real decoders accept, on
// real cart graphics. For every backed entry in both compressed-GFX pointer
// tables it runs two checks:
//
//   1. TS round-trip   : decode(encode(decode(blob))) === decode(blob)
//   2. decomp.exe cross : decomp.exe(encode(decode(blob))) === decode(blob)
//
// Check 2 is the important one — `decomp.exe` is the canonical Lunar Compress
// decoder, byte-exact against the SuperFX cart on real data, so it accepting our
// freshly-encoded streams is strong evidence the cart will too. Also reports the
// compression ratio vs the original blob and vs `recomp.exe` (the reference
// recompressor) as a yardstick.
//
// Run from the repo root (needs the V1.0 reference cart + the lc200 tools):
//   node snes-framework/scripts/engine/decompress/encode-verify.ts
//   node …/encode-verify.ts --ids=0,1,5 --limit=16 [cart.sfc]
//
// Skips cleanly (exit 0) when the cart or lc200 tools are absent.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { lz2 } from './lz2.ts';
import { lz16 } from './lz16.ts';
import { encodeLz2 } from './lz2-encode.ts';
import { encodeLz16 } from './lz16-encode.ts';
import { snesToPC } from '../symbol-map.ts';
import { u24le } from '../rom-read.ts';

// PC offsets of the two pointer tables (match verify.ts / load-graphics.ts).
const COMPRESSED_TABLE_LZ2 = 227678; // 0x3795E — DATA_lz2_compressed_gfx_ptrs
const COMPRESSED_TABLE_LZ16 = 228473; // 0x37C79 — DATA_lz16_compressed_gfx_ptrs
const LC_DIR = '/mnt/d/Dev/SNES/lc200';
const DECOMP_EXE = path.join(LC_DIR, 'decomp.exe');
const RECOMP_EXE = path.join(LC_DIR, 'recomp.exe');
const TABLE_ENTRIES = 256;
const MAX_ROWCOUNT = 4; // probe rowCount down from here (per lz16-model.md §8)

// MUST live on /mnt/d so wslToWin can hand Windows-style paths to the .exe
// tools (a /tmp path stays a WSL path the .exe can't open). Run from repo root.
const tmpDir = path.join(process.cwd(), 'tmp', 'encode-verify');

function wslToWin(p: string): string {
  if (p.startsWith('/mnt/')) {
    const letter = p[5]!.toUpperCase();
    return `${letter}:\\${p.slice(7).replace(/\//g, '\\')}`;
  }
  return p;
}

/** decomp.exe <in> <out> <offsetHex> <format+1000> <format2> → bytes or null. */
function runDecomp(inPath: string, srcOff: number, format: number, format2: number): Uint8Array | null {
  const outPath = path.join(tmpDir, 'decomp_out.bin');
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const res = spawnSync(
    DECOMP_EXE,
    [wslToWin(inPath), wslToWin(outPath), srcOff.toString(16).toUpperCase(), (format + 1000).toString(), format2.toString()],
    { encoding: 'utf8', cwd: LC_DIR }
  );
  if (res.status !== 0 || !fs.existsSync(outPath)) return null;
  const bytes = new Uint8Array(fs.readFileSync(outPath));
  fs.unlinkSync(outPath);
  return bytes;
}

/** recomp.exe <in> <out> 0 <format> <format2> → compressed size, or -1. */
function runRecompSize(rawPath: string, format: number, format2: number): number {
  const outPath = path.join(tmpDir, 'recomp_out.bin');
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const res = spawnSync(
    // +1000 to FORMAT skips the interactive "press enter" wait (else it hangs).
    RECOMP_EXE,
    [wslToWin(rawPath), wslToWin(outPath), '0', (format + 1000).toString(), format2.toString()],
    { encoding: 'utf8', cwd: LC_DIR }
  );
  if (res.status !== 0 || !fs.existsSync(outPath)) return -1;
  const size = fs.statSync(outPath).size;
  fs.unlinkSync(outPath);
  return size;
}

function eqBytes(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

interface Stats {
  pass: number;
  fail: number;
  empty: number;
  origBytes: number;
  ourBytes: number;
  recompBytes: number;
  recompWins: number; // entries where recomp beat us
}

function newStats(): Stats {
  return { pass: 0, fail: 0, empty: 0, origBytes: 0, ourBytes: 0, recompBytes: 0, recompWins: 0 };
}

function reportRow(sym: string, id: number, srcPC: number, msg: string): void {
  console.log(`  ${sym} id=0x${id.toString(16).padStart(2, '0')} pc=0x${srcPC.toString(16).padStart(6, '0')} ${msg}`);
}

function verifyLz2(rom: Uint8Array, cartPath: string, id: number, s: Stats): void {
  const srcSnes = u24le(rom, COMPRESSED_TABLE_LZ2 + id * 3);
  const srcPC = snesToPC(srcSnes);
  if (srcSnes === 0 || srcPC <= 0 || srcPC >= rom.length) {
    s.empty++;
    return;
  }
  // Ground-truth decode of the original blob.
  const buf = new Uint8Array(0x10000);
  let data: Uint8Array;
  let origCompLen: number;
  try {
    const r = lz2(rom, srcPC, buf, 0);
    data = buf.subarray(0, r.destEnd);
    origCompLen = r.srcEnd - srcPC;
  } catch (e) {
    reportRow('✗', id, srcPC, `decode failed: ${e}`);
    s.fail++;
    return;
  }

  const enc = encodeLz2(data);

  // 1. TS round-trip.
  const back = new Uint8Array(data.length + 16);
  let rtFirstDiff = -2;
  try {
    const r = lz2(enc, 0, back, 0);
    rtFirstDiff = eqBytes(back.subarray(0, r.destEnd), data);
  } catch (e) {
    reportRow('✗', id, srcPC, `TS round-trip threw: ${e}`);
    s.fail++;
    return;
  }
  if (rtFirstDiff !== -1) {
    reportRow('✗', id, srcPC, `TS round-trip differs at byte ${rtFirstDiff}`);
    s.fail++;
    return;
  }

  // 2. decomp.exe cross-check.
  const encPath = path.join(tmpDir, 'enc.bin');
  fs.writeFileSync(encPath, enc);
  const ref = runDecomp(encPath, 0, 1, 0);
  if (!ref) {
    reportRow('✗', id, srcPC, 'decomp.exe rejected our stream');
    s.fail++;
    return;
  }
  const dd = eqBytes(ref, data);
  if (dd !== -1) {
    reportRow('✗', id, srcPC, `decomp.exe output differs at byte ${dd} (len ours=${data.length} ref=${ref.length})`);
    s.fail++;
    return;
  }

  // Ratio (vs original compressed, vs recomp.exe).
  const rawPath = path.join(tmpDir, 'raw.bin');
  fs.writeFileSync(rawPath, data);
  const recompLen = runRecompSize(rawPath, 1, 0);
  s.origBytes += origCompLen;
  s.ourBytes += enc.length;
  if (recompLen > 0) {
    s.recompBytes += recompLen;
    if (recompLen < enc.length) s.recompWins++;
  }
  s.pass++;
  const recompStr = recompLen > 0 ? ` recomp=${recompLen}` : '';
  reportRow('✓', id, srcPC, `raw=${data.length} orig=${origCompLen} ours=${enc.length}${recompStr}`);
}

function verifyLz16(rom: Uint8Array, cartPath: string, id: number, s: Stats): void {
  const srcSnes = u24le(rom, COMPRESSED_TABLE_LZ16 + id * 3);
  const srcPC = snesToPC(srcSnes);
  if (srcSnes === 0 || srcPC <= 0 || srcPC >= rom.length) {
    s.empty++;
    return;
  }

  // Probe rowCount down from MAX until decomp.exe yields output (most entries
  // can't fill 4 strips — see lz16-model.md §8).
  let rowCount = 0;
  let data: Uint8Array | null = null;
  for (let rc = MAX_ROWCOUNT; rc >= 1; rc--) {
    const d = runDecomp(cartPath, srcPC, 15, rc);
    if (d && d.length === rc * 512) {
      rowCount = rc;
      data = d;
      break;
    }
  }
  if (!data) {
    reportRow('✗', id, srcPC, 'decomp.exe could not decode at any rowCount 1..4');
    s.fail++;
    return;
  }

  const enc = encodeLz16(data, rowCount);

  // 1. TS round-trip.
  const back = new Uint8Array(rowCount * 512);
  let rtFirstDiff = -2;
  try {
    const r = lz16(enc, 0, back, 0, rowCount);
    rtFirstDiff = r.destEnd === back.length ? eqBytes(back, data) : 0;
  } catch (e) {
    reportRow('✗', id, srcPC, `TS round-trip threw (rc=${rowCount}): ${e}`);
    s.fail++;
    return;
  }
  if (rtFirstDiff !== -1) {
    reportRow('✗', id, srcPC, `TS round-trip differs at byte ${rtFirstDiff} (rc=${rowCount})`);
    s.fail++;
    return;
  }

  // 2. decomp.exe cross-check.
  const encPath = path.join(tmpDir, 'enc.bin');
  fs.writeFileSync(encPath, enc);
  const ref = runDecomp(encPath, 0, 15, rowCount);
  if (!ref) {
    reportRow('✗', id, srcPC, `decomp.exe rejected our stream (rc=${rowCount})`);
    s.fail++;
    return;
  }
  const dd = eqBytes(ref, data);
  if (dd !== -1) {
    reportRow('✗', id, srcPC, `decomp.exe output differs at byte ${dd} (rc=${rowCount})`);
    s.fail++;
    return;
  }

  // Ratio. Original compressed length via our TS decoder's srcEnd.
  let origCompLen = 0;
  try {
    const r = lz16(rom, srcPC, new Uint8Array(rowCount * 512), 0, rowCount);
    origCompLen = r.srcEnd - srcPC;
  } catch {
    origCompLen = 0;
  }
  const rawPath = path.join(tmpDir, 'raw.bin');
  fs.writeFileSync(rawPath, data);
  const recompLen = runRecompSize(rawPath, 15, rowCount);
  s.origBytes += origCompLen;
  s.ourBytes += enc.length;
  if (recompLen > 0) {
    s.recompBytes += recompLen;
    if (recompLen < enc.length) s.recompWins++;
  }
  s.pass++;
  const recompStr = recompLen > 0 ? ` recomp=${recompLen}` : '';
  reportRow('✓', id, srcPC, `rc=${rowCount} raw=${data.length} orig=${origCompLen} ours=${enc.length}${recompStr}`);
}

function summarize(label: string, s: Stats): void {
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '–');
  console.log(
    `  → ${s.pass} pass, ${s.fail} fail, ${s.empty} empty | ` +
      `ours/orig=${pct(s.ourBytes, s.origBytes)} ` +
      `ours/recomp=${pct(s.ourBytes, s.recompBytes)} ` +
      `(recomp smaller on ${s.recompWins})`
  );
  console.log(`     ${label}: orig=${s.origBytes}B ours=${s.ourBytes}B recomp=${s.recompBytes}B\n`);
}

function main(): void {
  const argv = process.argv.slice(2);
  let cart = '/mnt/d/Dev/SNES/YI_USA1.sfc';
  let ids: number[] | undefined;
  let limit = TABLE_ENTRIES;
  for (const a of argv) {
    if (a.startsWith('--ids=')) ids = a.slice(6).split(',').map((x) => parseInt(x, 16));
    else if (a.startsWith('--limit=')) limit = parseInt(a.slice(8), 10);
    else if (!a.startsWith('--')) cart = a;
  }

  if (!fs.existsSync(cart) || !fs.existsSync(DECOMP_EXE) || !fs.existsSync(RECOMP_EXE)) {
    console.log('encode-verify: cart or lc200 tools absent — skipping (this is fine in CI).');
    console.log(`  cart=${fs.existsSync(cart)} decomp=${fs.existsSync(DECOMP_EXE)} recomp=${fs.existsSync(RECOMP_EXE)}`);
    process.exit(0);
  }
  fs.mkdirSync(tmpDir, { recursive: true });

  const rom = new Uint8Array(fs.readFileSync(cart));
  console.log(`Cart: ${cart} (${rom.length.toLocaleString()} bytes)`);
  console.log(`Oracle: ${DECOMP_EXE} + recomp.exe\n`);
  const idList = ids ?? Array.from({ length: limit }, (_, i) => i);

  console.log('=== LZ2 encoder (decomp.exe FORMAT=1) ===');
  const s2 = newStats();
  for (const id of idList) verifyLz2(rom, cart, id, s2);
  summarize('lz2', s2);

  console.log('=== LZ16 encoder (decomp.exe FORMAT=15) ===');
  const s16 = newStats();
  for (const id of idList) verifyLz16(rom, cart, id, s16);
  summarize('lz16', s16);

  process.exit(s2.fail + s16.fail === 0 ? 0 : 1);
}

main();
