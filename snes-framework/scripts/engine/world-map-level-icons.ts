// World-map per-level ICON export — the editable "meta" view of the overworld's
// unique per-level icons (the little level-select pictures: Shy Guys, Boos, bosses,
// EXTRA-star / BONUS panels). DISTINCT from the marker/castle frames (`screen-gfx.ts`
// `exportWorldMapIcons`, which are BG-tilemap stamps): these icons are GSU-PLOTTED
// OAM sprites whose CHR lives UNCOMPRESSED in **cart bank $53** in the GSU "chunky"
// format — **1 byte/pixel, 256-byte row stride** — the same family as the
// `sprite-glyph` boss sheet, so this mirrors that module's decode + RMW write-back.
//
// Each level's icon is a **24×24** picture (see ICON_W). Its bank-$53 source offset is read from a
// CART descriptor table: `DATA_08DA2E + R3*3` (a 3-byte pointer), `R3` = the global
// level index = `world*12 + slot`. So the offset AND pixels are 100% cart-derived.
//
// TWO ICONS PER CHUNKY BYTE (the "column A / column B" packing). The descriptor
// offset alone is ambiguous: worlds 0↔4 and 1↔5 share the SAME offset yet show
// DIFFERENT icons. The disambiguator is the per-slot GSU plot-X from the cart table
// `DATA_17DBA3[world][slot]` — X=$11 selects column A = the byte's **low** nibble,
// X=$15 selects column B = the **high** nibble. (The capture report's hypothesised
// "source-column shift" was wrong: there is no shift — the two columns are the two
// nibbles of one byte. Empirically validated against the live overworld capture for
// all 6 worlds, `tmp/wm-icons/CORRECTED_grid.png`.) Edits slice back to the bank-$53
// `.bin` via `saveRawChrEdit`, RMW-ing only the icon's own nibble.
//
// In the shipped cart the split lands as: worlds 0-3 slots 0-8 (L1..L8 + EXTRA) =
// low nibble; worlds 4-5 (all) + every world's BONUS slot = high nibble. We read it
// from `DATA_17DBA3` per slot rather than hard-coding, so it stays cart-faithful.
//
// SCOPE: worlds 0-5, slots 0-9 = L1..L8 + EXTRA + BONUS (the 10 icons per the user's
// "8 levels, the extra level, and the bonus"). Slots 10-11 (the SCORE panel + the
// empty trailing slot) are out of scope. Only the per-slot OBJ palette ROW is
// embedded metadata (the icon's OAM palette attribute, capture-derived — pixels
// still come 100% from the cart). Full provenance:
// `research/graphics-editing/world-map-screens.md` + `tmp/wm-icons/REPORT.md`.

import { loadScenePalettes } from './load-palettes.ts';
import { mapPalette } from './screen-gfx.ts';
import { buildPaletteRow } from './color.ts';
import { encodePng, type ImageData } from './png.ts';
import { encodeAsepriteImage } from './aseprite.ts';
import { snesToPC, type SymbolMap } from './symbol-map.ts';

// Each icon PICTURE is 24×24. The GSU plots a 32×32 region, but the per-slot
// descriptor pitch is only 28 (`$1C`) so a full read bleeds the *next* icon in (cols
// 28-31 are the neighbour's left edge), and within the icon's own cell the bottom-right
// is always transparent margin — across all 60 shipped icons the drawn pixels never
// pass column 23 / row 23 (verified, `tmp/margin-check`). So the real icon is the
// top-left 24×24; we crop to it. This (a) drops the foreign right strip, (b) drops the
// transparent margin that otherwise sat as a gap before the palette swatch, and (c)
// keeps editing neighbour-safe (24 < the 28 pitch, so an RMW never reaches the next
// icon's bytes). Cols 24-31 / rows 24-31 keep their base (transparent) values.
const ICON_W = 24;
const ICON_H = 24;
const ROW_STRIDE = 0x100; // chunky 256-byte stride
const SWATCH_PX = 8;
const LEVELS_PER_WORLD = 12;
/** 3-byte descriptors (→ bank-$53 chunky source), indexed by the global level
 *  index `R3 = world*12 + slot`. The cart's own icon-source table. */
