// Pin the whole-game palette catalog (`buildPaletteCatalog`) against the real
// built V1.0 cart. The load-bearing claim is that each catalog swatch's blob
// byte-offset is the EXACT offset the cart loads for that palette selection — so
// an edit there lands on the right color. We verify that by cross-checking every
// pointer-table entry's swatches against what `loadLevelPalettes` actually writes
// into CGRAM (offset + color) for a header that selects that palette.
//
// Reference-cart-gated: skips cleanly (exit 0) when the built ROM/.sym is absent.
//
// Run: node --experimental-strip-types snes-framework/scripts/engine/palette-catalog.test.ts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPaletteCatalog } from './palette-catalog.ts';
import { loadLevelPalettes, type PaletteHeader } from './load-palettes.ts';
import { parseWlaSymbolMap, snesToPC } from './symbol-map.ts';
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

// All CGRAM color offsets the cart writes for a given header (offset → color).
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
    backdrop: 1, bg1: 32, 'bg1-dark': 32, bg2: 64, bg3: 64, sprite: 16, yoshi: 8,
    'mode-0a': 1, anim: 18
  };
  for (const [id, n] of Object.entries(expect)) {
    const g = group(id);
    assert(!!g, `group '${id}' present`);
    if (g) assert(g.entries.length === n, `group '${id}' has ${n} entries (got ${g.entries.length})`);
  }
  const backdrop = group('backdrop')?.entries[0];
  assert(backdrop?.swatches.length === 16, `backdrop entry has 16 swatches (got ${backdrop?.swatches.length})`);
}

// ── Test 2: per-table offset + color correctness vs the live cart load ──────
// For a header selecting palette #n, every catalog swatch's (offset, color)
// must match a color the cart actually loads, and the per-entry swatch count
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
    assert(ok, `${id} #${n}: every swatch offset+color matches the live cart load`);
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
    assert(ok, `bg1-dark #1: swatch offsets+colors match the live World-6 load`);
  }
}

// ── Test 3: backdrop offsets line up with the cart's backdrop selection ──────
{
  const entry = group('backdrop')?.entries[0];
  if (entry) {
    let ok = true;
    for (const b of [0, 1, 7, 15]) {
      const header = emptyHeader();
      header.bgColor = b;
      const live = liveOffsets(header);
      const sw = entry.swatches[b]!;
      // The cart writes the chosen backdrop to CGRAM[0]; its provenance offset
      // must be this swatch's offset, with the matching color.
      if (live.get(sw.offset) !== sw.base) { ok = false; break; }
    }
    assert(ok, `backdrop: sampled colors match the live cart backdrop selection`);
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
    assert(ok, `fixed: every literal swatch offset+color matches the live load`);
    assert(total > 0, `fixed: has swatches (got ${total})`);
    // The OBJ 0–4 block (CGRAM rows 8–12 = indices 128..191) is the big fixed
    // sprite block — make sure that semantic entry is present and complete.
    const obj04 = fixed.entries.find((e) => e.sublabel?.includes('rows 8–12'));
    assert(!!obj04 && obj04.swatches.length === 75, `fixed: OBJ 0–4 block has 75 swatches (5 rows × 15)`);
  }
}

// ── Test 4b: mode-$0A cinema block matches the live mode-$0A palette load ────
{
  const g = group('mode-0a');
  assert(!!g, `mode-0a group present`);
  const entry = g?.entries[0];
  if (entry) {
    assert(entry.swatches.length === 120, `mode-0a block is 120 swatches / 8 rows × 15 (got ${entry.swatches.length})`);
    assert(entry.cols === 15, `mode-0a block lays out 15 per row (got ${entry.cols})`);
    const header = emptyHeader();
    header.levelMode = 0x0a;
    const live = liveOffsets(header);
    let ok = true;
    for (const sw of entry.swatches) if (live.get(sw.offset) !== sw.base) { ok = false; break; }
    assert(ok, `mode-0a: every swatch offset+color matches the live mode-$0A load`);
    // The universal rows the in-level program also loads must NOT be duplicated
    // here — only the cinema-exclusive literal block.
    const inLevelLive = liveOffsets(emptyHeader());
    const dup = entry.swatches.some((sw) => inLevelLive.has(sw.offset));
    assert(!dup, `mode-0a: no overlap with in-level-program offsets`);
  }
}

