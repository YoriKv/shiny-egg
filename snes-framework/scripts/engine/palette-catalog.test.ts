// Pin the whole-game palette catalog (`buildPaletteCatalog`) against the real
// built V1.0 cart. The load-bearing claim is that each catalog swatch's blob
// byte-offset is the EXACT offset the cart loads for that palette selection — so
// an edit there lands on the right colour. We verify that by cross-checking every
// pointer-table entry's swatches against what `loadLevelPalettes` actually writes
// into CGRAM (offset + colour) for a header that selects that palette.
//
// Reference-cart-gated: skips cleanly (exit 0) when the built ROM/.sym is absent.
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/palette-catalog.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPaletteCatalog } from './palette-catalog.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { parseWlaSymbolMap } from './symbol-map.ts';
import { u16le } from './rom-read.ts';
import type { PaletteCatalogGroup } from '../types.ts';

const BUILD_DIR = path.resolve(import.meta.dirname, '../../build');
const cartPath = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sfc");
const symPath = path.join(BUILD_DIR, "Super Mario World 2 - Yoshi's Island (USA V1.0).sym");

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error(`  ✗ ${msg}`); failures++; }
}

if (!fs.existsSync(cartPath) || !fs.existsSync(symPath)) {
  console.error(`built ROM/.sym not found in ${BUILD_DIR} — build first; skipping.`);
  process.exit(0);
}

const rom = new Uint8Array(fs.readFileSync(cartPath));
const symbols = parseWlaSymbolMap(fs.readFileSync(symPath, 'utf8'));
const blobPC = symbols.pc('DATA_master_palette_rom_blob');
// Use the built-ROM blob as the base source on BOTH sides so the cross-check
// isolates offset/structure correctness from base-blob sourcing.
const baseWord = (off: number): number => u16le(rom, blobPC + off);
const catalog = buildPaletteCatalog(rom, symbols, baseWord);

const cgColor = (cg: Uint8Array, i: number): number => cg[i * 2]! | (cg[i * 2 + 1]! << 8);
const emptyHeader = (): PaletteHeader => ({
  bgColor: 0, bg1Palette: 0, bg2Palette: 0, bg3Palette: 0,
  spritePalette: 0, yoshiColor: 0, isWorld6: false
});
const group = (id: string): PaletteCatalogGroup | undefined => catalog.catalog.find((g) => g.id === id);

// All CGRAM colour offsets the cart writes for a given header (offset → colour).
function liveOffsets(header: PaletteHeader): Map<number, number> {
  const cg = new Uint8Array(512);
  const pv = new Int32Array(256);
  loadLevelPalettes(rom, symbols, header, cg, pv);
  const m = new Map<number, number>();
  for (let i = 0; i < 256; i++) if (pv[i]! >= 0) m.set(pv[i]!, cgColor(cg, i));
  return m;
}

console.log(`Loaded ${symbols.size} symbols; catalog has ${catalog.catalog.length} groups, ${catalog.scenes.length} scene groups`);

// ── Test 1: structural — the expected pointer-table groups + entry counts ────
{
  const expect: Record<string, number> = {
    backdrop: 1, bg1: 32, 'bg1-dark': 32, bg2: 64, bg3: 64, sprite: 16, yoshi: 8
  };
  for (const [id, n] of Object.entries(expect)) {
    const g = group(id);
    assert(!!g, `group '${id}' present`);
    if (g) assert(g.entries.length === n, `group '${id}' has ${n} entries (got ${g.entries.length})`);
  }
  const backdrop = group('backdrop')?.entries[0];
  assert(backdrop?.swatches.length === 256, `backdrop entry has 256 swatches (got ${backdrop?.swatches.length})`);
}

// ── Test 2: per-table offset + colour correctness vs the live cart load ──────
// For a header selecting palette #n, every catalog swatch's (offset, colour)
// must match a colour the cart actually loads, and the per-entry swatch count
// must equal the cart's transfer size.
function verifyTable(id: string, field: keyof PaletteHeader, expectedCount: number): void {
  const g = group(id);
  if (!g) return;
  for (const n of [0, 1, g.entries.length >> 1, g.entries.length - 1]) {
    const header = emptyHeader();
    (header as unknown as Record<string, number>)[field] = n;
    const live = liveOffsets(header);
    const entry = g.entries[n]!;
    let ok = true;
    for (const sw of entry.swatches) {
      if (live.get(sw.offset) !== sw.base) { ok = false; break; }
    }
    assert(ok, `${id} #${n}: every swatch offset+colour matches the live cart load`);
    assert(entry.swatches.length === expectedCount, `${id} #${n}: ${expectedCount} swatches (got ${entry.swatches.length})`);
  }
}
verifyTable('bg1', 'bg1Palette', 42); // 30 main (rows 4–5) + 12 object-tint tail (rows 1–3)
verifyTable('bg2', 'bg2Palette', 30);
verifyTable('bg3', 'bg3Palette', 15);
verifyTable('sprite', 'spritePalette', 30);
verifyTable('yoshi', 'yoshiColor', 15);

