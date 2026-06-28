// Whole-game palette catalog — every palette the cart can select out of the
// master palette blob (`DATA_master_palette_rom_blob`), organised two ways:
//
//   • catalog — by the cart's palette POINTER TABLES: each BG1 / BG2 / BG3 /
//     sprite / Yoshi id, every backdrop colour, plus the fixed/universal literal
//     rows. The complete set of selectable palettes, labelled with what the
//     graphics pipeline knows (see research/graphics-editing/palettes.md).
//   • scenes — the composed CGRAM for each known non-level CONTEXT (boot, title,
//     storybook, per-world maps), via the shared scene interpreter.
//
// Both axes carry, per swatch, the master-blob BYTE-OFFSET that backs it — the
// exact `PaletteEdit.offset` an edit writes — so the catalog reuses the global
// blob-offset edit model for free (an edit propagates everywhere that offset is
// used, identical to the per-level Palette panel).
//
// The category layout is derived (not hardcoded) from the in-level palette
// program: `mapPaletteProgram` walks `scene_palette_layout` exactly like the
// cart's `CODE_load_palettes` (load-palettes.ts `runPaletteProgram`), recording
// for each CGRAM colour index which DP slot (BG1/BG2/…) or literal source backs
// it. So a level-1 BG1 palette = the slot-1 cells offset by the BG1 pointer; the
// fixed sprite rows = the program's literal cells. Robust to the program /
// pointer tables shifting under an asm edit.

import type { SymbolMap } from './symbol-map.ts';
import { u16le } from './rom-read.ts';
import { loadScenePalettes, type ScenePalette } from './load-palettes.ts';
import { titleVariant, mapPalette, WORLD_COUNT } from './screen-scene.ts';
import type {
  PaletteCatalog,
  PaletteCatalogEntry,
  PaletteCatalogGroup,
  PaletteCatalogSwatch
} from '../types.ts';

const PROGRAM_END = 0xffff;
/** First backdrop colour's blob byte-offset; 256 consecutive BGR-15 words. */
const BACKDROP_BASE_OFFSET = 0x0130;
/** The BG1-alt (DP `$1A`) pointer = BG1 pointer + this (load-palettes.ts). The
 *  in-level program's slot-5 reads here — the object-tint tail of a BG1 palette. */
const BG1_ALT_DELTA = 0x003c;
/** `scene_palette_layout` byte offset of the in-level program (the one the
 *  catalog's category layout is derived from). 0 = `CODE_load_level_palettes`. */
const IN_LEVEL_PROGRAM_START = 0;

/** Resolves a master-blob byte-offset to its PRISTINE (pre-edit) BGR-15 word.
 *  The caller supplies it (the main side reads the base Bank57 blob) so this
 *  module stays file-free; the UI overlays the live edit draft on top. */
export type BaseWord = (offset: number) => number;

/** Where one CGRAM colour index's value comes from in the palette program. */
interface ProgramCell {
  /** DP slot 0..6 (0 backdrop, 1 BG1, 2 BG2, 3 BG3, 4 sprite, 5 BG1-alt, 6 Yoshi),
   *  or `-1` for a literal source. */
  slot: number;
  /** For a DP slot: byte offset added to the slot's pointer. For a literal
   *  (slot `-1`): the absolute blob byte-offset. */
  src: number;
}

/** A CGRAM colour index + the byte offset (relative to a pointer) that fills it. */
interface CellRef {
  idx: number;
  relOff: number;
}

/**
 * Walk the `scene_palette_layout` program from `startOffset`, recording for each
 * of the 256 CGRAM colour indices which palette SOURCE backs it. Mirrors
 * `runPaletteProgram`'s address math but records provenance instead of copying
 * colours (last write wins, like the cart). Indices the program never writes
 * stay `null`.
 */