const DESC_SYMBOL = 'DATA_08DA2E';
/** Per-world pointer table → 12-byte GSU plot-X lists (bank $17). X=$11 = column A
 *  (low nibble), X=$15 = column B (high nibble). The cart's own column selector. */
const COLUMN_SYMBOL = 'DATA_17DBA3';
const COLUMN_X_HIGH = 0x15; // plot X that selects the high-nibble (column B) icon
/** Worlds 0-5, slots 0-9 (L1..L8 + EXTRA + BONUS). */
const ICON_WORLDS = 6;
const ICON_SLOTS = 10;

/** The uncompressed bank-$53 icon-chunky `.bin`s (by SNES base; relative to assets/yi). */
const ICON_BINS: { baseSnes: number; file: string }[] = [
  { baseSnes: 0x530000, file: 'Graphics/SuperFX/DATA_530000.bin' },
  { baseSnes: 0x538000, file: 'Graphics/SuperFX/DATA_538000.bin' }
];
/** Map a bank-$53 SNES address → its raw `.bin` + byte offset within it, or null. */
function iconBin(snes: number): { file: string; offset: number } | null {
  for (const b of ICON_BINS) if (snes >= b.baseSnes && snes < b.baseSnes + 0x8000) return { file: b.file, offset: snes - b.baseSnes };
  return null;
}

/** Per-(world,slot) OBJ palette row (0..7 → CGRAM 8..15) — the icon's OAM palette
 *  attribute. Capture-derived METADATA (pixels are 100% cart); worlds 0-5 × slots
 *  0-9. From the live icon capture (`tmp/wm-icons/icon-metadata.json`). */
const ICON_PALETTE_ROW: readonly (readonly number[])[] = [
  [0, 1, 1, 0, 0, 0, 1, 1, 0, 0], // world 0
  [0, 1, 1, 1, 0, 1, 0, 0, 0, 0], // world 1
  [1, 0, 0, 0, 0, 0, 1, 1, 0, 0], // world 2
  [0, 1, 0, 0, 1, 0, 0, 0, 0, 0], // world 3
  [0, 1, 0, 1, 0, 0, 1, 0, 0, 0], // world 4
  [0, 0, 1, 1, 0, 0, 1, 0, 0, 0] //  world 5
];

const slotName = (s: number): string => (s < 8 ? `L${s + 1}` : s === 8 ? 'EXTRA' : 'BONUS');

/** The bank-$53 SNES source offset for a slot's icon, from the cart descriptor
 *  table (`DATA_08DA2E + R3*3`, `R3 = world*12 + slot`). Fully cart-derived. */
export function levelIconSource(rom: Uint8Array, symbols: SymbolMap, world: number, slot: number): number {
  const o = symbols.pc(DESC_SYMBOL) + (world * LEVELS_PER_WORLD + slot) * 3;
  return rom[o]! | (rom[o + 1]! << 8) | (rom[o + 2]! << 16);
}

/** True if a slot draws "column B" (the chunky byte's HIGH nibble), per the cart's
 *  per-slot GSU plot-X table `DATA_17DBA3[world][slot]` (X=$15 → high). The two icons
 *  packed in one byte share a descriptor offset; this picks which nibble is ours. */
export function levelIconHighNibble(rom: Uint8Array, symbols: SymbolMap, world: number, slot: number): boolean {
  const lo = rom[symbols.pc(COLUMN_SYMBOL) + world * 2]! | (rom[symbols.pc(COLUMN_SYMBOL) + world * 2 + 1]! << 8);
  const listPc = snesToPC(0x170000 | lo); // the 12-byte X list lives in bank $17
  return rom[listPc + slot]! === COLUMN_X_HIGH;
}

/** Per-world decode context — just the per-world overworld CGRAM (icons colour
 *  against the map palette, like `mapPalette` for the BG). */
