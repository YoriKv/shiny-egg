// Detect-only diff inventory.
// Classifies every byte that differs between a foreign cart and the base into a
// category of cart structure — level data, graphics, tilemaps, Map16 tables,
// palette pointers, strings, world map, code, … — so the import report shows
// the FULL picture of what a hack changed instead of silently dropping the
// regions the importer doesn't apply. Pure detection: no apply path. Feeds a
// future "import the rest as a raw IPS patch" option (the patch layer exists).
//
// Attribution is three-tier, highest priority first:
//   1. Level stream extents (base + foreign) the level import already covers.
//   2. Known fixed tables/regions (vendored V1.0 symbols + the documented
//      Bank57 asset bands — see yi/Banks/Bank57.asm's header map).
//   3. The full base-build `.sym` (optional): the nearest preceding label names
//      the diff and a label-pattern rule picks the category.
// All addresses are cart PC offsets; only meaningful on a V1.0-derived cart
// (the caller gates on the resolved anchors, like palette/name import).

import { snesToPC, vendoredV10SymbolMap, type SymbolMap } from '../engine/symbol-map.ts';
import { RAW_GFX_PC_RANGE } from '../engine/gfx-file-catalog.ts';
import { LEVEL_NAME_PTR_COUNT } from '../levels-catalog.ts';
import { MESSAGE_PTR_COUNT, MESSAGE_PTR_TABLE_SNES } from '../strings.ts';
import type { InventoryCategory, RomImportInventory } from '../types.ts';

/** Category key → display label + whether a semantic import already covers it. */
const CATEGORY_DEFS: Record<string, { label: string; imported: boolean }> = {
  'level-data': { label: 'Level data (objects / sprites / exits)', imported: true },
  'level-ptrs': { label: 'Level pointer table (followed, not copied)', imported: true },
  'world-map': { label: 'World-map entrance tables', imported: true },
  strings: { label: 'Level names + message text', imported: true },
  palette: { label: 'Master palette colors', imported: true },
  'palette-ptrs': { label: 'Palette pointer tables (repointed palettes)', imported: false },
  'gfx-tables': { label: 'Graphics-selection tables (tileset / spriteset files)', imported: false },
  'gfx-ptrs': { label: 'Graphics pointer tables (followed, not copied)', imported: true },
  gradient: { label: 'Backdrop gradient colors', imported: true },
  'yoshi-colors': { label: 'Yoshi level colors', imported: true },
  'screen-tilemap': { label: 'Title-screen tilemaps (logo / island)', imported: true },
  'cutscene-text': { label: 'Cutscene text (intro / ending)', imported: true },
  map16: { label: 'Map16 page tables', imported: false },
  collision: { label: 'Collision / type tables', imported: false },
  graphics: { label: 'Compressed graphics (LZ2 / LZ16)', imported: true },
  'graphics-raw': { label: 'Raw graphics CHR (banks $52–$57)', imported: true },
  tilemaps: { label: 'Compressed BG tilemaps', imported: true },
  superfx: { label: 'SuperFX program', imported: false },
  music: { label: 'Music / sound (SPC)', imported: false },
  code: { label: '65816 code', imported: false },
  'data-other': { label: 'Other data tables', imported: false },
  'rom-header': { label: 'ROM header / checksum', imported: false },
  expanded: { label: 'Expanded ROM area (beyond 2 MB)', imported: false }
};

/** Categorise a containing `.sym` label by name (tier 3). Order matters: the
 *  IMPORTED gfx-meta labels (pointer tables, logo tilemap) are matched before the
 *  generic `tileset_files|spriteset_files|tilemap` selection-table bucket, so a
 *  relocated-graphics pointer or the imported logo tilemap isn't mis-flagged as a
 *  not-imported selection table (the EGGCELLENT false positive). */