function mapPaletteProgram(
  rom: Uint8Array,
  symbols: SymbolMap,
  startOffset: number
): (ProgramCell | null)[] {
  const PC = symbols.pc('DATA_scene_palette_layout');
  const cells: (ProgramCell | null)[] = new Array(256).fill(null);
  let prog = PC + startOffset;
  for (let guard = 0; guard < 10_000; guard++) {
    const sourceWord = u16le(rom, prog);
    if (sourceWord === PROGRAM_END) break;
    const isIndirect = (sourceWord & 0x8000) !== 0;
    const slot = isIndirect ? (sourceWord & 0x7fff) >>> 1 : -1;
    const literalBase = isIndirect ? 0 : sourceWord;
    const cgramByte = rom[prog + 2]!;
    const sizeByte = rom[prog + 3]!;
    const colorsPerRow = sizeByte & 0x0f;
    const rows = (sizeByte >>> 4) & 0x0f;
    let destByte = (cgramByte << 1) & 0xffff;
    let rel = 0; // byte offset within the source (advances continuously)
    for (let r = 0; r < rows; r++) {
      let d = destByte;
      for (let c = 0; c < colorsPerRow; c++) {
        const idx = d >>> 1;
        if (idx < 256) {
          cells[idx] = isIndirect
            ? { slot, src: rel }
            : { slot: -1, src: (literalBase + rel) & 0xffff };
        }
        rel += 2;
        d += 2;
      }
      destByte = (destByte + 0x20) & 0xffff;
    }
    prog += 4;
  }
  return cells;
}

/** All CGRAM cells the program fills from DP `slot`, as pointer-relative refs. */
function cellsForSlot(cells: (ProgramCell | null)[], slot: number): CellRef[] {
  const out: CellRef[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c && c.slot === slot) out.push({ idx: i, relOff: c.src });
  }
  return out;
}

/** Display width = the widest single CGRAM row the cells span (= the cart's
 *  colours-per-row), so a strip lays out one CGRAM row per display row. */
function rowWidth(cells: CellRef[]): number {
  const perRow = new Map<number, number>();
  for (const c of cells) {
    const row = c.idx >>> 4;
    perRow.set(row, (perRow.get(row) ?? 0) + 1);
  }
  let max = 1;
  for (const n of perRow.values()) if (n > max) max = n;
  return max;
}

const hex2 = (n: number): string => '0x' + n.toString(16).padStart(2, '0');

/** Build one catalog entry: a pointer + the (pointer-relative) cells it fills. */
function entryForPointer(
  label: string,
  sublabel: string | undefined,
  pointer: number,
  cells: CellRef[],
  baseWord: BaseWord
): PaletteCatalogEntry {
  const sorted = [...cells].sort((a, b) => a.relOff - b.relOff);
  const swatches: PaletteCatalogSwatch[] = sorted.map((c) => {
    const offset = (pointer + c.relOff) & 0xffff;
    return { offset, base: baseWord(offset) };
  });
  return { label, sublabel, cols: rowWidth(sorted), swatches };
}

/** A pointer table → one catalog group (one entry per selectable id). */
interface SlotTable {
  id: string;
  label: string;
  note: string;
  symbol: string;
  count: number;
  /** DP slot the program fills from this pointer. */
  slot: number;
  /** When set, also fold in the BG1-alt (slot 5) tail at `+BG1_ALT_DELTA`. */
  withAltTail?: boolean;
  /** Per-entry secondary label (the CGRAM rows + pipeline meaning). */
  sublabel: string;
}

const SLOT_TABLES: SlotTable[] = [
  {
    id: 'bg1',
    label: 'BG1 palettes',
    note: 'Level terrain (BG1). Selected by header BG1Palette; loaded into CGRAM rows 4–5.',
    symbol: 'DATA_bg1_palette_ptrs',
    count: 32,
    slot: 1,
    withAltTail: true,
    sublabel: 'rows 4–5 · terrain (+ object-tint tail in rows 1–3)'
  },
  {
    id: 'bg1-dark',
    label: 'BG1 palettes — World 6 (dark)',
    note: 'World-6 variant of the BG1 table (CODE_load_level_palettes picks it for World 6).',
    symbol: 'DATA_bg1_dark_world_palette_ptrs',
    count: 32,
    slot: 1,
    withAltTail: true,
    sublabel: 'rows 4–5 · dark-world terrain'
  },
  {
    id: 'bg2',
    label: 'BG2 palettes',
    note: 'BG2 background. Selected by header BG2Palette; loaded into CGRAM rows 6–7.',
    symbol: 'DATA_bg2_palette_ptrs',
    count: 64,
    slot: 2,
    sublabel: 'rows 6–7 · background'
  },
  {
    id: 'bg3',
    label: 'BG3 palettes',
    note: 'BG3 background (2bpp sub-palettes). Selected by header BG3Palette; loaded into CGRAM row 0.',
    symbol: 'DATA_bg3_palette_ptrs',
    count: 64,
    slot: 3,
    sublabel: 'row 0 · 2bpp sub-palettes'
  },
  {
    id: 'sprite',
    label: 'Sprite palettes',
    note: 'Header SpritePalette → OBJ palettes 6–7 (CGRAM rows 14–15). OBJ 0–4 are fixed (below).',
    symbol: 'DATA_sprite_palette_ptrs',
    count: 16,
    slot: 4,
    sublabel: 'OBJ pal 6–7 · CGRAM rows 14–15'
  },
  {
    id: 'yoshi',
    label: 'Yoshi palettes',
    note: 'Per Yoshi colour → OBJ palette 5 (CGRAM row 13).',
    symbol: 'DATA_yoshi_palette_ptrs',
    count: 8,
    slot: 6,
    sublabel: 'OBJ pal 5 · CGRAM row 13'
  }
];