export interface LevelIconContext {
  rom: Uint8Array;
  symbols: SymbolMap;
  world: number;
  cgram: Uint8Array;
}
export function buildLevelIconContext(rom: Uint8Array, symbols: SymbolMap, world: number): LevelIconContext {
  const cgram = new Uint8Array(512);
  loadScenePalettes(rom, symbols, mapPalette(rom, symbols, world), cgram);
  return { rom, symbols, world, cgram };
}

/** OBJ palette row as ARGB, index 0 transparent (the icon's background). */
const iconPalette = (cgram: Uint8Array, row: number): Uint32Array => buildPaletteRow(cgram, 8 + row, true);
const paletteIndexOf = (palette: Uint32Array, u: number): number => {
  for (let i = 1; i < 16; i++) if (palette[i] === u) return i;
  return 0;
};

/** The chunky source nibble for one byte — high (column B) or low (column A). */
const nibbleOf = (byte: number, high: boolean): number => (high ? (byte >> 4) : byte) & 0x0f;

/** Decode a 24×24 icon (chunky, one nibble of each byte) → indices, from the cart. */
function decodeIcon(rom: Uint8Array, snes: number, high: boolean): Uint8Array {
  const pc = snesToPC(snes);
  const out = new Uint8Array(ICON_W * ICON_H);
  for (let y = 0; y < ICON_H; y++) for (let x = 0; x < ICON_W; x++) out[y * ICON_W + x] = nibbleOf(rom[pc + y * ROW_STRIDE + x]!, high);
  return out;
}

export interface LevelIconCanvas {
  world: number;
  slot: number;
  name: string;
  srcSnes: number;
  paletteRow: number;
  /** True if this icon is the HIGH nibble (column B) of the shared chunky byte. */
  highNibble: boolean;
  /** 24×24 nibble indices (the base, for the slice). */
  indices: Uint8Array;
  width: number;
  height: number;
  /** Source maps cleanly to bank-$53 bins → slice-back is safe. */
  faithful: boolean;
}

/** Render one level-slot icon: decode the cart bank-$53 chunky → 32×32 indices +
 *  metadata, or `null` if the slot is out of the supported subset. */
export function renderWorldMapLevelIcon(ctx: LevelIconContext, slot: number): LevelIconCanvas | null {
  if (slot < 0 || slot >= ICON_SLOTS) return null;
  const srcSnes = levelIconSource(ctx.rom, ctx.symbols, ctx.world, slot);
  const highNibble = levelIconHighNibble(ctx.rom, ctx.symbols, ctx.world, slot);
  const faithful = iconBin(srcSnes) !== null && iconBin(srcSnes + (ICON_H - 1) * ROW_STRIDE) !== null;
  return {
    world: ctx.world, slot, name: slotName(slot), srcSnes, highNibble,
    paletteRow: ICON_PALETTE_ROW[ctx.world]?.[slot] ?? 0,
    indices: decodeIcon(ctx.rom, srcSnes, highNibble), width: ICON_W, height: ICON_H, faithful
  };
}

/** PNG: the 24×24 icon (index 0 transparent) + a full-row OBJ swatch on the right. */
export function levelIconPng(ctx: LevelIconContext, canvas: LevelIconCanvas): Uint8Array {
  const pal = iconPalette(ctx.cgram, canvas.paletteRow);
  const w = ICON_W, h = ICON_H, width = w + SWATCH_PX, height = Math.max(h, 16 * SWATCH_PX);
  const rgba = new Uint8Array(width * height * 4);
  const u32 = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const idx = canvas.indices[y * w + x]!; if (idx !== 0) u32[y * width + x] = pal[idx]!; }
  for (let i = 0; i < 16; i++) { const c = pal[i]!; if (c === 0) continue; for (let dy = 0; dy < SWATCH_PX; dy++) for (let dx = 0; dx < SWATCH_PX; dx++) u32[(i * SWATCH_PX + dy) * width + (w + dx)] = c; }
  const image: ImageData = { width, height, rgba };
  return new Uint8Array(encodePng(image));
}

/** One raw-CHR write (the shape `saveRawChrEdit` consumes). */
export interface IconWrite {
  binFile: string;
  offset: number;
  bytes: Uint8Array;
}

