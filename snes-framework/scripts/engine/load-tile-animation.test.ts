// Smoke test for loadTileAnimation. Asserts that after init runs on a
// clean VRAM, the always-on animated VRAM slots ($1400/$1440/$1480/$14C0
// in word addresses → byte $2800/$2880/$2900/$2980) contain cart ROM
// bytes drawn from the FXDATA bank $52 source pointer table — i.e.
// neither zero (uninitialised) nor whatever loadLevelGfx left behind.
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/load-tile-animation.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadLevelGfx, type GfxHeader } from './load-graphics.ts';
import { loadTileAnimation } from './load-tile-animation.ts';
import { mergeSymbolMaps, parseWlaSymbolMap } from './symbol-map.ts';

const BUILD_DIR = path.resolve(import.meta.dirname, '../../build');
const cartPath = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sfc");
const symPath  = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sym");
const fxSymPath = symPath.replace(/\.sym$/i, '-superfx.sym');

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

if (!fs.existsSync(cartPath) || !fs.existsSync(symPath) || !fs.existsSync(fxSymPath)) {
  console.error(`built ROM + .sym + -superfx.sym not found at ${BUILD_DIR}`);
  console.error(`run a fresh build (it emits both .sym files alongside the ROM)`);
  process.exit(0);
}
const rom = new Uint8Array(fs.readFileSync(cartPath));
// Mirror production (`mergeSymbolMaps`): the SuperFX-native `DATA_*` labels
// (e.g. DATA_gfx_bank52) live only in the -superfx.sym, so the engine needs the
// merged map.
const mainSym = parseWlaSymbolMap(fs.readFileSync(symPath, 'utf8'));
const fxSym = parseWlaSymbolMap(fs.readFileSync(fxSymPath, 'utf8'));
const symbols = mergeSymbolMaps(mainSym, fxSym);
console.log(`Loaded symbol map: ${symbols.size} labels`);

const FXDATA_520000 = symbols.pc('DATA_gfx_bank52');
const DEFAULT_SRC_PTRS = symbols.pc('DATA_default_tile_anim_source_ptrs');

const u16 = (b: Uint8Array, p: number): number => b[p] | (b[p + 1] << 8);

// --- Test 1: against an empty VRAM, the always-on slots receive ROM data
{
  const vram = new Uint8Array(0x10000);
  loadTileAnimation(rom, symbols, {
    animationTileset: 0,
    bg1Tileset: 0,
    levelMode: 0
  }, vram);

  // After 32 iterations of the cart's loop the LAST writes to each
  // unique destination win. Confirm each animated slot is non-zero.
  const slots = [0x1400, 0x1440, 0x1480, 0x14c0];
  for (const word of slots) {
    const byteAddr = word << 1;
    let nonZero = 0;
    for (let i = 0; i < 0x80; i++) if (vram[byteAddr + i] !== 0) nonZero++;
    assert(nonZero > 8, `VRAM word $${word.toString(16)}: only ${nonZero} non-zero bytes (expected > 8)`);
  }
  console.log(`Test 1: always-on slots populated`);
}

// --- Test 2: exact byte match for the final loop iteration writes -------
// With frame counter starting at 0 and incrementing 32× before each
// iteration, the LAST write per unique VRAM destination uses these
// (Y, dw) pairs (see source-asm trace):
//   $1400 ← last at frame=32 (Y=0,  dw 0  : src offset $C000)
//   $1440 ← last at frame=26 (Y=52, dw 26 : src offset $C680)
//   $1480 ← last at frame=28 (Y=56, dw 28 : src offset $C780)
//   $14C0 ← last at frame=30 (Y=60, dw 30 : src offset $AE80)
{
  const vram = new Uint8Array(0x10000);
  loadTileAnimation(rom, symbols, {
    animationTileset: 0,
    bg1Tileset: 0,
    levelMode: 0
  }, vram);

  const cases: Array<[string, number, number]> = [
    ['$1400', 0x1400, 0],   // dw 0
    ['$1440', 0x1440, 52],  // dw 26 (byte offset 52)
    ['$1480', 0x1480, 56],  // dw 28
    ['$14c0', 0x14c0, 60],  // dw 30
  ];
  for (const [name, vramWord, y] of cases) {
    const srcOff = u16(rom, DEFAULT_SRC_PTRS + y);
    const srcPC = FXDATA_520000 + srcOff;
    const vramByte = vramWord << 1;
    let match = true;
    for (let i = 0; i < 0x80; i++) {
      if (vram[vramByte + i] !== rom[srcPC + i]) { match = false; break; }
    }
    assert(match, `${name}: VRAM bytes != ROM bytes from src offset $${srcOff.toString(16)}`);
  }
  console.log(`Test 2: final-iteration bytes match cart ROM source`);
}