/** Semantic label for a fixed/literal block, keyed by its first CGRAM row. */
function fixedBlockLabel(firstRow: number, lastRow: number): { label: string; sublabel: string } {
  if (firstRow >= 1 && firstRow <= 3) {
    return {
      label: 'Universal object rows',
      sublabel: `CGRAM rows ${firstRow}–${lastRow} · coins / !-switch / star (level-independent)`
    };
  }
  if (firstRow >= 8 && firstRow <= 12) {
    return {
      label: 'Fixed sprite palettes (OBJ 0–4)',
      sublabel: `CGRAM rows ${firstRow}–${lastRow} · global sprite colours (level-invariant)`
    };
  }
  return { label: 'Fixed colours', sublabel: `CGRAM rows ${firstRow}–${lastRow}` };
}

/** Literal cells → entries, split into runs of contiguous source offsets (each
 *  run is one `dw`-literal block in the program, e.g. the universal object rows
 *  vs the fixed sprite rows). */
function buildFixedGroup(cells: (ProgramCell | null)[], baseWord: BaseWord): PaletteCatalogGroup | null {
  const lits: { idx: number; off: number }[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c && c.slot === -1) lits.push({ idx: i, off: c.src });
  }
  if (lits.length === 0) return null;
  lits.sort((a, b) => a.off - b.off);
  const entries: PaletteCatalogEntry[] = [];
  let run: { idx: number; off: number }[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const rows = run.map((r) => r.idx >>> 4);
    const { label, sublabel } = fixedBlockLabel(Math.min(...rows), Math.max(...rows));
    const refs: CellRef[] = run.map((r) => ({ idx: r.idx, relOff: 0 }));
    const swatches: PaletteCatalogSwatch[] = run.map((r) => ({ offset: r.off, base: baseWord(r.off) }));
    entries.push({ label, sublabel, cols: rowWidth(refs), swatches });
    run = [];
  };
  for (const lit of lits) {
    const prev = run[run.length - 1];
    if (prev && lit.off !== prev.off + 2) flush();
    run.push(lit);
  }
  flush();
  return {
    id: 'fixed',
    label: 'Fixed / universal colours',
    note: 'Loaded from literal sources in the palette program — the same for every level (not header-selected).',
    entries
  };
}

/** Build the master-blob catalog (the pointer-table axis). */
function buildCatalogGroups(
  rom: Uint8Array,
  symbols: SymbolMap,
  cells: (ProgramCell | null)[],
  baseWord: BaseWord
): PaletteCatalogGroup[] {
  const groups: PaletteCatalogGroup[] = [];

  // Backdrop — 256 single colours, selected by the header backdrop index.
  const backdrop: PaletteCatalogSwatch[] = [];
  for (let i = 0; i < 256; i++) {
    const offset = (BACKDROP_BASE_OFFSET + i * 2) & 0xffff;
    backdrop.push({ offset, base: baseWord(offset) });
  }
  groups.push({
    id: 'backdrop',
    label: 'Backdrop colours',
    note: 'The 256 selectable background (CGRAM index 0) colours — header BackgroundColor picks one.',
    entries: [{ label: 'Backdrop palette', sublabel: '256 colours · header BackgroundColor', cols: 16, swatches: backdrop }]
  });

  // Pointer tables.
  const altTail = cellsForSlot(cells, 5).map((c) => ({ idx: c.idx, relOff: (BG1_ALT_DELTA + c.relOff) & 0xffff }));
  for (const t of SLOT_TABLES) {
    let tablePC: number;
    try {
      tablePC = symbols.pc(t.symbol);
    } catch {
      continue; // table symbol absent (e.g. an unported variant) — skip the group
    }
    const slotCells = cellsForSlot(cells, t.slot);
    const cellTemplate = t.withAltTail ? [...slotCells, ...altTail] : slotCells;
    if (cellTemplate.length === 0) continue;
    const entries: PaletteCatalogEntry[] = [];
    for (let n = 0; n < t.count; n++) {
      const pointer = u16le(rom, tablePC + n * 2);
      entries.push(entryForPointer(`#${hex2(n)}`, t.sublabel, pointer, cellTemplate, baseWord));
    }
    groups.push({ id: t.id, label: t.label, note: t.note, entries });
  }

  // Fixed / universal literal rows.
  const fixed = buildFixedGroup(cells, baseWord);
  if (fixed) groups.push(fixed);

  return groups;
}