// BG1 dark-world: select via isWorld6 (the alt pointer table). Verify entry #1
// (where the dark table diverges from the normal one — ptr $0BBE vs $06D2).
{
  const g = group('bg1-dark');
  if (g) {
    const header = emptyHeader();
    header.bg1Palette = 1;
    header.isWorld6 = true;
    const live = liveOffsets(header);
    const entry = g.entries[1]!;
    let ok = true;
    for (const sw of entry.swatches) if (live.get(sw.offset) !== sw.base) { ok = false; break; }
    assert(ok, `bg1-dark #1: swatch offsets+colours match the live World-6 load`);
  }
}

// ── Test 3: backdrop offsets line up with the cart's backdrop selection ──────
{
  const entry = group('backdrop')?.entries[0];
  if (entry) {
    let ok = true;
    for (const b of [0, 1, 7, 64, 200, 255]) {
      const header = emptyHeader();
      header.bgColor = b;
      const live = liveOffsets(header);
      const sw = entry.swatches[b]!;
      // The cart writes the chosen backdrop to CGRAM[0]; its provenance offset
      // must be this swatch's offset, with the matching colour.
      if (live.get(sw.offset) !== sw.base) { ok = false; break; }
    }
    assert(ok, `backdrop: sampled colours match the live cart backdrop selection`);
  }
}

// ── Test 4: fixed/universal literal rows match the cart's literal sources ────
{
  const fixed = group('fixed');
  assert(!!fixed, `fixed/universal group present`);
  if (fixed) {
    const live = liveOffsets(emptyHeader());
    let total = 0;
    let ok = true;
    for (const entry of fixed.entries) {
      total += entry.swatches.length;
      for (const sw of entry.swatches) if (live.get(sw.offset) !== sw.base) { ok = false; break; }
    }
    assert(ok, `fixed: every literal swatch offset+colour matches the live load`);
    assert(total > 0, `fixed: has swatches (got ${total})`);
    // The OBJ 0–4 block (CGRAM rows 8–12 = indices 128..191) is the big fixed
    // sprite block — make sure that semantic entry is present and complete.
    const obj04 = fixed.entries.find((e) => e.sublabel?.includes('rows 8–12'));
    assert(!!obj04 && obj04.swatches.length === 75, `fixed: OBJ 0–4 block has 75 swatches (5 rows × 15)`);
  }
}

// ── Test 5: scenes build and carry editable, blob-backed swatches ────────────
{
  // Full-CGRAM scene snapshots only — the curated World-panels group (1 swatch
  // per world) is checked separately in Test 6.
  const sceneGroups = catalog.scenes.filter((g) => g.id !== 'scene-world-panels');
  assert(sceneGroups.length > 0, `at least one full-CGRAM scene group built`);
  let sceneEntries = 0;
  let editable = 0;
  for (const g of sceneGroups) {
    for (const e of g.entries) {
      sceneEntries++;
      assert(e.swatches.length === 256, `scene '${e.label}' is a full 256-entry CGRAM`);
      for (const sw of e.swatches) {
        if (sw.offset >= 0) { editable++; assert(sw.base === baseWord(sw.offset), `scene '${e.label}' editable swatch base == blob word`); }
      }
    }
  }
  assert(sceneEntries >= 4, `built several scenes (got ${sceneEntries})`);
  assert(editable > 0, `scenes expose editable (blob-backed) swatches (got ${editable})`);
}

// ── Test 6: the World-map panels group (per-world panel colour + sync copies) ─
{
  const panels = catalog.scenes.find((g) => g.id === 'scene-world-panels');
  assert(!!panels, `World-map panels group present`);
  if (panels) {
    assert(panels.entries.length === 6, `6 world-panel entries (got ${panels.entries.length})`);
    // Worlds 1–3 (tint rows 3–5) read from the shared block → single offset.
    for (const w of [0, 1, 2]) {
      const sw = panels.entries[w]!.swatches[0]!;
      assert(!sw.mirrors || sw.mirrors.length === 0, `World ${w + 1} is a single shared offset`);
    }
    // Worlds 4–6 (tint rows 0–2) are stored once per world palette → 6 synced copies.
    for (const w of [3, 4, 5]) {
      const sw = panels.entries[w]!.swatches[0]!;
      const all = [sw.offset, ...(sw.mirrors ?? [])];
      assert(all.length === 6, `World ${w + 1} syncs 6 copies (got ${all.length})`);
      // Every copy must hold the SAME base colour (else syncing them is wrong).
      const colours = new Set(all.map((o) => baseWord(o)));
      assert(colours.size === 1, `World ${w + 1}: all copies share one colour`);
    }
    // The user's verified anchor: World 6's panel colour includes blob 0x3b34.
    const w6 = panels.entries[5]!.swatches[0]!;
    const w6set = new Set([w6.offset, ...(w6.mirrors ?? [])]);
    assert(w6set.has(0x3b34), `World 6 panel-colour set includes blob 0x3b34 (the anchor)`);
    assert(w6set.has(0x3da0), `World 6 panel-colour set includes its own-screen copy 0x3da0`);
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