function categorizeLabel(label: string): string {
  if (/palette_ptrs|palette_layout/i.test(label)) return 'palette-ptrs';
  if (/bitmap_asset/i.test(label)) return 'map16';
  if (/bg_type_table|slope_panels|0AEBBC/i.test(label)) return 'collision';
  if (/_SPC_|^DATA_SPC|spc700|sound_bank/i.test(label)) return 'music';
  // The compressed-gfx pointer tables are FOLLOWED by the graphics import (the
  // build re-points them when placing relocated blobs), like the level ptr table.
  if (/compressed_gfx_ptrs/i.test(label)) return 'gfx-ptrs';
  // Title-screen logo tilemap — imported (logo placement); matched before the
  // generic `tilemap` bucket below.
  if (/title_screen_logo_tilemap/i.test(label)) return 'screen-tilemap';
  // The tileset/spriteset selection tables + BG tilemap index/selection tables —
  // genuinely not imported.
  if (/tileset_files|spriteset_files|tilemap/i.test(label)) return 'gfx-tables';
  if (/^(CODE|FXCODE)_/.test(label)) return 'code';
  return 'data-other';
}

interface Interval {
  start: number;
  end: number;
  key: string;
  /** Higher wins when intervals overlap (extents > tables > bands). */
  priority: number;
}

/** Vanilla's populated string region: the message pointer table ($51:10DB) through
 *  the last level-name byte ($51:5348, just past the garbage sentinel). */
const STRINGS_REGION_PC: readonly [number, number] = [snesToPC(MESSAGE_PTR_TABLE_SNES), 0x115348];

/** Bank $51 as PC bounds. Both string pointer tables hold bank-local 16-bit words,
 *  so every message body / level-name string the game can address lives in this
 *  bank — which is also the only place a hack can put new ones. */
const STRINGS_BANK_PC: readonly [number, number] = [snesToPC(0x510000), snesToPC(0x520000)];

/**
 * Known-region interval table (tiers 1 + 2). Bands cover the Bank57 asset file
 * (`$57:3C00`+ — see that bank's header map): LZ2 graphics, tilemap blobs,
 * LZ16 graphics, the palette blob, then the `$5F` tail tables. ($57:0000–$3BFF
 * is GSU bitmap data, folded into the raw-CHR band — not the GSU program.)
 * The strings band is Bank51's message-ptr-table → name-region tail
 * (`$51:10DB`–`$51:5348`); level blobs inside it are claimed first by the
 * higher-priority level extents.
 */