/**
 * Slice an edited icon (top-left 24×24 RGBA) → bank-$53 `.bin` writes — base-aware
 * (an unedited pixel keeps its base index) + RMW (only THIS icon's nibble is
 * rewritten; the other column's nibble in the shared byte is preserved), one write
 * per chunky row (256-byte stride). The 24-wide slice never touches the next icon's
 * bytes (cols 28-31 belong to the neighbour). Returns null if a row is outside the bins.
 */
export function sliceLevelIconWrites(
  ctx: LevelIconContext,
  canvas: LevelIconCanvas,
  editedRgba: Uint8Array
): { writes: IconWrite[]; changed: boolean } | null {
  const pal = iconPalette(ctx.cgram, canvas.paletteRow);
  const pc = snesToPC(canvas.srcSnes);
  const high = canvas.highNibble;
  const u32 = new Uint32Array(editedRgba.buffer, editedRgba.byteOffset, ICON_W * ICON_H);
  const writes: IconWrite[] = [];
  let changed = false;
  for (let y = 0; y < ICON_H; y++) {
    const bin = iconBin(canvas.srcSnes + y * ROW_STRIDE);
    if (!bin) return null;
    const bytes = new Uint8Array(ICON_W);
    for (let x = 0; x < ICON_W; x++) {
      const cur = ctx.rom[pc + y * ROW_STRIDE + x]!;
      const baseIdx = nibbleOf(cur, high);
      const u = u32[y * ICON_W + x]!;
      const idx = u === pal[baseIdx] ? baseIdx : paletteIndexOf(pal, u);
      // Preserve the OTHER column's nibble (the icon sharing this byte).
      const next = high ? ((cur & 0x0f) | (idx << 4)) : ((cur & 0xf0) | idx);
      if (next !== cur) changed = true;
      bytes[x] = next;
    }
    writes.push({ binFile: bin.file, offset: bin.offset, bytes });
  }
  return { writes, changed };
}

/** The icon as a single-image (no-tilemap) `.aseprite`: the 24×24 indexed image (the
 *  chunky nibble indices directly) + its OBJ palette row (index 0 transparent). Import
 *  flattens it back → `sliceLevelIconWrites`, like the PNG. */
export function levelIconAseprite(ctx: LevelIconContext, canvas: LevelIconCanvas): Uint8Array {
  return encodeAsepriteImage({
    width: canvas.width, height: canvas.height,
    pixels: canvas.indices.slice(), palette: iconPalette(ctx.cgram, canvas.paletteRow),
    transparentIndex: 0, layerName: `level-icon-${canvas.world}-${canvas.slot}`
  });
}

export interface LevelIconPngEntry {
  world: number;
  slot: number;
  name: string;
  faithful: boolean;
  width: number;
  height: number;
  png: Uint8Array;
  /** The same icon as a single-image `.aseprite` (built only when requested). */
  aseprite?: Uint8Array;
}

/**
 * Export the per-level icons for every world (0-5, slots 0-9 = L1..L8 + EXTRA +
 * BONUS) — the editable assembled icon, coloured by the world's overworld palette.
 * Pixels come from the cart bank-$53 chunky data (the right nibble per the cart's
 * column table); the per-slot palette row is the only embedded metadata.
 */
export function exportWorldMapLevelIcons(rom: Uint8Array, symbols: SymbolMap, opts: { aseprite?: boolean } = {}): LevelIconPngEntry[] {
  const out: LevelIconPngEntry[] = [];
  for (let world = 0; world < ICON_WORLDS; world++) {
    const ctx = buildLevelIconContext(rom, symbols, world);
    for (let slot = 0; slot < ICON_SLOTS; slot++) {
      const c = renderWorldMapLevelIcon(ctx, slot);
      if (!c) continue;
      out.push({
        world, slot, name: c.name, faithful: c.faithful, width: c.width, height: c.height,
        png: levelIconPng(ctx, c),
        aseprite: opts.aseprite && c.faithful ? levelIconAseprite(ctx, c) : undefined
      });
    }
  }
  return out;
}
