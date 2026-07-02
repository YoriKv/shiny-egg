// Whole-game palette catalog — every palette the cart can select out of the
// master palette blob (`DATA_master_palette_rom_blob`), organised two ways:
//
//   • catalog — by the cart's palette POINTER TABLES: each BG1 / BG2 / BG3 /
//     sprite / Yoshi id, every backdrop color, plus the fixed/universal literal
//     rows, the level-mode-$0A cinema block, and the per-frame palette-animation
//     source rows (header field 11). The complete set of selectable palettes,
//     labelled with what the graphics pipeline knows (see
//     research/graphics-editing/palettes.md).
//   • scenes — the composed CGRAM for each known non-level CONTEXT (boot, title,
//     storybook, retry screen, bonus games, per-world maps), via the shared
//     scene interpreter.
//
// Both axes carry, per swatch, the master-blob BYTE-OFFSET that backs it — the
// exact `PaletteEdit.offset` an edit writes — so the catalog reuses the global
// blob-offset edit model for free (an edit propagates everywhere that offset is
// used, identical to the per-level Palette panel).
//
// The category layout is derived (not hardcoded) from the in-level palette
// program: `mapPaletteProgram` walks `scene_palette_layout` exactly like the
// cart's `CODE_load_palettes` (load-palettes.ts `runPaletteProgram`), recording
// for each CGRAM color index which DP slot (BG1/BG2/…) or literal source backs
// it. So a level-1 BG1 palette = the slot-1 cells offset by the BG1 pointer; the
// fixed sprite rows = the program's literal cells. Robust to the program /
// pointer tables shifting under an asm edit.

import { snesToPC, type SymbolMap } from './symbol-map.ts';
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
/** First backdrop color's blob byte-offset; 256 consecutive BGR-15 words. */
const BACKDROP_BASE_OFFSET = 0x0130;
/** The BG1-alt (DP `$1A`) pointer = BG1 pointer + this (load-palettes.ts). The
 *  in-level program's slot-5 reads here — the object-tint tail of a BG1 palette. */
const BG1_ALT_DELTA = 0x003c;
/** `scene_palette_layout` byte offset of the in-level program (the one the
 *  catalog's category layout is derived from). 0 = `CODE_load_level_palettes`. */
const IN_LEVEL_PROGRAM_START = 0;
/** Program offset of the level-mode-$0A variant (`CODE_load_levelmode_0A_palettes`
 *  enters at `LDX #$00D8`; twin of load-palettes.ts `LEVEL_MODE_0A_START_OFFSET`). */
const MODE_0A_PROGRAM_START = 0xd8;
/** Program offset of the gm13 retry-screen load (`CODE_gm13_prepare_retry_screen`
 *  zeroes the CGRAM mirror, then runs the interpreter at X=$4A — Bank0F.asm:7592). */
const RETRY_PROGRAM_START = 0x4a;
/** Program offset of the gm2A bonus-game load (`CODE_gm2a_load_bonus_game` sets DP
 *  $10..$18 from per-game Bank10 tables, then runs at X=$94 — Bank10.asm:3286). */
const BONUS_PROGRAM_START = 0x94;

/** Resolves a master-blob byte-offset to its PRISTINE (pre-edit) BGR-15 word.
 *  The caller supplies it (the main side reads the base Bank57 blob) so this
 *  module stays file-free; the UI overlays the live edit draft on top. */
export type BaseWord = (offset: number) => number;

/** Where one CGRAM color index's value comes from in the palette program. */
interface ProgramCell {
  /** DP slot 0..6 (0 backdrop, 1 BG1, 2 BG2, 3 BG3, 4 sprite, 5 BG1-alt, 6 Yoshi),
   *  or `-1` for a literal source. */
  slot: number;
  /** For a DP slot: byte offset added to the slot's pointer. For a literal
   *  (slot `-1`): the absolute blob byte-offset. */
  src: number;
}

/** A CGRAM color index + the byte offset (relative to a pointer) that fills it. */
interface CellRef {
  idx: number;
  relOff: number;
}