// ── Test 4c: palette-animation sources ───────────────────────────────────────
// Every hand-derived (frames × wordsPerRow) geometry must agree with the cart's
// actual row packing: each source block is a CONTIGUOUS blob run (the Bank01
// pointer tables' row stride equals the handler's copy width for every mode),
// so each entry's swatches must be consecutive words. A wrong wordsPerRow or a
// shifted table breaks contiguity and fails here.
{
  const g = group('anim');
  assert(!!g, `anim group present`);
  if (g) {
    assert(g.entries.length === 18, `18 animation source blocks (got ${g.entries.length})`);
    for (const e of g.entries) {
      let contiguous = true;
      const first = e.swatches[0]!.offset;
      for (let i = 0; i < e.swatches.length; i++) {
        const sw = e.swatches[i]!;
        if (sw.offset !== first + i * 2 || sw.offset < 0 || sw.offset >= 0x6000) { contiguous = false; break; }
        if (sw.base !== baseWord(sw.offset)) { contiguous = false; break; }
      }
      assert(contiguous, `anim '${e.label}': contiguous in-blob run with matching base colors`);
    }
    // Ping-pong tables (mode 0x0D) dedup 8 table entries → 4 frames × 3.
    const evens = g.entries.find((e) => e.label.includes('0x0D') && e.label.includes('even'));
    assert(evens?.swatches.length === 12, `anim 0x0D even: 12 swatches after ping-pong dedup (got ${evens?.swatches.length})`);
    // Anchor: mode 0x01's first frame is the first pointer in the Bank01 table.
    const m01 = g.entries.find((e) => e.label === 'Mode 0x01');
    const t = u16le(rom, symbols.pc('DATA_01C47F'));
    const expected = snesToPC(0x5f0000 | t) - blobPC;
    assert(m01?.swatches[0]?.offset === expected, `anim 0x01 first frame == DATA_01C47F[0] (${expected.toString(16)})`);
    assert(m01?.swatches.length === 104, `anim 0x01: 8 frames × 13 (got ${m01?.swatches.length})`);
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

// ── Test 5b: retry screen + bonus-game scenes ────────────────────────────────
{
  const layoutPC = symbols.pc('DATA_scene_palette_layout');
  // Retry screen (program $4A): one literal entry → CGRAM 225.. from the
  // program's own source word; everything else stays black (offset -1).
  const screens = catalog.scenes.find((g) => g.id === 'scene-screens');
  const retry = screens?.entries.find((e) => e.label === 'Retry screen');
  assert(!!retry, `Retry screen scene present`);
  if (retry) {
    const src = u16le(rom, layoutPC + 0x4a);
    assert(retry.swatches[225]?.offset === src, `retry: CGRAM 225 sourced from program-$4A word (+0x${src.toString(16)})`);
    assert(retry.swatches[255]?.offset === src + 60 - 2, `retry: CGRAM 255 is the block's last word`);
    assert(retry.swatches[0]?.offset === -1 && retry.swatches[0]?.base === 0, `retry: backdrop stays black (display-only)`);
  }
  // Bonus games (program $94): 6 full-CGRAM entries; per game, CGRAM 0 comes
  // from the program's backdrop literal and CGRAM 1 from the game's slot-0 row.
  const bonus = catalog.scenes.find((g) => g.id === 'scene-bonus');
  assert(!!bonus, `Bonus games scene group present`);
  if (bonus) {
    assert(bonus.entries.length === 6, `6 bonus-game entries (got ${bonus.entries.length})`);
    const backdrop = u16le(rom, layoutPC + 0x94);
    const t0 = symbols.pc('DATA_109A88');
    const t2 = symbols.pc('DATA_109AA0');
    for (let g = 0; g < 6; g++) {
      const e = bonus.entries[g]!;
      assert(e.swatches.length === 256, `bonus ${g + 1}: full 256-entry CGRAM`);
      assert(e.swatches[0]?.offset === backdrop, `bonus ${g + 1}: backdrop from program literal`);
      assert(e.swatches[1]?.offset === u16le(rom, t0 + g * 2), `bonus ${g + 1}: CGRAM 1 from DATA_109A88[${g}]`);
      assert(e.swatches[49]?.offset === u16le(rom, t2 + g * 2), `bonus ${g + 1}: CGRAM 49 from DATA_109AA0[${g}] (item-card row)`);
    }
  }
}

// ── Test 6: the World-map panels group (per-world panel color + sync copies) ─
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
      // Every copy must hold the SAME base color (else syncing them is wrong).
      const colors = new Set(all.map((o) => baseWord(o)));
      assert(colors.size === 1, `World ${w + 1}: all copies share one color`);
    }
    // The user's verified anchor: World 6's panel color includes blob 0x3b34.
    const w6 = panels.entries[5]!.swatches[0]!;
    const w6set = new Set([w6.offset, ...(w6.mirrors ?? [])]);
    assert(w6set.has(0x3b34), `World 6 panel-color set includes blob 0x3b34 (the anchor)`);
    assert(w6set.has(0x3da0), `World 6 panel-color set includes its own-screen copy 0x3da0`);
  }
}

console.log(`\n${failures === 0 ? '✓' : '✗'} ${failures === 0 ? 'all tests pass' : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