/**
 * The per-world dominant level-icon panel background colour (the "World map
 * panels" group). Each world's level-select panel draws at a per-world palette
 * ROW — the `DATA_17C9EA` tint (`value >> 10`: W1→3, W2→4, W3→5, W4→0, W5→1,
 * W6→2) — and the panel's background fill is column 12 of that row. So a world's
 * panel colour is CGRAM[`tintRow*16 + 12`] on its own map screen.
 *
 * Worlds whose tint row is 3–6 read from the SHARED literal block (one blob
 * offset → one edit recolours everywhere). Worlds whose tint row is 0–2 read
 * from the PER-WORLD sub-palettes, and the cart stores the same colour once in
 * each of the 6 world palettes (so every world's tab renders correctly on every
 * screen) — those get `mirrors` so one swatch edit syncs all copies.
 *
 * Derived empirically from the map-palette provenance (robust to the program /
 * pointer-table layout shifting), anchored on the verified W6 = blob 0x3b34.
 */
const WORLD_PANEL_COLUMN = 12;

function buildWorldPanelGroup(
  rom: Uint8Array,
  symbols: SymbolMap,
  baseWord: BaseWord
): PaletteCatalogGroup | null {
  let tintPC: number;
  try {
    tintPC = symbols.pc('DATA_17C9EA');
  } catch {
    return null;
  }
  // Each world's map CGRAM provenance — so we can read the exact blob offset
  // backing the panel cell, per screen.
  const prov: Int32Array[] = [];
  for (let w = 0; w < WORLD_COUNT; w++) {
    const cgram = new Uint8Array(512);
    const pv = new Int32Array(256);
    try {
      loadScenePalettes(rom, symbols, mapPalette(rom, symbols, w), cgram, pv);
    } catch {
      return null;
    }
    prov.push(pv);
  }
  const entries: PaletteCatalogEntry[] = [];
  for (let w = 0; w < WORLD_COUNT; w++) {
    const tintRow = u16le(rom, tintPC + w * 2) >>> 10;
    const idx = tintRow * 16 + WORLD_PANEL_COLUMN;
    const own = prov[w]![idx]!; // this world's own-screen copy
    if (own < 0) continue;
    // Every distinct blob offset that holds this panel cell across the 6 screens.
    const copies = [...new Set(prov.map((p) => p[idx]!).filter((o) => o >= 0))];
    const mirrors = copies.filter((o) => o !== own);
    const swatch: PaletteCatalogSwatch = { offset: own, base: baseWord(own) };
    if (mirrors.length > 0) swatch.mirrors = mirrors;
    entries.push({
      label: `World ${w + 1}`,
      sublabel:
        mirrors.length > 0
          ? `row ${tintRow} · ${copies.length} copies (one edit syncs all)`
          : `row ${tintRow} · shared (single offset)`,
      cols: 1,
      swatches: [swatch]
    });
  }
  if (entries.length === 0) return null;
  return {
    id: 'scene-world-panels',
    label: 'World map panels',
    note: 'Dominant level-icon panel background colour per world (its world-tab tinted into a palette row). Worlds 4–6 store the colour once per world palette; editing one swatch updates every copy.',
    entries
  };
}

/** One labelled non-level scene whose CGRAM the catalog snapshots. */
interface SceneDesc {
  label: string;
  sublabel: string;
  palette: ScenePalette;
}

/** Build the scene CGRAM snapshot groups (the context axis). Each scene's full
 *  256-entry CGRAM is rendered as one entry; non-blob entries (`offset -1`) keep
 *  their composed colour and are display-only. */
