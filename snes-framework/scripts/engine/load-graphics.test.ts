// Smoke test: run the graphics loader against V1.0 with a handful of
// header configurations. Assert that the VRAM ends up mostly populated
// and that varying the tileset fields actually changes the output.
//
// Visual ground-truth verification comes in Phase 5.
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/load-graphics.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadLevelGfx, type GfxHeader } from './load-graphics.ts';
import { parseWlaSymbolMap } from './symbol-map.ts';

const BUILD_DIR = path.resolve(import.meta.dirname, '../../build');
const cartPath = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sfc");
const symPath  = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sym");

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

if (!fs.existsSync(cartPath) || !fs.existsSync(symPath)) {
  console.error(`built ROM + .sym not found at ${BUILD_DIR}`);
  console.error(`run a fresh build (it now emits .sym alongside the ROM)`);
  process.exit(0);
}
const rom = new Uint8Array(fs.readFileSync(cartPath));
const symbols = parseWlaSymbolMap(fs.readFileSync(symPath, 'utf8'));
console.log(`Loaded symbol map: ${symbols.size} labels`);

// --- Test 1: a default header runs to completion + produces meaningful VRAM
{
  const header: GfxHeader = {
    bg1Tileset: 0,
    bg2Tileset: 0,
    bg3Tileset: 0,
    spriteTileset: 0,
    isWorld6: false,
  };
  const vram = new Uint8Array(0x10000);
  loadLevelGfx(rom, symbols,header, vram);
  let nonZero = 0;
  for (let i = 0; i < vram.length; i++) if (vram[i] !== 0) nonZero++;
  assert(nonZero > 10_000, `default header: VRAM non-zero count = ${nonZero} (expected > 10k of 64k)`);
  console.log(`Default header: ${nonZero}/${vram.length} non-zero VRAM bytes`);
}

// --- Test 2: changing bg1Tileset changes VRAM bytes in the BG1 region ----
{
  const baseHeader: GfxHeader = {
    bg1Tileset: 0, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, isWorld6: false,
  };
  const vrams: Uint8Array[] = [];
  for (const bg1 of [0, 1, 5, 10, 15]) {
    const v = new Uint8Array(0x10000);
    loadLevelGfx(rom, symbols,{ ...baseHeader, bg1Tileset: bg1 }, v);
    vrams.push(v);
  }
  // Count distinct VRAM payloads — at least most should differ.
  const hashes = new Set<string>();
  for (const v of vrams) {
    // Crude hash: first 256 bytes of BG1 region (VRAM 0x0000)
    let h = '';
    for (let i = 0; i < 256; i++) h += v[i].toString(16).padStart(2, '0');
    hashes.add(h);
  }
  assert(hashes.size >= 3, `bg1Tileset sweep produces variety: ${hashes.size}/5 unique BG1 starts`);
  console.log(`bg1Tileset sweep: ${hashes.size}/5 distinct BG1 starts`);
}

// --- Test 3: isWorld6 flag toggles the BG1 file set --------------------
{
  const a = new Uint8Array(0x10000);
  const b = new Uint8Array(0x10000);
  const header: GfxHeader = {
    bg1Tileset: 1, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, isWorld6: false,
  };
  loadLevelGfx(rom, symbols,header, a);
  loadLevelGfx(rom, symbols,{ ...header, isWorld6: true }, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assert(diff > 0, `World 6 flag flips at least one VRAM byte (got ${diff})`);
  console.log(`World 6 vs default (bg1Tileset=1): ${diff} VRAM bytes differ`);
}

// --- Test 4: sweep all valid bg1 / bg2 / bg3 tileset values for crashes --
{
  let crashes = 0;
  for (let i = 0; i < 16; i++) {
    try {
      const v = new Uint8Array(0x10000);
      loadLevelGfx(rom, symbols,{
        bg1Tileset: i, bg2Tileset: 0, bg3Tileset: 0, spriteTileset: 0, isWorld6: false,
      }, v);
    } catch (e) { crashes++; console.error(`  bg1=${i} crashed: ${e}`); }
  }
  assert(crashes === 0, `all 16 bg1Tileset values decode (${crashes} crashes)`);

  crashes = 0;
  for (let i = 0; i < 32; i++) {
    try {
      const v = new Uint8Array(0x10000);
      loadLevelGfx(rom, symbols,{
        bg1Tileset: 0, bg2Tileset: i, bg3Tileset: 0, spriteTileset: 0, isWorld6: false,
      }, v);
    } catch (e) { crashes++; console.error(`  bg2=${i} crashed: ${e}`); }
  }
  assert(crashes === 0, `all 32 bg2Tileset values decode (${crashes} crashes)`);

  crashes = 0;
  for (let i = 0; i < 48; i++) {
    try {
      const v = new Uint8Array(0x10000);
      loadLevelGfx(rom, symbols,{
        bg1Tileset: 0, bg2Tileset: 0, bg3Tileset: i, spriteTileset: 0, isWorld6: false,
      }, v);
    } catch (e) { crashes++; console.error(`  bg3=${i} crashed: ${e}`); }
  }
  assert(crashes === 0, `all 48 bg3Tileset values decode (${crashes} crashes)`);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