function buildIntervals(levelExtents: Array<[number, number]>): Interval[] {
  const sym = vendoredV10SymbolMap();
  const out: Interval[] = [];
  for (const [start, end] of levelExtents) {
    out.push({ start, end, key: 'level-data', priority: 3 });
  }
  const idxPc = sym.pc('YI_LevelDataPtrsAndEntranceData_DATA_level_entrance_indexes');
  const ptrsPc = sym.pc('YI_LevelDataPtrsAndEntranceData_Ptrs');
  const palettePc = sym.pc('DATA_master_palette_rom_blob');
  // The now-imported fixed-address regions (resolved via the vendored map where a
  // label exists). Each is a priority-2 interval so it overrides the coarse asset
  // bands below — without these, a hack's gradient/island/logo/cutscene/gfx-ptr
  // changes mis-report as not-imported (data-other / code).
  const lz2Ptrs = sym.pc('DATA_lz2_compressed_gfx_ptrs');
  const lz16Ptrs = sym.pc('DATA_lz16_compressed_gfx_ptrs');
  const islandPc = sym.pc('DATA_5F9800');
  const logoPc = sym.pc('DATA_title_screen_logo_tilemap');
  const yoshiPc = sym.pc('DATA_yoshi_level_colors');
  out.push(
    { start: 0x7fb0, end: 0x8000, key: 'rom-header', priority: 2 },
    { start: idxPc, end: ptrsPc, key: 'world-map', priority: 2 },
    { start: ptrsPc, end: ptrsPc + 222 * 6, key: 'level-ptrs', priority: 2 },
    // $51:10DB (message ptr table) … $51:5348 (the bank's free tail) — message
    // bodies + level-name strings; PC = (bank-$40)<<16 | offset. A hack that
    // outgrows the region spills into the free tail past this end; those bytes are
    // reclaimed by `stringSpillBlocks`.
    { start: STRINGS_REGION_PC[0], end: STRINGS_REGION_PC[1], key: 'strings', priority: 2 },
    { start: palettePc, end: palettePc + 0x2000, key: 'palette', priority: 2 },
    // Compressed-gfx pointer tables (LZ2 then LZ16, contiguous) — followed by the
    // graphics import; the build re-points them when placing relocated blobs.
    { start: lz2Ptrs, end: lz16Ptrs + 187 * 3, key: 'gfx-ptrs', priority: 2 },
    // Cutscene text bodies — intro storybook (Bank0F $0F:CF78–$0F:D56E) + ending
    // (Bank0D $0D:F3E8–$0D:F4F7). Imported via readForeignGlyphTable.
    { start: 0x6f3e8, end: 0x6f4f7, key: 'cutscene-text', priority: 2 },
    { start: 0x7cf78, end: 0x7d56e, key: 'cutscene-text', priority: 2 },
    // Title-screen placement tilemaps — island (1024 Mode-7 char bytes) + logo
    // (448 BG words). Imported.
    { start: islandPc, end: islandPc + 1024, key: 'screen-tilemap', priority: 2 },
    { start: logoPc, end: logoPc + 448 * 2, key: 'screen-tilemap', priority: 2 },
    // Backdrop gradient tables (16 × 24 BGR-15 words, DATA_5FD64C…) — imported.
    { start: 0x1fd64c, end: 0x1fd94c, key: 'gradient', priority: 2 },
    // Per-level Yoshi-color LUT (DATA_yoshi_level_colors, 72 bytes) — imported.
    { start: yoshiPc, end: yoshiPc + 72, key: 'yoshi-colors', priority: 2 },
    // Raw-CHR graphics banks $52–$56 (animation tiles, world-map icons, sprite /
    // dynamic-body gfx, world-map char base) — imported via the raw-CHR path.
    // $52–$57:3BFF incl. DATA_570000.bin — GSU bitmap data, not the GSU program
    // (corrected: research/graphics-survey/11-vram-loading.md §4; the program is
    // banks $08–$0B, and the "$57 = H-flip mirror of $56" theory is byte-disproven).
    { start: RAW_GFX_PC_RANGE[0], end: RAW_GFX_PC_RANGE[1], key: 'graphics-raw', priority: 1 },
    // Bank57 asset bands (file offsets, from the bank's documented layout).
    { start: 0x173c00, end: 0x1b0000, key: 'graphics', priority: 1 },
    { start: 0x1b0000, end: 0x1d0000, key: 'tilemaps', priority: 1 },
    { start: 0x1d0000, end: 0x1fa000, key: 'graphics', priority: 1 },
    { start: 0x1fc000, end: 0x200000, key: 'data-other', priority: 1 }
  );
  return out;
}

interface Tally {
  bytes: number;
  runs: number;
  examples: string[];
}

function describePc(pc: number, segBytes: number, symbols: SymbolMap | undefined): string {
  const hit = symbols?.reverseLookup(pc);
  const loc = hit
    ? hit.delta === 0
      ? hit.label
      : `${hit.label}+0x${hit.delta.toString(16).toUpperCase()}`
    : `0x${pc.toString(16).toUpperCase().padStart(6, '0')}`;
  return `${loc} (${segBytes} B)`;
}

/** Count the bytes in `[start, end)` that actually differ (runs are
 *  gap-coalesced, so a segment can contain equal bytes). */
function countDiff(foreign: Buffer, base: Buffer, start: number, end: number): number {
  let n = 0;
  for (let i = start; i < end; i++) if (foreign[i] !== base[i]) n++;
  return n;
}

/** Max equal-byte gap bridged inside one diff run (keeps scattered single-byte
 *  edits in a table from counting as hundreds of runs). */
const RUN_GAP = 8;

export interface InventoryOptions {
  /** PC extents `[start, end)` the level-placement import covers (base +
   *  foreign stream spans). */
  levelExtents: Array<[number, number]>;
  /** Foreign cart `Ptrs:`-table stream targets (PC offsets, obj + spr, every
   *  record). A hack that relocates a level stream into a vanilla free-space
   *  tail leaves the walked stream itself claimed by `levelExtents`, but the
   *  allocator's zero-fill padding around it (and any stream-edge bytes the
   *  walker stops short of) would otherwise read as not-imported "Other data
   *  tables". Each target whose BASE byte is filler marks a relocation
   *  free-space block — the maximal vanilla-filler span containing it — and the
   *  whole block is attributed to level data, since a `Ptrs` pointer into
   *  vanilla free space IS the hack repacking level data there. See
   *  `fillerBlocks`. */
  levelPtrTargets?: number[];
  /** Full base-build symbol map (main + superfx merged) for tier-3 label
   *  attribution; absent ⇒ leftovers fall to coarse bank classification. */
  symbols?: SymbolMap;
}

