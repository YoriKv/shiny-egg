// Smoke test: run the palette loader against the real V1.1 cart with a few
// header configurations and assert the output looks plausible (non-zero,
// backdrop color matches the blob lookup, no exceptions).
//
// Full visual validation comes later, in Phase 5 (BG1 render against
// gameplay screenshots).
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/load-palettes.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadLevelPalettes, bgPaletteBaseRows, type PaletteHeader } from './load-palettes.ts';
import { bgr15ToRgb, readCgramColor } from './color.ts';
import { parseWlaSymbolMap } from './symbol-map.ts';

// V1.0 built ROM + accompanying .sym (the build emits both together).
const BUILD_DIR = path.resolve(import.meta.dirname, '../../build');
const cartPath = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sfc");
const symPath  = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sym");

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

if (!fs.existsSync(cartPath)) {
  console.error(`built ROM not found at ${cartPath}`);
  console.error(`run the build (pnpm build inside the editor) first`);
  process.exit(0);
}
if (!fs.existsSync(symPath)) {
  console.error(`.sym not found at ${symPath}`);
  console.error(`re-run the build — it should emit a .sym alongside the ROM`);
  process.exit(0);
}
const rom = new Uint8Array(fs.readFileSync(cartPath));
const symbols = parseWlaSymbolMap(fs.readFileSync(symPath, 'utf8'));
console.log(`Loaded symbol map: ${symbols.size} labels`);

// --- Test 1: a default-looking header runs to completion without throwing -
{
  const header: PaletteHeader = {
    bgColor: 0,
    bg1Palette: 0,
    bg2Palette: 0,
    bg3Palette: 0,
    spritePalette: 0,
    yoshiColor: 0,
    isWorld6: false,
  };
  const cgram = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, header, cgram);
  // At minimum we expect SOME non-zero bytes — the interpreter writes
  // dozens of colors.
  let nonZero = 0;
  for (let i = 0; i < 512; i++) if (cgram[i] !== 0) nonZero++;
  assert(nonZero > 16, `default header: cgram non-zero count = ${nonZero} (expected >16)`);
  console.log(`Level-0-ish header: ${nonZero} non-zero bytes in cgram`);
  const c0 = readCgramColor(cgram, 0);
  console.log(`  CGRAM[0] (backdrop) = $${c0.toString(16).padStart(4, '0')} → ${JSON.stringify(bgr15ToRgb(c0))}`);
}

// --- Test 2: vary bgColor — CGRAM[0] should change since slot $10 is the -
//             backdrop offset and entry 0 writes from $10 to CGRAM[0..].
{
  const baseHeader: PaletteHeader = {
    bgColor: 0, bg1Palette: 0, bg2Palette: 0, bg3Palette: 0,
    spritePalette: 0, yoshiColor: 0, isWorld6: false,
  };
  const colors: number[] = [];
  for (const bg of [0, 1, 5, 10, 20, 30]) {
    const cgram = new Uint8Array(512);
    loadLevelPalettes(rom, symbols, { ...baseHeader, bgColor: bg }, cgram);
    colors.push(readCgramColor(cgram, 0));
  }
  // Different bgColor values should produce different CGRAM[0] (most of the
  // time — backdrop palette has 32 distinct entries by design).
  const uniqueCount = new Set(colors).size;
  assert(uniqueCount >= 3, `bgColor sweep produces variety: ${uniqueCount}/6 unique`);
  console.log(`bgColor sweep CGRAM[0]: ${colors.map(c => '$' + c.toString(16).padStart(4, '0')).join(' ')}`);
}