/**
 * Walk the `scene_palette_layout` program from `startOffset`, recording for each
 * of the 256 CGRAM color indices which palette SOURCE backs it. Mirrors
 * `runPaletteProgram`'s address math but records provenance instead of copying
 * colors (last write wins, like the cart). Indices the program never writes
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
 *  colors-per-row), so a strip lays out one CGRAM row per display row. */
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
    note: 'Per Yoshi color → OBJ palette 5 (CGRAM row 13).',
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
      sublabel: `CGRAM rows ${firstRow}–${lastRow} · global sprite colors (level-invariant)`
    };
  }
  return { label: 'Fixed colors', sublabel: `CGRAM rows ${firstRow}–${lastRow}` };
}

/** All literal cells of a program, split into runs of contiguous source offsets
 *  (each run is one `dw`-literal block in the program, e.g. the universal object
 *  rows vs the fixed sprite rows). Runs come out sorted by offset. */
function literalRuns(cells: (ProgramCell | null)[]): { idx: number; off: number }[][] {
  const lits: { idx: number; off: number }[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c && c.slot === -1) lits.push({ idx: i, off: c.src });
  }
  lits.sort((a, b) => a.off - b.off);
  const runs: { idx: number; off: number }[][] = [];
  let run: { idx: number; off: number }[] = [];
  for (const lit of lits) {
    const prev = run[run.length - 1];
    if (prev && lit.off !== prev.off + 2) {
      runs.push(run);
      run = [];
    }
    run.push(lit);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/** One literal run → a catalog entry (cols = widest CGRAM row it spans). */
function runEntry(
  run: { idx: number; off: number }[],
  label: string,
  sublabel: string,
  baseWord: BaseWord
): PaletteCatalogEntry {
  const refs: CellRef[] = run.map((r) => ({ idx: r.idx, relOff: 0 }));
  const swatches: PaletteCatalogSwatch[] = run.map((r) => ({ offset: r.off, base: baseWord(r.off) }));
  return { label, sublabel, cols: rowWidth(refs), swatches };
}

/** Literal cells → entries, one per contiguous `dw`-literal block. */
function buildFixedGroup(cells: (ProgramCell | null)[], baseWord: BaseWord): PaletteCatalogGroup | null {
  const runs = literalRuns(cells);
  if (runs.length === 0) return null;
  const entries = runs.map((run) => {
    const rows = run.map((r) => r.idx >>> 4);
    const { label, sublabel } = fixedBlockLabel(Math.min(...rows), Math.max(...rows));
    return runEntry(run, label, sublabel, baseWord);
  });
  return {
    id: 'fixed',
    label: 'Fixed / universal colors',
    note: 'Loaded from literal sources in the palette program — the same for every level (not header-selected).',
    entries
  };
}

/** Level-mode $0A ("boss cinema", e.g. the 6-8 Kamek approach autoscroll) skips
 *  the normal header-selected BG tables entirely: its program variant loads one
 *  fixed literal block into CGRAM rows 0–7 (colors 1–15 each) — the complete
 *  BG1/BG2/BG3 palette of every mode-$0A level. This group exposes that block.
 *  Literals the in-level program also loads (the universal rows) are filtered
 *  out — they're already edited via the fixed group; Yoshi/sprite rows come
 *  from their own pointer-table groups. */
function buildMode0AGroup(
  rom: Uint8Array,
  symbols: SymbolMap,
  inLevelCells: (ProgramCell | null)[],
  baseWord: BaseWord
): PaletteCatalogGroup | null {
  const cells = mapPaletteProgram(rom, symbols, MODE_0A_PROGRAM_START);
  const inLevelLiterals = new Set<number>();
  for (const c of inLevelCells) if (c && c.slot === -1) inLevelLiterals.add(c.src);
  const own = cells.map((c) => (c && c.slot === -1 && !inLevelLiterals.has(c.src) ? c : null));
  const runs = literalRuns(own);
  if (runs.length === 0) return null;
  const entries = runs.map((run) =>
    runEntry(run, 'Cinema BG palette', 'CGRAM rows 0–7 · the whole BG palette of a mode-$0A level', baseWord)
  );
  return {
    id: 'mode-0a',
    label: 'Level-mode $0A (boss cinema)',
    note: 'Levels with header LevelMode $0A ignore the BG1/BG2/BG3 palette tables and load this fixed block instead. Their Yoshi / sprite / universal rows still come from the normal groups.',
    entries
  };
}

/** One palette-animation source block: where a header-field-11 animation mode's
 *  per-frame colors live in the blob. Frame starts come from the mode handler's
 *  Bank01 pointer table where one exists — each `dw` entry is the LOW WORD of a
 *  `$5F`-bank blob label (the handlers long-read `[$00]` with bank byte $5F) —
 *  else from a base label + stride. `wordsPerRow` is the handler's copy length;
 *  it's hardcoded per mode because it lives in handler code, not data (pinned by
 *  palette-catalog.test.ts). Ping-pong tables repeat entries — dedup'd. */
interface AnimSourceSpec {
  label: string;
  sublabel: string;
  table?: { symbol: string; count: number };
  direct?: { symbol: string; frames: number; strideWords: number };
  wordsPerRow: number;
}

/** Derived by reading every `DATA_animation_palette_ptr` handler (Bank01.asm
 *  8535–9310): mode → source rows, frame count, copy width, CGRAM destination. */
const ANIM_SOURCES: AnimSourceSpec[] = [
  {
    label: 'Mode 0x01',
    sublabel: '8 frames × 13 · BG1 row 4 colors 3–15 · random-timed cycle',
    table: { symbol: 'DATA_01C47F', count: 8 },
    wordsPerRow: 13
  },
  {
    label: 'Modes 0x02, 0x13–0x14',
    sublabel: '4 frames × 3 · row 0 colors 5–7 · speed follows the player',
    direct: { symbol: 'DATA_5FA190', frames: 4, strideWords: 3 },
    wordsPerRow: 3
  },
  {
    label: 'Mode 0x03',
    sublabel: '4 frames × 16 · BG2 row 7',
    direct: { symbol: 'DATA_5FCCEA', frames: 4, strideWords: 16 },
    wordsPerRow: 16
  },
  {
    label: 'Mode 0x04',
    sublabel: '8 frames × 15 · BG2 row 7 colors 1–15',
    table: { symbol: 'DATA_01C574', count: 8 },
    wordsPerRow: 15
  },
  {
    label: 'Modes 0x05–0x07, 0x10, 0x12',
    sublabel: '8 frames × 8 · BG2 row 7 colors 1–8',
    direct: { symbol: 'DATA_5FDA00', frames: 8, strideWords: 8 },
    wordsPerRow: 8
  },
  {
    label: 'Modes 0x05–0x07, 0x13–0x14',
    sublabel: '8 frames × 19 · cols 1–13 → BG1 row 4 colors 3–15; cols 14–19 → row 0 colors 2–7 (mode 0x05)',
    table: { symbol: 'DATA_01C634', count: 8 },
    wordsPerRow: 19
  },
  {
    label: 'Modes 0x06–0x07, 0x0E',
    sublabel: '4 frames × 4 · BG1 row 5 colors 3–6',
    table: { symbol: 'DATA_01C5EA', count: 4 },
    wordsPerRow: 4
  },
  {
    label: 'Mode 0x08',
    sublabel: '4 frames × 4 · BG1 row 5 colors 3–6',
    table: { symbol: 'DATA_01C67A', count: 4 },
    wordsPerRow: 4
  },
  {
    label: 'Mode 0x09',
    sublabel: '5-step ping-pong · colors 1 and 9',
    direct: { symbol: 'DATA_5FC932', frames: 1, strideWords: 5 },
    wordsPerRow: 5
  },
  {
    label: 'Modes 0x0A, 0x0E, 0x12',
    sublabel: '4 frames × 4 · BG1 row 5 colors 3–6',
    table: { symbol: 'DATA_01C6FA', count: 4 },
    wordsPerRow: 4
  },
  {
    label: 'Modes 0x0B–0x0C',
    sublabel: '8 one-shot steps × 3 · row 0 colors 1–3 (flash, then re-arms/disarms)',
    table: { symbol: 'DATA_01C773', count: 8 },
    wordsPerRow: 3
  },
  {
    label: 'Mode 0x0D (BG3 palette even)',
    sublabel: '4-step ping-pong × 3 · row 0 colors 1–3',
    table: { symbol: 'DATA_01C7D2', count: 8 },
    wordsPerRow: 3
  },
  {
    label: 'Mode 0x0D (BG3 palette odd)',
    sublabel: '4-step ping-pong × 3 · row 0 colors 1–3',
    table: { symbol: 'DATA_01C7E2', count: 8 },
    wordsPerRow: 3
  },
  {
    label: 'Modes 0x0E, 0x11, 0x13–0x14',
    sublabel: '8 frames × 16 · BG2 row 6 (half-row picked by BG2-palette parity)',
    table: { symbol: 'DATA_01C836', count: 8 },
    wordsPerRow: 16
  },
  {
    label: 'Mode 0x0F',
    sublabel: '4 frames × 3 · row 0 colors 5–7',
    table: { symbol: 'DATA_01C88F', count: 4 },
    wordsPerRow: 3
  },
  {
    label: 'Modes 0x10, 0x12',
    sublabel: '8 frames × 7 · BG1 row 4 colors 9–15',
    table: { symbol: 'DATA_01C8B3', count: 8 },
    wordsPerRow: 7
  },
  {
    label: 'Mode 0x11',
    sublabel: '16 timer steps × 4 · colors 0–3 · one-way sweep',
    direct: { symbol: 'DATA_5FF95E', frames: 16, strideWords: 4 },
    wordsPerRow: 4
  },
  {
    label: 'Mode 0x12',
    sublabel: '16 timer steps × 4 · colors 0–3 · one-way sweep',
    direct: { symbol: 'DATA_5FF9DE', frames: 16, strideWords: 4 },
    wordsPerRow: 4
  }
];

/** The per-frame palette-animation sources (header field 11). One entry per
 *  source block; blocks shared by several modes appear once, labelled with all
 *  of them. A display row = one animation frame. */
function buildAnimGroup(rom: Uint8Array, symbols: SymbolMap, baseWord: BaseWord): PaletteCatalogGroup | null {
  let blobPC: number;
  try {
    blobPC = symbols.pc('DATA_master_palette_rom_blob');
  } catch {
    return null;
  }
  const entries: PaletteCatalogEntry[] = [];
  for (const spec of ANIM_SOURCES) {
    let starts: number[];
    try {
      if (spec.table) {
        const pc = symbols.pc(spec.table.symbol);
        const set = new Set<number>();
        for (let i = 0; i < spec.table.count; i++) {
          const w = u16le(rom, pc + i * 2);
          set.add(snesToPC(0x5f0000 | w) - blobPC);
        }
        starts = [...set].sort((a, b) => a - b);
      } else {
        const d = spec.direct!;
        const base = symbols.pc(d.symbol) - blobPC;
        starts = Array.from({ length: d.frames }, (_, i) => base + i * d.strideWords * 2);
      }
    } catch {
      continue; // a source symbol is absent — skip the entry
    }
    const swatches: PaletteCatalogSwatch[] = [];
    for (const s of starts) {
      for (let w = 0; w < spec.wordsPerRow; w++) {
        const offset = (s + w * 2) & 0xffff;
        swatches.push({ offset, base: baseWord(offset) });
      }
    }
    entries.push({ label: spec.label, sublabel: spec.sublabel, cols: spec.wordsPerRow, swatches });
  }
  if (entries.length === 0) return null;
  return {
    id: 'anim',
    label: 'Palette animations',
    note: 'Per-frame color-cycling sources (header field 11, animation palette). A display row = one frame, copied at runtime over the CGRAM cells named in each caption. The static canvas render does not show these.',
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

  // Backdrop — the 16 solid background (CGRAM index 0) colors a level can pick.
  // The header BG-color field is 5-bit ($00..$1F): $00..$0F select these solid
  // colors, $10..$1F select a sky gradient instead (edited via the separate
  // gradient editor, not here). The palette blob continues past this window with
  // more words, but no level header can reach them (5-bit max is $1F, and $10+ is
  // the gradient range), so only these 16 are meaningful to edit.
  const backdrop: PaletteCatalogSwatch[] = [];
  for (let i = 0; i < 16; i++) {
    const offset = (BACKDROP_BASE_OFFSET + i * 2) & 0xffff;
    backdrop.push({ offset, base: baseWord(offset) });
  }
  groups.push({
    id: 'backdrop',
    label: 'Backdrop colors',
    note: 'The 16 solid background (CGRAM index 0) colors — header BG color $00–$0F picks one ($10+ selects a gradient instead).',
    entries: [{ label: 'Backdrop palette', sublabel: '16 colors · header BG color $00–$0F', cols: 16, swatches: backdrop }]
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

  // The level-mode-$0A cinema block + the palette-animation sources.
  const mode0a = buildMode0AGroup(rom, symbols, cells, baseWord);
  if (mode0a) groups.push(mode0a);
  const anim = buildAnimGroup(rom, symbols, baseWord);
  if (anim) groups.push(anim);

  return groups;
}

/**
 * The per-world dominant level-icon panel background color (the "World map
 * panels" group). Each world's level-select panel draws at a per-world palette
 * ROW — the `DATA_17C9EA` tint (`value >> 10`: W1→3, W2→4, W3→5, W4→0, W5→1,
 * W6→2) — and the panel's background fill is column 12 of that row. So a world's
 * panel color is CGRAM[`tintRow*16 + 12`] on its own map screen.
 *
 * Worlds whose tint row is 3–6 read from the SHARED literal block (one blob
 * offset → one edit recolors everywhere). Worlds whose tint row is 0–2 read
 * from the PER-WORLD sub-palettes, and the cart stores the same color once in
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
    note: 'Dominant level-icon panel background color per world (its world-tab tinted into a palette row). Worlds 4–6 store the color once per world palette; editing one swatch updates every copy.',
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
 *  their composed color and are display-only. */
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
  // Program X=$4A — the gm13 "Try again?" continue prompt (after losing Baby
  // Mario). The loader zeroes the CGRAM mirror and the screen is OBJ-only
  // (TM=$10), so the snapshot's black cells are faithful: 30 exclusive blob
  // words into OBJ rows 14–15 over black. (Row 14 is provably drawn; row 15's
  // palette bits live in GSU cel data — see Bank0F.asm:7584+.)
  push('Retry screen', '"Try again?" prompt (gm13) — OBJ rows 14–15 over black', () => ({
    startOffset: RETRY_PROGRAM_START,
    slots: []
  }));

  const maps: SceneDesc[] = [];
  for (let w = 0; w < WORLD_COUNT; w++) {
    try {
      maps.push({ label: `World ${w + 1} map`, sublabel: 'Overworld level-select', palette: mapPalette(rom, symbols, w) });
    } catch {
      /* skip a world whose map palette can't resolve */
    }
  }

  // Bonus games (gm2A) — program $94 with per-game DP slots from the Bank10
  // tables (`CODE_gm2a_load_bonus_game`): $10/$12 = the game's own rows, $14/$16
  // both point at the shared item-card block (+0x2860, also the title/map item
  // row), $18 = Yoshi. Yoshi's slot is snapshotted green — its cells are the
  // same blob offsets the Yoshi group edits.
  const BONUS_GAME_COUNT = 6;
  const bonusGames: SceneDesc[] = [];
  try {
    const t0 = symbols.pc('DATA_109A88');
    const t1 = symbols.pc('DATA_109A94');
    const t2 = symbols.pc('DATA_109AA0');
    const t3 = symbols.pc('DATA_109AAC');
    const yoshiGreen = u16le(rom, symbols.pc('DATA_yoshi_palette_ptrs'));
    for (let g = 0; g < BONUS_GAME_COUNT; g++) {
      bonusGames.push({
        label: `Bonus game ${g + 1}`,
        sublabel: 'gm2A post-level bonus game · Yoshi row shown green',
        palette: {
          startOffset: BONUS_PROGRAM_START,
          slots: [
            u16le(rom, t0 + g * 2),
            u16le(rom, t1 + g * 2),
            u16le(rom, t2 + g * 2),
            u16le(rom, t3 + g * 2),
            yoshiGreen
          ]
        }
      });
    }
  } catch {
    /* bonus-game tables unavailable — skip the group */
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
  // program (Bank10.asm:10716, yi-shiny scene-palettes.md §3.4): OBJ half (colors
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
  const bonusEntries = bonusGames.map(toEntry).filter((e): e is PaletteCatalogEntry => e !== null);
  if (bonusEntries.length > 0) {
    groups.push({
      id: 'scene-bonus',
      label: 'Bonus games',
      note: 'Post-level bonus-game screens (one per game). Rows 3–6 and 9–12 come from the shared item-card block in every game; the per-game colors are the rest.',
      entries: bonusEntries
    });
  }

  const panels = buildWorldPanelGroup(rom, symbols, baseWord);
  if (panels) groups.push(panels);

  const mapEntries = maps.map(toEntry).filter((e): e is PaletteCatalogEntry => e !== null);
  if (mapEntries.length > 0) {
    groups.push({
      id: 'scene-maps',
      label: 'World maps',
      note: 'Per-world overworld palette (tinted level-select). Shares blob colors with levels.',
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