/** A byte is "filler" when it's the unused-ROM fill the relocation allocator
 *  carves free space out of (0x00 or 0xFF). */
const isFiller = (b: number): boolean => b === 0x00 || b === 0xff;

/**
 * Free-space blocks a foreign pointer table targets (tier 1.5): for each target
 * whose BASE byte is filler — i.e. the hack pointed something into vanilla free
 * space — return the maximal contiguous run of base filler that contains it,
 * optionally clamped to `bounds`. Diff bytes inside such a block belong to
 * whatever that table addresses (a relocated level stream plus its zero-fill
 * padding; an extended string table), NOT a data table. Targets that land on real
 * base data (an in-place edit, not a relocation) produce no block, so genuine
 * engine-table edits are untouched. Returned spans may be merged (two targets in
 * one filler run yield one block) and are scanned at most once each.
 */
function fillerBlocks(
  base: Buffer,
  targets: number[],
  bounds?: readonly [number, number]
): Array<[number, number]> {
  const lo = Math.max(0, bounds ? bounds[0] : 0);
  const hi = Math.min(base.length, bounds ? bounds[1] : base.length);
  const blocks: Array<[number, number]> = [];
  let coveredTo = -1;
  for (const t of [...new Set(targets)].sort((a, b) => a - b)) {
    if (t <= coveredTo || t < lo || t >= hi || !isFiller(base[t])) continue;
    let s = t;
    let e = t;
    while (s > lo && isFiller(base[s - 1])) s--;
    while (e < hi && isFiller(base[e])) e++;
    blocks.push([s, e]);
    coveredTo = e - 1;
  }
  return blocks;
}

/**
 * Bank $51 free-tail blocks the foreign cart's string tables spill into (tier 1.5,
 * the strings analogue of the relocated-level-data rule above). Vanilla's string
 * region ends at $51:5348 and the rest of the bank is untouched filler; a hack
 * whose message / level-name text outgrows the region repoints slots into that
 * tail. Both readers FOLLOW the foreign pointer tables
 * (`readForeignMessages` / `readForeignLevelNames`), so the spilled text IS
 * imported — without this it lands just past `DATA_level_name_garbage_sentinel`
 * (the region's last byte) with no containing band or later label, and reports as
 * not-imported "Other data tables" (the EGGCELLENT extended-string-table case).
 *
 * Evidence-driven like `fillerBlocks`' level-data use: only a tail a foreign
 * string pointer actually targets is claimed, so a hack that parks unrelated data
 * in bank $51 still reports it honestly. Clamped to bank $51 because a bank-local
 * 16-bit pointer cannot reach further — and the vanilla filler run does bleed two
 * bytes into the bank $52 raw-CHR band.
 */
function stringSpillBlocks(foreign: Buffer, base: Buffer): Array<[number, number]> {
  const sym = vendoredV10SymbolMap();
  const targets: number[] = [];
  const collect = (tablePc: number, count: number): void => {
    for (let i = 0; i < count; i++) {
      const off = tablePc + i * 2;
      if (off + 2 > foreign.length) break;
      const word = foreign[off] | (foreign[off + 1] << 8);
      if (word === 0) continue; // slot the hack deleted
      const pc = snesToPC(0x510000 | word);
      if (pc >= STRINGS_REGION_PC[1]) targets.push(pc); // only the spill past vanilla's end
    }
  };
  collect(STRINGS_REGION_PC[0], MESSAGE_PTR_COUNT);
  collect(sym.pc('DATA_level_name_string_ptrs'), LEVEL_NAME_PTR_COUNT);
  return fillerBlocks(base, targets, STRINGS_BANK_PC);
}

/**
 * Walk the byte diff of `foreign` vs `base` and attribute every differing byte
 * to a category. Returns only non-empty categories, descending by bytes.
 */