// --- Test 3: World 6 flag selects the dark-world BG1 ptrs ---------------
{
  const baseHeader: PaletteHeader = {
    bgColor: 0, bg1Palette: 1, bg2Palette: 0, bg3Palette: 0,
    spritePalette: 0, yoshiColor: 0, isWorld6: false,
  };
  const a = new Uint8Array(512);
  const b = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, baseHeader, a);
  loadLevelPalettes(rom, symbols, { ...baseHeader, isWorld6: true }, b);

  // BG1 palette ID 1 differs between bg1_palette_ptrs[1] ($06D2) and
  // bg1_dark_world_palette_ptrs[1] ($0BBE), so at least some CGRAM bytes
  // should differ.
  let diffBytes = 0;
  for (let i = 0; i < 512; i++) if (a[i] !== b[i]) diffBytes++;
  assert(diffBytes > 0, `World 6 flag flips at least one CGRAM byte (got ${diffBytes})`);
  console.log(`World6 vs default (bg1Palette=1): ${diffBytes} CGRAM bytes differ`);
}

// --- Test 4: sweep all valid header field combos for one axis — no errors -
{
  let crashes = 0;
  for (let bg1 = 0; bg1 < 32; bg1++) {
    try {
      const cgram = new Uint8Array(512);
      loadLevelPalettes(rom, symbols, {
        bgColor: 0, bg1Palette: bg1, bg2Palette: 0, bg3Palette: 0,
        spritePalette: 0, yoshiColor: 0, isWorld6: false,
      }, cgram);
    } catch { crashes++; }
  }
  assert(crashes === 0, `all 32 bg1Palette values decode without error (${crashes} crashes)`);

  crashes = 0;
  for (let bg2 = 0; bg2 < 64; bg2++) {
    try {
      const cgram = new Uint8Array(512);
      loadLevelPalettes(rom, symbols, {
        bgColor: 0, bg1Palette: 0, bg2Palette: bg2, bg3Palette: 0,
        spritePalette: 0, yoshiColor: 0, isWorld6: false,
      }, cgram);
    } catch { crashes++; }
  }
  assert(crashes === 0, `all 64 bg2Palette values decode without error (${crashes} crashes)`);
}

// --- Test 4: levelMode == $0A picks the alternate interpreter entry -----
// The mode-$0A path enters at scene_palette_layout+$D8 and only populates
// DP $10 (yoshi) + $12 (sprite). It should produce CGRAM bytes that
// differ from the normal-mode pass on the same base header — confirming
// the branch is wired and the alt program walks different territory.
{
  const baseHeader: PaletteHeader = {
    bgColor: 16, bg1Palette: 4, bg2Palette: 2, bg3Palette: 2,
    spritePalette: 1, yoshiColor: 0, isWorld6: false,
  };
  const cgramNormal = new Uint8Array(512);
  const cgram0A = new Uint8Array(512);
  loadLevelPalettes(rom, symbols, baseHeader, cgramNormal);
  loadLevelPalettes(rom, symbols, { ...baseHeader, levelMode: 0x0a }, cgram0A);

  let diff = 0;
  for (let i = 0; i < 512; i++) if (cgramNormal[i] !== cgram0A[i]) diff++;
  assert(diff > 0, `mode-$0A CGRAM differs from normal-mode (${diff}/512 bytes)`);
  console.log(`Mode-$0A vs normal: ${diff} of 512 CGRAM bytes differ`);
}

// --- Test 5: BG palette base rows from scene_palette_layout --------------
// The paletteless gfx-file preview colors a BG sheet with its layer's own
// CGRAM row (not row 0, which holds the backdrop + BG3). The stock program
// loads BG1 → row 4, BG2 → row 6, BG3 → row 0; pin those so a program/loader
// change that shifts them is caught (BG1/BG2 sheets would preview in the wrong
// palette otherwise).
{
  const rows = bgPaletteBaseRows(rom, symbols, 0x0b);
  assert(rows.bg1 === 4, `BG1 palette base row is 4 (got ${rows.bg1})`);
  assert(rows.bg2 === 6, `BG2 palette base row is 6 (got ${rows.bg2})`);
  assert(rows.bg3 === 0, `BG3 palette base row is 0 (got ${rows.bg3})`);
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