// --- Test 3: running over an already-populated VRAM still produces the
//             expected final bytes (loadTileAnimation should overwrite
//             portions filled by loadLevelGfx, not get confused by them).
{
  const header: GfxHeader = {
    bg1Tileset: 0, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, isWorld6: false,
  };
  const vram = new Uint8Array(0x10000);
  loadLevelGfx(rom, symbols, header, vram);
  loadTileAnimation(rom, symbols, {
    animationTileset: 0,
    bg1Tileset: 0,
    levelMode: 0
  }, vram);

  // Same assertion as test 2's $1400 case: final byte should match the
  // FXDATA source even after loadLevelGfx ran first.
  const srcOff = u16(rom, DEFAULT_SRC_PTRS + 0);
  const srcPC = FXDATA_520000 + srcOff;
  let match = true;
  for (let i = 0; i < 0x80; i++) {
    if (vram[(0x1400 << 1) + i] !== rom[srcPC + i]) { match = false; break; }
  }
  assert(match, `Post-loadLevelGfx: $1400 bytes != FXDATA source ($${srcOff.toString(16)})`);
  console.log(`Test 3: loadTileAnimation correctly overwrites loadLevelGfx output`);
}

// --- Test 4: sweep all 18 animation-tileset values, no exceptions ------
{
  for (let at = 0; at <= 0x11; at++) {
    const vram = new Uint8Array(0x10000);
    loadTileAnimation(rom, symbols, {
      animationTileset: at,
      bg1Tileset: 0,
      levelMode: 0
    }, vram);
  }
  console.log(`Test 4: all 18 animationTileset values run without exceptions`);
}

// --- Test 5: per-tileset handlers actually wrote to their documented
// target VRAM region. We can't check for "non-zero bytes" because some
// handler sources (e.g. $52:B400 in V1.0) are genuinely zero-filled —
// the cart uses those handlers to clear-and-leave-blank specific VRAM
// regions. Instead: pre-fill VRAM with $AA sentinel, run the handler,
// and verify the target region was *modified* away from $AA.
{
  // (handler index, expected target byte range) — target = VRAM region the
  // handler's frame-0 DMA writes into.
  const targets: Array<[number, number, number, string]> = [
    [0x00, 0x2000, 0x80, '$1000 (handler $00 default)'],
    [0x01, 0x5e00, 0x80, '$2F00 (handler $01 swap-cycle)'],
    [0x02, 0x2000, 0x80, '$1000 (handler $02 water)'],
    [0x03, 0x5e00, 0x80, '$2F00 (handler $03 smiley clouds)'],
    [0x05, 0x5e00, 0x80, '$2F00 (handler $05 14-step)'],
    [0x06, 0x5e00, 0x80, '$2F00 (handler $06, non-mode-$0A)'],
    [0x07, 0x2100, 0x80, '$1080 (handler $07 paired)'],
    [0x08, 0x2000, 0x80, '$1000 (handler $08)'],
    [0x09, 0x5e00, 0x80, '$2F00 (handler $09)'],
    [0x0a, 0x5e00, 0x80, '$2F00 (handler $0A)'],
    [0x0b, 0x2000, 0x80, '$1000 (handler $0B alternates with $02)'],
    [0x0c, 0x2000, 0x80, '$1000 (handler $0C paired)'],
    [0x0d, 0x2100, 0x80, '$1080 (handler $0D chains $07)'],
    [0x0e, 0x5e00, 0x80, '$2F00 (handler $0E alternating)'],
    [0x0f, 0x5e00, 0x80, '$2F00 (handler $0F timer-gated)'],
    [0x10, 0x5e00, 0x80, '$2F00 (handler $10 paired half)'],
    [0x11, 0x5e00, 0x80, '$2F00 (handler $11 chains $03/$0C)'],
  ];
  let failedHandlers = 0;
  for (const [at, start, len, label] of targets) {
    const vram = new Uint8Array(0x10000).fill(0xaa);
    loadTileAnimation(rom, symbols, {
      animationTileset: at,
      bg1Tileset: 0,
      levelMode: 0
    }, vram);
    let modified = 0;
    for (let i = start; i < start + len; i++) if (vram[i] !== 0xaa) modified++;
    if (modified < 32) {
      console.error(`  ✗ handler $${at.toString(16).padStart(2,'0')}: target ${label} only modified ${modified}/${len} bytes from sentinel`);
      failedHandlers++;
    }
  }
  assert(failedHandlers === 0, `${targets.length} handlers all wrote to their target VRAM (vs $AA sentinel)`);
  console.log(`Test 5: per-tileset handlers populate their target regions`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log(`\nAll tile-animation tests passed.`);