export function diffInventory(
  foreign: Buffer,
  base: Buffer,
  opts: InventoryOptions
): RomImportInventory {
  const intervals = buildIntervals(opts.levelExtents);
  // Relocated-level-data free-space blocks (Ptrs target sitting in vanilla
  // filler) override the coarse bands + data-other fallback, like a level extent.
  for (const [start, end] of fillerBlocks(base, opts.levelPtrTargets ?? [])) {
    intervals.push({ start, end, key: 'level-data', priority: 3 });
  }
  // Extended string tables spilling into bank $51's free tail — same band
  // priority as the vanilla string region it continues (so a level stream
  // relocated into the same tail still wins at priority 3).
  for (const [start, end] of stringSpillBlocks(foreign, base)) {
    intervals.push({ start, end, key: 'strings', priority: 2 });
  }
  const tallies = new Map<string, Tally>();
  const tally = (key: string): Tally => {
    let t = tallies.get(key);
    if (!t) {
      t = { bytes: 0, runs: 0, examples: [] };
      tallies.set(key, t);
    }
    return t;
  };

  /** Highest-priority interval containing `pc` + where its claim ends (clipped
   *  by any higher-priority interval starting inside it). Linear scan — the
   *  table is small (~10 + level extents) and the walk is per-run. */
  const classify = (pc: number, runEnd: number): { key: string; end: number } => {
    let best: Interval | null = null;
    for (const iv of intervals) {
      if (pc >= iv.start && pc < iv.end && (!best || iv.priority > best.priority)) best = iv;
    }
    let end = Math.min(runEnd, best ? best.end : runEnd);
    for (const iv of intervals) {
      if (iv.start > pc && iv.start < end && (!best || iv.priority > best.priority)) end = iv.start;
    }
    if (best) return { key: best.key, end };
    // Tier 3: nearest preceding label names the region; LoROM defaults to code,
    // SuperFX-mapped banks to data (level pools / cel tables / GSU data).
    const hit = opts.symbols?.reverseLookup(pc);
    if (hit) return { key: categorizeLabel(hit.label), end };
    return { key: pc < 0xc0000 ? 'code' : 'data-other', end };
  };

  // ── diff runs over the shared length ──
  const n = Math.min(foreign.length, base.length);
  let totalDiffBytes = 0;
  let i = 0;
  while (i < n) {
    if (foreign[i] === base[i]) {
      i++;
      continue;
    }
    // A run: differing bytes, bridging equal gaps ≤ RUN_GAP.
    const start = i;
    let last = i;
    while (i < n) {
      if (foreign[i] !== base[i]) {
        last = i;
        i++;
        continue;
      }
      if (i - last > RUN_GAP) break;
      i++;
    }
    const runEnd = last + 1;
    // Split the run across intervals; attribute each segment.
    let p = start;
    while (p < runEnd) {
      const { key, end } = classify(p, runEnd);
      const segBytes = countDiff(foreign, base, p, end);
      if (segBytes > 0) {
        const t = tally(key);
        t.bytes += segBytes;
        t.runs++;
        if (t.examples.length < 3) t.examples.push(describePc(p, segBytes, opts.symbols));
        totalDiffBytes += segBytes;
      }
      p = end;
    }
  }

  // ── expansion beyond the base 2 MB: count non-filler bytes ──
  if (foreign.length > base.length) {
    let used = 0;
    for (let p = base.length; p < foreign.length; p++) {
      if (foreign[p] !== 0x00 && foreign[p] !== 0xff) used++;
    }
    if (used > 0) {
      const t = tally('expanded');
      t.bytes += used;
      t.runs++;
      t.examples.push(
        `ROM expanded to ${(foreign.length / 0x100000).toFixed(1)} MB (${used} B used)`
      );
      totalDiffBytes += used;
    }
  }

  const categories: InventoryCategory[] = [...tallies.entries()]
    .map(([key, t]) => ({
      key,
      label: CATEGORY_DEFS[key]?.label ?? key,
      bytes: t.bytes,
      runs: t.runs,
      imported: CATEGORY_DEFS[key]?.imported ?? false,
      examples: t.examples
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return { totalDiffBytes, categories };
}
