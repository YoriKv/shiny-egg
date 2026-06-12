// Detect-only diff inventory (plan-rom-import.md §10/P5 reporting half).
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

import { vendoredV10SymbolMap, type SymbolMap } from '../engine/symbol-map.ts';
import type { InventoryCategory, RomImportInventory } from '../types.ts';

/** Category key → display label + whether a semantic import already covers it. */
const CATEGORY_DEFS: Record<string, { label: string; imported: boolean }> = {
  'level-data': { label: 'Level data (objects / sprites / exits)', imported: true },
  'level-ptrs': { label: 'Level pointer table (followed, not copied)', imported: true },
  'world-map': { label: 'World-map entrance tables', imported: true },
  strings: { label: 'Level names + message text', imported: true },
  palette: { label: 'Master palette colours', imported: true },
  'palette-ptrs': { label: 'Palette pointer tables (repointed palettes)', imported: false },
  'gfx-tables': { label: 'Graphics-selection tables (tileset / spriteset files)', imported: false },
  map16: { label: 'Map16 page tables', imported: false },
  collision: { label: 'Collision / type tables', imported: false },
  graphics: { label: 'Compressed graphics (LZ2 / LZ16)', imported: false },
  tilemaps: { label: 'Compressed BG tilemaps', imported: false },
  superfx: { label: 'SuperFX program', imported: false },
  music: { label: 'Music / sound (SPC)', imported: false },
  code: { label: '65816 code', imported: false },
  'data-other': { label: 'Other data tables', imported: false },
  'rom-header': { label: 'ROM header / checksum', imported: false },
  expanded: { label: 'Expanded ROM area (beyond 2 MB)', imported: false }
};

/** Categorise a containing `.sym` label by name (tier 3). */
function categorizeLabel(label: string): string {
  if (/palette_ptrs|palette_layout/i.test(label)) return 'palette-ptrs';
  if (/bitmap_asset/i.test(label)) return 'map16';
  if (/bg_type_table|slope_panels|0AEBBC/i.test(label)) return 'collision';
  if (/_SPC_|^DATA_SPC|spc700|sound_bank/i.test(label)) return 'music';
  if (/tileset_files|spriteset_files|gfx_ptrs|tilemap/i.test(label)) return 'gfx-tables';
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

/**
 * Known-region interval table (tiers 1 + 2). Bands cover the Bank57 asset file
 * (`$57:3C00`+ — see that bank's header map): SuperFX program, LZ2 graphics,
 * tilemap blobs, LZ16 graphics, the palette blob, then the `$5F` tail tables.
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
  out.push(
    { start: 0x7fb0, end: 0x8000, key: 'rom-header', priority: 2 },
    { start: idxPc, end: ptrsPc, key: 'world-map', priority: 2 },
    { start: ptrsPc, end: ptrsPc + 222 * 6, key: 'level-ptrs', priority: 2 },
    // $51:10DB (message ptr table) … $51:5348 (the bank's free tail) — message
    // bodies + level-name strings; PC = (bank-$40)<<16 | offset.
    { start: 0x1110db, end: 0x115348, key: 'strings', priority: 2 },
    { start: palettePc, end: palettePc + 0x2000, key: 'palette', priority: 2 },
    // Bank57 asset bands (file offsets, from the bank's documented layout).
    { start: 0x170000, end: 0x173c00, key: 'superfx', priority: 1 },
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
  /** Full base-build symbol map (main + superfx merged) for tier-3 label
   *  attribution; absent ⇒ leftovers fall to coarse bank classification. */
  symbols?: SymbolMap;
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