function buildSceneGroups(rom: Uint8Array, symbols: SymbolMap, baseWord: BaseWord): PaletteCatalogGroup[] {
  // Boot + story-cutscene palette programs are literal-only (no DP slots). Title +
  // map carry per-scene DP pointer slots, resolved by the exported helpers. The
  // storybook intro is NOT a program (bespoke fill) — built separately below.
  const screens: SceneDesc[] = [];
  const push = (label: string, sublabel: string, make: () => ScenePalette): void => {
    try {
      screens.push({ label, sublabel, palette: make() });
    } catch {
      /* a scene's symbols/pointers are unavailable — skip it */
    }
  };
  push('Boot', '"Nintendo Presents" boot screen', () => ({ startOffset: 0x40, slots: [] }));
  push('Title', 'Title screen (rotating island)', () => titleVariant(rom, symbols).palette);
  // Program X=$50 — the between-world / opening story cutscene (gm05), all fixed blob
  // literals. (This was mislabelled "Storybook"; the real storybook is the bespoke
  // entry below — see yi-shiny scene-palettes.md §3.4.)
  push('Story cutscene', 'Between-world / opening story pages (gm05)', () => ({ startOffset: 0x50, slots: [] }));

  const maps: SceneDesc[] = [];
  for (let w = 0; w < WORLD_COUNT; w++) {
    try {
      maps.push({ label: `World ${w + 1} map`, sublabel: 'Overworld level-select', palette: mapPalette(rom, symbols, w) });
    } catch {
      /* skip a world whose map palette can't resolve */
    }
  }

  const toEntry = (s: SceneDesc): PaletteCatalogEntry | null => {
    const cgram = new Uint8Array(512);
    const provenance = new Int32Array(256);
    try {
      loadScenePalettes(rom, symbols, s.palette, cgram, provenance);
    } catch {
      return null;
    }
    const swatches: PaletteCatalogSwatch[] = [];
    for (let i = 0; i < 256; i++) {
      const offset = provenance[i]!;
      const base = offset >= 0 ? baseWord(offset) : (cgram[i * 2]! | (cgram[i * 2 + 1]! << 8));
      swatches.push({ offset, base });
    }
    return { label: s.label, sublabel: s.sublabel, cols: 16, swatches };
  };

  // Storybook intro (gm38/gm39) — a bespoke CGRAM fill, NOT a scene_palette_layout
  // program (Bank10.asm:10716, yi-shiny scene-palettes.md §3.4): OBJ half (colours
  // $80–$FF) ← blob DATA_5FED4A in order; BG half = white-literal pages (display-only).
  const storybookEntry = (): PaletteCatalogEntry | null => {
    let objOff: number;
    try {
      objOff = (symbols.pc('DATA_5FED4A') - symbols.pc('DATA_master_palette_rom_blob')) & 0xffff;
    } catch {
      return null;
    }
    const swatches: PaletteCatalogSwatch[] = [];
    for (let i = 0; i < 256; i++) {
      if (i >= 0x80) {
        const offset = (objOff + (i - 0x80) * 2) & 0xffff;
        swatches.push({ offset, base: baseWord(offset) });
      } else {
        swatches.push({ offset: -1, base: 0x7fff }); // BG half = white storybook pages
      }
    }
    return { label: 'Storybook', sublabel: 'Intro storybook — OBJ from $5F:ED4A; BG white', cols: 16, swatches };
  };

  const groups: PaletteCatalogGroup[] = [];
  const screenEntries = screens.map(toEntry).filter((e): e is PaletteCatalogEntry => e !== null);
  const sb = storybookEntry();
  if (sb) screenEntries.push(sb);
  if (screenEntries.length > 0) {
    groups.push({
      id: 'scene-screens',
      label: 'System screens',
      note: 'Composed CGRAM for each non-level screen. Editable entries map back to the shared master blob.',
      entries: screenEntries
    });
  }
  const panels = buildWorldPanelGroup(rom, symbols, baseWord);
  if (panels) groups.push(panels);

  const mapEntries = maps.map(toEntry).filter((e): e is PaletteCatalogEntry => e !== null);
  if (mapEntries.length > 0) {
    groups.push({
      id: 'scene-maps',
      label: 'World maps',
      note: 'Per-world overworld palette (tinted level-select). Shares blob colours with levels.',
      entries: mapEntries
    });
  }
  return groups;
}

/**
 * Build the whole-game palette catalog from the built cart + symbols. `baseWord`
 * resolves a blob byte-offset to its pristine (pre-edit) BGR-15 word, so the
 * result is the base palette the UI overlays its live edit draft onto (matching
 * the per-level panel, independent of build freshness).
 */
export function buildPaletteCatalog(rom: Uint8Array, symbols: SymbolMap, baseWord: BaseWord): PaletteCatalog {
  const cells = mapPaletteProgram(rom, symbols, IN_LEVEL_PROGRAM_START);
  return {
    catalog: buildCatalogGroups(rom, symbols, cells, baseWord),
    scenes: buildSceneGroups(rom, symbols, baseWord)
  };
}
